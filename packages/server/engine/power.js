/*
 * Power model for the panel — current estimate, budget, and the limiter's
 * rescale factor. WLED calls the equivalent ABL (Automatic Brightness
 * Limiter); the arithmetic is small, and where it *sits* matters more than
 * what it computes.
 *
 * It sits in the pixel sink, for the same reason global brightness does: the
 * sink is the one place values are post-brightness, clamped, and about to
 * become the bytes Fadecandy receives. The compositor knows nothing about
 * brightness and nothing about power.
 *
 * Three things make this different from WLED's version:
 *
 * - **Fadecandy applies gamma.** WLED sums post-brightness byte values
 *   because its bytes drive the LEDs directly. Ours pass through fcserver's
 *   colour LUT first (fcserver.json: gamma 2.5, whitepoint [0.98, 1, 1]), so
 *   the duty cycle an LED actually runs at is wp * (v/255)^gamma, not v/255.
 *   A mid-grey frame draws ~18% of full white, not 50%. Summing bytes would
 *   read 3-4x high on every ordinary scene and would miss the one thing worth
 *   knowing: 255 is the single input the gamma curve does not attenuate,
 *   which is why solid white is the one scene that bites. The gamma and
 *   whitepoint here MUST match fcserver.json or every reading is wrong.
 *
 * - **The budget is the PSU's rating, not a modelled rail.** A tighter,
 *   IR-drop-aware cap (V = openCircuitVolts - I * ohms, tightening as the
 *   supply rail sags) was tried and dropped: fitting it needs a real voltage
 *   reading, and the Pi's PMIC-ADC route to one — `vcgencmd pmic_read_adc` /
 *   `EXT5V_V` — turned out to be undocumented and unavailable on a standard
 *   Pi 4 Model B (Raspberry Pi Ltd's own "Extra PMIC features" whitepaper
 *   scopes that ADC to CM4 only). Manual testing at full white held up fine
 *   with no undervoltage, so the PSU cap alone is the budget.
 *
 * - **The rescale is gamma-corrected too.** Scaling channel values by k
 *   scales current by k^gamma, so hitting a current ratio s needs
 *   k = s^(1/gamma). WLED's linear rescale would over-dim hard here: needing
 *   66% of the current means k = 0.845 (white at byte ~215), where a linear
 *   factor would drop it to ~168.
 *
 * Node 14 on the Pi: ES2019 only, no ?. or ?? in here.
 */

// Same line frame-stats draws for "nothing has rendered lately". It is the
// same fact about the same loop — when no scene is active the tick renders
// one black frame and fast-exits — so it is deliberately not re-hardcoded.
var IDLE_MS = require('./frame-stats').IDLE_MS;

// Rolling window for the reported figures, matching frame-stats: an
// instantaneous sample off a fast animation jitters unreadably.
var WINDOW_MS = 1000;

// ~2.5s of headroom at 100 FPS; the window is bounded by time, not by this.
var CAPACITY = 256;

// The limiter never returns 0. A budget that cannot be met still shows
// something rather than a dead panel that looks like a fault. One count of
// 255 is WLED's floor too — but *not* its `+1`, which exists only to dodge
// integer truncation and makes the result exceed the limit.
var MIN_SCALE = 1 / 255;

var DEFAULTS = {
    // Act on the estimate, not just report it.
    limit: true,
    // 5V/20A supply.
    maxMilliamps: 20000,
    // Everything on the supply that isn't panel LEDs: the Pi 4 under load
    // plus the USB-powered Fadecandy. Reserved off the top of both caps.
    overheadMilliamps: 1200,
    // WS2812B at 5V, full white, per LED.
    ledMilliamps: 55,
    // Per-LED quiescent draw of the driver itself — not controllable, so it
    // sets the floor below which no amount of dimming helps.
    standbyMilliamps: 1,
    // MUST match fcserver.json.
    gamma: 2.5,
    whitepoint: [0.98, 1, 1],
};

function num(value, fallback, min, max) {
    if (typeof value !== 'number' || !isFinite(value)) return fallback;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

/*
 * Every field validated on its own rather than trusting the document shape —
 * the SettingsStore precedent. A NaN reaching the scale multiply blacks the
 * panel with no error anywhere.
 */
function normaliseConfig(input, base) {
    var from = base || DEFAULTS;
    var raw = input || {};
    var cfg = {
        limit: typeof raw.limit === 'boolean' ? raw.limit : from.limit,
        maxMilliamps: num(raw.maxMilliamps, from.maxMilliamps, 0, 1e6),
        overheadMilliamps: num(raw.overheadMilliamps, from.overheadMilliamps, 0, 1e6),
        ledMilliamps: num(raw.ledMilliamps, from.ledMilliamps, 0, 1000),
        standbyMilliamps: num(raw.standbyMilliamps, from.standbyMilliamps, 0, 100),
        // A gamma at or below 0 inverts the curve and a 1/gamma of 0 divides
        // by zero in the rescale, so the low end is pinned above both.
        gamma: num(raw.gamma, from.gamma, 0.1, 10),
        whitepoint: normaliseWhitepoint(raw.whitepoint, from.whitepoint),
    };
    return cfg;
}

function normaliseWhitepoint(value, fallback) {
    if (!Array.isArray(value) || value.length !== 3) return fallback.slice();
    var out = [];
    for (var i = 0; i < 3; i++) out.push(num(value[i], fallback[i], 0, 1));
    return out;
}

/*
 * fcserver's colour LUT, as duty cycle per channel value: what fraction of
 * full current an LED driven with this byte actually runs at. Built once per
 * config change so the hot loop is three array lookups per pixel and no
 * Math.pow.
 */
function buildDutyLut(gamma, whitepoint) {
    var luts = [];
    for (var c = 0; c < 3; c++) {
        var lut = new Float32Array(256);
        for (var v = 0; v < 256; v++) {
            lut[v] = Math.pow(v / 255, gamma) * whitepoint[c];
        }
        luts.push(lut);
    }
    return luts;
}

// dutySum is the sum of per-channel duties over the frame (each 0..1), so a
// fully-white 240-LED panel sums to 240 * (0.98 + 1 + 1).
function milliampsFor(dutySum, numLeds, cfg) {
    return (dutySum / 3) * cfg.ledMilliamps + numLeds * cfg.standbyMilliamps;
}

// The LED budget: what the panel may draw, after reserving overhead for
// everything else on the supply.
function budgetFor(cfg) {
    return cfg.maxMilliamps - cfg.overheadMilliamps;
}

/*
 * The factor to apply to channel values — not the current ratio. Current is
 * proportional to value^gamma once fcserver's LUT is in the path, and the
 * standby term is not controllable at all, so the ratio is solved on the
 * LED-driven part only.
 *
 * Continuous at the boundary: as the estimate approaches the budget from
 * above the factor approaches 1, so there is no step to flicker across and no
 * hysteresis is needed.
 *
 * `floored` means the budget is at or below what the panel draws doing
 * nothing — dimming cannot get there, and the UI should say so rather than
 * showing a near-black panel with no explanation.
 */
function scaleFor(milliamps, numLeds, cfg) {
    var budget = budgetFor(cfg);
    if (!cfg.limit || milliamps <= budget) return { scale: 1, floored: false };

    var standby = numLeds * cfg.standbyMilliamps;
    var budgetLed = budget - standby;
    if (budgetLed <= 0) return { scale: MIN_SCALE, floored: true };

    var estimateLed = milliamps - standby;
    if (estimateLed <= 0) return { scale: 1, floored: false };

    var scale = Math.pow(budgetLed / estimateLed, 1 / cfg.gamma);
    if (scale < MIN_SCALE) scale = MIN_SCALE;
    if (scale > 1) scale = 1;
    return { scale: scale, floored: false };
}

/*
 * Per-frame accumulator and the reporting window.
 *
 * Measurement is unconditional and only the rescale is gated by `limit`.
 * Three LUT lookups per pixel is ~2000 operations a frame against a
 * compositor already walking 720 floats per layer, and "how much headroom is
 * left" is the question the meter exists to answer — gating that on the
 * limiter being armed would defeat the point of having it.
 *
 * Same bar as frame-stats: nothing is allocated per frame. Samples go into
 * fixed-size Float64Array ring buffers written in place, and the only object
 * built is the snapshot the API asks for, at most once a second.
 */
class PowerMeter {
    constructor(options) {
        var opts = options || {};
        this._now = opts.now || function() { return Date.now(); };
        this.numLeds = opts.numLeds || 0;
        this._milliamps = new Float64Array(CAPACITY);  // post-limit, per frame
        this._requested = new Float64Array(CAPACITY);  // pre-limit
        this._at = new Float64Array(CAPACITY);
        this._head = 0;
        this._filled = 0;
        this._lastSampleAt = 0;

        this._dutySum = 0;
        this.scale = 1;
        this.floored = false;

        this.setConfig(opts.config);
    }

    setConfig(config) {
        this.config = normaliseConfig(config, this.config || DEFAULTS);
        var luts = buildDutyLut(this.config.gamma, this.config.whitepoint);
        // Held as three fields rather than an array of arrays: this is the
        // innermost thing in the render path.
        this._lutR = luts[0];
        this._lutG = luts[1];
        this._lutB = luts[2];
        this.budgetMilliamps = budgetFor(this.config);
    }

    setPixelCount(numLeds) {
        this.numLeds = numLeds;
    }

    // Called from the sink's setPixel with the post-brightness, post-clamp
    // byte values — what Fadecandy will actually be sent.
    accumulate(r, g, b) {
        this._dutySum += this._lutR[r] + this._lutG[g] + this._lutB[b];
    }

    /*
     * Closes the frame and returns the factor the sink should apply to the
     * buffer before writing it out (1 means leave it alone).
     *
     * The estimate can only be completed here, not folded into setPixel's
     * multiply: the sum is not known until the last pixel has been written.
     * That is why the rescale is a second pass over the buffer, and why the
     * pass only happens on frames that actually exceed the budget.
     */
    endFrame() {
        var requested = milliampsFor(this._dutySum, this.numLeds, this.config);
        this._dutySum = 0;

        var result = scaleFor(requested, this.numLeds, this.config);
        this.scale = result.scale;
        this.floored = result.floored;

        // Scaling values by k scales the LED-driven current by k^gamma, by
        // construction — so a limited frame lands on the budget rather than
        // somewhere under it.
        var standby = this.numLeds * this.config.standbyMilliamps;
        var delivered = result.scale === 1
            ? requested
            : standby + (requested - standby) * Math.pow(result.scale, this.config.gamma);

        var now = this._now();
        var i = this._head;
        this._milliamps[i] = delivered;
        this._requested[i] = requested;
        this._at[i] = now;
        this._head = (i + 1) % CAPACITY;
        if (this._filled < CAPACITY) this._filled++;
        this._lastSampleAt = now;

        return result.scale;
    }

    /*
     * Averages over the last WINDOW_MS, newest first. `idle` means nothing
     * has rendered lately — no scene active — so the figures are the last
     * ones taken rather than a live reading of a dark panel.
     */
    snapshot() {
        var cfg = this.config;
        var now = this._now();
        var snap = {
            limit: cfg.limit,
            maxMilliamps: cfg.maxMilliamps,
            overheadMilliamps: cfg.overheadMilliamps,
            ledMilliamps: cfg.ledMilliamps,
            standbyMilliamps: cfg.standbyMilliamps,
            gamma: cfg.gamma,
            whitepoint: cfg.whitepoint.slice(),

            numLeds: this.numLeds,
            budgetMilliamps: this.budgetMilliamps,
            maxMilliampsFullWhite: this.fullWhiteMilliamps(),

            idle: true,
            milliamps: null,
            requestedMilliamps: null,
            peakMilliamps: null,
            limiting: false,
            scale: this.scale,
            floored: this.floored,
        };
        if (this._filled === 0) return snap;

        snap.idle = now - this._lastSampleAt > IDLE_MS;

        var total = 0, requestedTotal = 0, peak = 0, n = 0;
        for (var k = 0; k < this._filled; k++) {
            var i = (this._head - 1 - k + CAPACITY * 2) % CAPACITY;
            if (now - this._at[i] > WINDOW_MS) break;
            total += this._milliamps[i];
            requestedTotal += this._requested[i];
            if (this._milliamps[i] > peak) peak = this._milliamps[i];
            n++;
        }
        // An idle window has no samples in it at all; report the last frame
        // rendered rather than nothing.
        if (n === 0) {
            var last = (this._head - 1 + CAPACITY) % CAPACITY;
            total = this._milliamps[last];
            requestedTotal = this._requested[last];
            peak = this._milliamps[last];
            n = 1;
        }

        snap.milliamps = total / n;
        snap.requestedMilliamps = requestedTotal / n;
        snap.peakMilliamps = peak;
        snap.limiting = snap.requestedMilliamps > snap.milliamps + 0.5;
        return snap;
    }

    // What the panel would draw with every LED at 255 — the headline figure
    // for "how much of the supply can this thing actually ask for".
    fullWhiteMilliamps() {
        var wp = this.config.whitepoint;
        return milliampsFor(this.numLeds * (wp[0] + wp[1] + wp[2]), this.numLeds, this.config);
    }
}

module.exports = {
    PowerMeter: PowerMeter,
    DEFAULTS: DEFAULTS,
    normaliseConfig: normaliseConfig,
    buildDutyLut: buildDutyLut,
    milliampsFor: milliampsFor,
    budgetFor: budgetFor,
    scaleFor: scaleFor,
    WINDOW_MS: WINDOW_MS,
    MIN_SCALE: MIN_SCALE,
};
