const test = require('node:test');
const assert = require('node:assert');

const emitter = require('../effects/emitter');
const effects = require('../effects');
const { panelCtx } = require('./support/panel-ctx');

// ── Emitter ──
//
// The effect candy_sparkler and embers collapsed into. These guard the three
// things that were easy to get wrong when the constants became params.

test('emitter renders every preset non-black and finite after warm-up', () => {
    const ctx = panelCtx();
    for (const preset of emitter.presets) {
        const params = { ...emitter.defaults, ...preset.params };
        const p = emitter.prepare(params);
        const inst = emitter.createInstance(ctx);
        const out = new Float32Array(ctx.numPixels * 3);
        // Across the ramp, which fills the field over about one lifetime.
        let lit = 0;
        for (let f = 0; f < 200; f++) {
            inst.render(out, 1000 + f * 40, p);
            for (let i = 0; i < out.length; i++) if (out[i] > 1) { lit++; break; }
        }
        assert.ok(out.every(v => Number.isFinite(v)), `${preset.id} produced non-finite values`);
        assert.ok(lit > 150, `${preset.id} was lit on only ${lit}/200 frames`);
    }
});

// The ramp. A fresh emitter fills from empty at count/life births per second.
// What this replaced staggered each slot's *first* birth over one lifetime,
// which starts at about the right rate but lets every replacement through the
// moment its slot dies — so the field reached full while it was still young,
// and since the envelope peaks early in a particle's life, the layer surged
// about a lifetime in and then subsided to something dimmer (issue #37).
//
// Every particle below is born at one point, stands still and shares a colour,
// so the layer's total energy is exactly the sum of the born particles'
// envelopes — a direct read of the birth schedule. swell 1 makes that envelope
// smoothstep(age/life), whose mean over a lifetime is half its peak, so a
// settled field sits at half of what the same field of full-grown particles
// would carry.
const RAMP_LIFE = 4;
const RAMP_PARAMS = {
    count: 40, life: RAMP_LIFE, lifeSpread: 0, swell: 1, speed: 0, speedSpread: 0,
    spread: 1, grav: 0, hueSpread: 0, extX: 0, extY: 0, size: 0.3,
};

// Energy over time. The step is a sampling interval, not the render loop's
// 10ms tick: every effect here is a pure function of absolute millis, and the
// ramp is paced by elapsed time rather than by frames, so a coarse sample
// measures the same curve for a fraction of the renders.
const RAMP_STEP = 40;

function energyTrace(inst, p, out, from, ms) {
    const n = Math.round(ms / RAMP_STEP);
    const trace = new Float64Array(n);
    for (let f = 0; f < n; f++) {
        inst.render(out, from + f * RAMP_STEP, p);
        let sum = 0;
        for (let i = 0; i < out.length; i++) sum += out[i];
        trace[f] = sum;
    }
    return trace;
}

function tailMean(trace, from) {
    let sum = 0, n = 0;
    for (let f = from; f < trace.length; f++) { sum += trace[f]; n++; }
    return sum / n;
}

test('a fresh emitter fills in gradually and holds', () => {
    const ctx = panelCtx();
    const p = emitter.prepare({ ...emitter.defaults, ...RAMP_PARAMS });
    const inst = emitter.createInstance(ctx);
    const out = new Float32Array(ctx.numPixels * 3);
    const life = RAMP_LIFE * 1000;

    const trace = energyTrace(inst, p, out, 1e6, life * 6);
    const steady = tailMean(trace, (life * 3) / RAMP_STEP);
    const at = (tau) => trace[Math.round((tau * life) / RAMP_STEP)] / steady;

    // A quarter of the way into the first lifetime, a quarter of the field has
    // been born and none of it is bright yet. A field delivered all at once
    // would be at 0.31 of steady by now and 1.0 by the half way point.
    assert.ok(at(0.25) < 0.10, `a quarter life in, the field is at ${at(0.25).toFixed(2)} of steady`);
    assert.ok(at(0.5) < 0.45, `half a life in, the field is at ${at(0.5).toFixed(2)} of steady`);
    // And it does fill: a gate that never reopened would look great above.
    assert.ok(at(1.5) > 0.9, `the field is still only at ${at(1.5).toFixed(2)} of steady`);

    // The surge, measured. The staggered first birth peaked at 1.16 of steady
    // here and rang for several lifetimes after; on the presets, where the
    // lifetime spread stretches the first cohort, it peaked at 1.22 to 1.33.
    let peak = 0;
    for (let f = 0; f < trace.length; f++) if (trace[f] > peak) peak = trace[f];
    assert.ok(peak / steady < 1.06, `start-up peaked at ${(peak / steady).toFixed(3)} of steady`);
});

// Density adds slots to an emitter that has been settled for a while, so the
// gate's clock is stale by however long ago the last fill ended. Unarmed, it
// grants the whole new cohort on the tick it appears — the burst again, with
// extra steps — which is why arming is a transition and not a first render.
test('raising Density paces the particles it adds', () => {
    const ctx = panelCtx();
    const small = emitter.prepare({ ...emitter.defaults, ...RAMP_PARAMS, count: 10 });
    const big = emitter.prepare({ ...emitter.defaults, ...RAMP_PARAMS, count: 40 });
    const inst = emitter.createInstance(ctx);
    const out = new Float32Array(ctx.numPixels * 3);
    const life = RAMP_LIFE * 1000;

    energyTrace(inst, small, out, 1e6, life * 3);
    const trace = energyTrace(inst, big, out, 1e6 + life * 3, life * 6);
    const steady = tailMean(trace, (life * 3) / RAMP_STEP);
    const at = (tau) => trace[Math.round((tau * life) / RAMP_STEP)] / steady;

    // Quarter density to full over about a lifetime. Ungated, the new cohort
    // is all born at once and this reads 1.02 half a lifetime in and 1.77 at
    // the top of the swell.
    assert.ok(at(0) < 0.35, `the raise jumped straight to ${at(0).toFixed(2)} of steady`);
    assert.ok(at(0.5) < 0.6, `half a life in, density is at ${at(0.5).toFixed(2)} of steady`);
    assert.ok(at(1.5) > 0.9, `density is still only at ${at(1.5).toFixed(2)} of steady`);

    let peak = 0;
    for (let f = 0; f < trace.length; f++) if (trace[f] > peak) peak = trace[f];
    assert.ok(peak / steady < 1.06, `the raise peaked at ${(peak / steady).toFixed(3)} of steady`);
});

// The compositor holds a layer instance per layer id for every scene, not just
// the active one, and the render loop only ever runs the active scene — so a
// scene switched away from and back is this instance resumed with its whole
// field dead, and it is much the commonest way to watch an emitter start.
// Ungated, every particle is reborn on the tick you switch back, in perfect
// lockstep: measured on the panel that is a 2x surge, worse than the start-up
// this ramps.
test('an emitter left unrendered ramps back in rather than snapping back', () => {
    const ctx = panelCtx();
    const p = emitter.prepare({ ...emitter.defaults, ...RAMP_PARAMS });
    const inst = emitter.createInstance(ctx);
    const out = new Float32Array(ctx.numPixels * 3);
    const life = RAMP_LIFE * 1000;

    energyTrace(inst, p, out, 1e6, life * 3);
    // The gap another scene's turn at the panel leaves behind.
    const back = 1e6 + life * 3 + 30000;
    const trace = energyTrace(inst, p, out, back, life * 6);
    const steady = tailMean(trace, (life * 3) / RAMP_STEP);
    const at = (tau) => trace[Math.round((tau * life) / RAMP_STEP)] / steady;

    assert.ok(at(0) < 0.1, `switching back lit ${at(0).toFixed(2)} of the field at once`);
    assert.ok(at(0.5) < 0.45, `half a life in, the field is at ${at(0.5).toFixed(2)} of steady`);
    assert.ok(at(1.5) > 0.9, `the field is still only at ${at(1.5).toFixed(2)} of steady`);

    let peak = 0;
    for (let f = 0; f < trace.length; f++) if (trace[f] > peak) peak = trace[f];
    assert.ok(peak / steady < 1.06, `switching back peaked at ${(peak / steady).toFixed(3)} of steady`);
});

// A gap need not be long enough to empty the field, and a scene you glance
// away from for a moment leaves a partial one. Only the slots with nothing
// alive in them go back to virgin, so what survived the gap carries on and the
// holes it left fill at the same paced rate — ungated, half a lifetime away
// reads as 1.84x on the way back, against 2.06x for a gap that empties it.
test('a gap that empties only part of the field keeps the rest', () => {
    const ctx = panelCtx();
    const p = emitter.prepare({ ...emitter.defaults, ...RAMP_PARAMS });
    const inst = emitter.createInstance(ctx);
    const out = new Float32Array(ctx.numPixels * 3);
    const life = RAMP_LIFE * 1000;

    energyTrace(inst, p, out, 1e6, life * 3);
    const trace = energyTrace(inst, p, out, 1e6 + life * 3.5, life * 6);
    const steady = tailMean(trace, (life * 3) / RAMP_STEP);

    assert.ok(trace[0] / steady > 0.5,
        `coming back culled the survivors: ${(trace[0] / steady).toFixed(2)} of steady`);
    let peak = 0;
    for (let f = 0; f < trace.length; f++) if (trace[f] > peak) peak = trace[f];
    assert.ok(peak / steady < 1.06, `refilling the holes peaked at ${(peak / steady).toFixed(3)}`);
});

// createInstance is recreated only when a layer's effectType changes, so a
// param edit has to reach the render loop through `p`. Anything captured at
// construction would silently freeze at the value the layer was created with.
test('emitter reads params through p, not from construction', () => {
    const ctx = panelCtx();
    const inst = emitter.createInstance(ctx);
    const out = new Float32Array(ctx.numPixels * 3);

    const dim = emitter.prepare({ ...emitter.defaults, count: 2, size: 0.08 });
    const bright = emitter.prepare({ ...emitter.defaults, count: 60, size: 0.5 });

    // Same instance, same time base, different params: only `p` differs.
    for (let f = 0; f < 120; f++) inst.render(out, 1000 + f * 40, dim);
    let dimSum = 0;
    for (let i = 0; i < out.length; i++) dimSum += out[i];

    for (let f = 0; f < 120; f++) inst.render(out, 6000 + f * 40, bright);
    let brightSum = 0;
    for (let i = 0; i < out.length; i++) brightSum += out[i];

    assert.ok(brightSum > dimSum * 3,
        `params did not reach the loop: ${dimSum.toFixed(0)} vs ${brightSum.toFixed(0)}`);
});

// falloff is 1/size^2, so a size of 0 is Infinity and then
// intensity / (1 + Infinity * 0) is NaN — straight through setPixel and out to
// the panel. The slider cannot reach 0 but the typed field is unclamped.
test('emitter survives a typed size of 0', () => {
    const ctx = panelCtx();
    const p = emitter.prepare({ ...emitter.defaults, size: 0 });
    assert.ok(Number.isFinite(p.falloff), 'falloff must not be Infinity');
    const inst = emitter.createInstance(ctx);
    const out = new Float32Array(ctx.numPixels * 3);
    for (let f = 0; f < 60; f++) inst.render(out, 1000 + f * 40, p);
    assert.ok(out.every(v => Number.isFinite(v)), 'size 0 put non-finite values in the buffer');
});

// The documented filmstrip trap: a particle effect testing a falsy birth time
// to decide whether a slot needs seeding would re-seed every particle every
// frame at t=0 and render black. The emitter uses an explicit alive flag
// instead, which has to hold at t=0 too.
test('emitter renders at a zero time base', () => {
    const ctx = panelCtx();
    const p = emitter.prepare({ ...emitter.defaults, count: 40 });
    const inst = emitter.createInstance(ctx);
    const out = new Float32Array(ctx.numPixels * 3);
    for (let f = 0; f < 120; f++) inst.render(out, f * 40, p);
    let sum = 0;
    for (let i = 0; i < out.length; i++) sum += out[i];
    assert.ok(sum > 0, 'renders black from a zero time base');
});

// Gravity is a vector, which is the whole reason it is a magnitude and an
// angle rather than a fall/rise toggle: a sideways pull is a look no launch
// direction reproduces.
test('emitter gravity pulls sideways, not just down', () => {
    const ctx = panelCtx();
    const base = { ...emitter.defaults, count: 40, speed: 0.2, spread: 20, dir: 90, life: 4, grav: 3 };

    function centroidX(gravDir) {
        const p = emitter.prepare({ ...base, gravDir });
        const inst = emitter.createInstance(ctx);
        const out = new Float32Array(ctx.numPixels * 3);
        let weighted = 0, total = 0;
        for (let f = 0; f < 150; f++) {
            inst.render(out, 4000 + f * 40, p);
            for (let i = 0; i < ctx.numPixels; i++) {
                const v = out[i * 3] + out[i * 3 + 1] + out[i * 3 + 2];
                weighted += ctx.modelX[i] * v;
                total += v;
            }
        }
        return total > 0 ? weighted / total : 0;
    }

    assert.ok(centroidX(0) > centroidX(180) + 0.5,
        'gravity at 0 degrees should push the field right of gravity at 180');
});

test('emitter superseded candy_sparkler and embers, which are gone from the catalog', () => {
    const types = effects.catalog().map(e => e.type);
    assert.ok(types.includes('emitter'));
    assert.ok(!types.includes('candy_sparkler'));
    assert.ok(!types.includes('embers'));
    assert.strictEqual(effects.get('embers'), null, 'the superseded effect module is gone entirely');
    assert.strictEqual(effects.get('candy_sparkler'), null);
});

// The vertical axis inverts between param space (y up, what the pad and the
// dials draw) and modelZ (+0.875 is the *bottom* row). Origin, travel and
// gravity all share that negation, so they break together — and a symmetric
// preset like the sparkler shows nothing, which is how it shipped once.
//
// panelCtx() builds modelZ ascending with row, matching layout.json, so
// "toward the top of the panel" is modelZ negative throughout.
function verticalCentroid(params, ctx) {
    const p = emitter.prepare({ ...emitter.defaults, ...params });
    const inst = emitter.createInstance(ctx);
    const out = new Float32Array(ctx.numPixels * 3);
    let weighted = 0, total = 0;
    for (let f = 0; f < 150; f++) {
        inst.render(out, 4000 + f * 40, p);
        for (let i = 0; i < ctx.numPixels; i++) {
            const v = out[i * 3] + out[i * 3 + 1] + out[i * 3 + 2];
            weighted += ctx.modelZ[i] * v;
            total += v;
        }
    }
    return total > 0 ? weighted / total : null;
}

test('a positive y origin sits toward the top of the panel', () => {
    const ctx = panelCtx();
    const base = { count: 40, speed: 0, spread: 1, life: 4, grav: 0, extX: 0, extY: 0, size: 0.2 };
    const top = verticalCentroid({ ...base, y: 0.6 }, ctx);
    const bottom = verticalCentroid({ ...base, y: -0.6 }, ctx);
    assert.ok(top < bottom,
        `y +0.6 should render above y -0.6 (modelZ ${top} vs ${bottom})`);
    assert.ok(top < 0 && bottom > 0, 'the two should straddle the panel centre');
});

test('travel at 90 degrees moves up the panel, 270 moves down', () => {
    const ctx = panelCtx();
    const base = { count: 40, speed: 1.2, spread: 20, life: 3, grav: 0, y: 0 };
    const up = verticalCentroid({ ...base, dir: 90 }, ctx);
    const down = verticalCentroid({ ...base, dir: 270 }, ctx);
    assert.ok(up < down, `dir 90 should render above dir 270 (modelZ ${up} vs ${down})`);
});

test('gravity at 270 degrees pulls down the panel, 90 pulls up', () => {
    const ctx = panelCtx();
    const base = { count: 40, speed: 0.1, spread: 360, life: 3, grav: 3, y: 0 };
    const falls = verticalCentroid({ ...base, gravDir: 270 }, ctx);
    const rises = verticalCentroid({ ...base, gravDir: 90 }, ctx);
    assert.ok(rises < falls,
        `gravity up should render above gravity down (modelZ ${rises} vs ${falls})`);
});

// The effect this replaced was born over modelZ 0..2 with a negative modelZ
// velocity — it rises from the lower half. Keeping that is the whole point of
// the preset, and it is the case the cancelling sign errors hid.
test('the embers preset rises from the lower half, as the old effect did', () => {
    const ctx = panelCtx();
    const preset = emitter.presets.find(p => p.id === 'embers');
    assert.ok(preset.params.y < 0, 'embers are born below centre');
    assert.ok(preset.params.dir > 0 && preset.params.dir < 180, 'and travel upward');

    const early = verticalCentroid({ ...preset.params, life: 1.2 }, ctx);
    const late = verticalCentroid({ ...preset.params, life: 5.5 }, ctx);
    assert.ok(late < early, `embers should climb over their life (${late} vs ${early})`);
});
