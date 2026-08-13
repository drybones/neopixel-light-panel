/*
 * Noise field — slowly-drifting fractal gradient noise mapped onto a
 * two-colour ramp. The cheapest "organic" texture for a 30×8 grid.
 * Each instance gets its own permutation table so two noise layers
 * don't move in lockstep.
 *
 * This is gradient (Perlin) noise, not value noise: value noise pins a fixed
 * value to each lattice point, so interpolating between them with a fade
 * whose derivative is zero at both ends makes the field coast to a near-stop
 * and pick back up every time the time axis crosses an integer — a visible
 * pulse rather than a flow. A gradient lattice stores directions instead, so
 * the value at a lattice point isn't fixed and there is nothing to settle
 * onto. The stall-depth test in test/effects.test.js pins this against
 * regressing back to a pulse.
 *
 * The fade below is Perlin's quintic rather than a plain smoothstep: with
 * gradient noise the second derivative also has to vanish at the lattice or
 * the seams show up as creases.
 */

var color = require('../engine/color');

// TIME_RATE calibrates how fast the field moves against a stored scene's
// `speed` value — gradient noise covers more ground per unit t than a
// differently-scaled field would at the same `speed`. This is a deliberate,
// measured calibration, not a guess; retuning it changes how fast a stored
// `speed` reads.
var TIME_RATE = 0.7;

// AMPLITUDE is what makes `min: 0, max: 1` mean *the full ramp*, the same
// thing it means on a wavelet.
//
// A wavelet's sine is bounded and hits both ends every cycle at every pixel;
// better, a sine lingers at its turning points, so at 0/1 about 9% of samples
// sit within 2% of each rail. A gradient field is nothing like that: it is a
// blend of eight dot products, so it is bell-shaped with a strong central
// tendency and no value it reliably reaches — an uncalibrated field quietly
// means "the middle of the ramp" at 0/1, not the full range.
//
// So the field is scaled here instead: 1.124 puts its 1st and 99th percentiles
// on 0 and 1 (measured over 1.15M pixel-samples across six permutation tables),
// which leaves ~1% of pixels resting on each rail at any moment. That is the
// closest a bell-shaped field gets to the wavelet's behaviour — matching its 9%
// would mean clipping a fifth of the field. The practical consequence is that
// `min` below 0 and `max` above 1 now bite at the rate the numbers suggest.
var AMPLITUDE = 1.124;

function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, f) {
    return a + (b - a) * f;
}

// The 12 edge-midpoint gradients of a cube, selected by the low 4 bits of a
// permutation entry. Written as branches on those bits rather than a lookup
// table of vectors so the hot loop does no array indexing per corner.
function grad(h, x, y, z) {
    var u = h < 8 ? x : y;
    var v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

module.exports = {
    type: 'noise',
    name: 'Noise field',
    schema: [
        { key: 'c1', type: 'color', label: 'Low colour' },
        { key: 'c2', type: 'color', label: 'High colour' },
        { key: 'scale', type: 'number', label: 'Scale', min: 0.1, max: 8, scale: 'log', modulatable: true },
        { key: 'speed', type: 'number', label: 'Speed', min: 0.01, max: 5, scale: 'log', zeroable: true, modulatable: true },
        // Levels, not Brightness: v is a position in the c1..c2 ramp, not a
        // light level. Unbounded on purpose (see the note on the clamp below).
        { type: 'range', label: 'Levels', minKey: 'min', maxKey: 'max', scale: 'atan', modulatable: true },
    ],
    defaults: {
        c1: '#0a1030',
        c2: '#3fd0ff',
        scale: 1,
        speed: 0.3,
        // The whole ramp — see AMPLITUDE for what that is calibrated to mean.
        min: 0,
        max: 1,
    },

    prepare(params) {
        var a = color.hexToRgb(params.c1);
        var b = color.hexToRgb(params.c2);
        return {
            r1: a.r, g1: a.g, b1: a.b,
            r2: b.r, g2: b.g, b2: b.b,
            scale: params.scale,
            speed: params.speed,
            min: params.min,
            max: params.max,
        };
    },

    createInstance(ctx) {
        var modelX = ctx.modelX;
        var modelZ = ctx.modelZ;
        var n = ctx.numPixels;

        var perm = new Uint8Array(512);
        var source = new Uint8Array(256);
        for (var i = 0; i < 256; i++) source[i] = i;
        for (var j = 255; j > 0; j--) {
            var k = (Math.random() * (j + 1)) | 0;
            var tmp = source[j]; source[j] = source[k]; source[k] = tmp;
        }
        for (var m = 0; m < 512; m++) perm[m] = source[m & 255];

        // Classic 3D Perlin: the value at a point is a blend of the dot
        // products between eight lattice gradients and the offsets to them.
        // Roughly ±0.7 rather than 0..1, so the caller recentres it.
        function gradientNoise(x, y, z) {
            var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
            var X = xi & 255, Y = yi & 255, Z = zi & 255;
            var xf = x - xi, yf = y - yi, zf = z - zi;
            var u = fade(xf), v = fade(yf), w = fade(zf);

            var A = (perm[X] + Y) & 255;
            var AA = (perm[A] + Z) & 255;
            var AB = (perm[(A + 1) & 255] + Z) & 255;
            var B = (perm[(X + 1) & 255] + Y) & 255;
            var BA = (perm[B] + Z) & 255;
            var BB = (perm[(B + 1) & 255] + Z) & 255;

            return lerp(
                lerp(
                    lerp(grad(perm[AA] & 15, xf, yf, zf),
                         grad(perm[BA] & 15, xf - 1, yf, zf), u),
                    lerp(grad(perm[AB] & 15, xf, yf - 1, zf),
                         grad(perm[BB] & 15, xf - 1, yf - 1, zf), u), v),
                lerp(
                    lerp(grad(perm[(AA + 1) & 255] & 15, xf, yf, zf - 1),
                         grad(perm[(BA + 1) & 255] & 15, xf - 1, yf, zf - 1), u),
                    lerp(grad(perm[(AB + 1) & 255] & 15, xf, yf - 1, zf - 1),
                         grad(perm[(BB + 1) & 255] & 15, xf - 1, yf - 1, zf - 1), u), v),
                w);
        }

        return {
            render(out, millis, p) {
                var t = millis / 1000 * p.speed * TIME_RATE;
                var freq = p.scale;
                for (var i = 0; i < n; i++) {
                    var x = modelX[i] * freq;
                    var z = modelZ[i] * freq;
                    // Two octaves is plenty at this resolution. The second runs
                    // at t * 1.7 so the two never line up into a single rhythm.
                    var v = 0.5 + (gradientNoise(x + 100, z + 100, t) * 0.65
                                 + gradientNoise(x * 2 + 37, z * 2 + 41, t * 1.7) * 0.35) * AMPLITUDE;
                    // Levels: remap the field into the ramp, then clamp. The
                    // clamp is what makes this a density control and not just
                    // a gain — a min below 0 crushes the low end to solid c1
                    // (sparse, only the peaks light) and a max above 1
                    // saturates the top (dense). Do not "tidy" it away, and do
                    // not bound min/max to [0,1] in the schema.
                    v = p.min + (p.max - p.min) * v;
                    v = v < 0 ? 0 : (v > 1 ? 1 : v);
                    out[i * 3] = p.r1 + (p.r2 - p.r1) * v;
                    out[i * 3 + 1] = p.g1 + (p.g2 - p.g1) * v;
                    out[i * 3 + 2] = p.b1 + (p.b2 - p.b1) * v;
                }
            }
        };
    }
};
