#!/usr/bin/env node
/*
 * Rail calibration sweep — run this ON THE PI, with the panel connected.
 *
 *   node tools/power-sweep.js [--steps 12] [--floor 4.75] [--api http://localhost:3000]
 *                             [--out data/power-calibration.json]
 *
 * Why it exists: a 5V/20A supply that cannot deliver 14A is not a PSU
 * problem, it is an IR-drop problem. Everything downstream of the supply's
 * terminals shares a resistance — regulation droop, leads, connectors — so
 * the Pi sees V = V_oc - I * R_eff, and it trips undervoltage at ~4.63V long
 * before the PSU runs out of current. R_eff cannot be guessed to better than
 * a factor of two, but it can be measured: drive the panel up a current ramp
 * and watch the rail fall.
 *
 * What it does: saves the current state, puts a full-white scene up, steps
 * the brightness through evenly-spaced *currents*, reads the panel's current
 * estimate from /api/power and the real 5V rail from the Pi's PMIC ADC at
 * each step, then least-squares fits V against I. It prints the `rail` block
 * to PUT back into /api/power.
 *
 * Safety: this deliberately drives the panel towards the region that was
 * misbehaving, so it aborts and restores the moment `vcgencmd get_throttled`
 * reports undervoltage, and restores on SIGINT and on any error too. It also
 * turns the limiter off for the duration — the point is to measure what the
 * panel really asks for.
 *
 * The raw samples are written to data/power-calibration.json alongside the
 * fit, because the fit alone is a number with no provenance: the residual and
 * the count of dropped high-current points are what say whether the rail
 * follows a single slope at all, and none of it can be recovered from a
 * terminal that has scrolled. Written even when the sweep aborts — an aborted
 * run is the most informative one there is.
 *
 * Node 14 on the Pi: ES2019 only, and no global fetch.
 */

var http = require('http');
var url = require('url');
var path = require('path');
var execFile = require('child_process').execFile;
var jsonStore = require('../engine/json-store');

// ---------------------------------------------------------------- pure bits
// Everything below this line is testable off the Pi, which is the only reason
// the fit is trustworthy at all — there is no way to unit-test a multimeter.

/*
 * Brightness values that land on evenly-spaced *currents*.
 *
 * Current goes as brightness^gamma once fcserver's LUT is in the path, so a
 * linear brightness ramp puts fifteen of twenty samples in the bottom third
 * of the current range and crams everything interesting into the last few
 * percent of the fader. Inverting the gamma spreads the samples where the
 * measurement actually is.
 *
 * The ramp starts partway up rather than at zero: the bottom of the range is
 * all standby current and contributes nothing but leverage-free points near
 * the intercept.
 */
function brightnessSteps(steps, gamma, startFraction) {
    var start = startFraction === undefined ? 0.15 : startFraction;
    var out = [];
    for (var i = 0; i <= steps; i++) {
        var fraction = start + (1 - start) * (i / steps);
        out.push(Math.pow(fraction, 1 / gamma));
    }
    return out;
}

// Ordinary least squares of volts against amps.
function fitLine(samples) {
    var n = samples.length;
    if (n < 2) return null;
    var sx = 0, sy = 0;
    for (var i = 0; i < n; i++) {
        sx += samples[i].amps;
        sy += samples[i].volts;
    }
    var mx = sx / n, my = sy / n;
    var sxx = 0, sxy = 0;
    for (i = 0; i < n; i++) {
        var dx = samples[i].amps - mx;
        sxx += dx * dx;
        sxy += dx * (samples[i].volts - my);
    }
    if (sxx === 0) return null;
    var slope = sxy / sxx;
    var intercept = my - slope * mx;

    var sse = 0;
    for (i = 0; i < n; i++) {
        var err = samples[i].volts - (intercept + slope * samples[i].amps);
        sse += err * err;
    }
    return {
        openCircuitVolts: intercept,
        ohms: -slope,
        rmsVolts: Math.sqrt(sse / n),
        n: n,
    };
}

/*
 * Fit V = V_oc - I*R over the region where that is actually true.
 *
 * The curve bends at large sags: as the rail falls, the WS2812B constant-
 * current regulators start dropping out and the panel draws less than the
 * model says it should, so the top samples pull the slope down and make the
 * fit optimistic exactly where it matters. Highest-current samples are
 * dropped one at a time until the residual is within tolerance.
 *
 * Note what this is *not* sensitive to: a wrong overheadMilliamps shifts
 * every current by the same constant, which moves the intercept and leaves
 * the slope — the number being measured — untouched. So R_eff is sound even
 * if the Pi's own draw was guessed badly.
 */
function fitRail(samples, options) {
    var opts = options || {};
    var tolerance = opts.toleranceVolts === undefined ? 0.015 : opts.toleranceVolts;
    var minPoints = opts.minPoints === undefined ? 4 : opts.minPoints;

    var sorted = samples.slice().sort(function(a, b) { return a.amps - b.amps; });
    var dropped = 0;
    var fit = fitLine(sorted);
    while (fit && fit.rmsVolts > tolerance && sorted.length > minPoints) {
        sorted.pop();
        dropped++;
        fit = fitLine(sorted);
    }
    if (!fit) return null;
    fit.droppedHighCurrent = dropped;
    fit.bent = fit.rmsVolts > tolerance;
    return fit;
}

// The current at which the rail reaches `volts` — the whole point of the fit.
function currentAtVolts(fit, volts) {
    if (!fit || fit.ohms <= 0) return Infinity;
    return (fit.openCircuitVolts - volts) / fit.ohms;
}

// `EXT5V_V volt(24)=5.06015625V` among a couple of dozen other rails.
function parsePmicVolts(text) {
    var m = /EXT5V_V\s+volt\(\d+\)=([0-9.]+)V/.exec(text || '');
    return m ? parseFloat(m[1]) : null;
}

// `throttled=0x50005`; bit 0 is under-voltage now, bit 16 is under-voltage
// since boot.
function parseThrottled(text) {
    var m = /throttled=0x([0-9a-fA-F]+)/.exec(text || '');
    if (!m) return null;
    var bits = parseInt(m[1], 16);
    return {
        raw: bits,
        underVoltageNow: !!(bits & 0x1),
        underVoltageEver: !!(bits & 0x10000),
    };
}

function median(values) {
    if (!values.length) return null;
    var sorted = values.slice().sort(function(a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ------------------------------------------------------------------- I/O

function request(api, method, path, body) {
    return new Promise(function(resolve, reject) {
        var target = url.parse(api + path);
        var payload = body === undefined ? null : JSON.stringify(body);
        var req = http.request({
            hostname: target.hostname,
            port: target.port || 80,
            path: target.path,
            method: method,
            headers: payload
                ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
                : {},
        }, function(res) {
            var chunks = '';
            res.setEncoding('utf8');
            res.on('data', function(c) { chunks += c; });
            res.on('end', function() {
                if (res.statusCode >= 400) {
                    return reject(new Error(method + ' ' + path + ' -> ' + res.statusCode + ' ' + chunks));
                }
                try {
                    resolve(chunks ? JSON.parse(chunks) : null);
                } catch (err) {
                    resolve(chunks); // /api/brightness answers in plain text
                }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function vcgencmd(args) {
    return new Promise(function(resolve) {
        execFile('vcgencmd', args, function(err, stdout) {
            resolve(err ? null : stdout);
        });
    });
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// ------------------------------------------------------------------- sweep

var SETTLE_MS = 800;   // let the supply reach its droop, not just the LEDs
var READS = 5;         // the PMIC ADC is noisy; take a median
var READ_GAP_MS = 120;

// Beside scenes and settings, and gitignored like them: this is a
// measurement of one particular panel's wiring, not repo content.
var DEFAULT_OUT = path.join(__dirname, '..', 'data', 'power-calibration.json');

function parseArgs(argv) {
    var out = { steps: 12, floor: 4.75, api: 'http://localhost:3000', out: DEFAULT_OUT };
    for (var i = 0; i < argv.length; i++) {
        var arg = argv[i];
        if (arg === '--steps') out.steps = parseInt(argv[++i], 10);
        else if (arg === '--floor') out.floor = parseFloat(argv[++i]);
        else if (arg === '--api') out.api = argv[++i];
        else if (arg === '--out') out.out = argv[++i];
    }
    return out;
}

// Rounded to the precision the measurement actually supports, and shaped
// exactly as /api/power wants it.
function railBlock(fit, floorVolts) {
    return {
        openCircuitVolts: Number(fit.openCircuitVolts.toFixed(4)),
        ohms: Number(fit.ohms.toFixed(5)),
        floorVolts: floorVolts,
    };
}

/*
 * The record of one sweep: what was measured, under what assumptions, and
 * what was fitted from it. The assumptions travel with the samples because
 * the currents are *estimates* — re-reading this file after changing
 * ledMilliamps or the gamma without knowing which figures produced it would
 * be worse than having no record at all.
 */
function calibrationRecord(samples, fit, opts, meta) {
    var power = meta.power;
    return {
        version: 1,
        measuredAt: new Date().toISOString(),
        aborted: !!meta.aborted,
        floorVolts: opts.floor,
        assumptions: {
            numLeds: power.numLeds,
            gamma: power.gamma,
            whitepoint: power.whitepoint,
            ledMilliamps: power.ledMilliamps,
            standbyMilliamps: power.standbyMilliamps,
            overheadMilliamps: power.overheadMilliamps,
            maxMilliamps: power.maxMilliamps,
        },
        samples: samples,
        fit: fit || null,
        floorAmps: fit ? currentAtVolts(fit, opts.floor) : null,
        // Exactly what /api/power wants, so the file is the thing to paste
        // from rather than a report about it.
        rail: fit ? railBlock(fit, opts.floor) : null,
    };
}

async function main() {
    var opts = parseArgs(process.argv.slice(2));
    var api = opts.api;

    var probe = await vcgencmd(['pmic_read_adc']);
    var canMeasure = parsePmicVolts(probe) !== null;
    if (!canMeasure) {
        console.error('No EXT5V_V reading from `vcgencmd pmic_read_adc`.');
        console.error('That ADC exists on the Pi 4 and Pi 5. On an older Pi there is no');
        console.error('voltage to read, only the ~4.63V undervoltage trip in get_throttled —');
        console.error('run the sweep there and note the current at which the flag first sets.');
        process.exitCode = 1;
        return;
    }

    var throttledBefore = parseThrottled(await vcgencmd(['get_throttled']));
    if (throttledBefore && throttledBefore.underVoltageNow) {
        console.error('The rail is ALREADY under-voltage at idle. Fix the supply before calibrating.');
        process.exitCode = 1;
        return;
    }

    // ---- save everything we are about to disturb
    var savedActive = await request(api, 'GET', '/api/active_scene');
    var savedBrightness = parseFloat(await request(api, 'GET', '/api/brightness/'));
    var savedPower = await request(api, 'GET', '/api/power');
    var tempSceneId = null;
    var restored = false;

    async function restore() {
        if (restored) return;
        restored = true;
        try {
            await request(api, 'PUT', '/api/brightness/' + savedBrightness);
            await request(api, 'PUT', '/api/active_scene', { id: savedActive ? savedActive.id : null });
            if (tempSceneId) await request(api, 'DELETE', '/api/scenes/' + tempSceneId);
            await request(api, 'PUT', '/api/power', { limit: savedPower.limit });
            console.log('\nRestored brightness, active scene and limiter.');
        } catch (err) {
            console.error('\nRESTORE FAILED — check the panel by hand:', err.message);
        }
    }
    process.on('SIGINT', function() { restore().then(function() { process.exit(130); }); });

    try {
        // The limiter would clamp exactly the frames being measured.
        await request(api, 'PUT', '/api/power', { limit: false });

        var scene = await request(api, 'POST', '/api/scenes', {
            name: 'Power sweep (temporary)',
            layers: [{ effectType: 'solid', params: { color: '#ffffff', level: 1 } }],
        });
        tempSceneId = scene.id;
        await request(api, 'PUT', '/api/active_scene', { id: tempSceneId });

        var gamma = savedPower.gamma || 2.5;
        var steps = brightnessSteps(opts.steps, gamma);
        var samples = [];
        var aborted = false;

        console.log('Sweeping ' + steps.length + ' steps of full white. Ctrl-C restores.\n');
        console.log('  bright    panel mA    total A    rail V');

        for (var i = 0; i < steps.length; i++) {
            var brightness = steps[i];
            await request(api, 'PUT', '/api/brightness/' + brightness.toFixed(4));
            await sleep(SETTLE_MS);

            var volts = [];
            for (var k = 0; k < READS; k++) {
                var throttled = parseThrottled(await vcgencmd(['get_throttled']));
                if (throttled && throttled.underVoltageNow) {
                    console.log('\n  UNDER-VOLTAGE at brightness ' + brightness.toFixed(3) + ' — stopping here.');
                    aborted = true;
                    break;
                }
                var v = parsePmicVolts(await vcgencmd(['pmic_read_adc']));
                if (v !== null) volts.push(v);
                await sleep(READ_GAP_MS);
            }
            if (aborted) break;

            var power = await request(api, 'GET', '/api/power');
            var railVolts = median(volts);
            if (railVolts === null || power.milliamps === null) continue;

            // The rail carries the panel plus everything else on the supply.
            // `amps`/`volts` are what the fit reads; the rest is provenance
            // for the record, and harmless to fitLine.
            var totalAmps = (power.milliamps + power.overheadMilliamps) / 1000;
            samples.push({
                amps: totalAmps,
                volts: railVolts,
                brightness: Number(brightness.toFixed(4)),
                panelMilliamps: power.milliamps,
                railVoltSamples: volts,
            });
            console.log(
                '  ' + brightness.toFixed(3).padStart(6)
                + '  ' + power.milliamps.toFixed(0).padStart(10)
                + '  ' + totalAmps.toFixed(2).padStart(9)
                + '  ' + railVolts.toFixed(3).padStart(8)
            );
        }

        await restore();
        report(samples, opts, { aborted: aborted, power: savedPower });
    } catch (err) {
        await restore();
        throw err;
    }
}

function writeRecord(samples, fit, opts, meta) {
    try {
        jsonStore.save(opts.out, calibrationRecord(samples, fit, opts, meta));
        console.log('\nSweep data written to ' + opts.out
            + (fit ? '' : ' (samples only — no fit)'));
        console.log('The previous run, if any, is beside it as .bak.');
    } catch (err) {
        console.error('\nCould not write ' + opts.out + ': ' + err.message);
    }
}

function report(samples, opts, meta) {
    if (samples.length < 3) {
        // Still worth keeping: a run that aborted after two steps says
        // something about the rail, and re-running costs another sweep.
        writeRecord(samples, null, opts, meta);
        console.error('\nOnly ' + samples.length + ' usable samples — not enough to fit.');
        process.exitCode = 1;
        return;
    }

    var fit = fitRail(samples);
    var floorAmps = currentAtVolts(fit, opts.floor);

    console.log('\n--- fit -------------------------------------------------');
    console.log('  open-circuit   ' + fit.openCircuitVolts.toFixed(3) + ' V');
    console.log('  R_eff          ' + (fit.ohms * 1000).toFixed(1) + ' mOhm');
    console.log('  residual       ' + (fit.rmsVolts * 1000).toFixed(1) + ' mV RMS over ' + fit.n + ' points');
    if (fit.droppedHighCurrent) {
        console.log('  dropped        ' + fit.droppedHighCurrent + ' high-current point(s): the curve bends there');
        console.log('                 (regulators dropping out — the linear model stops holding)');
    }
    if (fit.bent) {
        console.log('  WARNING        residual still high; a single slope does not describe this rail.');
        console.log('                 Read the floor crossing off the table above instead of trusting it.');
    }
    console.log('  ' + opts.floor.toFixed(2) + ' V at      ' + floorAmps.toFixed(2) + ' A total');

    var body = { rail: railBlock(fit, opts.floor), limit: true };
    console.log('\nPUT this to /api/power:\n');
    console.log(JSON.stringify(body, null, 2));
    console.log('\ncurl -X PUT -H "Content-Type: application/json" -d \''
        + JSON.stringify(body) + '\' ' + opts.api + '/api/power');

    writeRecord(samples, fit, opts, meta);
}

if (require.main === module) {
    main().catch(function(err) {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {
    brightnessSteps: brightnessSteps,
    fitLine: fitLine,
    fitRail: fitRail,
    railBlock: railBlock,
    calibrationRecord: calibrationRecord,
    currentAtVolts: currentAtVolts,
    parsePmicVolts: parsePmicVolts,
    parseThrottled: parseThrottled,
    median: median,
};
