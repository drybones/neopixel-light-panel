const test = require('node:test');
const assert = require('node:assert');

const power = require('../engine/power');
const { PowerMeter, budgetFor, normaliseConfig, milliampsFor } = power;
const GAMMA = power.FCSERVER_COLOUR.gamma;
const scaleFor = (milliamps, numLeds, cfg) => power.scaleFor(milliamps, numLeds, cfg, GAMMA);
const VirtualOPC = require('../virtual-opc');
const { HEADER_BYTES: R } = require('../engine/pixel-sink');

const NUM_LEDS = 240;

// A tight budget for exercising the limiter, without needing a real supply
// on the test machine — same 8800mA the old rail-calibrated example used.
const TIGHT_BUDGET = { maxMilliamps: 10000 };

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
    const sink = new VirtualOPC();
    sink.power = new PowerMeter({ colour: { gamma: 2.5, whitepoint: [1, 1, 1] } });
    sink.setPixelCount(NUM_LEDS);
    const snap = paint(sink, 255, 255, 255);
    assert.strictEqual(Math.round(snap.requestedMilliamps), NUM_LEDS * 55 + NUM_LEDS);
});

// --------------------------------------------------------- fcserver.json

test('the curve is the one in the fcserver.json beside the server', () => {
    // The file fcserver.service runs. Read, not restated: a copy here could
    // drift from it and every reading would be wrong without a symptom.
    const file = require('path').join(__dirname, '..', 'fcserver.json');
    const { color } = JSON.parse(require('fs').readFileSync(file, 'utf8'));
    assert.deepStrictEqual(power.FCSERVER_COLOUR, { gamma: color.gamma, whitepoint: color.whitepoint });
    assert.deepStrictEqual(new PowerMeter().snapshot().whitepoint, color.whitepoint);
});

test('an unreadable fcserver.json falls back to a linear curve, which reads high', () => {
    const warnings = [];
    const colour = power.readFcserverColour('/nonexistent/fcserver.json', (m) => warnings.push(m));
    assert.deepStrictEqual(colour, power.FCSERVER_DEFAULT_COLOUR);
    assert.strictEqual(warnings.length, 1);

    // The safe direction for a limiter: the linear estimate of a mid-grey
    // frame is higher than the gamma-aware one, so it dims early, not late.
    const meterWith = (c) => {
        const sink = new VirtualOPC();
        sink.power = new PowerMeter({ colour: c });
        sink.setPixelCount(NUM_LEDS);
        return paint(sink, 128, 128, 128).requestedMilliamps;
    };
    assert.ok(meterWith(colour) > meterWith(power.FCSERVER_COLOUR));
});

test('a config with no color block is fcserver\'s own default: no curve', () => {
    const fs = require('fs');
    const dir = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'fcserver-'));
    const file = require('path').join(dir, 'fcserver.json');
    fs.writeFileSync(file, JSON.stringify({ listen: ['127.0.0.1', 7890] }));
    const warnings = [];
    assert.deepStrictEqual(power.readFcserverColour(file, (m) => warnings.push(m)), power.FCSERVER_DEFAULT_COLOUR);
    assert.deepStrictEqual(warnings, [], 'an absent block is valid fcserver config, not a fault');

    fs.writeFileSync(file, JSON.stringify({ color: { gamma: 'steep', whitepoint: [2, 1] } }));
    assert.deepStrictEqual(power.readFcserverColour(file, (m) => warnings.push(m)), power.FCSERVER_DEFAULT_COLOUR);
    assert.strictEqual(warnings.length, 2, 'a present but unusable value is worth a line each');
});

test('gamma and whitepoint are not part of the editable config', () => {
    // They describe fcserver. Accepting them here is how a persisted
    // settings.json came to carry a third copy of the curve, overriding
    // whatever fcserver.json said.
    const cfg = normaliseConfig({ gamma: 1, whitepoint: [1, 1, 1] });
    assert.strictEqual('gamma' in cfg, false);
    assert.strictEqual('whitepoint' in cfg, false);
});

// ------------------------------------------------------------------ budget

test('the budget is the PSU rating less the reserved overhead', () => {
    assert.strictEqual(budgetFor(config()), 20000 - 1200);
    assert.strictEqual(budgetFor(config(TIGHT_BUDGET)), 10000 - 1200);
});

test('the PSU cap does not bind this panel at its default rating', () => {
    const snap = paint(sinkWith(config()), 255, 255, 255);
    assert.strictEqual(snap.limiting, false);
    assert.ok(snap.requestedMilliamps < budgetFor(config()));
});

// ----------------------------------------------------------------- limiter

test('a limited frame is sent at or under the budget, never over', () => {
    const cfg = config(TIGHT_BUDGET);
    const sink = sinkWith(cfg);
    const snap = paint(sink, 255, 255, 255);

    assert.strictEqual(snap.limiting, true);
    assert.ok(snap.milliamps <= snap.budgetMilliamps,
        `delivered ${snap.milliamps} must not exceed budget ${snap.budgetMilliamps}`);

    // Re-estimate over the bytes that actually went out, which is the only
    // figure the panel cares about.
    const check = sinkWith(cfg);
    const resent = paint(check, sink.pixelBuffer[R], sink.pixelBuffer[R + 1], sink.pixelBuffer[R + 2]);
    assert.ok(resent.requestedMilliamps <= 8800,
        `the frame as sent draws ${resent.requestedMilliamps}mA against a budget of 8800`);
});

test('the rescale is gamma-corrected, not linear', () => {
    const sink = sinkWith(config(TIGHT_BUDGET));
    paint(sink, 255, 255, 255);
    // Needing 65% of the current means scaling values by 0.65^0.4 = 0.843,
    // i.e. white at byte 215. A linear rescale would drop it to 166 and dim
    // the panel far more than the budget requires.
    assert.strictEqual(sink.pixelBuffer[R], 215);
});

test('an already-limited frame is not dimmed twice', () => {
    const cfg = config(TIGHT_BUDGET);
    const first = sinkWith(cfg);
    paint(first, 255, 255, 255);
    const limited = first.pixelBuffer[R];

    const second = sinkWith(cfg);
    const snap = paint(second, limited, limited, limited);
    assert.strictEqual(snap.scale, 1);
    assert.strictEqual(second.pixelBuffer[R], limited);
});

/*
 * There is no step at the threshold, so no hysteresis is needed and nothing
 * flickers as a scene animates across it. Worth pinning: a limiter that
 * jumped to a fixed factor on the way in would be visible on every frame that
 * crossed the line.
 */
test('the scale is continuous at the budget boundary', () => {
    const cfg = config(TIGHT_BUDGET);
    const budget = budgetFor(cfg);
    assert.strictEqual(scaleFor(budget, NUM_LEDS, cfg).scale, 1);
    assert.ok(scaleFor(budget + 1, NUM_LEDS, cfg).scale > 0.9999);
    assert.ok(scaleFor(budget + 1, NUM_LEDS, cfg).scale < 1);
});

test('limit:false measures without acting', () => {
    const sink = sinkWith(config({ ...TIGHT_BUDGET, limit: false }));
    const snap = paint(sink, 255, 255, 255);
    assert.strictEqual(sink.pixelBuffer[R], 255);
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
    sink.power.setConfig(config(TIGHT_BUDGET));

    const compositor = new Compositor(sink, model);
    const store = new SceneStore(compositor, null);
    const created = store.create({
        name: 'white',
        layers: [{ effectType: 'solid', params: { color: '#ffffff', level: 1 } }],
    });
    compositor.renderFrame(store.get(created.id), Date.now());

    assert.strictEqual(compositor.composite[0], 255, 'the preview source is untouched');
    assert.strictEqual(sink.pixelBuffer[R], 215, 'the panel is pulled back');
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
    const first = normaliseConfig({ maxMilliamps: 15000, ledMilliamps: 60 });
    const second = normaliseConfig({ limit: false }, first);
    assert.strictEqual(second.maxMilliamps, 15000);
    assert.strictEqual(second.ledMilliamps, 60);
    assert.strictEqual(second.limit, false);
});

test('garbage in a config field falls back to the default, not NaN', () => {
    const cfg = normaliseConfig({ maxMilliamps: NaN, ledMilliamps: -5 });
    assert.strictEqual(cfg.maxMilliamps, power.DEFAULTS.maxMilliamps);
    assert.strictEqual(cfg.ledMilliamps, 0);
    assert.ok(isFinite(milliampsFor(100, NUM_LEDS, cfg)));
});
