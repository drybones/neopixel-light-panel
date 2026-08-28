const test = require('node:test');
const assert = require('node:assert');

const { Compositor, BLEND, blendInto } = require('../engine/compositor');
const { SceneStore } = require('../engine/scene-store');

function makeModel(n) {
    const model = [];
    for (let i = 0; i < n; i++) {
        model.push({ point: [(i - (n - 1) / 2) * 0.25, 0, 0] });
    }
    return model;
}

function makeClient() {
    return {
        brightness: 1.0,
        pixels: [],
        writes: 0,
        setPixel(i, r, g, b) {
            this.pixels[i] = [
                Math.max(0, Math.min(255, (r | 0) * this.brightness)),
                Math.max(0, Math.min(255, (g | 0) * this.brightness)),
                Math.max(0, Math.min(255, (b | 0) * this.brightness)),
            ];
        },
        writePixels() { this.writes++; },
    };
}

test('blend math matches hand-computed values', () => {
    const cases = [
        { mode: BLEND.normal, a: 100, b: 200, op: 1.0, expect: 200 },
        { mode: BLEND.normal, a: 100, b: 200, op: 0.5, expect: 150 },
        { mode: BLEND.add, a: 100, b: 200, op: 1.0, expect: 300 },
        { mode: BLEND.add, a: 100, b: 200, op: 0.5, expect: 200 },
        { mode: BLEND.multiply, a: 100, b: 255, op: 1.0, expect: 100 },
        { mode: BLEND.multiply, a: 100, b: 0, op: 1.0, expect: 0 },
        { mode: BLEND.multiply, a: 100, b: 0, op: 0.5, expect: 50 },
        { mode: BLEND.screen, a: 255, b: 128, op: 1.0, expect: 255 },
        { mode: BLEND.screen, a: 0, b: 128, op: 1.0, expect: 128 },
        { mode: BLEND.screen, a: 102, b: 51, op: 1.0, expect: 102 + 51 - 102 * 51 / 255 },
        { mode: BLEND.overlay, a: 0, b: 200, op: 1.0, expect: 0 },
        { mode: BLEND.overlay, a: 255, b: 50, op: 1.0, expect: 255 },
        { mode: BLEND.overlay, a: 64, b: 128, op: 1.0, expect: 2 * 64 * 128 / 255 },

        // Subtract mirrors add: opacity is a source gain, not a mix, and the
        // result is left unclamped so an add above it can bring it back.
        { mode: BLEND.subtract, a: 200, b: 50, op: 1.0, expect: 150 },
        { mode: BLEND.subtract, a: 200, b: 50, op: 0.5, expect: 175 },
        { mode: BLEND.subtract, a: 100, b: 200, op: 1.0, expect: -100 },

        // Difference with white is an invert — the property that makes this
        // the cheap route to a mask, and the reason the guarded form blends
        // the in-range part rather than the raw accumulator.
        { mode: BLEND.difference, a: 200, b: 255, op: 1.0, expect: 55 },
        { mode: BLEND.difference, a: 60, b: 200, op: 1.0, expect: 140 },
        { mode: BLEND.difference, a: 200, b: 60, op: 1.0, expect: 140 },
        { mode: BLEND.difference, a: 90, b: 90, op: 1.0, expect: 0 },

        { mode: BLEND.lighten, a: 100, b: 200, op: 1.0, expect: 200 },
        { mode: BLEND.lighten, a: 200, b: 100, op: 1.0, expect: 200 },
        { mode: BLEND.lighten, a: 100, b: 200, op: 0.5, expect: 150 },
        { mode: BLEND.darken, a: 100, b: 200, op: 1.0, expect: 100 },
        { mode: BLEND.darken, a: 200, b: 100, op: 1.0, expect: 100 },

        // Soft light pivots on mid-grey: 127.5 is identity, black squares the
        // backdrop, white is its complement. Both rails stay put.
        { mode: BLEND.soft_light, a: 160, b: 127.5, op: 1.0, expect: 160 },
        { mode: BLEND.soft_light, a: 160, b: 0, op: 1.0, expect: 160 * 160 / 255 },
        { mode: BLEND.soft_light, a: 160, b: 255, op: 1.0, expect: 2 * 160 - 160 * 160 / 255 },
        { mode: BLEND.soft_light, a: 0, b: 200, op: 1.0, expect: 0 },
        { mode: BLEND.soft_light, a: 255, b: 40, op: 1.0, expect: 255 },

        // Linear light is a signed gain about the same pivot: it adds
        // (2b - 255) and never reads the accumulator, so it neither clamps
        // what is below it nor caps its own output at white.
        { mode: BLEND.linear_light, a: 128, b: 127.5, op: 1.0, expect: 128 },
        { mode: BLEND.linear_light, a: 128, b: 160, op: 1.0, expect: 193 },
        { mode: BLEND.linear_light, a: 128, b: 100, op: 1.0, expect: 73 },
        { mode: BLEND.linear_light, a: 100, b: 255, op: 1.0, expect: 355 },
        { mode: BLEND.linear_light, a: 100, b: 0, op: 1.0, expect: -155 },
        { mode: BLEND.linear_light, a: 100, b: 255, op: 0.5, expect: 227.5 },
    ];
    for (const c of cases) {
        const dst = new Float32Array([c.a, c.a, c.a]);
        const src = new Float32Array([c.b, c.b, c.b]);
        blendInto(dst, src, c.mode, c.op, 1);
        assert.ok(Math.abs(dst[0] - c.expect) < 1e-3,
            `mode ${c.mode} a=${c.a} b=${c.b} op=${c.op}: got ${dst[0]}, want ${c.expect}`);
    }
});

// The rule from issue #93: a blend may clamp its source where the formula
// needs a bounded domain, but no blend may clamp the accumulator. Which modes
// need a guard at all is decided by whether their identity element still
// behaves like one off the end of the range.
const GUARDED_MODES = [
    BLEND.screen, BLEND.overlay, BLEND.difference,
    BLEND.lighten, BLEND.darken, BLEND.soft_light,
];
const UNGUARDED_MODES = [
    BLEND.normal, BLEND.add, BLEND.subtract, BLEND.multiply, BLEND.linear_light,
];

// The value that makes each mode a no-op. `normal` has none — it replaces.
const IDENTITY = {
    [BLEND.add]: 0,
    [BLEND.subtract]: 0,
    [BLEND.multiply]: 255,
    [BLEND.screen]: 0,
    [BLEND.overlay]: 127.5,
    [BLEND.difference]: 0,
    [BLEND.lighten]: 0,
    [BLEND.darken]: 255,
    [BLEND.soft_light]: 127.5,
    [BLEND.linear_light]: 127.5,
};

// Every mode has to pick a side. A new one added to BLEND without being
// classified here is one nobody has asked the identity question about, which
// is how screen and overlay shipped truncating the accumulator in the first
// place.
test('every blend mode is classified as guarded or unguarded', () => {
    const classified = new Set([...GUARDED_MODES, ...UNGUARDED_MODES]);
    for (const [name, mode] of Object.entries(BLEND)) {
        assert.ok(classified.has(mode), `mode ${name} is in neither family`);
    }
    assert.strictEqual(classified.size, Object.keys(BLEND).length);
});

function blend1(a, b, mode, op) {
    const dst = new Float32Array([a, a, a]);
    blendInto(dst, new Float32Array([b, b, b]), mode, op, 1);
    return dst[0];
}

// The load-bearing property, and the one that catches the whole class of bug:
// screening with black, multiplying by white and darkening with white are
// no-ops by definition, so a mode that turns one into a truncation is broken.
// A layer merely dark over part of the panel would then silently flatten
// everything beneath it, with nothing to surface it.
test('a layer at a mode\'s identity value leaves any accumulator untouched', () => {
    for (const [mode, ident] of Object.entries(IDENTITY)) {
        for (const a of [-320, -80, 0, 100, 255, 510, 765, 1104]) {
            const got = blend1(a, ident, Number(mode), 1.0);
            assert.ok(Math.abs(got - a) < 1e-3,
                `mode ${mode} with identity source ${ident} moved ${a} to ${got}`);
        }
    }
});

test('no mode clamps the accumulator, only its own source', () => {
    // An accumulator well past white survives every mode that is not being
    // asked to take light away. emitter reaches ~765 and particle_trail ~1104
    // at their own defaults, so this is the range that actually occurs.
    for (const mode of [BLEND.screen, BLEND.overlay, BLEND.lighten, BLEND.soft_light]) {
        for (const b of [0, 40, 127.5, 200, 255]) {
            const got = blend1(765, b, mode, 1.0);
            assert.ok(Math.abs(got - 765) < 1e-3,
                `mode ${mode} with source ${b} pulled an over-range accumulator to ${got}`);
        }
    }
});

// The reason the accumulator is unbounded in the first place: a two-particle
// overlap and a three-particle one must stay distinguishable through a layer,
// so a later multiply or partial-opacity layer can still recover the gradation.
test('headroom gradation survives every guarded mode', () => {
    for (const mode of GUARDED_MODES) {
        const two = blend1(510, 100, mode, 1.0);
        const three = blend1(765, 100, mode, 1.0);
        assert.notStrictEqual(two, three,
            `mode ${mode} flattened 510 and 765 to the same ${two}`);
        assert.ok(three > two, `mode ${mode} inverted the ordering of 510 and 765`);
    }
});

// Issue #93's stated regressions, pinned verbatim.
test('screen and overlay no longer truncate what is below them', () => {
    assert.strictEqual(blend1(510, 0, BLEND.screen, 1.0), 510);
    assert.strictEqual(blend1(765, 0, BLEND.screen, 1.0), 765);
    for (const a of [300, 400, 510]) {
        assert.strictEqual(blend1(a, 128, BLEND.screen, 1.0), a);
        assert.strictEqual(blend1(a, 128, BLEND.overlay, 1.0), a);
    }
});

// The recovery path the unbounded accumulator exists to protect. If any of
// these three drift, the headroom is no longer worth carrying.
test('a later layer can still recover headroom built by add', () => {
    assert.strictEqual(blend1(510, 127.5, BLEND.multiply, 1.0), 255);
    assert.ok(Math.abs(blend1(765, 85, BLEND.multiply, 1.0) - 255) < 1e-3);
    assert.strictEqual(blend1(510, 0, BLEND.normal, 0.5), 255);
});

test('negative sources are clamped by every mode that guards its domain', () => {
    for (const mode of GUARDED_MODES) {
        const guarded = blend1(100, -50, mode, 1.0);
        const atZero = blend1(100, 0, mode, 1.0);
        assert.ok(Math.abs(guarded - atZero) < 1e-3,
            `mode ${mode} treated a negative source differently from black`);
    }
    // The two gain modes read the source raw, which is what lets a negative
    // value passed to add subtract, and keeps subtract add's exact mirror.
    assert.strictEqual(blend1(100, -50, BLEND.add, 1.0), 50);
    assert.strictEqual(blend1(100, -50, BLEND.subtract, 1.0), 150);
});

test('every mode is a no-op at opacity 0', () => {
    for (const mode of Object.values(BLEND)) {
        assert.strictEqual(blend1(137, 211, mode, 0), 137,
            `mode ${mode} moved the composite at opacity 0`);
    }
});

// The gain family is what keeps headroom recoverable in the other direction:
// a subtract that drives the composite under zero must not have destroyed the
// light an add above it puts back. This is the one behaviour that would
// silently regress if subtract were ever "tidied up" to clamp at 0 per layer.
test('subtract below add round-trips through negative territory', () => {
    const dst = new Float32Array([100, 100, 100]);
    blendInto(dst, new Float32Array([180, 180, 180]), BLEND.subtract, 1.0, 1);
    assert.strictEqual(dst[0], -80);
    blendInto(dst, new Float32Array([180, 180, 180]), BLEND.add, 1.0, 1);
    assert.strictEqual(dst[0], 100);
});

// Every mode but difference is non-decreasing in the accumulator: brightening
// what is below a layer must never darken the result. Difference is |a - b|
// and genuinely turns over, which is the mode doing its job rather than a
// domain guard misfiring.
test('modes are monotone in the accumulator', () => {
    for (const mode of Object.values(BLEND)) {
        if (mode === BLEND.difference) continue;
        for (const b of [0, 64, 127.5, 200, 255]) {
            for (const op of [0.25, 0.5, 1.0]) {
                let prev = -Infinity;
                for (let a = -300; a <= 900; a += 12) {
                    const got = blend1(a, b, mode, op);
                    assert.ok(got >= prev - 1e-3,
                        `mode ${mode} b=${b} op=${op}: a=${a} gave ${got} after ${prev}`);
                    prev = got;
                }
            }
        }
    }
});

// Soft light and linear light both pivot on mid-grey, and a layer sitting
// exactly there must leave the stack alone at any accumulator level. A pivot
// off by even half a byte reads as a whole-panel tint.
test('soft light and linear light are identity at mid-grey', () => {
    for (const mode of [BLEND.soft_light, BLEND.linear_light]) {
        for (const a of [0, 40, 128, 200, 255, 510]) {
            const got = blend1(a, 127.5, mode, 1.0);
            assert.ok(Math.abs(got - a) < 1e-3,
                `mode ${mode} shifted ${a} to ${got} against a mid-grey source`);
        }
    }
});

// Channels are independent for every mode — no mode may read one channel to
// decide another, which is exactly the property that rules out hue/saturation
// modes being added to this switch.
test('blend modes treat channels independently', () => {
    for (const mode of Object.values(BLEND)) {
        const together = new Float32Array([30, 150, 240]);
        blendInto(together, new Float32Array([200, 90, 12]), mode, 0.7, 1);
        const apart = [
            [30, 200], [150, 90], [240, 12],
        ].map(([a, b]) => blend1(a, b, mode, 0.7));
        for (let c = 0; c < 3; c++) {
            assert.ok(Math.abs(together[c] - apart[c]) < 1e-3,
                `mode ${mode} channel ${c}: ${together[c]} vs ${apart[c]} in isolation`);
        }
    }
});

test('solid layer renders through compositor to the client', () => {
    const model = makeModel(4);
    const client = makeClient();
    const compositor = new Compositor(client, model);
    const store = new SceneStore(compositor, null);

    const scene = {
        id: 's1', name: 'test',
        layers: [{ id: 'l1', effectType: 'solid', params: { color: '#ff8000', level: 1 }, blendMode: 'normal', opacity: 1, enabled: true, solo: false }],
    };
    store.preprocess(scene);
    compositor.renderFrame(scene, 0);

    assert.deepStrictEqual(client.pixels[0], [255, 128, 0]);
    assert.strictEqual(client.writes, 1);
});

test('opacity halves a solid layer over black', () => {
    const model = makeModel(2);
    const client = makeClient();
    const compositor = new Compositor(client, model);
    const store = new SceneStore(compositor, null);

    const scene = {
        id: 's1', name: 'test',
        layers: [{ id: 'l1', effectType: 'solid', params: { color: '#ffffff', level: 1 }, blendMode: 'normal', opacity: 0.5, enabled: true, solo: false }],
    };
    store.preprocess(scene);
    compositor.renderFrame(scene, 0);
    assert.deepStrictEqual(client.pixels[0], [127, 127, 127]);
});

test('a multi-wavelet scene sums per-layer additive blending correctly', () => {
    const model = makeModel(8);
    const client = makeClient();
    const compositor = new Compositor(client, model);
    const store = new SceneStore(compositor, null);

    const wavelets = [
        { color: '#3060c0', freq: 0.3, lambda: 0.4, delta: 0.7, x: -0.5, y: 0.2, min: 0.1, max: 0.5 },
        { color: '#c04010', freq: 0.6, lambda: 0.9, delta: 2.1, x: 0.75, y: -0.1, min: 0.0, max: 0.4 },
    ];
    const scene = {
        id: 's1', name: 'multi-wavelet',
        layers: wavelets.map((w, i) => ({
            id: 'w' + i, effectType: 'wavelet', params: w,
            blendMode: 'add', opacity: 1, enabled: true, solo: false,
        })),
    };
    store.preprocess(scene);

    const millis = 123456;
    compositor.renderFrame(scene, millis);

    // Old shader.js inner loop, with clip:true clamping per wavelet
    function hexToRgb(hex) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
    }
    for (let pixel = 0; pixel < model.length; pixel++) {
        const px = model[pixel].point[0];
        const pz = model[pixel].point[2];
        let red = 0, green = 0, blue = 0;
        for (const w of wavelets) {
            const dx = px - w.x;
            const dz = pz + w.y;
            const r = Math.sqrt(dx * dx + dz * dz);
            const theta = millis * 0.00628 * w.freq - r / w.lambda;
            const brightness = w.min + (w.max - w.min) * 0.5 * (Math.sin(theta + w.delta) + 1);
            const rgb = hexToRgb(w.color);
            red += Math.min(Math.max(rgb.r * brightness, 0), 255);
            green += Math.min(Math.max(rgb.g * brightness, 0), 255);
            blue += Math.min(Math.max(rgb.b * brightness, 0), 255);
        }
        const expect = [
            Math.max(0, Math.min(255, red | 0)),
            Math.max(0, Math.min(255, green | 0)),
            Math.max(0, Math.min(255, blue | 0)),
        ];
        assert.deepStrictEqual(client.pixels[pixel], expect, `pixel ${pixel}`);
    }
});

test('changing effectType recreates the instance, changing params does not', () => {
    const model = makeModel(2);
    const client = makeClient();
    const compositor = new Compositor(client, model);

    const scene = { layers: [{ id: 'l1', effectType: 'solid' }] };
    compositor.syncScene(scene);
    const first = compositor.layers.get('l1').instance;

    compositor.syncScene(scene);
    assert.strictEqual(compositor.layers.get('l1').instance, first);

    scene.layers[0].effectType = 'wavelet';
    compositor.syncScene(scene);
    assert.notStrictEqual(compositor.layers.get('l1').instance, first);
});

test('the compositor refuses to render a layer whose cached instance is stale', () => {
    const model = makeModel(2);
    const client = makeClient();
    const store = new SceneStore(new Compositor(client, model), null);
    store.setScenes([{ id: 'aaaaaaaa', name: 'One', layers: [{ id: 'layer001', effectType: 'solid', params: { color: '#ffffff', level: 1 } }] }]);
    const scene = store.scenes[0];

    // Simulate the collision directly: another scene rebinds the id.
    store.compositor.syncScene({ layers: [{ id: 'layer001', effectType: 'wavelet' }] });
    store.compositor.renderFrame(scene, 0);
    assert.ok(store.compositor.composite.every(Number.isFinite),
        'a stale entry must never put NaN on the panel');
});

test('a layer whose effectType has no module renders nothing and throws nothing', () => {
    const model = makeModel(2);
    const client = makeClient();
    const store = new SceneStore(new Compositor(client, model), null);
    store.setScenes([{ id: 'aaaaaaaa', name: 'One', layers: [{ id: 'l1', effectType: 'no_such_effect', params: {} }] }]);
    const scene = store.scenes[0];

    assert.doesNotThrow(() => store.compositor.renderFrame(scene, 0));
    assert.ok(store.compositor.composite.every((v) => v === 0), 'an unknown effect must not put anything on the panel');
});
