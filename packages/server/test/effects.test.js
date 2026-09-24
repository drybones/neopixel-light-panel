const test = require('node:test');
const assert = require('node:assert');

const wavelet = require('../effects/wavelet');
const planewave = require('../effects/planewave');
const solid = require('../effects/solid');
const gradientLinear = require('../effects/gradient_linear');
const gradientRadial = require('../effects/gradient_radial');
const noise = require('../effects/noise');
const twinkle = require('../effects/twinkle');
const effects = require('../effects');
const { panelCtx } = require('./support/panel-ctx');
const { RAD_PER_MS } = require('../engine/wave');

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
    // Guards against reintroducing a filter between the two: every registered
    // effect belongs in the catalog now that nothing is hidden.
    assert.strictEqual(catalog.length, effects.list().length);
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
    // wt = millis * RAD_PER_MS * freq.
    const crestAt = (direction, wt) => {
        instance.render(out, wt / (RAD_PER_MS * freq), wavelet.prepare({
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

const RAMP = [
    { position: 0, color: '#000000' },
    { position: 1, color: '#ff0000' },
];

test('gradient LUT interpolates stops', () => {
    const p = gradientLinear.prepare({ ...gradientLinear.defaults, stops: RAMP });
    assert.strictEqual(p.lut[0], 0);
    assert.strictEqual(p.lut[255 * 3], 255);
    const mid = p.lut[128 * 3];
    assert.ok(Math.abs(mid - 128) < 2, 'midpoint ' + mid);
});

test('linear gradient maps panel extremes to stop colours', () => {
    const p = gradientLinear.prepare({ ...gradientLinear.defaults, stops: RAMP, angle: 0 });
    const ctx = {
        numPixels: 3,
        modelX: new Float32Array([-3.625, 0, 3.625]),
        modelZ: new Float32Array([0, 0, 0]),
    };
    const out = new Float32Array(9);
    gradientLinear.createInstance(ctx).render(out, 0, p);
    assert.ok(out[0] < 3, 'left edge should be near black, got ' + out[0]);
    assert.ok(Math.abs(out[3] - 127.5) < 3, 'centre should be mid-red, got ' + out[3]);
    assert.ok(out[6] > 252, 'right edge should be full red, got ' + out[6]);
});

// The vertical axis inverts between param space (the dial draws 90 degrees as
// up) and modelZ, whose +0.875 is the *bottom* row. The effect this replaced was
// missing the negation and ran its ramp downward at 90; it went unseen because
// the control was a slider with no picture, and because the x axis on its own
// looks perfectly correct. Pin the axis the dial disagreed with.
test('linear gradient at 90 degrees puts its last stop at the top', () => {
    const p = gradientLinear.prepare({ ...gradientLinear.defaults, stops: RAMP, angle: 90 });
    const ctx = {
        numPixels: 2,
        modelX: new Float32Array([0, 0]),
        // Strip order: modelZ -0.875 is the top row, +0.875 the bottom.
        modelZ: new Float32Array([-0.875, 0.875]),
    };
    const out = new Float32Array(6);
    gradientLinear.createInstance(ctx).render(out, 0, p);
    assert.ok(out[0] > out[3], `top row must be the brighter end, got ${out[0]} vs ${out[3]}`);
});

// Repeats scales the ramp about the panel's centre, so at 2 the stop list runs
// black-to-red over the middle half and the mirror tiling folds both edges back
// to the same mid-ramp colour — which is what keeps it seamless.
test('linear gradient repeats traverse the stop list more than once', () => {
    const ctx = {
        numPixels: 5,
        modelX: new Float32Array([-3.625, -1.8125, 0, 1.8125, 3.625]),
        modelZ: new Float32Array([0, 0, 0, 0, 0]),
    };
    const out = new Float32Array(15);
    gradientLinear.createInstance(ctx).render(out, 0,
        gradientLinear.prepare({ ...gradientLinear.defaults, stops: RAMP, angle: 0, repeats: 2 }));
    assert.ok(out[3] < 3, 'the first stop should land a quarter in, got ' + out[3]);
    assert.ok(out[9] > 252, 'the last stop should land three quarters in, got ' + out[9]);
    assert.ok(Math.abs(out[0] - 127.5) < 3, 'left edge should fold to mid-ramp, got ' + out[0]);
    assert.ok(Math.abs(out[12] - 127.5) < 3, 'right edge should fold to mid-ramp, got ' + out[12]);
});

test('gradient tiling decides what happens past the ends', () => {
    const ctx = {
        // Off the right of the panel, at u = 1.25 — the mirror fold and the
        // sawtooth agree at exactly 1.5, so a sample there would prove nothing.
        numPixels: 1,
        modelX: new Float32Array([5.4375]),
        modelZ: new Float32Array([0]),
    };
    function edge(tiling) {
        const out = new Float32Array(3);
        gradientLinear.createInstance(ctx).render(out, 0,
            gradientLinear.prepare({ ...gradientLinear.defaults, stops: RAMP, angle: 0, tiling }));
        return out[0];
    }
    assert.ok(edge('hold') > 252, 'hold should sit on the last stop, got ' + edge('hold'));
    assert.ok(Math.abs(edge('repeat') - 63.75) < 3, 'repeat should sawtooth to 0.25, got ' + edge('repeat'));
    assert.ok(Math.abs(edge('mirror') - 191.25) < 3, 'mirror should fold to 0.75, got ' + edge('mirror'));
});

test('radial gradient is symmetric around the centre', () => {
    const p = gradientRadial.prepare({
        ...gradientRadial.defaults,
        stops: [
            { position: 0, color: '#ffffff' },
            { position: 1, color: '#000000' },
        ],
        cx: 0, cy: 0,
    });
    const ctx = {
        numPixels: 3,
        modelX: new Float32Array([-2, 0, 2]),
        modelZ: new Float32Array([0, 0, 0]),
    };
    const out = new Float32Array(9);
    gradientRadial.createInstance(ctx).render(out, 0, p);
    assert.strictEqual(out[0], out[6]);
    assert.ok(out[3] > out[0], 'centre should be brightest');
});

// A circle on a 30x8 panel is clipped hard at the left and right edges; aspect
// stretches it in x, which is the whole reason the control exists.
test('radial aspect stretches the falloff horizontally, not vertically', () => {
    const ctx = {
        numPixels: 2,
        modelX: new Float32Array([2, 0]),
        modelZ: new Float32Array([0, 0.5]),
    };
    function render(aspect) {
        const out = new Float32Array(6);
        gradientRadial.createInstance(ctx).render(out, 0, gradientRadial.prepare({
            ...gradientRadial.defaults, cx: 0, cy: 0, aspect,
            stops: [{ position: 0, color: '#ffffff' }, { position: 1, color: '#000000' }],
        }));
        return { x: out[0], z: out[3] };
    }
    const circle = render(1);
    const wide = render(4);
    assert.ok(wide.x > circle.x, 'a wider aspect must keep the x pixel brighter for longer');
    assert.strictEqual(wide.z, circle.z, 'and must not touch the vertical falloff');
});

// Scroll is a log slider and cannot go negative; unlike the linear gradient
// there is no dial here to turn the picture round, so the direction is a toggle
// — wavelet's reason, and wavelet's label.
test('radial travel reverses the scroll', () => {
    const ctx = { numPixels: 1, modelX: new Float32Array([1]), modelZ: new Float32Array([0]) };
    function at(travel, millis) {
        const out = new Float32Array(3);
        gradientRadial.createInstance(ctx).render(out, millis, gradientRadial.prepare({
            ...gradientRadial.defaults, stops: RAMP, cx: 0, cy: 0, scroll: 0.1, travel,
        }));
        return out[0];
    }
    assert.strictEqual(at('outward', 0), at('inward', 0), 'they only differ once time passes');
    assert.ok(Math.abs(at('outward', 1000) - at('inward', 1000)) > 1,
        'a second in, the two directions must have parted');
    // Symmetric about t = 0: one is the other run backwards.
    assert.ok(Math.abs(at('outward', 1000) - at('inward', -1000)) < 1e-3);
});

// ---- noise: levels replaced contrast (#13) ----

function renderNoise(params, millis, ctx) {
    const p = noise.prepare({ ...noise.defaults, ...params });
    const out = new Float32Array(ctx.numPixels * 3);
    noise.createInstance(ctx).render(out, millis, p);
    return out;
}

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

// The backglow is a floor the swell is scaled into, not a bias added on top of
// it (issue #94). Added on top, the peak was 1 + background and the sink's
// per-channel clamp bit red first, so the brightest moment of a star drifted
// off the configured colour — worst exactly where it shows most.
test('twinkle peaks at the configured colour for any backglow', () => {
    const ctx = panelCtx();
    const rgb = [255, 233, 196]; // #ffe9c4, the default swatch
    for (const background of [0, 0.02, 0.1, 0.5]) {
        // sharpness 1 is the plain sine, so a peak is reached often enough to
        // catch within one sweep at every period in the instance's spread.
        const p = twinkle.prepare({ ...twinkle.defaults, sharpness: 1, density: 1, background });
        const inst = twinkle.createInstance(ctx);
        const out = new Float32Array(ctx.numPixels * 3);
        const peak = [0, 0, 0];
        for (let f = 0; f < 400; f++) {
            inst.render(out, f * 25, p);
            for (let i = 0; i < ctx.numPixels; i++) {
                for (let k = 0; k < 3; k++) peak[k] = Math.max(peak[k], out[i * 3 + k]);
            }
        }
        for (let k = 0; k < 3; k++) {
            assert.ok(peak[k] <= rgb[k] + 1e-4,
                `background ${background} channel ${k} overshot: ${peak[k]} > ${rgb[k]}`);
            assert.ok(peak[k] > rgb[k] - 0.5,
                `background ${background} channel ${k} never reached the colour: ${peak[k]}`);
        }
    }
});
