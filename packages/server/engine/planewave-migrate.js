/*
 * One-time conversion of far-away wavelets into planewave layers.
 *
 * The old UI had no way to express a plane wave, so presets faked one by
 * shoving the wave source a thousand units off-panel. Those layers then became
 * uneditable: the position pad could not represent the value and the drag
 * handle rendered outside its clipped container. Converting them to planewave
 * makes the thing the author actually wanted — a direction — editable.
 *
 * The conversion is exact in the far-field limit (see effects/planewave for
 * the derivation): angle = atan2(y, x), and the constant D/lambda phase term
 * folds into delta. What is left is the wavefront curvature the approximation
 * drops, which is why shouldConvert() checks the *phase* error rather than
 * distance alone — a short wavelength magnifies it.
 *
 * Callers are expected to snapshot the pre-conversion document first; nothing
 * here writes to disk.
 */

var panel = require('./panel');

var TWO_PI = Math.PI * 2;

// Convert only well past the point where a source reads as a point source...
var MIN_DISTANCE = panel.RADIUS * 10;
// ...and only when the dropped curvature is a small fraction of a radian. At
// the panel corner the neglected term is RADIUS^2 / (2D); dividing by lambda
// turns it into phase. 0.05 rad moves an LED by well under 1/255.
var MAX_PHASE_ERROR = 0.05;

function phaseError(distance, lambda) {
    return (panel.RADIUS * panel.RADIUS / (2 * distance)) / lambda;
}

function shouldConvert(params) {
    if (!params || typeof params.x !== 'number' || typeof params.y !== 'number') return false;
    if (!(params.lambda > 0)) return false;
    var distance = Math.sqrt(params.x * params.x + params.y * params.y);
    if (!(distance > MIN_DISTANCE)) return false;
    return phaseError(distance, params.lambda) < MAX_PHASE_ERROR;
}

function wrap(radians) {
    var r = radians % TWO_PI;
    return r < 0 ? r + TWO_PI : r;
}

function waveletToPlanewave(params) {
    var distance = Math.sqrt(params.x * params.x + params.y * params.y);
    // planewave's angle is the direction of travel, and a wave moves *away*
    // from its source — so it is the bearing of the source plus 180.
    var degrees = Math.atan2(params.y, params.x) * 180 / Math.PI + 180;
    return {
        color: params.color,
        freq: params.freq,
        lambda: params.lambda,
        // The source's distance is a fixed phase lead; drop the distance, keep
        // the phase, and the panel sees exactly the same wave.
        delta: wrap(params.delta - distance / params.lambda),
        angle: ((degrees % 360) + 360) % 360,
        min: params.min,
        max: params.max,
    };
}

// Returns a new scene array plus a count. Layers that fail shouldConvert are
// passed through untouched, as are scenes with nothing to convert.
function convertScenes(scenes) {
    var converted = 0;
    var out = (scenes || []).map(function(scene) {
        var layers = (scene.layers || []).map(function(layer) {
            if (layer.effectType !== 'wavelet' || !shouldConvert(layer.params)) return layer;
            converted++;
            return Object.assign({}, layer, {
                effectType: 'planewave',
                params: waveletToPlanewave(layer.params),
            });
        });
        return Object.assign({}, scene, { layers: layers });
    });
    return { scenes: out, converted: converted };
}

module.exports = {
    shouldConvert,
    waveletToPlanewave,
    convertScenes,
    phaseError,
    MIN_DISTANCE,
    MAX_PHASE_ERROR,
};
