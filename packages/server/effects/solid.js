/*
 * Solid effect — fills the whole panel with one flat colour.
 * Mostly useful as a base layer under multiply/overlay blends.
 */

var color = require('../engine/color');

module.exports = {
    type: 'solid',
    name: 'Solid colour',
    schema: [
        { key: 'color', type: 'color', label: 'Colour' },
        { key: 'level', type: 'number', label: 'Level', min: 0, max: 1, step: 0.01, scale: 'linear', modulatable: true },
    ],
    defaults: {
        color: '#404060',
        level: 1.0,
    },

    prepare(params) {
        var rgb = color.hexToRgb(params.color);
        return {
            r: rgb.r * params.level,
            g: rgb.g * params.level,
            b: rgb.b * params.level,
        };
    },

    createInstance(ctx) {
        var n = ctx.numPixels;
        return {
            render(out, millis, p) {
                for (var i = 0; i < n; i++) {
                    out[i * 3] = p.r;
                    out[i * 3 + 1] = p.g;
                    out[i * 3 + 2] = p.b;
                }
            }
        };
    }
};
