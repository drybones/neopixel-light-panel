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
        // the cheap route to a mask, and the reason `a` is clamped first.
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

        // Linear light is signed about the same pivot, and clamps because a
        // mix-family mode has to stay displayable.
        { mode: BLEND.linear_light, a: 128, b: 127.5, op: 1.0, expect: 128 },
        { mode: BLEND.linear_light, a: 128, b: 160, op: 1.0, expect: 193 },
        { mode: BLEND.linear_light, a: 128, b: 100, op: 1.0, expect: 73 },
        { mode: BLEND.linear_light, a: 100, b: 255, op: 1.0, expect: 255 },
        { mode: BLEND.linear_light, a: 100, b: 0, op: 1.0, expect: 0 },
    ];
    for (const c of cases) {
        const dst = new Float32Array([c.a, c.a, c.a]);
        const src = new Float32Array([c.b, c.b, c.b]);
        blendInto(dst, src, c.mode, c.op, 1);
        assert.ok(Math.abs(dst[0] - c.expect) < 1e-3,
            `mode ${c.mode} a=${c.a} b=${c.b} op=${c.op}: got ${dst[0]}, want ${c.expect}`);
    }
});

const MIX_MODES = [
    BLEND.multiply, BLEND.screen, BLEND.overlay, BLEND.difference,
    BLEND.lighten, BLEND.darken, BLEND.soft_light, BLEND.linear_light,
];
const GAIN_MODES = [BLEND.add, BLEND.subtract];

test('negative source values are clamped by the mix family but pass through the gain family', () => {
    for (const mode of MIX_MODES) {
        const dst = new Float32Array([100, 100, 100]);
        const src = new Float32Array([-50, -50, -50]);
        blendInto(dst, src, mode, 1.0, 1);
        assert.ok(dst[0] >= 0, `mode ${mode} produced negative output ${dst[0]}`);
    }
    const add = new Float32Array([100, 100, 100]);
    blendInto(add, new Float32Array([-50, -50, -50]), BLEND.add, 1.0, 1);
    assert.strictEqual(add[0], 50);
    const sub = new Float32Array([100, 100, 100]);
    blendInto(sub, new Float32Array([-50, -50, -50]), BLEND.subtract, 1.0, 1);
    assert.strictEqual(sub[0], 150);
});

// Multiply is the one mix-family mode that does not clamp the backdrop, and
// that is deliberate: a*255/255 is a at any magnitude, so multiplying by white
// carries headroom through where every other mix mode discards it. Pinning
// both halves here so neither gets "tidied" into the other.
test('multiply alone carries headroom through the mix family', () => {
    const keep = new Float32Array([400, 400, 400]);
    blendInto(keep, new Float32Array([255, 255, 255]), BLEND.multiply, 1.0, 1);
    assert.ok(Math.abs(keep[0] - 400) < 1e-3, `multiply by white gave ${keep[0]}, want 400`);

    for (const mode of MIX_MODES.filter((m) => m !== BLEND.multiply)) {
        const dst = new Float32Array([400, 400, 400]);
        blendInto(dst, new Float32Array([180, 180, 180]), mode, 1.0, 1);
        assert.ok(dst[0] >= 0 && dst[0] <= 255,
            `mode ${mode} left ${dst[0]} outside 0-255 from an over-range backdrop`);
    }
});

test('every mode is a no-op at opacity 0', () => {
    for (const mode of Object.values(BLEND)) {
        const dst = new Float32Array([137, 137, 137]);
        blendInto(dst, new Float32Array([211, 211, 211]), mode, 0, 1);
        assert.strictEqual(dst[0], 137, `mode ${mode} moved the composite at opacity 0`);
    }
});

// The gain family is what keeps headroom recoverable: a subtract that drives
// the composite under zero must not have destroyed the light an add above it
// puts back. This is the one behaviour that would silently regress if
// subtract were ever "tidied up" to clamp at 0 per layer.
test('subtract below add round-trips through negative territory', () => {
    const dst = new Float32Array([100, 100, 100]);
    blendInto(dst, new Float32Array([180, 180, 180]), BLEND.subtract, 1.0, 1);
    assert.strictEqual(dst[0], -80);
    blendInto(dst, new Float32Array([180, 180, 180]), BLEND.add, 1.0, 1);
    assert.strictEqual(dst[0], 100);
});

// Soft light and linear light both pivot on mid-grey, and a layer sitting
// exactly there must leave the stack alone at any backdrop level. A pivot
// off by even half a byte reads as a whole-panel tint.
test('soft light and linear light are identity at mid-grey', () => {
    for (const mode of [BLEND.soft_light, BLEND.linear_light]) {
        for (const a of [0, 40, 128, 200, 255]) {
            const dst = new Float32Array([a, a, a]);
            blendInto(dst, new Float32Array([127.5, 127.5, 127.5]), mode, 1.0, 1);
            assert.ok(Math.abs(dst[0] - a) < 1e-3,
                `mode ${mode} shifted ${a} to ${dst[0]} against a mid-grey source`);
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
        ].map(([a, b]) => {
            const d = new Float32Array([a, a, a]);
            blendInto(d, new Float32Array([b, b, b]), mode, 0.7, 1);
            return d[0];
        });
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
