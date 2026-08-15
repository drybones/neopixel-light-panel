const test = require('node:test');
const assert = require('node:assert');

const { FrameStats, RESUME_MS, IDLE_MS, LATE_WINDOW_MS, BUCKET_MS } = require('../engine/frame-stats');

// A hand-cranked clock, so the assertions are about the arithmetic rather
// than about how fast the test machine happens to be.
function fakeClock() {
    var t = 1000; // deliberately not 0 — 0 is the "no previous tick" sentinel
    return {
        now: function() { return t; },
        advance: function(ms) { t += ms; },
        set: function(ms) { t = ms; },
    };
}

function statsAt(rateMs, options) {
    var clock = fakeClock();
    var stats = new FrameStats(Object.assign({ now: clock.now }, options));
    stats.setEnabled(true);
    return { stats: stats, clock: clock, rateMs: rateMs };
}

// One tick: `workMs` of render, `restMs` of broadcast, then wait out the rest
// of the frame period.
function runFrames(h, count, workMs, restMs) {
    workMs = workMs || 0;
    restMs = restMs || 0;
    for (var i = 0; i < count; i++) {
        var t0 = h.stats.begin();
        h.clock.advance(workMs);
        h.stats.endRender(t0);
        h.clock.advance(restMs);
        h.stats.end(t0);
        h.clock.advance(Math.max(0, h.rateMs - workMs - restMs));
    }
}

test('records nothing while disabled, and begin() hands back no timestamp', () => {
    const clock = fakeClock();
    const stats = new FrameStats({ now: clock.now });

    assert.strictEqual(stats.begin(), 0);
    runFrames({ stats, clock, rateMs: 10 }, 50, 2);

    const snap = stats.snapshot();
    assert.strictEqual(snap.enabled, false);
    assert.strictEqual(snap.frames, 0);
    assert.strictEqual(snap.fps, null);
});

test('reports the achieved frame rate, not the nominal one', () => {
    const h = statsAt(20); // 50 FPS out of a loop asking for 100
    runFrames(h, 100, 3);

    const snap = h.stats.snapshot();
    assert.strictEqual(snap.idle, false);
    assert.ok(Math.abs(snap.fps - 50) < 0.001, 'fps was ' + snap.fps);
    assert.strictEqual(snap.targetFps, 100);
    assert.ok(Math.abs(snap.frameMs - 20) < 0.001);
});

test('separates render time from total tick time', () => {
    const h = statsAt(10);
    runFrames(h, 50, 3, 2); // 3ms render + 2ms broadcast

    const snap = h.stats.snapshot();
    assert.ok(Math.abs(snap.renderMs - 3) < 0.001, 'renderMs was ' + snap.renderMs);
    assert.ok(Math.abs(snap.tickMs - 5) < 0.001, 'tickMs was ' + snap.tickMs);
});

test('averages over a rolling window, so an old stall stops counting', () => {
    const h = statsAt(10);
    runFrames(h, 5, 8);    // a slow patch...
    runFrames(h, 300, 1);  // ...then three seconds of healthy frames

    const snap = h.stats.snapshot();
    assert.ok(Math.abs(snap.renderMs - 1) < 0.001, 'window still holds the stall: ' + snap.renderMs);
    // The cumulative counters do keep it.
    assert.ok(Math.abs(snap.worstRenderMs - 8) < 0.001);
});

test('counts a tick gap of 2x the target as an overrun', () => {
    const h = statsAt(10);
    runFrames(h, 10, 1);

    // One tick that lands 25ms late.
    const t0 = h.stats.begin();
    h.stats.endRender(t0);
    h.stats.end(t0);
    h.clock.advance(25);
    runFrames(h, 10, 1);

    const snap = h.stats.snapshot();
    assert.strictEqual(snap.overruns, 1);
    assert.ok(Math.abs(snap.worstFrameMs - 25) < 0.001, 'worstFrameMs was ' + snap.worstFrameMs);
});

test('a gap under 2x the target is jitter, not an overrun', () => {
    const h = statsAt(10);
    runFrames(h, 10, 1);
    const t0 = h.stats.begin();
    h.stats.endRender(t0);
    h.stats.end(t0);
    h.clock.advance(19);
    runFrames(h, 10, 1);

    assert.strictEqual(h.stats.snapshot().overruns, 0);
});

// A tick that lands a whole period late, i.e. one dropped frame.
function runLateFrames(h, count) {
    for (var i = 0; i < count; i++) {
        h.clock.advance(h.rateMs * 2);
        runFrames(h, 1, 1);
    }
}

test('reports late frames as a rate over a window, not just a running total', () => {
    const h = statsAt(10);
    runFrames(h, 90, 1);
    runLateFrames(h, 10);

    const snap = h.stats.snapshot();
    assert.strictEqual(snap.overruns, 10);
    assert.strictEqual(snap.lateFrames, 10);
    assert.strictEqual(snap.windowFrames, 100);
    assert.ok(Math.abs(snap.latePercent - 10) < 0.001, 'latePercent was ' + snap.latePercent);
    assert.strictEqual(snap.lateWindowMs, LATE_WINDOW_MS);
});

test('the late rate falls back to zero once the stall ages out of the window', () => {
    const h = statsAt(10);
    runFrames(h, 10, 1); // so the first stalled tick has a predecessor to be late against
    runLateFrames(h, 10);
    // A full window of healthy frames, plus a bucket's worth to clear the
    // partial second the stall landed in.
    runFrames(h, (LATE_WINDOW_MS + BUCKET_MS) / 10, 1);

    const snap = h.stats.snapshot();
    assert.strictEqual(snap.latePercent, 0, 'the stall is still being reported');
    assert.strictEqual(snap.lateFrames, 0);
    // Cumulative counters are the long soak, and do keep it.
    assert.strictEqual(snap.overruns, 10);
});

test('seconds in which nothing rendered stay out of the denominator', () => {
    const h = statsAt(10);
    runFrames(h, 90, 1);
    runLateFrames(h, 10);
    // Scene off for five seconds, then rendering again. Billing that idle
    // stretch as wall-clock time would put ~500 phantom frames under the
    // percentage and quietly wash the stall out.
    h.clock.advance(RESUME_MS * 10);
    runFrames(h, 100, 1);

    // 199, not 200: the tick that resumes is the discontinuity itself and is
    // not sampled at all. What matters is that it is nowhere near the ~700
    // that billing the idle stretch as wall-clock time would produce.
    const snap = h.stats.snapshot();
    assert.strictEqual(snap.windowFrames, 199, 'idle time reached the denominator');
    assert.strictEqual(snap.lateFrames, 10, 'the resume was billed as a dropped frame');
});

test('a scene change restarts the tracker without switching it off', () => {
    const h = statsAt(10);
    runFrames(h, 200, 1);
    runLateFrames(h, 5);

    h.stats.restart();
    const cleared = h.stats.snapshot();
    assert.strictEqual(cleared.enabled, true, 'restart switched the tracker off');
    assert.strictEqual(cleared.frames, 0);
    assert.strictEqual(cleared.overruns, 0);
    assert.strictEqual(cleared.worstFrameMs, 0);
    assert.strictEqual(cleared.latePercent, null);

    // The window has to go with it: the new scene's late frames must read as
    // its own rate, not be diluted by the 205 healthy ones before the switch.
    // 9 of 10, because a restart re-anchors — the first tick after it has no
    // predecessor to measure a gap against, exactly as at start-up.
    runLateFrames(h, 10);
    const snap = h.stats.snapshot();
    assert.strictEqual(snap.windowFrames, 10);
    assert.strictEqual(snap.lateFrames, 9);
});

test('resuming after an idle stretch is a discontinuity, not a dropped frame', () => {
    const h = statsAt(10);
    runFrames(h, 100, 2);
    const before = h.stats.snapshot();

    // Scene switched off for a while: the loop fast-exits and takes no
    // samples at all, then a scene is activated again.
    h.clock.advance(RESUME_MS * 20);
    runFrames(h, 100, 2);

    const snap = h.stats.snapshot();
    assert.strictEqual(snap.overruns, 0, 'the idle gap was billed as a dropped frame');
    assert.ok(Math.abs(snap.fps - 100) < 0.001, 'fps was ' + snap.fps);
    assert.ok(snap.worstFrameMs < RESUME_MS, 'the idle gap became the worst frame');
    assert.ok(snap.frames > before.frames);
});

test('reports idle rather than 0 FPS when nothing has rendered lately', () => {
    const h = statsAt(10);
    runFrames(h, 100, 2);
    assert.strictEqual(h.stats.snapshot().idle, false);

    h.clock.advance(IDLE_MS * 2);
    const snap = h.stats.snapshot();
    assert.strictEqual(snap.idle, true);
    // The last known numbers are still there to read; only `idle` says they
    // are stale.
    assert.ok(snap.fps > 0);
});

test('survives more samples than the ring buffer holds', () => {
    const h = statsAt(10);
    runFrames(h, 5000, 2);

    const snap = h.stats.snapshot();
    assert.strictEqual(snap.frames, 5000);
    assert.ok(Math.abs(snap.fps - 100) < 0.001, 'fps was ' + snap.fps);
    assert.ok(Math.abs(snap.renderMs - 2) < 0.001);
});

test('a single frame reports its work without inventing a rate', () => {
    const h = statsAt(10);
    runFrames(h, 1, 2);

    const snap = h.stats.snapshot();
    assert.strictEqual(snap.fps, null);
    assert.ok(Math.abs(snap.renderMs - 2) < 0.001);
});

test('toggling off and on clears the counters', () => {
    const h = statsAt(10);
    runFrames(h, 100, 2);
    h.stats.setEnabled(false);
    assert.strictEqual(h.stats.snapshot().frames, 0);

    h.stats.setEnabled(true);
    runFrames(h, 10, 2);
    assert.strictEqual(h.stats.snapshot().frames, 10);
});

test('does not allocate per frame', () => {
    const h = statsAt(10);
    runFrames(h, 200, 2); // warm up

    const before = process.memoryUsage().heapUsed;
    runFrames(h, 100000, 2);
    const grown = process.memoryUsage().heapUsed - before;

    // 100k frames through a per-frame allocation of even one small object
    // would be megabytes. A little movement is other test noise.
    assert.ok(grown < 1024 * 1024, 'heap grew ' + grown + ' bytes over 100k frames');
});
