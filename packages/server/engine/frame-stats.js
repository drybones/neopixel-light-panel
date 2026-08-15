/*
 * Render-loop instrumentation for the 10ms tick in app.js.
 *
 * The loop is a fixed setInterval, so its *nominal* rate is 100 FPS whether
 * or not it keeps up. This measures what actually happens: the wall-clock
 * gap between ticks (the achieved frame rate), how long our own work takes
 * inside a tick, and how often a tick lands so late that a frame was
 * effectively dropped.
 *
 * Two things shape the implementation:
 *
 * - It sits in the hot loop, so when disabled it must cost nothing beyond a
 *   boolean test, and when *enabled* it must not allocate per frame. Samples
 *   go into fixed-size Float64Array ring buffers written in place; the only
 *   object built is the snapshot the API asks for, at most once a second.
 *   Timing is perf_hooks.performance.now() — a plain float, where
 *   process.hrtime() allocates an array and hrtime.bigint() allocates a
 *   BigInt, every single tick.
 *
 * - The loop does not run continuously. With no scene active the tick
 *   renders one black frame and then fast-exits, and preview warm-up can
 *   park it for a beat. Neither is a frame-rate fault, so a gap longer than
 *   RESUME_MS is treated as a discontinuity: not a sample, not an overrun,
 *   just a new starting point. A snapshot taken while nothing is rendering
 *   reports idle rather than 0 FPS.
 *
 * Lateness is reported two ways, and the difference matters. The cumulative
 * `overruns`/`frames` pair is the long soak. The *rate* — late frames as a
 * percentage of the last LATE_WINDOW_MS — is what says whether the loop is
 * stumbling now, and it is the one worth watching: a running total only ever
 * climbs, so one coalesced tick at start-up reads the same as a scene that is
 * genuinely too expensive. Both are scoped to the active scene; see restart().
 *
 * Node 14 on the Pi: ES2019 only, no ?. or ?? in here.
 */

var performance = require('perf_hooks').performance;

// A second or so of ticks at 100 FPS. The window is bounded by time (see
// snapshot) rather than by this; the buffer just has to be big enough to
// hold it.
var CAPACITY = 256;

// Rolling window for the reported averages.
var WINDOW_MS = 1000;

// A tick gap at or beyond this multiple of the target counts as an overrun:
// setInterval coalesced, or something blocked past the interval.
var OVERRUN_FACTOR = 2;

// Window for the late-frame *rate*, deliberately much longer than WINDOW_MS.
// At the ~91 FPS a 10ms setInterval actually delivers, a single late frame
// inside a one-second window is 1.1%, so a perfectly healthy loop would
// flicker between zero and one-ish percent. Ten seconds reads as a rate.
var LATE_WINDOW_MS = 10000;

// Lateness is tallied in per-second buckets rather than per frame. The
// per-frame ring holds 2.8s at that rate and covering the window would want
// ~900 entries of every sample; ten counters cost nothing, and nobody reads a
// percentage to the individual frame. A bucket exists only if something
// rendered during it, which is what keeps idle seconds out of the
// denominator — they age out having never been counted.
var BUCKET_MS = 1000;
var BUCKETS = Math.ceil(LATE_WINDOW_MS / BUCKET_MS);

// A gap beyond this is the loop having been idle (scene off, startup), not a
// slow frame.
var RESUME_MS = 500;

// Below this the reported rate is stale — nothing has rendered recently.
var IDLE_MS = 500;

class FrameStats {
    constructor(options) {
        this.enabled = false;
        this.targetMs = (options && options.targetMs) || 10;
        this._now = (options && options.now) || function() { return performance.now(); };

        this._frameMs = new Float64Array(CAPACITY);  // gap since the previous tick
        this._renderMs = new Float64Array(CAPACITY); // compositor + sink write
        this._tickMs = new Float64Array(CAPACITY);   // the whole tick body

        // One second of lateness per slot: which second it holds, how many
        // frames landed in it, how many of those were late.
        this._bucketId = new Float64Array(BUCKETS);
        this._bucketFrames = new Int32Array(BUCKETS);
        this._bucketLate = new Int32Array(BUCKETS);

        this.reset();
    }

    // Start of a tick that will do work. Returns the timestamp to hand back
    // to endRender/end, or 0 when disabled.
    begin() {
        if (!this.enabled) return 0;
        return this._now();
    }

    // After compositor.renderFrame (which includes the write to the pixel
    // sink). Stashed rather than recorded, so one sample covers the whole
    // tick.
    endRender(started) {
        if (!started) return;
        this._pendingRenderMs = this._now() - started;
    }

    // End of the tick body — records one sample.
    end(started) {
        if (!started) return;
        var now = this._now();
        var tickMs = now - started;
        var renderMs = this._pendingRenderMs;
        this._pendingRenderMs = 0;

        var frameMs = this._last ? started - this._last : 0;
        this._last = started;

        // Resuming after an idle stretch: re-anchor, don't sample. Recording
        // it would post one multi-second "frame" and a phantom overrun.
        if (frameMs > RESUME_MS) {
            this._lastSampleAt = now;
            return;
        }

        var i = this._head;
        this._frameMs[i] = frameMs;
        this._renderMs[i] = renderMs;
        this._tickMs[i] = tickMs;
        this._head = (i + 1) % CAPACITY;
        if (this._filled < CAPACITY) this._filled++;

        this.frames++;
        this._lastSampleAt = now;
        var late = frameMs >= this.targetMs * OVERRUN_FACTOR;
        if (late) this.overruns++;
        if (frameMs > this.worstFrameMs) this.worstFrameMs = frameMs;
        if (renderMs > this.worstRenderMs) this.worstRenderMs = renderMs;

        // Tally into this second's bucket, clearing it first if the slot is
        // still holding an older second. Writes into pre-allocated arrays —
        // this runs every tick.
        var id = Math.floor(now / BUCKET_MS);
        var slot = id % BUCKETS;
        if (this._bucketId[slot] !== id) {
            this._bucketId[slot] = id;
            this._bucketFrames[slot] = 0;
            this._bucketLate[slot] = 0;
        }
        this._bucketFrames[slot]++;
        if (late) this._bucketLate[slot]++;
    }

    setEnabled(enabled) {
        enabled = !!enabled;
        if (enabled === this.enabled) return;
        this.enabled = enabled;
        this.restart();
    }

    /*
     * Drop everything measured so far and start again, without touching the
     * enabled flag. Called when the active scene changes: render cost is
     * largely a property of the scene, so a heavy scene's overruns and worst
     * frame would otherwise be read as the light scene you switched to — and
     * a switch is continuous, so nothing else here notices it (there is no
     * gap for the RESUME_MS discontinuity to catch).
     */
    restart() {
        this.reset();
        if (this.enabled) this.startedAt = this._now();
    }

    reset() {
        this._head = 0;      // next write index
        this._filled = 0;    // samples held, ≤ CAPACITY
        this._last = 0;          // previous tick's start, 0 = no previous
        this._lastSampleAt = 0;  // for the idle test
        this._pendingRenderMs = 0;

        // -1 rather than 0: performance.now() starts near zero at boot, so
        // second 0 is a real bucket id and cannot double as "empty".
        this._bucketId.fill(-1);
        this._bucketFrames.fill(0);
        this._bucketLate.fill(0);

        // Cumulative since the last restart — the tracker being switched on,
        // or the scene changing. What a long soak on the Pi is actually for.
        this.frames = 0;
        this.overruns = 0;
        this.worstFrameMs = 0;
        this.worstRenderMs = 0;
        this.startedAt = 0;
    }

    /*
     * Averages over the last WINDOW_MS of samples, walking backwards from
     * the newest until the accumulated frame time covers the window.
     * Time-bounded rather than count-bounded so a slow loop reports over the
     * same second a fast one does.
     *
     * `idle` means nothing has rendered lately — scene off, or the loop
     * parked. The caller should say so rather than showing 0 FPS, which
     * reads as a fault.
     */
    snapshot() {
        var snap = {
            enabled: this.enabled,
            targetFps: 1000 / this.targetMs,
            idle: true,
            fps: null,
            frameMs: null,
            renderMs: null,
            tickMs: null,
            worstFrameMs: this.worstFrameMs,
            worstRenderMs: this.worstRenderMs,
            overruns: this.overruns,
            frames: this.frames,
            latePercent: null,
            lateFrames: 0,
            windowFrames: 0,
            lateWindowMs: LATE_WINDOW_MS,
            uptimeMs: this.startedAt ? this._now() - this.startedAt : 0,
        };
        if (!this.enabled || this._filled === 0) return snap;

        snap.idle = this._now() - this._lastSampleAt > IDLE_MS;

        // Late-frame rate over the trailing window. Summing whole buckets
        // makes the window granular at the head — it covers between
        // LATE_WINDOW_MS - BUCKET_MS and LATE_WINDOW_MS of rendering — which
        // costs a percentage nothing and is why a stall ages out on its own.
        var oldest = Math.floor(this._now() / BUCKET_MS) - (BUCKETS - 1);
        for (var b = 0; b < BUCKETS; b++) {
            if (this._bucketId[b] < oldest) continue;
            snap.windowFrames += this._bucketFrames[b];
            snap.lateFrames += this._bucketLate[b];
        }
        if (snap.windowFrames > 0) {
            snap.latePercent = (snap.lateFrames / snap.windowFrames) * 100;
        }

        var frameTotal = 0, renderTotal = 0, tickTotal = 0, n = 0;
        for (var k = 0; k < this._filled; k++) {
            var i = (this._head - 1 - k + CAPACITY * 2) % CAPACITY;
            var frameMs = this._frameMs[i];
            // A zero gap marks the first tick of a run, which has no
            // predecessor to measure against — stop, don't average it in.
            if (frameMs === 0 && k > 0) break;
            frameTotal += frameMs;
            renderTotal += this._renderMs[i];
            tickTotal += this._tickMs[i];
            n++;
            if (frameTotal >= WINDOW_MS) break;
        }
        if (n === 0) return snap;

        snap.renderMs = renderTotal / n;
        snap.tickMs = tickTotal / n;
        // A lone first-tick sample gives no elapsed time to divide by —
        // report the work done, not a rate.
        if (frameTotal > 0) {
            snap.frameMs = frameTotal / n;
            snap.fps = 1000 / snap.frameMs;
        }
        return snap;
    }
}

module.exports = {
    FrameStats: FrameStats,
    WINDOW_MS: WINDOW_MS,
    LATE_WINDOW_MS: LATE_WINDOW_MS,
    BUCKET_MS: BUCKET_MS,
    RESUME_MS: RESUME_MS,
    IDLE_MS: IDLE_MS,
    OVERRUN_FACTOR: OVERRUN_FACTOR,
};
