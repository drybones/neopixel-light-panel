const test = require('node:test');
const assert = require('node:assert');

const color = require('../engine/color');

// The primaries and secondaries land on every one of the six hue sextants, so
// this walks each branch of the switch that replaced the old array lookups.
test('hsv covers all six hue sextants', () => {
    const cases = [
        [0, [255, 0, 0]],
        [1 / 6, [255, 255, 0]],
        [2 / 6, [0, 255, 0]],
        [3 / 6, [0, 255, 255]],
        [4 / 6, [0, 0, 255]],
        [5 / 6, [255, 0, 255]],
        [-1 / 6, [255, 0, 255]],
        [1.5, [0, 255, 255]],
    ];
    for (const [h, want] of cases) {
        assert.deepStrictEqual(color.hsv(h, 1, 1).map(Math.round), want, `h=${h}`);
    }
});

test('hsvInto writes into the array it is given', () => {
    const out = [9, 9, 9];
    assert.strictEqual(color.hsvInto(out, 0, 0, 0.5), out);
    assert.deepStrictEqual(out, [127.5, 127.5, 127.5]);
});

test('hexToRgb answers the fallback for junk, white by default', () => {
    assert.deepStrictEqual(color.hexToRgb('#102030'), { r: 16, g: 32, b: 48 });
    assert.deepStrictEqual(color.hexToRgb('nope'), { r: 255, g: 255, b: 255 });
    const black = { r: 0, g: 0, b: 0 };
    assert.deepStrictEqual(color.hexToRgb('nope', black), black);
    assert.notStrictEqual(color.hexToRgb('nope', black), black, 'the fallback must be copied, not shared');
});

test('clamp255 keeps the fraction and toByte truncates', () => {
    assert.strictEqual(color.clamp255(-3), 0);
    assert.strictEqual(color.clamp255(12.5), 12.5);
    assert.strictEqual(color.clamp255(700), 255);
    assert.strictEqual(color.toByte(12.9), 12);
    assert.strictEqual(color.toByte(700), 255);
    assert.strictEqual(color.toByte(NaN), 0);
});
