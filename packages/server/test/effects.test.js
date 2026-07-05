const test = require('node:test');
const assert = require('node:assert');

const wavelet = require('../effects/wavelet');
const solid = require('../effects/solid');
const gradient = require('../effects/gradient');
const effects = require('../effects');

const ctx2 = {
    numPixels: 2,
    modelX: new Float32Array([-1, 1]),
    modelZ: new Float32Array([0, 0]),
};

test('catalog exposes type, name, schema and defaults', () => {
    const catalog = effects.catalog();
    assert.ok(catalog.length >= 3);
    for (const entry of catalog) {
        assert.ok(entry.type && entry.name);
        assert.ok(Array.isArray(entry.schema));
        assert.ok(entry.defaults && typeof entry.defaults === 'object');
    }
});

test('every effect renders its defaults without throwing', () => {
    for (const entry of effects.catalog()) {
        const mod = effects.get(entry.type);
        const prepared = mod.prepare(mod.defaults);
        const instance = mod.createInstance(ctx2);
        const out = new Float32Array(ctx2.numPixels * 3);
        instance.render(out, 12345, prepared);
        assert.ok(out.every(v => Number.isFinite(v)), entry.type + ' produced non-finite values');
    }
});

test('wavelet prepare caches rgb', () => {
    const p = wavelet.prepare({ ...wavelet.defaults, color: '#102030' });
    assert.strictEqual(p.r, 16);
    assert.strictEqual(p.g, 32);
    assert.strictEqual(p.b, 48);
});

test('wavelet render clamps output to [0, 255]', () => {
    const p = wavelet.prepare({ ...wavelet.defaults, color: '#ffffff', min: -5, max: 10 });
    const instance = wavelet.createInstance(ctx2);
    const out = new Float32Array(6);
    instance.render(out, 99999, p);
    assert.ok(out.every(v => v >= 0 && v <= 255));
});

test('solid scales by level', () => {
    const p = solid.prepare({ color: '#ff0080', level: 0.5 });
    assert.strictEqual(p.r, 127.5);
    assert.strictEqual(p.b, 64);
});

test('gradient LUT interpolates stops', () => {
    const p = gradient.prepare({
        ...gradient.defaults,
        stops: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ff0000' },
        ],
        mode: 'linear', angle: 0, animate: 'none',
    });
    assert.strictEqual(p.lut[0], 0);
    assert.strictEqual(p.lut[255 * 3], 255);
    const mid = p.lut[128 * 3];
    assert.ok(Math.abs(mid - 128) < 2, 'midpoint ' + mid);
});

test('linear gradient maps panel extremes to stop colours', () => {
    const p = gradient.prepare({
        ...gradient.defaults,
        stops: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ff0000' },
        ],
        mode: 'linear', angle: 0, animate: 'none',
    });
    const ctx = {
        numPixels: 3,
        modelX: new Float32Array([-3.625, 0, 3.625]),
        modelZ: new Float32Array([0, 0, 0]),
    };
    const out = new Float32Array(9);
    gradient.createInstance(ctx).render(out, 0, p);
    assert.ok(out[0] < 3, 'left edge should be near black, got ' + out[0]);
    assert.ok(Math.abs(out[3] - 127.5) < 3, 'centre should be mid-red, got ' + out[3]);
    assert.ok(out[6] > 252, 'right edge should be full red, got ' + out[6]);
});

test('radial gradient is symmetric around the centre', () => {
    const p = gradient.prepare({
        ...gradient.defaults,
        stops: [
            { position: 0, color: '#ffffff' },
            { position: 1, color: '#000000' },
        ],
        mode: 'radial', cx: 0, cy: 0, animate: 'none',
    });
    const ctx = {
        numPixels: 3,
        modelX: new Float32Array([-2, 0, 2]),
        modelZ: new Float32Array([0, 0, 0]),
    };
    const out = new Float32Array(9);
    gradient.createInstance(ctx).render(out, 0, p);
    assert.strictEqual(out[0], out[6]);
    assert.ok(out[3] > out[0], 'centre should be brightest');
});
