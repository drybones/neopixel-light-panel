/*
 * Gradient effect — linear or radial multi-stop gradient with optional
 * slow animation (scroll along the gradient axis, or rotation for linear).
 *
 * SUPERSEDED by gradient_linear and gradient_radial, and hidden: its `mode`
 * enum decided what its other controls meant, leaving the Centre pad inert for
 * linear, the Angle inert for radial, and Motion 'rotate' inert for radial
 * outright — the radial branch below never reads `angle`.
 *
 * Kept registered so it still renders, exactly as embers and candy_sparkler
 * are. The one-time engine/gradient-migrate converts stored layers, but an
 * *export* taken before the migration can be imported long afterwards and
 * importMerge does not re-run migrations, so this has to keep working
 * indefinitely. The migration's exactness test renders it against the new
 * effects, which is another reason it cannot be deleted.
 *
 * Note the projection below is `+ modelZ * sa`, missing the negation every
 * other effect applies (see the root CLAUDE.md): at 90 degrees its ramp runs
 * *downward* while a dial would draw the arrow up. That is preserved here, bug
 * and all, because this module's only remaining job is to render old layers the
 * way they always rendered; gradient_linear fixes it, and the migration mirrors
 * the stored angle so the picture does not move.
 *
 * prepare() bakes the colour stops into a 256-entry LUT so the render loop
 * is a projection + table lookup per pixel.
 */

var panel = require('../engine/panel');
var gradientLut = require('../engine/gradient-lut');

var LUT_SIZE = gradientLut.LUT_SIZE;
var buildLut = gradientLut.buildLut;

var HALF_X = panel.HALF_X;
var HALF_Z = panel.HALF_Z;
var MAX_RADIUS = panel.RADIUS;

module.exports = {
    type: 'gradient',
    name: 'Gradient',
    hidden: true,
    schema: [
        { key: 'stops', type: 'gradientStops', label: 'Colours', minStops: 2 },
        { key: 'mode', type: 'enum', label: 'Shape', options: [
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' },
        ]},
        { key: 'angle', type: 'number', label: 'Angle', min: 0, max: 360, step: 1, scale: 'linear', modulatable: true },
        // margin (world units) expands the pad past the panel on all four sides
        // so an off-panel centre stays grabbable. No farLimit: a radial centre a
        // thousand units away is just a flat wash, so there's nothing out there
        // worth reaching for.
        { type: 'xy', label: 'Centre', xKey: 'cx', yKey: 'cy',
          xRange: [-HALF_X, HALF_X], yRange: [-HALF_Z, HALF_Z], margin: 2 },
        { key: 'animate', type: 'enum', label: 'Motion', options: [
            { value: 'none', label: 'Still' },
            { value: 'scroll', label: 'Scroll' },
            { value: 'rotate', label: 'Rotate' },
        ]},
        { key: 'speed', type: 'number', label: 'Drift', min: 0.002, max: 2, scale: 'log', zeroable: true, modulatable: true },
    ],
    defaults: {
        stops: [
            { position: 0.0, color: '#241040' },
            { position: 1.0, color: '#e04f1f' },
        ],
        mode: 'linear',
        angle: 0,
        cx: 0,
        cy: 0,
        animate: 'none',
        speed: 0.05,
    },

    prepare(params) {
        return {
            lut: buildLut(params.stops),
            radial: params.mode === 'radial',
            angle: params.angle * Math.PI / 180,
            cx: params.cx,
            cy: params.cy,
            scroll: params.animate === 'scroll' ? params.speed : 0,
            rotate: params.animate === 'rotate' ? params.speed : 0,
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
                var offset = p.scroll * t;
                var angle = p.angle + p.rotate * t * Math.PI * 2;
                var ca = Math.cos(angle), sa = Math.sin(angle);

                for (var i = 0; i < n; i++) {
                    var u;
                    if (p.radial) {
                        var dx = modelX[i] - p.cx;
                        var dz = modelZ[i] + p.cy;
                        u = Math.sqrt(dx * dx + dz * dz) / MAX_RADIUS + offset;
                    } else {
                        u = (modelX[i] * ca + modelZ[i] * sa) / HALF_X * 0.5 + 0.5 + offset;
                    }
                    // Mirror-wrap so scrolling loops without a seam
                    u = u % 2;
                    if (u < 0) u += 2;
                    if (u > 1) u = 2 - u;
                    var li = (u * (LUT_SIZE - 1)) | 0;
                    out[i * 3] = lut[li * 3];
                    out[i * 3 + 1] = lut[li * 3 + 1];
                    out[i * 3 + 2] = lut[li * 3 + 2];
                }
            }
        };
    }
};
