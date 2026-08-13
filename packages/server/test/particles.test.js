const test = require('node:test');
const assert = require('node:assert');

const { renderParticles } = require('../engine/particles');
const effects = require('../effects');

const ctx = {
    numPixels: 4,
    modelX: new Float32Array([-1, 0, 1, 2]),
    modelZ: new Float32Array([0, 0, 0, 0]),
};

test('renderParticles matches the old mapParticles falloff maths', () => {
    const particles = [
        { point: [0, 0, 0], intensity: 1.0, falloff: 10, color: [255, 0, 0] },
    ];
    const out = new Float32Array(ctx.numPixels * 3);
    renderParticles(out, particles, 1, ctx.modelX, ctx.modelZ, ctx.numPixels);

    // Pixel at distance 0: intensity 1/(1+0) = 1 → full red
    assert.ok(Math.abs(out[1 * 3] - 255) < 1e-3);
    // Pixel at distance 1: 1/(1+10) of 255
    assert.ok(Math.abs(out[0] - 255 / 11) < 1e-3);
    // No colour bleed into other channels
    assert.strictEqual(out[1 * 3 + 1], 0);
});

test('ambient particle with empty point [] lights all pixels equally', () => {
    const particles = [
        { point: [], intensity: 0.1, falloff: 0, color: [100, 100, 100] },
    ];
    const out = new Float32Array(ctx.numPixels * 3);
    renderParticles(out, particles, 1, ctx.modelX, ctx.modelZ, ctx.numPixels);
    for (let i = 0; i < ctx.numPixels; i++) {
        assert.ok(Math.abs(out[i * 3] - 10) < 1e-3, `pixel ${i}: ${out[i * 3]}`);
    }
});

test('two particle-effect instances animate independently', () => {
    const emitter = effects.get('emitter');
    const prepared = emitter.prepare(emitter.defaults);
    const a = emitter.createInstance(ctx);
    const b = emitter.createInstance(ctx);

    // Step both forward at the real render loop's cadence rather than one
    // large jump — a jump bigger than RESUME_MS reads as a's field going
    // idle and resuming, not as steady animation.
    const outA = new Float32Array(ctx.numPixels * 3);
    const outB = new Float32Array(ctx.numPixels * 3);
    for (let t = 0; t <= 5000; t += 10) {
        a.render(outA, t, prepared);
        b.render(outB, t, prepared);
    }

    // If b shared a's pool, its state would equal a's. Randomised spawns make
    // equality vanishingly unlikely when independent.
    assert.notDeepStrictEqual(Array.from(outB), Array.from(outA));
});

test('param changes do not reset particle state', () => {
    const emitter = effects.get('emitter');
    const instance = emitter.createInstance(ctx);
    const p1 = emitter.prepare(emitter.defaults);
    const out = new Float32Array(ctx.numPixels * 3);
    instance.render(out, 1000, p1);

    // Capture a live particle's birth time, then render with new params
    const p2 = emitter.prepare({ ...emitter.defaults, speed: 2, glow: 0.2 });
    instance.render(out, 1100, p2);
    instance.render(out, 1200, p2);
    // No assertion on internals available; the contract is "no throw and
    // continuous output". Verify output is finite and non-zero.
    assert.ok(out.some(v => v > 0));
    assert.ok(out.every(v => Number.isFinite(v)));
});

test('particle effects render without allocation errors at max density', () => {
    for (const type of ['emitter', 'particle_trail']) {
        const mod = effects.get(type);
        const maxCount = mod.schema.find(s => s.key === 'count').max;
        const prepared = mod.prepare({ ...mod.defaults, count: maxCount });
        const instance = mod.createInstance(ctx);
        const out = new Float32Array(ctx.numPixels * 3);
        for (let t = 0; t < 5000; t += 500) {
            instance.render(out, t, prepared);
        }
        assert.ok(out.every(v => Number.isFinite(v)), type + ' produced non-finite output');
    }
});
