/*
 * Filmstrip renderer — a short looping capture of any scene, active or not.
 *
 * The scene selector needs to show what each scene looks like, but the render
 * loop only ever renders the active one (app.js), so there is no frame to send
 * for the other 22 cards. Rather than run a second live loop, this renders a
 * fixed 4s loop per scene once, off the hot path; the client caches it and
 * plays it back. Two properties of the engine make that cheap:
 *
 *   - Every effect is a pure function of *absolute* millis — none integrate a
 *     fixed dt — so a 4s loop costs FRAMES renders, not 4s worth of ticks. The
 *     step below is the playback interval, nothing to do with the 10ms tick.
 *   - SceneStore.preprocess() already runs on every scene, so _prepared,
 *     _blend and _displayLayers are there for the taking.
 *
 * The one thing that cannot be borrowed is the live Compositor: renderFrame
 * writes the composite out through client.setPixel, i.e. to the panel. So this
 * builds a throwaway Compositor over a no-op sink. That also gives it its own
 * layer instance map, which matters — warming up a scene's particles through
 * the live compositor would jump them the next time it went active.
 */

const { Compositor } = require('./compositor');
const effects = require('../effects');
const toByte = require('./color').toByte;

// 40 frames at 100ms is a 4.0s loop, ~38KB of base64 per scene. The length is
// a compromise between the seam coming round often enough to notice and the
// client's cost, which is all in the payload and the sprite sheet the UI
// blooms from it (~3.7MB of canvas per visible card) — the render itself is
// nothing next to the warm-up below.
const FRAMES = 40;
const INTERVAL_MS = 100;

// The loop is not naturally cyclic — particle effects are not periodic at
// all, and a multi-layer scene's period is an unusable LCM — so the last
// frame cutting back to the first undoes 4s of motion in one step, which reads
// as a glitch rather than a loop. Instead, render FADE_FRAMES *past* the end
// and dissolve that continuation into the head, so frame FRAMES genuinely is
// frame 0. It costs a few renders and nothing at all in payload or on the
// client: the extra frames are consumed by the blend, not shipped. During the
// dissolve a particle effect briefly double-exposes; at 30x8 under the UI's
// bloom that reads as a soft cross-dissolve. Static scenes are untouched,
// since identical frames blend to themselves.
//
// 12 frames (1.2s): measured as a step size against the median step between
// ordinary frames, a plain cut is over 20x for the discriminating cases
// (noise, an aperiodic particle field), 6 frames brings the worst to 3.4x,
// and 12 brings every effect inside 2x. 16 buys nothing and ghosts for
// longer. See test/filmstrip.test.js.
const FADE_FRAMES = 12;

// Particle effects seed lazily, so frame 1 of a fresh instance is empty, and
// an emitter additionally *ramps* — it fills from empty at count/life births
// per second, which is the look on the panel and exactly the wrong thing to
// capture in a card. So the warm-up has to outlast whatever the scene's
// slowest layer takes to settle: effects that need one say so with
// warmupMs(prepared), and the rest get 8s. Discarded frames, coarser steps
// than playback — none of this is captured.
//
// The step is also a floor on how finely the ramp can be paced: the emitter's
// gate hands out births by elapsed time rather than per frame, so a coarse
// step still fills at the right rate, but do not raise it past the shortest
// lifetime a layer can have (0.2s) or a whole generation would live and die
// inside one warm-up frame.
const WARMUP_STEP_MS = 200;
const DEFAULT_WARMUP_MS = 8000;
// A typed lifetime is deliberately unclamped — a schema min/max is a slider
// hint — so a layer can ask for any warm-up at all, and every millisecond of
// it is renders on the same thread as the 10ms tick. The whole slider fits
// under this (life 10s at lifeSpread 1 asks for 41s, ~200 renders, measured at
// 22ms for a full-density emitter over the real panel); past it, a card
// showing a still-filling layer is the better failure.
const MAX_WARMUP_MS = 60000;

function warmupMsFor(scene) {
    const layers = scene._displayLayers || scene.layers || [];
    let ms = 0;
    for (let i = 0; i < layers.length; i++) {
        const effect = effects.get(layers[i].effectType);
        const want = effect && effect.warmupMs
            ? effect.warmupMs(layers[i]._prepared || {})
            : DEFAULT_WARMUP_MS;
        if (want > ms) ms = want;
    }
    return ms > MAX_WARMUP_MS ? MAX_WARMUP_MS : ms;
}

// Fixed base so a filmstrip is reproducible apart from the effects' own
// Math.random. It must not be 0: a particle effect testing a falsy birth
// time to decide whether a slot needs seeding would treat a born time of 0
// as unseeded and re-seed it every single frame, rendering the layer black.
// `emitter` carries an explicit `alive` flag for exactly this reason.
const TIME_BASE = 1e6;

const NULL_SINK = {
    setPixel() {},
    writePixels() {},
};

// How many renders run back to back before the async path hands the thread
// back. A full-density emitter renders in ~0.1ms, so this is a couple of
// milliseconds between chances for the 10ms tick — where a whole capped
// warm-up (300 renders) done in one go would drop a few frames on the panel.
const YIELD_EVERY = 16;

// The render as a generator that yields every YIELD_EVERY renders and returns
// the bytes, so the sync and async entry points below are one body.
function* filmstripSteps(scene, model) {
    const compositor = new Compositor(NULL_SINK, model);
    compositor.syncScene(scene);

    const numPixels = model.length;
    const stride = numPixels * 3;

    const warmupFrames = Math.ceil(warmupMsFor(scene) / WARMUP_STEP_MS);
    let t = TIME_BASE - warmupFrames * WARMUP_STEP_MS;
    for (let w = 0; w < warmupFrames; w++) {
        compositor.renderFrame(scene, t);
        t += WARMUP_STEP_MS;
        if ((w + 1) % YIELD_EVERY === 0) yield;
    }

    // Capture the loop plus its continuation, in float — the blend below wants
    // full precision, and rounding to bytes happens once on the way out.
    const captured = new Float32Array((FRAMES + FADE_FRAMES) * stride);
    for (let f = 0; f < FRAMES + FADE_FRAMES; f++) {
        compositor.renderFrame(scene, TIME_BASE + f * INTERVAL_MS);
        captured.set(compositor.composite, f * stride);
        if ((f + 1) % YIELD_EVERY === 0) yield;
    }

    // Dissolve the continuation into the head. `a` runs 0→1 across the fade,
    // so frame 0 is nearly all continuation (and so follows frame FRAMES-1
    // almost exactly) and by the end of the fade it is the true frame again.
    const out = new Uint8Array(FRAMES * stride);
    for (let g = 0; g < FRAMES; g++) {
        const base = g * stride;
        if (g < FADE_FRAMES) {
            const a = (g + 1) / (FADE_FRAMES + 1);
            const tail = (FRAMES + g) * stride;
            for (let i = 0; i < stride; i++) {
                out[base + i] = toByte(a * captured[base + i] + (1 - a) * captured[tail + i]);
            }
        } else {
            for (let j = 0; j < stride; j++) {
                out[base + j] = toByte(captured[base + j]);
            }
        }
    }

    return out;
}

// Renders `scene` (as held by SceneStore, i.e. already preprocessed) to a flat
// Uint8Array of FRAMES * numPixels * 3 bytes, frame-major.
function renderFilmstrip(scene, model) {
    const steps = filmstripSteps(scene, model);
    let r;
    do { r = steps.next(); } while (!r.done);
    return r.value;
}

// The same, yielding to the event loop between batches of renders. The scene
// may be edited while this is suspended; the throwaway compositor skips a
// layer it was never synced with, and the cache keys the result on the hash
// taken before rendering, so a stale strip is replaced on the next request.
async function renderFilmstripAsync(scene, model) {
    const steps = filmstripSteps(scene, model);
    let r;
    while (!(r = steps.next()).done) {
        await new Promise((resolve) => { setImmediate(resolve); });
    }
    return r.value;
}

// One effect at its defaults, as a scene of one layer — what the effect
// picker offers you when you add a layer. Built here rather than through
// SceneStore because preprocess() would sync the layer into the *live*
// compositor, and this scene is never going to be rendered by the panel.
function effectScene(effect) {
    const layer = {
        id: `effect-preview-${effect.type}`,
        effectType: effect.type,
        params: effect.defaults,
        blendMode: 'normal',
        opacity: 1,
        enabled: true,
        solo: false,
        _prepared: effect.prepare(effect.defaults),
        _blend: 0,
    };
    const scene = { id: layer.id, name: effect.name, layers: [layer] };
    scene._displayLayers = scene.layers;
    return scene;
}

function renderEffectFilmstrip(effect, model) {
    return renderFilmstrip(effectScene(effect), model);
}

function renderEffectFilmstripAsync(effect, model) {
    return renderFilmstripAsync(effectScene(effect), model);
}

module.exports = {
    renderFilmstrip,
    renderFilmstripAsync,
    renderEffectFilmstrip,
    renderEffectFilmstripAsync,
    warmupMsFor,
    FRAMES,
    YIELD_EVERY,
    INTERVAL_MS,
    DEFAULT_WARMUP_MS,
    MAX_WARMUP_MS,
};
