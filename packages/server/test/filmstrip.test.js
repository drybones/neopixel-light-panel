const test = require('node:test');
const assert = require('node:assert');

const { Compositor } = require('../engine/compositor');
const { SceneStore } = require('../engine/scene-store');
const {
    renderFilmstrip, renderEffectFilmstrip, warmupMsFor, FRAMES,
    DEFAULT_WARMUP_MS, MAX_WARMUP_MS,
} = require('../engine/filmstrip');
const { PreviewCache, EffectPreviewCache } = require('../engine/preview-cache');
const effects = require('../effects');

function makeModel(n) {
    const model = [];
    for (let i = 0; i < n; i++) {
        model.push({ point: [(i - (n - 1) / 2) * 0.25, 0, 0] });
    }
    return model;
}

const MODEL = makeModel(24);

// Scenes have to come out of a store: the filmstrip renders through
// renderFrame, which reads the _prepared/_blend/_displayLayers that
// preprocess() attaches on the write path.
function makeStore() {
    const sink = { setPixel() {}, writePixels() {} };
    return new SceneStore(new Compositor(sink, MODEL), null);
}

function sceneWith(layers) {
    const store = makeStore();
    store.setScenes([{ id: 's1', name: 'test', layers }]);
    return { store, scene: store.scenes[0] };
}

test('a filmstrip is one RGB byte per pixel per frame', () => {
    const { scene } = sceneWith([{ effectType: 'solid', params: { color: '#204080' } }]);
    const strip = renderFilmstrip(scene, MODEL);
    assert.strictEqual(strip.length, FRAMES * MODEL.length * 3);
});

test('a static scene renders its own colour on every frame', () => {
    const { scene } = sceneWith([{ effectType: 'solid', params: { color: '#204080' } }]);
    const strip = renderFilmstrip(scene, MODEL);
    for (let f = 0; f < FRAMES; f++) {
        const o = f * MODEL.length * 3;
        assert.deepStrictEqual(
            [strip[o], strip[o + 1], strip[o + 2]], [0x20, 0x40, 0x80],
            'frame ' + f + ' should be the layer colour',
        );
    }
});

// The seam is the whole reason the strip is rendered longer than it ships: a
// plain cut undoes the entire loop's motion in one step, which reads as a
// glitch. Measured as a step size, the wrap should be an ordinary frame
// transition, not an outlier — this fails loudly if the crossfade is dropped.
test('the loop wraps without a jump', () => {
    const stride = MODEL.length * 3;
    const step = (strip, from, to) => {
        let sum = 0;
        for (let i = 0; i < stride; i++) sum += Math.abs(strip[from * stride + i] - strip[to * stride + i]);
        return sum / stride;
    };

    // noise and embers are the discriminating cases — uncrossfaded they wrap
    // at 23x and 9x the median step. wavelet is near-periodic over the loop
    // and would pass either way; it is here to catch the fade *breaking* a
    // case that was already fine.
    for (const layers of [
        [{ effectType: 'wavelet', params: { freq: 1 } }],
        [{ effectType: 'embers' }],
        [{ effectType: 'noise' }],
    ]) {
        const { scene } = sceneWith(layers);
        const strip = renderFilmstrip(scene, MODEL);

        const steps = [];
        for (let f = 0; f < FRAMES - 1; f++) steps.push(step(strip, f, f + 1));
        steps.sort((a, b) => a - b);
        const median = steps[steps.length >> 1];
        const wrap = step(strip, FRAMES - 1, 0);

        assert.ok(
            wrap <= median * 3 + 1,
            `${layers[0].effectType}: wrap step ${wrap.toFixed(1)} should be near the median frame step ${median.toFixed(1)}`,
        );
    }
});

test('an animated scene differs between frames', () => {
    const { scene } = sceneWith([{ effectType: 'wavelet', params: { freq: 1 } }]);
    const strip = renderFilmstrip(scene, MODEL);
    const stride = MODEL.length * 3;
    const first = strip.slice(0, stride);
    const later = strip.slice(5 * stride, 6 * stride);
    assert.notDeepStrictEqual(Array.from(first), Array.from(later));
});

// Particle effects seed lazily off `millis`, so without the warm-up the first
// captured frame is an empty field. embers additionally tests `if (!q.born)`,
// which makes a born time of 0 falsy and re-seeds every particle every frame —
// a zero time base renders the layer permanently black.
test('particle effects are lit by the time capture starts', () => {
    for (const effectType of ['embers', 'candy_sparkler']) {
        const { scene } = sceneWith([{ effectType }]);
        const strip = renderFilmstrip(scene, MODEL);
        const stride = MODEL.length * 3;
        let lit = 0;
        for (let i = 0; i < stride; i++) if (strip[i] > 0) lit++;
        assert.ok(lit > 0, effectType + ' should not be black on the first captured frame');
    }
});

// An emitter ramps up from empty over a lifetime and a half, so a fixed
// warm-up budget is only ever right for one point of the Lifetime slider. The
// effect says what it needs and the scene's slowest layer sets the length.
test('the warm-up is derived from the scene rather than fixed', () => {
    const emitter = effects.get('emitter');
    const withEmitter = (params) => sceneWith([
        { effectType: 'emitter', params: { ...emitter.defaults, ...params } },
    ]).scene;

    assert.strictEqual(
        warmupMsFor(sceneWith([{ effectType: 'solid' }]).scene), DEFAULT_WARMUP_MS,
        'an effect that needs no warm-up should not lengthen one',
    );

    // Two of the longest lifetime the layer can produce, plus a second.
    assert.strictEqual(warmupMsFor(withEmitter({ life: 9, lifeSpread: 0.5 })), 28000);
    // Short-lived layers settle sooner than the old fixed 8s, and pay less.
    assert.ok(warmupMsFor(withEmitter({ life: 1.5, lifeSpread: 0.33 })) < DEFAULT_WARMUP_MS);

    const mixed = sceneWith([
        { effectType: 'solid' },
        { effectType: 'emitter', params: { ...emitter.defaults, life: 1, lifeSpread: 0 } },
        { effectType: 'emitter', params: { ...emitter.defaults, life: 9, lifeSpread: 0.5 } },
    ]).scene;
    assert.strictEqual(warmupMsFor(mixed), 28000, 'the slowest layer sets the budget');

    // A typed lifetime is unclamped by design — a schema min/max is a slider
    // hint — so the cap is what stops one layer stalling the preview cache.
    assert.strictEqual(warmupMsFor(withEmitter({ life: 600 })), MAX_WARMUP_MS);
});

// The whole point of warming up: a card must show a settled emitter, never the
// ramp. One point of the Lifetime slider is enough to check it, as long as it
// is one the old fixed budget could not cover — with an 8s warm-up this layer
// is a fifth as bright and still climbing, at 1.65x across the strip.
test('a long-lived emitter is settled by the time capture starts', () => {
    const emitter = effects.get('emitter');
    // Deterministic on purpose: no lifetime spread, no motion, one colour, and
    // laid along MODEL's single row of pixels, so the frame energies read the
    // birth schedule rather than a realisation of it. Dim and spread out so
    // nothing clips on the way to bytes.
    const { scene } = sceneWith([{ effectType: 'emitter', params: {
        ...emitter.defaults, color: '#404040', count: 24, life: 20, lifeSpread: 0,
        swell: 1, speed: 0, speedSpread: 0, spread: 1, grav: 0, hueSpread: 0,
        x: 0, y: 0, extX: 5, extY: 0, size: 0.2,
    } }]);
    const strip = renderFilmstrip(scene, MODEL);

    const stride = MODEL.length * 3;
    const energy = (from, to) => {
        let sum = 0;
        for (let f = from; f < to; f++) for (let i = 0; i < stride; i++) sum += strip[f * stride + i];
        return sum / (to - from);
    };
    // Frames 0..FADE_FRAMES-1 are crossfaded with the continuation, so measure
    // between two stretches of untouched ones.
    const head = energy(12, 20), tail = energy(32, 40);
    assert.ok(head > 0, 'the strip is black');
    assert.ok(Math.abs(tail / head - 1) < 0.1,
        `the strip is still filling: ${head.toFixed(0)} at the head, ${tail.toFixed(0)} at the tail`);
});

test('rendering a scene does not disturb the live compositor', () => {
    const { store, scene } = sceneWith([{ effectType: 'embers' }]);
    const before = store.compositor.getLayerBuffer(scene.layers[0].id);
    renderFilmstrip(scene, MODEL);
    const after = store.compositor.getLayerBuffer(scene.layers[0].id);
    assert.strictEqual(before, after, 'the live layer buffer should be untouched');
});

test('the cache re-renders only when scene content changes', () => {
    const { store, scene } = sceneWith([{ effectType: 'solid', params: { color: '#204080' } }]);
    const cache = new PreviewCache(MODEL);

    const first = cache.get(scene);
    assert.strictEqual(cache.get(scene).data, first.data, 'an unchanged scene should hit the cache');

    scene.layers[0].params.color = '#ff0000';
    store.preprocess(scene);
    const edited = cache.get(scene);
    assert.notStrictEqual(edited.hash, first.hash);
    assert.strictEqual(Buffer.from(edited.data, 'base64')[0], 255);
});

// The picker used to need a hand-picked colour per effect in the UI, so the
// point of these is that adding an effect module is enough on its own.
test('every registered effect renders a lit filmstrip from its defaults', () => {
    const catalog = effects.list();
    assert.ok(catalog.length > 0);
    for (const effect of catalog) {
        const strip = renderEffectFilmstrip(effect, MODEL);
        assert.strictEqual(strip.length, FRAMES * MODEL.length * 3, effect.type + ' length');
        let lit = 0;
        for (let i = 0; i < strip.length; i++) if (strip[i] > 0) lit++;
        assert.ok(lit > 0, effect.type + ' should render something at its defaults');
    }
});

test('effect previews are keyed by type and rendered once', async () => {
    const cache = new EffectPreviewCache(MODEL);
    const visible = effects.visible();
    const all = await cache.all(visible);
    assert.deepStrictEqual(all.map((p) => p.id), visible.map((e) => e.type));

    const solid = effects.get('solid');
    assert.strictEqual(cache.get(solid).data, cache.get(solid).data);
    assert.strictEqual(cache.entries.size, visible.length);
});

// An effect's presets are starting points inside its layer editor, not extra
// things to add, so they must not multiply the picker's tiles.
test('presets do not add picker tiles', async () => {
    const emitter = effects.get('emitter');
    assert.ok(emitter.presets.length > 1, 'emitter should ship several presets');

    const types = effects.visible().map((e) => e.type);
    assert.strictEqual(types.filter((t) => t === 'emitter').length, 1);
    assert.strictEqual(new Set(types).size, types.length, 'one tile per effect');

    const cache = new EffectPreviewCache(MODEL);
    await cache.all(effects.visible());
    assert.strictEqual(cache.entries.size, effects.visible().length);
});

// The superseded effects still render, so a layer that predates the migration
// is never blank — but nothing should offer them as a new layer.
test('hidden effects are absent from the picker but still resolvable', () => {
    const types = effects.visible().map((e) => e.type);
    assert.ok(!types.includes('candy_sparkler'));
    assert.ok(!types.includes('embers'));
    assert.ok(effects.get('embers'));
});

test('the cache forgets scenes that no longer exist', async () => {
    const store = makeStore();
    store.setScenes([
        { id: 'a', name: 'a', layers: [{ effectType: 'solid' }] },
        { id: 'b', name: 'b', layers: [{ effectType: 'solid' }] },
    ]);
    const cache = new PreviewCache(MODEL);
    await cache.all(store.scenes);
    assert.strictEqual(cache.entries.size, 2);

    store.remove('b');
    await cache.all(store.scenes);
    assert.deepStrictEqual([...cache.entries.keys()], ['a']);
});
