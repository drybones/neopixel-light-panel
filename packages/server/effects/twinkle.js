/*
 * Twinkle — random pixels swell and fade like slow stars. Per-pixel
 * phase/period state lives in the instance; density decides how many
 * pixels take part.
 */

var color = require('../engine/color');

module.exports = {
    type: 'twinkle',
    name: 'Twinkle',
    schema: [
        { key: 'color', type: 'color', label: 'Colour' },
        { key: 'density', type: 'number', label: 'Density', min: 0.02, max: 1, step: 0.01, scale: 'linear', modulatable: true },
        { key: 'speed', type: 'number', label: 'Speed', min: 0.1, max: 3, step: 0.05, scale: 'linear', modulatable: true },
        { key: 'background', type: 'number', label: 'Backglow', min: 0, max: 0.3, step: 0.005, scale: 'linear', modulatable: true },
    ],
    defaults: {
        color: '#ffe9c4',
        density: 0.25,
        speed: 1,
        background: 0.02,
    },

    prepare(params) {
        var rgb = color.hexToRgb(params.color);
        return {
            r: rgb.r, g: rgb.g, b: rgb.b,
            density: params.density,
            speed: params.speed,
            background: params.background,
        };
    },

    createInstance(ctx) {
        var n = ctx.numPixels;
        var phase = new Float32Array(n);
        var period = new Float32Array(n);
        var lottery = new Float32Array(n); // stable per-pixel random for density threshold
        for (var i = 0; i < n; i++) {
            phase[i] = Math.random() * Math.PI * 2;
            period[i] = 1.5 + Math.random() * 4;
            lottery[i] = Math.random();
        }

        return {
            render(out, millis, p) {
                var t = millis / 1000 * p.speed;
                for (var i = 0; i < n; i++) {
                    var level = p.background;
                    if (lottery[i] < p.density) {
                        var s = Math.sin(phase[i] + t * Math.PI * 2 / period[i]);
                        // Sharpen so pixels are dark most of the cycle
                        if (s > 0) level += s * s * s * s;
                    }
                    out[i * 3] = p.r * level;
                    out[i * 3 + 1] = p.g * level;
                    out[i * 3 + 2] = p.b * level;
                }
            }
        };
    }
};
