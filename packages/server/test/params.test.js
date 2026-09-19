const test = require('node:test');
const assert = require('node:assert');

const effects = require('../effects');
const { coerceParams } = require('../engine/params');

const emitter = effects.get('emitter');
const gradient = effects.get('gradient_linear');

test('every effect\'s defaults are a fixed point, with a default for every declared field', () => {
    for (const effect of effects.list()) {
        const out = coerceParams(effect, effect.defaults);
        assert.deepStrictEqual(out, effect.defaults, effect.type + ' defaults do not survive coercion');
        for (const [key, value] of Object.entries(out)) {
            assert.notStrictEqual(value, undefined, effect.type + '.' + key + ' has no default');
        }
    }
});

test('a wrong-typed number falls back to its default, per field', () => {
    // The reproduced case: a string reached particles.js as NaN and turned
    // every particle into an ambient one lighting the whole panel.
    const out = coerceParams(emitter, { x: 'left', y: 0.5, speed: null, count: Infinity });
    assert.strictEqual(out.x, emitter.defaults.x);
    assert.strictEqual(out.y, 0.5, 'a good neighbour is kept');
    assert.strictEqual(out.speed, emitter.defaults.speed);
    assert.strictEqual(out.count, emitter.defaults.count);
});

test('a numeric string is a number, and an empty one is not', () => {
    const out = coerceParams(emitter, { size: '0.3', life: '', dir: ' 45 ' });
    assert.strictEqual(out.size, 0.3);
    assert.strictEqual(out.life, emitter.defaults.life);
    assert.strictEqual(out.dir, 45);
});

test('min/max are slider hints: an out-of-range number is kept as it is', () => {
    const out = coerceParams(emitter, { count: 10000, speed: -3 });
    assert.strictEqual(out.count, 10000);
    assert.strictEqual(out.speed, -3);
});

test('colours, enums, text, range and xy are each checked against their type', () => {
    const noise = effects.get('noise');
    assert.strictEqual(coerceParams(noise, { c1: 'red' }).c1, noise.defaults.c1);
    assert.strictEqual(coerceParams(noise, { c1: 'ff0000' }).c1, 'ff0000', 'hexToRgb accepts no #, so this does');
    assert.strictEqual(coerceParams(noise, { min: 'low', max: '0.5' }).min, noise.defaults.min);
    assert.strictEqual(coerceParams(noise, { min: 'low', max: '0.5' }).max, 0.5);

    assert.strictEqual(coerceParams(gradient, { tiling: 'sideways' }).tiling, gradient.defaults.tiling);
    assert.strictEqual(coerceParams(gradient, { tiling: 'hold' }).tiling, 'hold');

    const text = effects.get('text');
    assert.strictEqual(coerceParams(text, { text: 42 }).text, '42');
    assert.strictEqual(coerceParams(text, { text: { a: 1 } }).text, text.defaults.text);

    const radial = effects.get('gradient_radial');
    assert.strictEqual(coerceParams(radial, { cx: [1] }).cx, radial.defaults.cx);
});

test('stops that are not a usable list fall back to the default list', () => {
    for (const stops of [null, 'red', 3, [], [{ position: 0, color: '#ff0000' }], {}]) {
        assert.deepStrictEqual(coerceParams(gradient, { stops }).stops, gradient.defaults.stops,
            'expected the default for ' + JSON.stringify(stops));
    }
});

test('one bad stop costs that stop, not the gradient', () => {
    const out = coerceParams(gradient, { stops: [
        { position: 0, color: '#ff0000' },
        { position: 'middle', color: '#00ff00' },
        null,
        { position: '1', color: '#0000ff' },
    ] });
    assert.deepStrictEqual(out.stops, [
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#0000ff' },
    ]);
});

test('a defaulted stop list is a copy, not the defaults array itself', () => {
    const a = coerceParams(gradient, {});
    const b = coerceParams(gradient, {});
    assert.notStrictEqual(a.stops, gradient.defaults.stops);
    assert.notStrictEqual(a.stops, b.stops);
});

test('keys the schema does not declare pass through untouched', () => {
    assert.deepStrictEqual(coerceParams(emitter, { futureKnob: { any: 'thing' } }).futureKnob, { any: 'thing' });
});

test('params that are not an object at all are the defaults', () => {
    for (const params of [null, 'x', [1, 2], 7]) {
        assert.deepStrictEqual(coerceParams(emitter, params), emitter.defaults);
    }
});

test('the registry answers only for its own effects, not for Object.prototype', () => {
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        assert.strictEqual(effects.get(type), null, type);
    }
});
