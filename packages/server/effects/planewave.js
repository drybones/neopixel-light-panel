/*
 * Plane wave — parallel wavefronts crossing the panel at a chosen direction.
 *
 * `angle` is the direction the wave *travels*, in screen terms: 0 degrees
 * moves right, 90 moves up. That is what the dial's arrow points along, so
 * the control agrees with the motion you can see. Note it is the opposite of
 * where an equivalent wavelet's source would sit — waves move away from
 * their source, so the bearing *to* the source is `angle + 180`.
 *
 * This is the far-field limit of wavelet. For a source at S = (x, -y) a
 * distance D from the centre, wavelet's r = |P - S| approaches D - P·û with
 * û = S/D, so its phase
 *
 *     theta = wt - r/lambda + delta
 *
 * becomes
 *
 *     theta = wt - (px·cos a - pz·sin a)/lambda + (delta - D/lambda)
 *
 * with a = atan2(y, x) + 180. The D/lambda term is *constant*, so it folds
 * into delta — a distant wavelet and a plane wave at the equivalent angle
 * are interchangeable without changing a pixel.
 *
 * The minus on the projection is what makes crests advance along `angle`
 * rather than against it: holding theta constant as t grows requires P·d to
 * increase, so the wavefronts move in +d.
 *
 * Unlike wavelet this needs no per-pixel sqrt. It is also the exact answer at
 * short wavelengths, where the wavelet pad's finite far edge (farLimit, 1000
 * units) still leaves a little measurable curvature.
 */

var color = require('../engine/color');

// See wavelet.js — guards the division by lambda against an unclamped 0.
var MIN_LAMBDA = 1e-6;

module.exports = {
    type: 'planewave',
    name: 'Plane Wave',
    schema: [
        { key: 'color', type: 'color', label: 'Colour' },
        { key: 'freq', type: 'number', label: 'Speed', min: 0.01, max: 5, scale: 'log', zeroable: true, modulatable: true },
        { key: 'lambda', type: 'number', label: 'Wavelength', min: 0.001, max: 50, scale: 'log', modulatable: true },
        { key: 'delta', type: 'number', label: 'Phase', min: 0, max: 6.28, step: 0.01, scale: 'linear', modulatable: true },
        { key: 'angle', type: 'angle', label: 'Travel', min: 0, max: 360, step: 1, modulatable: true },
        { type: 'range', label: 'Brightness', minKey: 'min', maxKey: 'max', scale: 'atan', modulatable: true },
    ],
    defaults: {
        color: '#ffffff',
        freq: 0.2,
        lambda: 0.5,
        delta: 0.0,
        angle: 0,
        min: 0.1,
        max: 0.7,
    },

    prepare(params) {
        var rgb = color.hexToRgb(params.color);
        var a = params.angle * Math.PI / 180;
        return {
            r: rgb.r, g: rgb.g, b: rgb.b,
            freq: params.freq,
            // Divided into `proj` below — 0 would render the layer as NaN.
            // The typed field is unclamped, so this can arrive as 0.
            lambda: params.lambda || MIN_LAMBDA,
            delta: params.delta,
            ca: Math.cos(a),
            sa: Math.sin(a),
            min: params.min,
            max: params.max,
        };
    },

    createInstance(ctx) {
        var modelX = ctx.modelX;
        var modelZ = ctx.modelZ;
        var n = ctx.numPixels;

        return {
            render(out, millis, p) {
                var phase = millis * 0.00628 * p.freq + p.delta;
                for (var i = 0; i < n; i++) {
                    var proj = modelX[i] * p.ca - modelZ[i] * p.sa;
                    var theta = phase - proj / p.lambda;
                    var brightness = p.min + (p.max - p.min) * 0.5 * (Math.sin(theta) + 1);

                    var wr = p.r * brightness;
                    var wg = p.g * brightness;
                    var wb = p.b * brightness;
                    out[i * 3] = wr < 0 ? 0 : (wr > 255 ? 255 : wr);
                    out[i * 3 + 1] = wg < 0 ? 0 : (wg > 255 ? 255 : wg);
                    out[i * 3 + 2] = wb < 0 ? 0 : (wb > 255 ? 255 : wb);
                }
            }
        };
    }
};
