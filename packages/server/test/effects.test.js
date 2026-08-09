const test = require('node:test');
const assert = require('node:assert');

const wavelet = require('../effects/wavelet');
const planewave = require('../effects/planewave');
const solid = require('../effects/solid');
const gradient = require('../effects/gradient');
const noise = require('../effects/noise');
const emitter = require('../effects/emitter');
const twinkle = require('../effects/twinkle');
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

test('wavelet crests run outward by default and inward when asked', () => {
    // A row of pixels running away from a source at the origin, so a pixel's
    // model x is exactly its distance from the source. lambda is wide enough
    // that under two radians of phase fit across the row, so there is never
    // more than one crest in view to confuse "which way did it move".
    const n = 16;
    const row = { numPixels: n, modelX: new Float32Array(n), modelZ: new Float32Array(n) };
    for (let i = 0; i < n; i++) row.modelX[i] = 0.25 + i * 0.25;

    const freq = 0.2;
    const lambda = 2;
    const instance = wavelet.createInstance(row);
    const out = new Float32Array(n * 3);
    // Times are quoted as the wave's own phase (wt), which is what puts the
    // crest somewhere legible; millis is just the inverse of the render loop's
    // wt = millis * 0.00628 * freq.
    const crestAt = (direction, wt) => {
        instance.render(out, wt / (0.00628 * freq), wavelet.prepare({
            ...wavelet.defaults, color: '#ffffff', x: 0, y: 0,
            freq, lambda, delta: 0, min: 0, max: 1, direction,
        }));
        let best = -1, bi = -1;
        for (let i = 0; i < n; i++) if (out[i * 3] > best) { best = out[i * 3]; bi = i; }
        // An off-the-end "crest" is the row's edge, not the wave's peak, and
        // would make the comparison below meaningless.
        assert.ok(bi > 0 && bi < n - 1, `crest sits on the row's edge at wt=${wt}`);
        return row.modelX[bi];
    };

    assert.ok(crestAt('outward', 2.6) > crestAt('outward', 1.8),
        'an outward crest must move away from the source');
    assert.ok(crestAt('inward', 1.0) < crestAt('inward', 0.2),
        'an inward crest must converge on the source');
});

test('a wavelet stored before the direction toggle renders as outward', () => {
    const stored = { ...wavelet.defaults, color: '#ffffff' };
    delete stored.direction;
    assert.strictEqual(wavelet.prepare(stored).k, wavelet.prepare({ ...stored, direction: 'outward' }).k);
    assert.ok(wavelet.prepare(stored).k > 0, 'outward subtracts the radial term');
});

test('planewave prepare bakes the direction into cos/sin', () => {
    const p = planewave.prepare({ ...planewave.defaults, angle: 90 });
    assert.ok(Math.abs(p.ca - 0) < 1e-12);
    assert.ok(Math.abs(p.sa - 1) < 1e-12);
    assert.strictEqual(p.angle, undefined, 'degrees should not reach the render loop');
});

test('planewave wavefronts are parallel and perpendicular to the direction', () => {
    // Two pixels offset only along z. At 0 degrees the wave travels along x,
    // so both sit on the same wavefront and must match; at 90 degrees the wave
    // travels along z, so they must not.
    const ctx = {
        numPixels: 2,
        modelX: new Float32Array([1, 1]),
        modelZ: new Float32Array([-0.5, 0.5]),
    };
    const instance = planewave.createInstance(ctx);
    const out = new Float32Array(6);

    instance.render(out, 0, planewave.prepare({ ...planewave.defaults, angle: 0, color: '#ffffff' }));
    assert.ok(Math.abs(out[0] - out[3]) < 1e-9, 'wavefront should be flat across z at 0 degrees');

    instance.render(out, 0, planewave.prepare({ ...planewave.defaults, angle: 90, color: '#ffffff' }));
    assert.ok(Math.abs(out[0] - out[3]) > 1, 'the wave should vary along z at 90 degrees');
});

test('planewave render clamps output to [0, 255]', () => {
    const p = planewave.prepare({ ...planewave.defaults, color: '#ffffff', min: -5, max: 10 });
    const out = new Float32Array(6);
    planewave.createInstance(ctx2).render(out, 99999, p);
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

// ---- noise: levels replaced contrast (#13) ----

// A full panel's worth of pixels, so distribution claims mean something.
function panelCtx() {
    const COLS = 30, ROWS = 8, SPACING = 0.25, n = COLS * ROWS;
    const modelX = new Float32Array(n), modelZ = new Float32Array(n);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const i = r * COLS + c;
            modelX[i] = (c - (COLS - 1) / 2) * SPACING;
            modelZ[i] = (r - (ROWS - 1) / 2) * SPACING;
        }
    }
    return { numPixels: n, modelX, modelZ };
}

function renderNoise(params, millis, ctx) {
    const p = noise.prepare({ ...noise.defaults, ...params });
    const out = new Float32Array(ctx.numPixels * 3);
    noise.createInstance(ctx).render(out, millis, p);
    return out;
}

test('noise upgradeParams converts contrast to the equivalent levels pair', () => {
    const up = noise.upgradeParams({ c1: '#000000', scale: 0.8, contrast: 3 });
    assert.strictEqual(up.min, -0.5);
    assert.strictEqual(up.max, 1.5);
    assert.strictEqual(up.contrast, undefined, 'the dead key should not survive');
    assert.strictEqual(up.scale, 0.8, 'other params must be carried over');
    assert.strictEqual(up.c1, '#000000');
});

test('noise upgradeParams leaves already-converted params alone', () => {
    const converted = { scale: 1, min: 0, max: 1 };
    assert.strictEqual(noise.upgradeParams(converted), converted);
    // Idempotent: running it on its own output changes nothing.
    const once = noise.upgradeParams({ contrast: 1.8 });
    assert.strictEqual(noise.upgradeParams(once), once);
    // And a params object that never had contrast is passed straight through.
    const fresh = { scale: 2 };
    assert.strictEqual(noise.upgradeParams(fresh), fresh);
});

test('noise upgradeParams keeps min/max when a stray contrast is also present', () => {
    // Nothing validates params, so a hand-edited or half-migrated layer can
    // carry both. The new keys win rather than being overwritten.
    const up = noise.upgradeParams({ contrast: 8, min: 0, max: 1 });
    assert.strictEqual(up.min, 0);
    assert.strictEqual(up.max, 1);
});

test('contrast converts to a proportional span about the ramp centre', () => {
    // Deliberately not look-preserving: the field was recalibrated at the same
    // time (see AMPLITUDE), so the same fraction of the ramp is now a stronger
    // image. What the conversion does preserve is the *meaning* of the stored
    // number — its position in the ordering, and the balance point it sat on.
    for (const contrast of [0.25, 1.22, 1.5, 1.8, 3, 16]) {
        const up = noise.upgradeParams({ contrast });
        assert.ok(Math.abs((up.min + up.max) / 2 - 0.5) < 1e-12,
            `contrast ${contrast} should stay centred on the ramp midpoint`);
        assert.ok(Math.abs((up.max - up.min) - contrast / 1.5) < 1e-12,
            `contrast ${contrast} should become a span of c/1.5`);
    }

    // The old default lands exactly on the new one, so a layer that was never
    // touched comes through the conversion reading 0 / 1.
    const fromDefault = noise.upgradeParams({ contrast: 1.5 });
    assert.strictEqual(fromDefault.min, 0);
    assert.strictEqual(fromDefault.max, 1);
    assert.strictEqual(fromDefault.min, noise.defaults.min);
    assert.strictEqual(fromDefault.max, noise.defaults.max);

    // Ordering survives: a scene stored more contrasty stays more contrasty.
    const pairs = [1, 1.5, 3, 8].map(c => noise.upgradeParams({ contrast: c }));
    for (let i = 1; i < pairs.length; i++) {
        assert.ok(pairs[i].max - pairs[i].min > pairs[i - 1].max - pairs[i - 1].min);
    }
});

test('the default levels use the whole ramp, both rails included', () => {
    // The calibration this effect exists to have: at 0 / 1 the field should
    // rest on each rail about 1% of the time — enough that "fully dark" and
    // "fully bright" pixels are really there, without clipping the field.
    // A wavelet gets 9% from its sine's turning points; a bell-shaped field
    // has no analogue, and chasing that number would clip a fifth of it.
    const ctx = panelCtx();
    const c1b = 48, c2b = 255;
    const p = noise.prepare({ ...noise.defaults, speed: 1, scale: 1 });
    const inst = noise.createInstance(ctx);
    const out = new Float32Array(ctx.numPixels * 3);

    let atLow = 0, atHigh = 0, total = 0;
    for (let f = 0; f < 600; f++) {
        inst.render(out, f * 40, p);
        for (let i = 0; i < ctx.numPixels; i++) {
            const b = out[i * 3 + 2];
            total++;
            if (b <= c1b) atLow++;
            if (b >= c2b) atHigh++;
        }
    }
    const low = atLow / total * 100, high = atHigh / total * 100;
    assert.ok(low > 0.3 && low < 3,
        `at 0/1 the field should rest on c1 about 1% of the time, got ${low.toFixed(2)}%`);
    assert.ok(high > 0.3 && high < 3,
        `at 0/1 the field should rest on c2 about 1% of the time, got ${high.toFixed(2)}%`);
});

test('levels reach both rails, which is the density control contrast lacked', () => {
    const ctx = panelCtx();
    const c1 = [10, 16, 48], c2 = [63, 208, 255];

    const sparse = renderNoise({ min: -2, max: 1 }, 7777, ctx);
    const dense = renderNoise({ min: 0.5, max: 3 }, 7777, ctx);

    let atLow = 0, atHigh = 0;
    for (let i = 0; i < ctx.numPixels; i++) {
        if (sparse[i * 3 + 2] === c1[2]) atLow++;
        if (dense[i * 3 + 2] === c2[2]) atHigh++;
    }
    assert.ok(atLow > ctx.numPixels / 2,
        `min: -2 should pin most pixels to c1, got ${atLow}/${ctx.numPixels}`);
    assert.ok(atHigh > ctx.numPixels / 2,
        `max: 3 should pin most pixels to c2, got ${atHigh}/${ctx.numPixels}`);
});

// ---- noise: the field flows rather than pulsing (#14) ----

test('noise moves at a near-constant rate across lattice crossings', () => {
    // The bug this guards: interpolating the time axis with a fade whose
    // derivative is zero at both ends made the field stall every time t crossed
    // an integer — one visible beat per 1/speed seconds. Measured as the 10th
    // percentile of per-frame change over the median: 100% is constant
    // velocity. The old value-noise implementation scored 57% here.
    //
    // A fixed step and a long window, so this does not depend on frame timing
    // and covers many crossings whatever the interpolation is doing.
    const ctx = panelCtx();
    const STEP_MS = 40, FRAMES = 1200;   // 48 s at speed 1
    const p = noise.prepare({ ...noise.defaults, speed: 1, scale: 1, min: 0, max: 1 });
    const inst = noise.createInstance(ctx);

    const cur = new Float32Array(ctx.numPixels * 3);
    const prev = new Float32Array(ctx.numPixels * 3);
    const deltas = [];
    for (let f = 0; f < FRAMES; f++) {
        inst.render(cur, f * STEP_MS, p);
        if (f > 0) {
            let sum = 0;
            for (let i = 0; i < cur.length; i++) sum += Math.abs(cur[i] - prev[i]);
            deltas.push(sum / cur.length);
        }
        prev.set(cur);
    }

    deltas.sort((a, b) => a - b);
    const p10 = deltas[Math.floor(deltas.length * 0.1)];
    const median = deltas[Math.floor(deltas.length * 0.5)];
    const stallDepth = p10 / median;

    assert.ok(stallDepth > 0.7,
        `the field stalls periodically: 10th percentile of per-frame change is ` +
        `${(stallDepth * 100).toFixed(0)}% of the median (want > 70%)`);
});

test('noise keeps the pace value noise had, independent of its strength', () => {
    // TIME_RATE holds the field's speed where value noise had it, so a stored
    // `speed` still means what it meant. Measured scale-free, as mean per-frame
    // change over the field's own standard deviation: that ratio depends only
    // on how fast the field moves through the lattice, so it pins TIME_RATE
    // without also pinning AMPLITUDE — which is deliberately not where value
    // noise had it, and is guarded by the rail-occupancy test instead.
    //
    // Levels are set narrow so nothing clamps; clipping would eat exactly the
    // large excursions this is trying to measure.
    const ctx = panelCtx();
    const p = noise.prepare({ ...noise.defaults, speed: 1, scale: 1, min: 0.25, max: 0.75 });
    const inst = noise.createInstance(ctx);
    const cur = new Float32Array(ctx.numPixels * 3);
    const prev = new Float32Array(ctx.numPixels * 3);

    let sum = 0, sumSq = 0, count = 0, deltaSum = 0, frames = 0;
    for (let f = 0; f < 800; f++) {
        inst.render(cur, f * 40, p);
        for (let i = 0; i < ctx.numPixels; i++) {
            const b = cur[i * 3 + 2];
            sum += b; sumSq += b * b; count++;
        }
        if (f > 0) {
            let d = 0;
            for (let i = 0; i < ctx.numPixels; i++) d += Math.abs(cur[i * 3 + 2] - prev[i * 3 + 2]);
            deltaSum += d / ctx.numPixels;
            frames++;
        }
        prev.set(cur);
    }

    const sd = Math.sqrt(sumSq / count - (sum / count) ** 2);
    const pace = (deltaSum / frames) / sd;
    assert.ok(pace > 0.05 && pace < 0.09,
        `field pace ${pace.toFixed(4)} is outside the rate value noise moved at (want ~0.067)`);
});

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
        // Past the virgin stagger, which spreads first births over one lifetime.
        let lit = 0;
        for (let f = 0; f < 200; f++) {
            inst.render(out, 1000 + f * 40, p);
            for (let i = 0; i < out.length; i++) if (out[i] > 1) { lit++; break; }
        }
        assert.ok(out.every(v => Number.isFinite(v)), `${preset.id} produced non-finite values`);
        assert.ok(lit > 150, `${preset.id} was lit on only ${lit}/200 frames`);
    }
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

// The documented filmstrip trap: embers tested `if (!q.born)`, so a born time
// of 0 re-seeded every particle every frame and the layer rendered black. The
// emitter uses an explicit alive flag, which has to hold at t=0 too.
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

test('emitter is the only particle effect in the catalog', () => {
    const types = effects.catalog().map(e => e.type);
    assert.ok(types.includes('emitter'));
    assert.ok(!types.includes('candy_sparkler'), 'superseded effects must not be offered');
    assert.ok(!types.includes('embers'));
    // Still registered, so stored and imported layers keep rendering.
    assert.ok(effects.get('candy_sparkler'), 'candy_sparkler must stay resolvable');
    assert.ok(effects.get('embers'), 'embers must stay resolvable');
});

test('every catalog entry with presets renders each of them', () => {
    for (const entry of effects.catalog()) {
        if (!entry.presets) continue;
        const mod = effects.get(entry.type);
        for (const preset of entry.presets) {
            const params = { ...mod.defaults, ...preset.params };
            assert.ok(preset.id && preset.name, `${entry.type} preset missing id or name`);
            const out = new Float32Array(ctx2.numPixels * 3);
            mod.createInstance(ctx2).render(out, 12345, mod.prepare(params));
            assert.ok(out.every(v => Number.isFinite(v)), `${entry.type}:${preset.id} not finite`);
        }
    }
});

// hueSpread 0 is what every stored twinkle layer has, and it must stay on the
// single-colour path rather than quietly routing through a one-entry palette.
test('twinkle hue spread widens the palette and 0 keeps the old path', () => {
    assert.strictEqual(twinkle.prepare(twinkle.defaults).palette, null);
    const spread = twinkle.prepare({ ...twinkle.defaults, color: '#ff0000', hueSpread: 1 });
    assert.ok(spread.palette, 'a non-zero spread must build a palette');
    const hues = new Set();
    for (let i = 0; i < spread.palette.length / 3; i++) {
        hues.add([0, 1, 2].map(k => Math.round(spread.palette[i * 3 + k] / 32)).join(','));
    }
    assert.ok(hues.size > 8, `expected a spread of hues, got ${hues.size}`);
});

test('twinkle sharpness changes how much of the cycle is lit', () => {
    const ctx = panelCtx();
    function litSum(sharpness) {
        const p = twinkle.prepare({ ...twinkle.defaults, sharpness, background: 0 });
        const inst = twinkle.createInstance(ctx);
        const out = new Float32Array(ctx.numPixels * 3);
        let sum = 0;
        for (let f = 0; f < 60; f++) {
            inst.render(out, f * 100, p);
            for (let i = 0; i < out.length; i++) sum += out[i];
        }
        return sum;
    }
    // A higher exponent spends more of the cycle near zero.
    assert.ok(litSum(1) > litSum(12), 'sharpness must darken the duty cycle');
});

// app.js seeds the built-in scenes by looking these preset ids up, and only on
// a *fresh* install — where emitterMigrated is already true, so nothing would
// ever convert a layer seeded with a hidden type, and a renamed id throws at
// boot rather than in any test that runs on an existing library.
test('the preset ids app.js seeds built-ins from still exist', () => {
    const ids = emitter.presets.map(p => p.id);
    for (const id of ['embers', 'sparkler']) {
        assert.ok(ids.includes(id), `seedBuiltins looks up the '${id}' preset`);
    }
});

// Whatever a built-in is seeded as has to be something the picker can also
// create, or the library ships with a layer the user cannot reproduce.
test('no effect is both hidden and reachable from the catalog', () => {
    const visible = new Set(effects.catalog().map(e => e.type));
    for (const mod of effects.list()) {
        assert.strictEqual(visible.has(mod.type), !mod.hidden,
            `${mod.type} disagrees with its hidden flag`);
    }
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
