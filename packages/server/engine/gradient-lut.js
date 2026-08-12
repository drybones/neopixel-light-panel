/*
 * Shared machinery for the gradient effects — the colour-stop LUT and the
 * tiling rule that decides what happens to a ramp position outside 0..1.
 *
 * Both gradient_linear and gradient_radial reduce to the same two lines per
 * pixel: build a position `u` along the stop list from their own geometry, then
 * tile it and read the table. Only the geometry differs, which is the whole
 * reason they are two effects and this is one module.
 */

var color = require('./color');

var LUT_SIZE = 256;

// Resolved from the schema's string in prepare() so the render loop branches on
// a small int rather than comparing strings 240 times a frame.
var TILE = {
    hold: 0,
    repeat: 1,
    mirror: 2,
};

function buildLut(stops) {
    var sorted = stops.slice().sort(function(a, b) { return a.position - b.position; });
    var lut = new Float32Array(LUT_SIZE * 3);
    var si = 0;
    for (var i = 0; i < LUT_SIZE; i++) {
        var u = i / (LUT_SIZE - 1);
        while (si < sorted.length - 2 && u > sorted[si + 1].position) si++;
        var a = sorted[si], b = sorted[Math.min(si + 1, sorted.length - 1)];
        var span = b.position - a.position;
        var f = span > 0 ? Math.min(1, Math.max(0, (u - a.position) / span)) : 0;
        var ca = color.hexToRgb(a.color), cb = color.hexToRgb(b.color);
        lut[i * 3] = ca.r + (cb.r - ca.r) * f;
        lut[i * 3 + 1] = ca.g + (cb.g - ca.g) * f;
        lut[i * 3 + 2] = ca.b + (cb.b - ca.b) * f;
    }
    return lut;
}

// Anything unrecognised reads as mirror, which is what every layer stored
// before this control existed was rendered with.
function tileMode(name) {
    return TILE.hasOwnProperty(name) ? TILE[name] : TILE.mirror;
}

// The three ways a ramp position outside 0..1 can be resolved, and the reason
// there is a choice at all:
//
//   mirror — fold about 0 and 1 (period 2). The only one that scrolls without a
//       seam, and the behaviour every gradient had before this was a control.
//   repeat — sawtooth. Discontinuous by construction: scrolled, the seam sweeps
//       across the panel, which reads as a wipe rather than a drift.
//   hold   — clamp. The ends keep their colour, so a radial reads as a pool of
//       light fading into a flat surround instead of brightening again at the
//       corners, which is the one thing mirror cannot express at any `repeats`.
//
// Note that hold and scroll together eventually push the whole panel onto one
// end colour and leave it there. That is a degenerate combination of *values*,
// visible as it happens — not a mode switching another control off, which is
// what this effect was split to stop doing.
function tile(u, mode) {
    if (mode === TILE.hold) {
        return u < 0 ? 0 : (u > 1 ? 1 : u);
    }
    if (mode === TILE.repeat) {
        u = u % 1;
        return u < 0 ? u + 1 : u;
    }
    u = u % 2;
    if (u < 0) u += 2;
    return u > 1 ? 2 - u : u;
}

// The schema entry both effects use, so the options and labels cannot drift
// apart between them.
var TILING_SCHEMA = { key: 'tiling', type: 'enum', label: 'Tiling', options: [
    { value: 'hold', label: 'Hold' },
    { value: 'repeat', label: 'Repeat' },
    { value: 'mirror', label: 'Mirror' },
]};

module.exports = {
    LUT_SIZE: LUT_SIZE,
    TILE: TILE,
    TILING_SCHEMA: TILING_SCHEMA,
    buildLut: buildLut,
    tileMode: tileMode,
    tile: tile,
};
