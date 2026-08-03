/*
 * Filmstrip renderer — a short looping capture of any scene, active or not.
 *
 * The scene selector needs to show what each scene looks like, but the render
 * loop only ever renders the active one (app.js), so there is no frame to send
 * for the other 22 cards. Rather than run a second live loop, this renders a
 * fixed 2s loop per scene once, off the hot path; the client caches it and
 * plays it back. Two properties of the engine make that cheap:
 *
 *   - Every effect is a pure function of *absolute* millis — none integrate a
 *     fixed dt — so a 2s loop costs FRAMES renders, not 2s worth of ticks. The
 *     step below is the playback interval, nothing to do with the 10ms tick.
 *   - SceneStore.preprocess() already runs on every scene, so _prepared,
 *     _blend and _displayLayers are there for the taking.
 *
 * The one thing that cannot be borrowed is the live Compositor: renderFrame
 * writes the composite out through client.setPixel, i.e. to the panel. So this
 * builds a throwaway Compositor over a no-op sink. That also gives it its own
 * layer instance map, which matters — warming up a scene's embers through the
 * live compositor would jump its particles the next time it went active.
 */

var { Compositor } = require('./compositor');

// 40 frames at 100ms is a 4.0s loop, ~38KB of base64 per scene. The length is
// a compromise between the seam coming round often enough to notice and the
// client's cost, which is all in the payload and the sprite sheet the UI
// blooms from it (~3.7MB of canvas per visible card) — the render itself is
// nothing next to the warm-up below.
var FRAMES = 40;
var INTERVAL_MS = 100;

// The loop is not naturally cyclic — embers and the sparkler are not periodic
// at all, and a multi-layer scene's period is an unusable LCM — so the last
// frame cutting back to the first undoes 4s of motion in one step, which reads
// as a glitch rather than a loop. Instead, render FADE_FRAMES *past* the end
// and dissolve that continuation into the head, so frame FRAMES genuinely is
// frame 0. It costs a few renders and nothing at all in payload or on the
// client: the extra frames are consumed by the blend, not shipped. During the
// dissolve a particle effect briefly double-exposes; at 30x8 under the UI's
// bloom that reads as a soft cross-dissolve. Static scenes are untouched,
// since identical frames blend to themselves.
//
// 12 frames (1.2s) was chosen by measuring the wrap as a step size against the
// median step between ordinary frames: a plain cut is 23x for noise and 9x for
// embers, 6 frames brings the worst to 3.4x, and 12 brings every effect inside
// 2x. 16 buys nothing and ghosts for longer. See test/filmstrip.test.js.
var FADE_FRAMES = 12;

// Particle effects seed lazily, so frame 1 of a fresh instance is empty and
// every particle would be born in lockstep. Warm past the longest lifetime
// (embers: millis + random*5000 + 3000) so births are staggered by the time we
// start capturing. Discarded frames, coarser steps — this is 8s of sim time.
var WARMUP_FRAMES = 40;
var WARMUP_STEP_MS = 200;

// Fixed base so a filmstrip is reproducible apart from the effects' own
// Math.random. It must not be 0: embers tests `if (!q.born)` to decide whether
// a particle needs seeding, so a born time of 0 re-seeds it every single frame
// and the layer renders black.
var TIME_BASE = 1e6;

var NULL_SINK = {
    setPixel: function() {},
    writePixels: function() {},
};

function clamp255(v) {
    return v < 0 ? 0 : (v > 255 ? 255 : v | 0);
}

// Renders `scene` (as held by SceneStore, i.e. already preprocessed) to a flat
// Uint8Array of FRAMES * numPixels * 3 bytes, frame-major.
function renderFilmstrip(scene, model) {
    var compositor = new Compositor(NULL_SINK, model);
    compositor.syncScene(scene);

    var numPixels = model.length;
    var stride = numPixels * 3;

    var t = TIME_BASE - WARMUP_FRAMES * WARMUP_STEP_MS;
    for (var w = 0; w < WARMUP_FRAMES; w++) {
        compositor.renderFrame(scene, t);
        t += WARMUP_STEP_MS;
    }

    // Capture the loop plus its continuation, in float — the blend below wants
    // full precision, and rounding to bytes happens once on the way out.
    var captured = new Float32Array((FRAMES + FADE_FRAMES) * stride);
    for (var f = 0; f < FRAMES + FADE_FRAMES; f++) {
        compositor.renderFrame(scene, TIME_BASE + f * INTERVAL_MS);
        captured.set(compositor.composite, f * stride);
    }

    // Dissolve the continuation into the head. `a` runs 0→1 across the fade,
    // so frame 0 is nearly all continuation (and so follows frame FRAMES-1
    // almost exactly) and by the end of the fade it is the true frame again.
    var out = new Uint8Array(FRAMES * stride);
    for (var g = 0; g < FRAMES; g++) {
        var base = g * stride;
        if (g < FADE_FRAMES) {
            var a = (g + 1) / (FADE_FRAMES + 1);
            var tail = (FRAMES + g) * stride;
            for (var i = 0; i < stride; i++) {
                out[base + i] = clamp255(a * captured[base + i] + (1 - a) * captured[tail + i]);
            }
        } else {
            for (var j = 0; j < stride; j++) {
                out[base + j] = clamp255(captured[base + j]);
            }
        }
    }

    return out;
}

// One effect at its defaults, as a scene of one layer — what the effect
// picker offers you when you add a layer. Built here rather than through
// SceneStore because preprocess() would sync the layer into the *live*
// compositor, and this scene is never going to be rendered by the panel.
function renderEffectFilmstrip(effect, model) {
    var layer = {
        id: 'effect-preview-' + effect.type,
        effectType: effect.type,
        params: effect.defaults,
        blendMode: 'normal',
        opacity: 1,
        enabled: true,
        solo: false,
        _prepared: effect.prepare(effect.defaults),
        _blend: 0,
    };
    var scene = { id: layer.id, name: effect.name, layers: [layer] };
    scene._displayLayers = scene.layers;
    return renderFilmstrip(scene, model);
}

module.exports = {
    renderFilmstrip: renderFilmstrip,
    renderEffectFilmstrip: renderEffectFilmstrip,
    FRAMES: FRAMES,
    INTERVAL_MS: INTERVAL_MS,
};
