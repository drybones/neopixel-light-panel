const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { convert } = require('../engine/migrate');

test('converts the example wavelet config into scenes', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../example_wavelet_config.json')));
    const scenes = convert(fixture);

    assert.strictEqual(scenes.length, fixture.length);
    const first = scenes[0];
    assert.strictEqual(first.id, 'SyADMBJvz');
    assert.strictEqual(first.name, 'Warm Vignette');
    assert.strictEqual(first.layers.length, 1);

    const layer = first.layers[0];
    assert.strictEqual(layer.id, 'BJuyKFJPz');
    assert.strictEqual(layer.effectType, 'wavelet');
    assert.strictEqual(layer.blendMode, 'add');
    assert.strictEqual(layer.opacity, 1);
    assert.strictEqual(layer.enabled, true);
    assert.deepStrictEqual(layer.params, {
        color: '#efc89d', freq: 0, lambda: 3, delta: 0, x: 0, y: 0, min: 0.2, max: 1,
    });
});

test('multi-wavelet presets become multi-layer scenes', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../example_wavelet_config.json')));
    const multi = fixture.find(p => p.wavelets.length > 1);
    const scene = convert([multi])[0];
    assert.strictEqual(scene.layers.length, multi.wavelets.length);
    assert.ok(scene.layers.every(l => l.blendMode === 'add' && l.opacity === 1));
});

test('solo flags carry over and fixed/unknown presets are skipped', () => {
    const scenes = convert([
        { id: 'p1', name: 'P', type: 'wavelet', wavelets: [{ id: 'w1', color: '#ffffff', freq: 1, lambda: 1, delta: 0, x: 0, y: 0, min: 0, max: 1, solo: true }] },
        { id: 'f:embers', name: 'Embers', type: 'fixed' },
    ]);
    assert.strictEqual(scenes.length, 1);
    assert.strictEqual(scenes[0].layers[0].solo, true);
});
