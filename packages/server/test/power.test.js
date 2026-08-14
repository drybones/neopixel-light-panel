const test = require('node:test');
const assert = require('node:assert');

const power = require('../engine/power');
const { PowerMeter, scaleFor, budgetFor, railVolts, normaliseConfig, milliampsFor } = power;
const VirtualOPC = require('../virtual-opc');
const sweep = require('../tools/power-sweep');

const NUM_LEDS = 240;

// The rail this panel actually has to live with: a 5V/20A supply whose
// wiring puts the Pi under 4.75V somewhere around 10A. Deliberately the
// worked example from the plan, so the numbers below can be checked by hand.
const RAIL = { openCircuitVolts: 5.15, ohms: 0.04, floorVolts: 4.75 };

function config(overrides) {
    return normaliseConfig(Object.assign({}, overrides));
}

// A sink painted a flat colour and flushed — the whole write path, since the
// estimate is only meaningful over the bytes that would really be sent.
function paint(sink, r, g, b) {
    for (let i = 0; i < NUM_LEDS; i++) sink.setPixel(i, r, g, b);
    sink.writePixels();
    return sink.power.snapshot();
}

function sinkWith(cfg, brightness) {
    const sink = new VirtualOPC();
    sink.brightness = brightness === undefined ? 1 : brightness;
    sink.setPixelCount(NUM_LEDS);
    sink.power.setConfig(cfg);
    return sink;
}

// ---------------------------------------------------------------- estimate

test('full white on 240 LEDs estimates 13.35A', () => {
    const snap = paint(sinkWith(config()), 255, 255, 255);
    // 240 * 55 * (0.98 + 1 + 1)/3 driven, plus 1mA standby per LED.
    assert.ok(Math.abs(snap.requestedMilliamps - 13352) < 1,
        `expected ~13352mA, got ${snap.requestedMilliamps}`);
    assert.strictEqual(Math.round(snap.maxMilliampsFullWhite), 13352);
});

/*
 * The load-bearing test of the whole model. fcserver applies gamma 2.5, so
 * half brightness is not half the current — it is about a fifth. WLED's
 * byte-sum would say ~6.7A here, and every ordinary scene would read three to
 * four times high.
 */
test('half brightness draws a fifth of the current, not half — gamma 2.5', () => {
    const full = paint(sinkWith(config()), 255, 255, 255).requestedMilliamps;
    const half = paint(sinkWith(config(), 0.5), 255, 255, 255).requestedMilliamps;

    assert.ok(half > 2400 && half < 2700, `expected ~2535mA, got ${half}`);
    const linearWouldBe = (full - NUM_LEDS) * 0.5 + NUM_LEDS;
    assert.ok(linearWouldBe / half > 2.5,
        'a linear byte-sum should be more than 2.5x higher than the gamma-aware estimate');
});

test('an unlit panel still draws its standby current', () => {
    const snap = paint(sinkWith(config()), 0, 0, 0);
    assert.strictEqual(snap.requestedMilliamps, NUM_LEDS);
});

test('whitepoint is carried into the estimate', () => {
    const flat = config({ whitepoint: [1, 1, 1] });
    const snap = paint(sinkWith(flat), 255, 255, 255);
    assert.strictEqual(Math.round(snap.requestedMilliamps), NUM_LEDS * 55 + NUM_LEDS);
});

// ------------------------------------------------------------------ budget

test('the tighter of the PSU and rail caps binds, and says which', () => {
    const psuOnly = budgetFor(config());
    assert.strictEqual(psuOnly.boundBy, 'psu');
    assert.strictEqual(psuOnly.milliamps, 20000 - 1200);

    const withRail = budgetFor(config({ rail: RAIL }));
    assert.strictEqual(withRail.boundBy, 'rail');
    // (5.15 - 4.75) / 0.04 = 10A total, less 1.2A of overhead.
    assert.ok(Math.abs(withRail.milliamps - 8800) < 1e-6);

    // A generous rail leaves the PSU binding.
    const easyRail = budgetFor(config({ rail: { openCircuitVolts: 5.2, ohms: 0.005, floorVolts: 4.75 } }));
    assert.strictEqual(easyRail.boundBy, 'psu');
});

test('an uncalibrated or nonsense rail reads as no rail at all', () => {
    assert.strictEqual(config({ rail: null }).rail, null);
    assert.strictEqual(config({ rail: { openCircuitVolts: 5.1, ohms: 0, floorVolts: 4.75 } }).rail, null);
    // A floor at or above the open-circuit voltage describes a negative budget.
    assert.strictEqual(config({ rail: { openCircuitVolts: 4.7, ohms: 0.04, floorVolts: 4.75 } }).rail, null);
    assert.strictEqual(config({ rail: { openCircuitVolts: 'five', ohms: 0.04, floorVolts: 4.75 } }).rail, null);
});

test('the PSU alone does not bind this panel — which is the point', () => {
    const snap = paint(sinkWith(config()), 255, 255, 255);
    assert.strictEqual(snap.limiting, false);
    assert.ok(snap.requestedMilliamps < budgetFor(config()).milliamps);
});

// ----------------------------------------------------------------- limiter

test('a limited frame is sent at or under the budget, never over', () => {
    const cfg = config({ rail: RAIL });
    const sink = sinkWith(cfg);
    const snap = paint(sink, 255, 255, 255);

    assert.strictEqual(snap.limiting, true);
    assert.ok(snap.milliamps <= snap.budgetMilliamps,
        `delivered ${snap.milliamps} must not exceed budget ${snap.budgetMilliamps}`);

    // Re-estimate over the bytes that actually went out, which is the only
    // figure the panel cares about.
    const check = sinkWith(cfg);
    const resent = paint(check, sink.pixelBuffer[0], sink.pixelBuffer[1], sink.pixelBuffer[2]);
    assert.ok(resent.requestedMilliamps <= 8800,
        `the frame as sent draws ${resent.requestedMilliamps}mA against a budget of 8800`);
});

test('the rescale is gamma-corrected, not linear', () => {
    const sink = sinkWith(config({ rail: RAIL }));
    paint(sink, 255, 255, 255);
    // Needing 65% of the current means scaling values by 0.65^0.4 = 0.843,
    // i.e. white at byte 215. A linear rescale would drop it to 166 and dim
    // the panel far more than the budget requires.
    assert.strictEqual(sink.pixelBuffer[0], 215);
});

test('an already-limited frame is not dimmed twice', () => {
    const cfg = config({ rail: RAIL });
    const first = sinkWith(cfg);
    paint(first, 255, 255, 255);
    const limited = first.pixelBuffer[0];

    const second = sinkWith(cfg);
    const snap = paint(second, limited, limited, limited);
    assert.strictEqual(snap.scale, 1);
    assert.strictEqual(second.pixelBuffer[0], limited);
});

/*
 * There is no step at the threshold, so no hysteresis is needed and nothing
 * flickers as a scene animates across it. Worth pinning: a limiter that
 * jumped to a fixed factor on the way in would be visible on every frame that
 * crossed the line.
 */
test('the scale is continuous at the budget boundary', () => {
    const cfg = config({ rail: RAIL });
    const budget = budgetFor(cfg).milliamps;
    assert.strictEqual(scaleFor(budget, NUM_LEDS, cfg).scale, 1);
    assert.ok(scaleFor(budget + 1, NUM_LEDS, cfg).scale > 0.9999);
    assert.ok(scaleFor(budget + 1, NUM_LEDS, cfg).scale < 1);
});

test('limit:false measures without acting', () => {
    const sink = sinkWith(config({ rail: RAIL, limit: false }));
    const snap = paint(sink, 255, 255, 255);
    assert.strictEqual(sink.pixelBuffer[0], 255);
    assert.strictEqual(snap.scale, 1);
    // Still reports what it would have cost — the headroom reading is the
    // reason measurement is unconditional.
    assert.ok(snap.requestedMilliamps > snap.budgetMilliamps);
});

/*
 * A budget below the panel's idle draw cannot be met by dimming at all:
 * standby current is not controllable. WLED shows something rather than a
 * dead panel, and so do we — but it must be flagged, or it looks like a
 * fault instead of a misconfiguration.
 */
test('a budget below standby draw floors rather than blacking out', () => {
    const cfg = config({ maxMilliamps: 200, overheadMilliamps: 0 });
    const result = scaleFor(5000, NUM_LEDS, cfg);
    assert.strictEqual(result.floored, true);
    assert.ok(result.scale > 0, 'never zero — a dead panel reads as a failure');
    assert.strictEqual(result.scale, power.MIN_SCALE);
});

test('the limiter never returns WLED’s +1 overshoot', () => {
    // Sweep budgets across the whole range and check the delivered estimate
    // never exceeds the budget for any of them.
    for (let budget = 500; budget <= 13000; budget += 250) {
        const cfg = config({ maxMilliamps: budget, overheadMilliamps: 0 });
        const sink = sinkWith(cfg);
        const snap = paint(sink, 255, 255, 255);
        assert.ok(snap.milliamps <= budget + 1e-6,
            `budget ${budget} delivered ${snap.milliamps}`);
    }
});

// ------------------------------------------------------------- reporting

test('predicted rail volts falls with current', () => {
    assert.strictEqual(railVolts(0, RAIL), 5.15);
    assert.ok(Math.abs(railVolts(10000, RAIL) - 4.75) < 1e-9);
    assert.strictEqual(railVolts(10000, null), null);
});

test('a snapshot includes the rail prediction under load', () => {
    const snap = paint(sinkWith(config({ rail: RAIL })), 255, 255, 255);
    // Limited to 8800mA of panel plus 1200mA of overhead = 10A, i.e. the floor.
    assert.ok(Math.abs(snap.railVolts - 4.75) < 0.01, `got ${snap.railVolts}`);
});

test('nothing rendered lately reports idle, not zero', () => {
    let t = 10000;
    const meter = new PowerMeter({ numLeds: NUM_LEDS, now: () => t });
    meter.accumulate(255, 255, 255);
    meter.endFrame();
    assert.strictEqual(meter.snapshot().idle, false);

    t += 5000;
    const snap = meter.snapshot();
    assert.strictEqual(snap.idle, true);
    // The last real reading, not a live claim about a dark panel.
    assert.ok(snap.milliamps > 0);
});

test('a fresh meter reports no reading rather than a fabricated one', () => {
    const snap = new PowerMeter({ numLeds: NUM_LEDS }).snapshot();
    assert.strictEqual(snap.milliamps, null);
    assert.strictEqual(snap.idle, true);
    assert.strictEqual(snap.numLeds, NUM_LEDS);
});

// --------------------------------------------------------------- previews

/*
 * The limiter must not reach the previews. broadcast.js serialises
 * compositor.composite — pre-brightness and now pre-limiter — so the UI stays
 * a pre-fader meter showing the scene as authored, and only the panel dims.
 * Structural today, but the whole reason the estimate lives in the sink, so
 * it is worth a test rather than a comment.
 */
test('limiting dims the panel and leaves the composite the previews read', () => {
    const { Compositor } = require('../engine/compositor');
    const { SceneStore } = require('../engine/scene-store');
    const model = require('../layout.json');

    const sink = new VirtualOPC();
    sink.setPixelCount(model.length);
    sink.power.setConfig(config({ rail: RAIL }));

    const compositor = new Compositor(sink, model);
    const store = new SceneStore(compositor, null);
    const created = store.create({
        name: 'white',
        layers: [{ effectType: 'solid', params: { color: '#ffffff', level: 1 } }],
    });
    compositor.renderFrame(store.get(created.id), Date.now());

    assert.strictEqual(compositor.composite[0], 255, 'the preview source is untouched');
    assert.strictEqual(sink.pixelBuffer[0], 215, 'the panel is pulled back');
});

// ---------------------------------------------------------------- hot loop

test('does not allocate per frame', () => {
    const meter = new PowerMeter({ numLeds: NUM_LEDS, config: config() });
    // Warm up, so JIT and the first snapshot are not counted.
    for (let i = 0; i < 1000; i++) { meter.accumulate(200, 100, 50); meter.endFrame(); }
    if (global.gc) global.gc();

    const before = process.memoryUsage().heapUsed;
    for (let frame = 0; frame < 2000; frame++) {
        for (let i = 0; i < NUM_LEDS; i++) meter.accumulate(200, 100, 50);
        meter.endFrame();
    }
    const grown = process.memoryUsage().heapUsed - before;
    // 2000 frames x 240 pixels through a per-call allocation of even one
    // small object would be tens of megabytes.
    assert.ok(grown < 2 * 1024 * 1024, `heap grew ${grown} bytes`);
});

// -------------------------------------------------------------- config I/O

test('a partial config merges rather than resetting to defaults', () => {
    const first = normaliseConfig({ maxMilliamps: 15000, rail: RAIL });
    const second = normaliseConfig({ limit: false }, first);
    assert.strictEqual(second.maxMilliamps, 15000);
    assert.deepStrictEqual(second.rail, RAIL);
    assert.strictEqual(second.limit, false);
    // An explicit null clears the calibration; an absent key does not.
    assert.strictEqual(normaliseConfig({ rail: null }, first).rail, null);
});

test('garbage in a config field falls back to the default, not NaN', () => {
    const cfg = normaliseConfig({ maxMilliamps: NaN, gamma: 'steep', ledMilliamps: -5 });
    assert.strictEqual(cfg.maxMilliamps, power.DEFAULTS.maxMilliamps);
    assert.strictEqual(cfg.gamma, power.DEFAULTS.gamma);
    assert.strictEqual(cfg.ledMilliamps, 0);
    assert.ok(isFinite(milliampsFor(100, NUM_LEDS, cfg)));
});

// ------------------------------------------------------- calibration maths

test('the rail fit recovers a synthetic V_oc and R_eff', () => {
    const samples = [];
    for (let amps = 1; amps <= 10; amps += 0.5) {
        samples.push({ amps, volts: 5.15 - 0.04 * amps });
    }
    const fit = sweep.fitRail(samples);
    assert.ok(Math.abs(fit.openCircuitVolts - 5.15) < 1e-6);
    assert.ok(Math.abs(fit.ohms - 0.04) < 1e-6);
    assert.strictEqual(fit.bent, false);
    assert.ok(Math.abs(sweep.currentAtVolts(fit, 4.75) - 10) < 1e-6);
});

test('the fit drops the bend at the top rather than flattening the slope', () => {
    const samples = [];
    for (let amps = 1; amps <= 10; amps += 0.5) {
        // Linear up to 8A, then the regulators start dropping out.
        const excess = Math.max(0, amps - 8);
        samples.push({ amps, volts: 5.15 - 0.04 * amps - 0.06 * excess * excess });
    }
    const fit = sweep.fitRail(samples);
    assert.ok(fit.droppedHighCurrent > 0, 'should have dropped the bent tail');
    assert.ok(Math.abs(fit.ohms - 0.04) < 0.005, `slope ${fit.ohms} should survive the bend`);
});

test('R_eff is insensitive to a wrong overhead figure', () => {
    const base = [];
    for (let amps = 1; amps <= 10; amps += 0.5) base.push({ amps, volts: 5.15 - 0.04 * amps });
    // Overhead guessed 0.8A too low: every current shifts by the same amount.
    const shifted = base.map((s) => ({ amps: s.amps - 0.8, volts: s.volts }));
    assert.ok(Math.abs(sweep.fitRail(shifted).ohms - sweep.fitRail(base).ohms) < 1e-9);
});

test('sweep steps are evenly spaced in current, not in brightness', () => {
    const steps = sweep.brightnessSteps(10, 2.5);
    const currents = steps.map((b) => Math.pow(b, 2.5));
    const gaps = [];
    for (let i = 1; i < currents.length; i++) gaps.push(currents[i] - currents[i - 1]);
    const spread = Math.max(...gaps) - Math.min(...gaps);
    assert.ok(spread < 1e-9, 'current steps should be uniform');
    assert.ok(steps[0] > 0.4, 'the ramp starts partway up, not at standby');
});

test('vcgencmd output parsing', () => {
    const pmic = [
        '3V7_WL_SW_A current(0)=0.00000000A',
        'EXT5V_V volt(24)=5.06015625V',
        'BATT_V volt(25)=0.00000000V',
    ].join('\n');
    assert.strictEqual(sweep.parsePmicVolts(pmic), 5.06015625);
    assert.strictEqual(sweep.parsePmicVolts('no such rail'), null);

    assert.deepStrictEqual(sweep.parseThrottled('throttled=0x0'),
        { raw: 0, underVoltageNow: false, underVoltageEver: false });
    // Under-voltage now, and since boot.
    assert.deepStrictEqual(sweep.parseThrottled('throttled=0x10001'),
        { raw: 0x10001, underVoltageNow: true, underVoltageEver: true });
    // Has happened, but not right now — must not abort a sweep.
    assert.strictEqual(sweep.parseThrottled('throttled=0x50000').underVoltageNow, false);
    assert.strictEqual(sweep.parseThrottled('nonsense'), null);
});
