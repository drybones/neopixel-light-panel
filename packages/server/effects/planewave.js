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

const color = require('../engine/color');
const wave = require('../engine/wave');

module.exports = {
    type: 'planewave',
    name: 'Plane Wave',
    schema: [
        { key: 'color', type: 'color', label: 'Colour' },
        { key: 'freq', type: 'number', label: 'Speed', min: 0.01, max: 5, scale: 'log', zeroable: true },
        { key: 'lambda', type: 'number', label: 'Wavelength', min: 0.001, max: 50, scale: 'log' },
        { key: 'delta', type: 'number', label: 'Phase', min: 0, max: 6.28, step: 0.01, scale: 'linear' },
        { key: 'angle', type: 'angle', label: 'Travel', min: 0, max: 360, step: 1 },
        { type: 'range', label: 'Brightness', minKey: 'min', maxKey: 'max', scale: 'atan' },
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
        const rgb = color.hexToRgb(params.color);
        const a = params.angle * Math.PI / 180;
        return {
            r: rgb.r, g: rgb.g, b: rgb.b,
            freq: params.freq,
            // Divided into `proj` below — 0 would render the layer as NaN.
            // The typed field is unclamped, so this can arrive as 0.
            lambda: params.lambda || wave.MIN_LAMBDA,
            delta: params.delta,
            ca: Math.cos(a),
            sa: Math.sin(a),
            min: params.min,
            max: params.max,
        };
    },

    createInstance(ctx) {
        const modelX = ctx.modelX;
        const modelZ = ctx.modelZ;
        const n = ctx.numPixels;

        return {
            render(out, millis, p) {
                const phase = wave.phase(millis, p);
                for (let i = 0; i < n; i++) {
                    const proj = modelX[i] * p.ca - modelZ[i] * p.sa;
                    wave.shade(out, i, phase - proj / p.lambda, p);
                }
            }
        };
    }
};
