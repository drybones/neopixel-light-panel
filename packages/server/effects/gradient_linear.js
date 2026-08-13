/*
 * Linear gradient — a multi-stop ramp running along a chosen direction, with
 * optional scroll along it and optional rotation of the whole thing.
 *
 * This and gradient_radial are separate effects, not one with a `mode` enum,
 * for the same reason wavelet and planewave are: the two shapes are told
 * apart by a *control type* — a pad against a dial — and no parameter
 * interpolates one into the other.
 *
 * `angle` is where the ramp runs, from the first stop to the last, and it is
 * also the direction positive Scroll carries the colours — which is why the
 * scroll term is subtracted rather than added. Holding a colour's position
 * fixed as t grows means proj must grow with it, so the picture advances
 * along the dial's arrow.
 *
 * There is deliberately no inward/outward toggle here. The dial already
 * reverses the scroll (angle + 180) — unlike the radial, which has no dial and
 * therefore does carry one.
 *
 * The projection is `modelX * ca - modelZ * sa`, with the negation planewave
 * spells the same way: modelZ +0.875 is the panel's *bottom* row while the
 * dial draws +y up.
 */

var panel = require('../engine/panel');
var gradientLut = require('../engine/gradient-lut');

var LUT_SIZE = gradientLut.LUT_SIZE;
var HALF_X = panel.HALF_X;

module.exports = {
    type: 'gradient_linear',
    name: 'Linear Gradient',
    schema: [
        { key: 'stops', type: 'gradientStops', label: 'Colours', minStops: 2 },

        { type: 'group', label: 'Shape' },
        // 'bands' fills the dial with the stops themselves — this angle is not
        // a wave direction and the wavefront stripes would say the wrong thing,
        // but the ramp's own colours say exactly the right one.
        { key: 'angle', type: 'angle', label: 'Angle', min: 0, max: 360, step: 1,
          render: 'bands', stopsKey: 'stops', modulatable: true },
        // How many times the stop list is traversed across the panel. 1 is one
        // ramp edge to edge, which is what the effect this replaced hardcoded —
        // and the reason an angle near 90 looked so flat, since the projection
        // is normalised on the panel's *half-width* and the panel is only 0.875
        // tall. Log: 0.1 to 16 is two and a half decades of band count.
        { key: 'repeats', type: 'number', label: 'Repeats', min: 0.1, max: 16, scale: 'log', modulatable: true },
        gradientLut.TILING_SCHEMA,
        // In ramps rather than radians — wavelet and planewave measure phase on
        // a sine, this one measures it along a stop list. 1 is a whole traversal.
        { key: 'phase', type: 'number', label: 'Phase', min: 0, max: 1, step: 0.005, scale: 'linear', modulatable: true },

        { type: 'group', label: 'Motion' },
        { key: 'scroll', type: 'number', label: 'Scroll', min: 0.002, max: 2, scale: 'log', zeroable: true, modulatable: true },
        // Rotations per second, and the one speed in this codebase that is a
        // signed linear track rather than a log one: it does not span decades,
        // and a log slider cannot reach a negative at all, which would need a
        // direction enum beside it for a quantity that has no other use for one.
        // Anticlockwise for positive, the way the dial's numbers already run.
        { key: 'spin', type: 'number', label: 'Spin', min: -0.5, max: 0.5, step: 0.005, scale: 'linear', modulatable: true },
    ],
    defaults: {
        stops: [
            { position: 0.0, color: '#241040' },
            { position: 1.0, color: '#e04f1f' },
        ],
        angle: 0,
        repeats: 1,
        tiling: 'mirror',
        phase: 0,
        scroll: 0,
        spin: 0,
    },

    prepare(params) {
        return {
            lut: gradientLut.buildLut(params.stops),
            angle: params.angle * Math.PI / 180,
            repeats: params.repeats,
            tiling: gradientLut.tileMode(params.tiling),
            phase: params.phase,
            scroll: params.scroll,
            spin: params.spin,
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
                var angle = p.angle + p.spin * t * Math.PI * 2;
                var ca = Math.cos(angle), sa = Math.sin(angle);
                // Everything constant across the panel, hoisted: the offset is
                // 0.5 (the ramp's centre on the panel's centre) plus the static
                // phase, minus the distance scrolled.
                var scale = p.repeats / (2 * HALF_X);
                var offset = 0.5 + p.phase - p.scroll * t;

                for (var i = 0; i < n; i++) {
                    var proj = modelX[i] * ca - modelZ[i] * sa;
                    var u = gradientLut.tile(proj * scale + offset, tiling);
                    var li = (u * (LUT_SIZE - 1)) | 0;
                    out[i * 3] = lut[li * 3];
                    out[i * 3 + 1] = lut[li * 3 + 1];
                    out[i * 3 + 2] = lut[li * 3 + 2];
                }
            }
        };
    }
};
