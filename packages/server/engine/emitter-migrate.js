/*
 * One-time conversion of candy_sparkler and embers layers into `emitter`.
 *
 * Both were the same program with different constants compiled into
 * createInstance() — emission origin, direction, spread, speed, lifetime,
 * colour source and the intensity envelope were all literals — which is why
 * each had exactly one look and candy sparkler had no colour control at all.
 * The emitter exposes those as params, so this reads each old layer's four or
 * five knobs and writes out the sixteen that reproduce it.
 *
 * This is deliberately NOT bit-exact, and should not claim to be. The old
 * per-particle velocity distributions do not map onto a direction/spread pair
 * term for term:
 *
 *  - candy sparkler drew a radial speed in [1.5, 2.0] x speed, i.e. 1.75 with
 *    a +/-14% spread, over a full 2*PI.
 *  - embers drew vx in +/-0.3 and vz in [-0.6, -0.2] independently, a
 *    rectangular velocity distribution. The polar equivalent is roughly 0.45
 *    with a wide speed spread over a 70-degree downward cone; it is the same
 *    drift, particle for particle it is not.
 *
 * Two numbers matter more than the geometry:
 *
 *  - Embers' envelope peaked at 0.7 where the sparkler's peaked at 1.0, so a
 *    straight conversion would come out 1.43x brighter. That folds into the
 *    layer's opacity, which is the one place a preset cannot reach but a
 *    migration can.
 *  - Embers jittered hue as `hue + hueSpread * (random() - 0.15)`, biased
 *    upward by 0.35 * hueSpread. The emitter's jitter is symmetric, so the
 *    converted swatch is shifted by that bias to keep the mean hue where it was.
 *
 * Callers snapshot the pre-conversion document first; nothing here writes to
 * disk. The old effects stay registered (hidden) so anything this does not
 * reach — an export taken before the migration and imported long after — still
 * renders.
 */

var color = require('./color');

// Both old effects stretched emitted velocity 1.5x in x, and the emitter still
// does, so speeds carry over unchanged rather than being rescaled here.

// candy_sparkler: v_r = (random() * 0.5 + 1.5) * speed. Midpoint and half-range
// as a fraction of it.
var SPARKLER_SPEED = 1.75;
var SPARKLER_SPEED_SPREAD = 0.25 / 1.75;
// Lifetime was random() * 1000 + 1000 ms.
var SPARKLER_LIFE = 1.5;
var SPARKLER_LIFE_SPREAD = 0.5 / 1.5;
// The attack/decay pivot, which is exactly what `swell` is.
var SPARKLER_SWELL = 0.25;
// Particle falloff 30 -> radius 1/sqrt(30).
var SPARKLER_SIZE = 1 / Math.sqrt(30);

// embers: origin x over [-4, 4] and *modelZ* over [0, 2] — a box, which is what
// extX/extY express. Note the emitter's params are in param space, where y is up
// and modelZ is negated, so that box is centred at y = -1: the panel's lower
// half and the region below it, not above.
var EMBERS_EXT_X = 8;
var EMBERS_EXT_Y = 2;
var EMBERS_ORIGIN_Y = -1;
// vx in +/-0.3, modelZ velocity in [-0.6, -0.2] — decreasing modelZ, i.e. toward
// the top row. Embers rise. Mean speed ~0.45 over a 70-degree upward cone.
var EMBERS_SPEED = 0.45;
var EMBERS_SPEED_SPREAD = 0.5;
var EMBERS_DIR = 90;
var EMBERS_SPREAD = 70;
// death = born + random() * 5000 + 3000 ms.
var EMBERS_LIFE = 5.5;
var EMBERS_LIFE_SPREAD = 2.5 / 5.5;
// A sine over the whole life peaks halfway, which is swell 0.5.
var EMBERS_SWELL = 0.5;
// Particle falloff 20 -> radius 1/sqrt(20).
var EMBERS_SIZE = 1 / Math.sqrt(20);
// The 0.7 the old envelope multiplied by, and the asymmetry in its hue jitter.
var EMBERS_LEVEL = 0.7;
var EMBERS_HUE_BIAS = 0.35;

function hueToHex(h, s, v) {
    var rgb = color.hsv(h, s, v);
    var out = '#';
    for (var i = 0; i < 3; i++) {
        var byte = Math.max(0, Math.min(255, Math.round(rgb[i])));
        out += (byte < 16 ? '0' : '') + byte.toString(16);
    }
    return out;
}

function num(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
}

function sparklerToEmitter(params) {
    var p = params || {};
    return {
        // The old hue was Math.random() per particle with no control at all,
        // which is exactly hueSpread 1. Saturation was a param and still is —
        // it rides on the swatch now, so a fully saturated red carries it.
        color: hueToHex(0, num(p.saturation, 1), 1),
        hueSpread: 1,
        size: SPARKLER_SIZE,
        dir: 90,
        spread: 360,
        speed: SPARKLER_SPEED * num(p.speed, 1),
        speedSpread: SPARKLER_SPEED_SPREAD,
        grav: 0,
        gravDir: 270,
        count: Math.max(1, num(p.count, 49)),
        life: SPARKLER_LIFE,
        lifeSpread: SPARKLER_LIFE_SPREAD,
        swell: SPARKLER_SWELL,
        x: 0,
        y: 0,
        extX: 0,
        extY: 0,
    };
}

function embersToEmitter(params) {
    var p = params || {};
    var spread = num(p.hueSpread, 0.11);
    return {
        color: hueToHex(num(p.hue, 0.035) + EMBERS_HUE_BIAS * spread, 1, 1),
        hueSpread: spread,
        size: EMBERS_SIZE,
        dir: EMBERS_DIR,
        spread: EMBERS_SPREAD,
        // The old render scaled *age* by speed rather than velocity, which is
        // the same thing for a straight-line drift.
        speed: EMBERS_SPEED * num(p.speed, 1),
        speedSpread: EMBERS_SPEED_SPREAD,
        grav: 0,
        gravDir: 270,
        count: Math.max(1, num(p.count, 29)),
        life: EMBERS_LIFE,
        lifeSpread: EMBERS_LIFE_SPREAD,
        swell: EMBERS_SWELL,
        x: 0,
        y: EMBERS_ORIGIN_Y,
        extX: EMBERS_EXT_X,
        extY: EMBERS_EXT_Y,
    };
}

// Returns a new scene array plus a count. Layers of any other type are passed
// through untouched, as are scenes with nothing to convert.
function convertScenes(scenes) {
    var converted = 0;
    var out = (scenes || []).map(function(scene) {
        var layers = (scene.layers || []).map(function(layer) {
            if (layer.effectType === 'candy_sparkler') {
                converted++;
                return Object.assign({}, layer, {
                    effectType: 'emitter',
                    params: sparklerToEmitter(layer.params),
                });
            }
            if (layer.effectType === 'embers') {
                converted++;
                // The 0.7 envelope peak lands here rather than in the params:
                // the emitter has no level knob, and opacity is the layer's own
                // brightness. Clamped because a stored opacity below 1 is
                // multiplied by it, not replaced.
                var opacity = num(layer.opacity, 1) * EMBERS_LEVEL;
                return Object.assign({}, layer, {
                    effectType: 'emitter',
                    params: embersToEmitter(layer.params),
                    opacity: Math.max(0, Math.min(1, opacity)),
                });
            }
            return layer;
        });
        return Object.assign({}, scene, { layers: layers });
    });
    return { scenes: out, converted: converted };
}

module.exports = {
    sparklerToEmitter,
    embersToEmitter,
    convertScenes,
    EMBERS_LEVEL,
    EMBERS_HUE_BIAS,
};
