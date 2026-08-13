/*
 * Radial gradient — a multi-stop ramp running outward from a centre, with
 * optional scroll along the radius.
 *
 * A separate effect from the linear gradient rather than one with a mode
 * enum; see effects/gradient_linear for why.
 *
 * `aspect` stretches the radius in x. The panel is 30x8 on a square pitch, so a
 * true circle is clipped hard at the left and right edges and the corners are
 * most of what you see; an aspect of about 4.14 is the ellipse that fits it.
 * This is the emitter's extX/extY move applied to a shape — a continuous
 * parameter reaching a look the mode enum could not. There is deliberately no
 * rotation for the ellipse: it would be inert at the default aspect of 1, which
 * is the thing this effect was split to stop doing.
 *
 * `travel` is the whole of the inward/outward toggle, and it exists for exactly
 * wavelet's reason: Scroll is a log slider and cannot express a negative, and
 * unlike the linear gradient there is no dial here to turn the picture round.
 * Outward is new — the effect this replaced only ever scrolled inward.
 */

var panel = require('../engine/panel');
var gradientLut = require('../engine/gradient-lut');

var LUT_SIZE = gradientLut.LUT_SIZE;
var MAX_RADIUS = panel.RADIUS;

// Divided into dx below, so a 0 would put Infinity and then NaN in the pixel
// buffer and out through setPixel. The slider cannot reach 0 but the typed
// field is deliberately unclamped — the same guard as wavelet's MIN_LAMBDA.
var MIN_ASPECT = 1e-6;

module.exports = {
    type: 'gradient_radial',
    name: 'Radial Gradient',
    schema: [
        { key: 'stops', type: 'gradientStops', label: 'Colours', minStops: 2 },

        { type: 'group', label: 'Shape' },
        // margin (world units) expands the pad past the panel on all four sides
        // so an off-panel centre stays grabbable. No farLimit: a centre a
        // thousand units away is just a flat wash, so there is nothing out
        // there worth reaching for.
        { type: 'xy', label: 'Centre', xKey: 'cx', yKey: 'cy',
          xRange: [-panel.HALF_X, panel.HALF_X], yRange: [-panel.HALF_Z, panel.HALF_Z], margin: 2 },
        // Width against height. 1 is a circle; the panel's own ratio is 4.14.
        { key: 'aspect', type: 'number', label: 'Aspect', min: 0.25, max: 8, scale: 'log', modulatable: true },
        // How many times the stop list is traversed between the centre and the
        // farthest corner. 1 is what the effect this replaced hardcoded.
        { key: 'repeats', type: 'number', label: 'Repeats', min: 0.1, max: 16, scale: 'log', modulatable: true },
        gradientLut.TILING_SCHEMA,
        // In ramps rather than radians — see gradient_linear.
        { key: 'phase', type: 'number', label: 'Phase', min: 0, max: 1, step: 0.005, scale: 'linear', modulatable: true },

        { type: 'group', label: 'Motion' },
        { key: 'scroll', type: 'number', label: 'Scroll', min: 0.002, max: 2, scale: 'log', zeroable: true, modulatable: true },
        // Labelled to match wavelet, which uses Travel for the direction the
        // rings go rather than where they come from.
        { key: 'travel', type: 'enum', label: 'Travel', options: [
            { value: 'outward', label: 'Outward' },
            { value: 'inward', label: 'Inward' },
        ]},
    ],
    defaults: {
        stops: [
            { position: 0.0, color: '#e04f1f' },
            { position: 1.0, color: '#241040' },
        ],
        cx: 0,
        cy: 0,
        aspect: 1,
        repeats: 1,
        tiling: 'mirror',
        phase: 0,
        scroll: 0,
        travel: 'outward',
    },

    prepare(params) {
        return {
            lut: gradientLut.buildLut(params.stops),
            cx: params.cx,
            cy: params.cy,
            aspect: params.aspect > MIN_ASPECT ? params.aspect : MIN_ASPECT,
            repeats: params.repeats,
            tiling: gradientLut.tileMode(params.tiling),
            phase: params.phase,
            // The scroll direction's sign baked in, so the render loop neither
            // branches nor reads the enum. Adding to u puts a given colour at a
            // smaller radius as t grows, i.e. the rings converge — so inward is
            // the positive one. Anything but 'inward' reads as outward — the
            // default for a layer with no stored travel direction.
            scroll: (params.travel === 'inward' ? 1 : -1) * params.scroll,
        };
    },

    createInstance(ctx) {
        var modelX = ctx.modelX;
        var modelZ = ctx.modelZ;
        var n = ctx.numPixels;

        return {
            render(out, millis, p) {
                var t = millis / 1000;
                var lut = p.lut;
                var tiling = p.tiling;
                var invAspect = 1 / p.aspect;
                var scale = p.repeats / MAX_RADIUS;
                var offset = p.phase + p.scroll * t;

                for (var i = 0; i < n; i++) {
                    var dx = (modelX[i] - p.cx) * invAspect;
                    // The pad draws +y up and modelZ runs the other way; this
                    // is the same negation wavelet spells as dz = modelZ + y.
                    var dz = modelZ[i] + p.cy;
                    var r = Math.sqrt(dx * dx + dz * dz);
                    var u = gradientLut.tile(r * scale + offset, tiling);
                    var li = (u * (LUT_SIZE - 1)) | 0;
                    out[i * 3] = lut[li * 3];
                    out[i * 3 + 1] = lut[li * 3 + 1];
                    out[i * 3 + 2] = lut[li * 3 + 2];
                }
            }
        };
    }
};
