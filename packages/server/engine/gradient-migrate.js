/*
 * One-time conversion of `gradient` layers into gradient_linear and
 * gradient_radial.
 *
 * The old effect was one effect with a `mode` enum deciding what its other
 * controls meant: the Centre pad was inert for linear, the Angle was inert for
 * radial, and Motion 'rotate' did nothing at all in radial because that branch
 * never read the angle. Splitting it leaves each shape showing only its own
 * controls, the way wavelet and planewave already do.
 *
 * Three of the four sign relations here are exact, and the derivations matter
 * because none of them is visible in a still frame:
 *
 *  - The old linear projection was `modelX * ca + modelZ * sa`, missing the
 *    negation every other effect applies (modelZ +0.875 is the panel's *bottom*
 *    row). gradient_linear fixes it, and since proj_new(-a) === proj_old(a),
 *    mirroring the stored angle to 360 - a cancels the fix exactly. Every still
 *    gradient converts pixel for pixel. It was invisible before only because
 *    the control was a bare slider; on a dial the arrow would point the wrong
 *    way.
 *  - Old rotation was `angle + speed * 2PI * t` applied to that un-negated
 *    projection, which is -speed once the frame is mirrored. `spin` is a signed
 *    linear track precisely so this needs no compromise.
 *  - Old radial scroll added a positive offset to r/MAX_RADIUS, so a given
 *    colour ring sat at a smaller radius as t grew: it converged. Inward was
 *    the only direction that effect ever had, and outward is new.
 *
 * The fourth is NOT exact, and should not claim to be. Old linear scroll ran
 * *against* the ramp direction; gradient_linear runs along it, so that the
 * dial's arrow agrees with the motion you can see on the panel — planewave's
 * convention. A migrated scrolling linear gradient therefore drifts the other
 * way. Among the built-ins that is `Sunset drift` alone. The exact alternative
 * (angle + 180 with phase = 1, which the mirror tiling makes identical) was
 * rejected: it leaves the layer reading "180 degrees, phase 1" for what its
 * author set as 0, which is worse to open than a reversed drift.
 *
 * Callers snapshot the pre-conversion document first; nothing here writes to
 * disk. The old effect stays registered (hidden) so anything this does not
 * reach — an export taken beforehand and imported long after — still renders.
 */

// Everything the new effects add starts at the value that reproduces the old
// one: one traversal of the stop list, no phase offset, and the mirror tiling
// that was hardcoded before it was a control.
var REPEATS = 1;
var PHASE = 0;
var TILING = 'mirror';

function num(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
}

function wrapDegrees(deg) {
    return ((deg % 360) + 360) % 360;
}

// Carried across by reference when it is there, and *left out entirely* when it
// is not. An explicit `stops: undefined` would survive normaliseLayer's
// Object.assign and overwrite the new effect's default with it, and buildLut
// throws on that before a single pixel is rendered.
function withStops(converted, params) {
    if (Array.isArray(params.stops)) converted.stops = params.stops;
    return converted;
}

function toLinear(params) {
    var p = params || {};
    var speed = num(p.speed, 0);
    var animate = p.animate;
    return withStops({
        // Mirrored, which cancels gradient_linear's modelZ fix exactly.
        angle: wrapDegrees(-num(p.angle, 0)),
        repeats: REPEATS,
        tiling: TILING,
        phase: PHASE,
        // The enum made these mutually exclusive, which is the only reason the
        // rotate case can be exact while the scroll case is not.
        scroll: animate === 'scroll' ? speed : 0,
        spin: animate === 'rotate' ? -speed : 0,
    }, p);
}

function toRadial(params) {
    var p = params || {};
    var scrolling = p.animate === 'scroll';
    return withStops({
        cx: num(p.cx, 0),
        cy: num(p.cy, 0),
        // The old shape was always a circle.
        aspect: 1,
        repeats: REPEATS,
        tiling: TILING,
        phase: PHASE,
        scroll: scrolling ? num(p.speed, 0) : 0,
        // Leave a still layer on the new default rather than recording a
        // direction it never travelled in.
        travel: scrolling ? 'inward' : 'outward',
    }, p);
}

// Returns a new scene array plus a count. Layers of any other type are passed
// through untouched, as are scenes with nothing to convert.
function convertScenes(scenes) {
    var converted = 0;
    var out = (scenes || []).map(function(scene) {
        var layers = (scene.layers || []).map(function(layer) {
            if (layer.effectType !== 'gradient') return layer;
            converted++;
            var radial = layer.params && layer.params.mode === 'radial';
            return Object.assign({}, layer, {
                effectType: radial ? 'gradient_radial' : 'gradient_linear',
                params: radial ? toRadial(layer.params) : toLinear(layer.params),
            });
        });
        return Object.assign({}, scene, { layers: layers });
    });
    return { scenes: out, converted: converted };
}

module.exports = {
    toLinear: toLinear,
    toRadial: toRadial,
    convertScenes: convertScenes,
};
