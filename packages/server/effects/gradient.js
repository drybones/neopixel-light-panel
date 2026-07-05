/*
 * Gradient effect — linear or radial multi-stop gradient with optional
 * slow animation (scroll along the gradient axis, or rotation for linear).
 *
 * prepare() bakes the colour stops into a 256-entry LUT so the render loop
 * is a projection + table lookup per pixel.
 */

var color = require('../engine/color');

var LUT_SIZE = 256;

// Panel extent: x is ±3.625 (30 cols × 0.25), z is ±0.875 (8 rows × 0.25).
var HALF_X = 3.625;
var HALF_Z = 0.875;
var MAX_RADIUS = Math.sqrt(HALF_X * HALF_X + HALF_Z * HALF_Z);

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

module.exports = {
    type: 'gradient',
    name: 'Gradient',
    schema: [
        { key: 'stops', type: 'gradientStops', label: 'Colours', minStops: 2 },
        { key: 'mode', type: 'enum', label: 'Shape', options: [
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' },
        ]},
        { key: 'angle', type: 'number', label: 'Angle', min: 0, max: 360, step: 1, scale: 'linear', modulatable: true },
        { type: 'xy', label: 'Centre', xKey: 'cx', yKey: 'cy', xRange: [-3.6, 3.6], yRange: [-0.9, 0.9], draggable: true },
        { key: 'animate', type: 'enum', label: 'Motion', options: [
            { value: 'none', label: 'Still' },
            { value: 'scroll', label: 'Scroll' },
            { value: 'rotate', label: 'Rotate' },
        ]},
        { key: 'speed', type: 'number', label: 'Drift', min: 0, max: 0.5, step: 0.005, scale: 'linear', modulatable: true },
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
