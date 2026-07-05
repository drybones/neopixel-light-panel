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
    ];
    for (const c of cases) {
        const dst = new Float32Array([c.a, c.a, c.a]);
        const src = new Float32Array([c.b, c.b, c.b]);
        blendInto(dst, src, c.mode, c.op, 1);
        assert.ok(Math.abs(dst[0] - c.expect) < 1e-3,
            `mode ${c.mode} a=${c.a} b=${c.b} op=${c.op}: got ${dst[0]}, want ${c.expect}`);
    }
});

test('negative source values are clamped for multiply/screen/overlay but pass through add', () => {
    for (const mode of [BLEND.multiply, BLEND.screen, BLEND.overlay]) {
        const dst = new Float32Array([100, 100, 100]);
        const src = new Float32Array([-50, -50, -50]);
        blendInto(dst, src, mode, 1.0, 1);
        assert.ok(dst[0] >= 0, `mode ${mode} produced negative output ${dst[0]}`);
    }
    const dst = new Float32Array([100, 100, 100]);
    blendInto(dst, new Float32Array([-50, -50, -50]), BLEND.add, 1.0, 1);
    assert.strictEqual(dst[0], 50);
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

test('migrated multi-wavelet scene reproduces the old interactive_wave sum', () => {
    const model = makeModel(8);
    const client = makeClient();
    const compositor = new Compositor(client, model);
    const store = new SceneStore(compositor, null);

    const wavelets = [
        { color: '#3060c0', freq: 0.3, lambda: 0.4, delta: 0.7, x: -0.5, y: 0.2, min: 0.1, max: 0.5 },
        { color: '#c04010', freq: 0.6, lambda: 0.9, delta: 2.1, x: 0.75, y: -0.1, min: 0.0, max: 0.4 },
    ];
    const scene = {
        id: 's1', name: 'migrated',
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
