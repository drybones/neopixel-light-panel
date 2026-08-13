/*
 * Wavelet effect — one instance is one wavelet; a multi-wavelet look is
 * multiple layers on the "add" blend mode.
 *
 * dz = pz + y (see the effect y-axis note in the root CLAUDE.md). Output is
 * clamped per-layer to [0, 255].
 *
 * `direction` is the whole of the inward/outward toggle: the phase is
 * theta = wt - r/lambda, and a crest is a point of constant theta, so as t
 * grows r must grow with it — the crests run away from the source. Negating
 * the radial term makes r shrink instead and the same wave converges on the
 * source. It is a toggle rather than a negative freq or lambda because both
 * of those are log sliders, which cannot express a negative at all.
 */

var color = require('../engine/color');
var panel = require('../engine/panel');

// Floor for a lambda of 0, which the unclamped typed field allows. Far below
// the LED pitch, so it renders as the same per-pixel speckle as any other
// sub-Nyquist wavelength rather than changing the look.
var MIN_LAMBDA = 1e-6;

module.exports = {
    type: 'wavelet',
    name: 'Wavelet',
    schema: [
        { key: 'color', type: 'color', label: 'Colour' },
        { key: 'freq', type: 'number', label: 'Speed', min: 0.01, max: 5, scale: 'log', zeroable: true, modulatable: true },
        { key: 'lambda', type: 'number', label: 'Wavelength', min: 0.001, max: 50, scale: 'log', modulatable: true },
        { key: 'delta', type: 'number', label: 'Phase', min: 0, max: 6.28, step: 0.01, scale: 'linear', modulatable: true },
        // margin (world units) expands the pad past the panel on all four sides;
        // farLimit adds a compressed outer frame reaching that distance, where
        // the wave reads as planar. Both are in world units — see engine/panel.
        { type: 'xy', label: 'Position', xKey: 'x', yKey: 'y',
          xRange: [-panel.HALF_X, panel.HALF_X], yRange: [-panel.HALF_Z, panel.HALF_Z],
          margin: 2, farLimit: 1000 },
        // Labelled to match planewave's `angle`, which is also the direction
        // the wave travels — the two effects should read the same way.
        { key: 'direction', type: 'enum', label: 'Travel', options: [
            { value: 'outward', label: 'Outward' },
            { value: 'inward', label: 'Inward' },
        ]},
        { type: 'range', label: 'Brightness', minKey: 'min', maxKey: 'max', scale: 'atan', modulatable: true },
    ],
    defaults: {
        color: '#ffffff',
        freq: 0.2,
        lambda: 0.5,
        delta: 0.0,
        x: 0,
        y: 0,
        direction: 'outward',
        min: 0.1,
        max: 0.7,
    },

    prepare(params) {
        var rgb = color.hexToRgb(params.color);
        // 1/lambda with the travel direction's sign baked in, so the render
        // loop is a multiply and neither branches nor divides. Anything but
        // 'inward' reads as outward — the default for a layer with no stored
        // direction.
        //
        // A lambda of 0 would divide to Infinity and put NaN in the pixel
        // buffer and out through setPixel; the slider can't reach 0, but the
        // typed field is deliberately unclamped.
        var k = (params.direction === 'inward' ? -1 : 1) / (params.lambda || MIN_LAMBDA);
        return {
            r: rgb.r, g: rgb.g, b: rgb.b,
            freq: params.freq,
            k: k,
            delta: params.delta,
            x: params.x,
            y: params.y,
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
                    var dx = modelX[i] - p.x;
                    var dz = modelZ[i] + p.y;
                    var r = Math.sqrt(dx * dx + dz * dz);
                    var theta = phase - r * p.k;
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
