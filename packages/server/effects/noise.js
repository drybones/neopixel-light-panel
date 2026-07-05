/*
 * Noise field — slowly-drifting fractal value noise mapped onto a
 * two-colour ramp. The cheapest "organic" texture for a 30×8 grid.
 * Each instance gets its own permutation table so two noise layers
 * don't move in lockstep.
 */

var color = require('../engine/color');

function fade(t) {
    return t * t * (3 - 2 * t);
}

module.exports = {
    type: 'noise',
    name: 'Noise field',
    schema: [
        { key: 'c1', type: 'color', label: 'Low colour' },
        { key: 'c2', type: 'color', label: 'High colour' },
        { key: 'scale', type: 'number', label: 'Scale', min: 0.2, max: 4, step: 0.05, scale: 'linear', modulatable: true },
        { key: 'speed', type: 'number', label: 'Speed', min: 0, max: 2, step: 0.01, scale: 'linear', modulatable: true },
        { key: 'contrast', type: 'number', label: 'Contrast', min: 0.5, max: 4, step: 0.05, scale: 'linear', modulatable: true },
    ],
    defaults: {
        c1: '#0a1030',
        c2: '#3fd0ff',
        scale: 1,
        speed: 0.3,
        contrast: 1.5,
    },

    prepare(params) {
        var a = color.hexToRgb(params.c1);
        var b = color.hexToRgb(params.c2);
        return {
            r1: a.r, g1: a.g, b1: a.b,
            r2: b.r, g2: b.g, b2: b.b,
            scale: params.scale,
            speed: params.speed,
            contrast: params.contrast,
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

        function gridValue(xi, zi, ti) {
            return perm[(perm[(perm[xi & 255] + zi) & 255] + ti) & 255] / 255;
        }

        function valueNoise(x, z, t) {
            var xi = Math.floor(x), zi = Math.floor(z), ti = Math.floor(t);
            var xf = x - xi, zf = z - zi, tf = t - ti;
            var u = fade(xf), v = fade(zf), w = fade(tf);

            function corner(dz, dt) {
                var a = gridValue(xi, zi + dz, ti + dt);
                var b = gridValue(xi + 1, zi + dz, ti + dt);
                return a + (b - a) * u;
            }
            var z0t0 = corner(0, 0), z1t0 = corner(1, 0);
            var z0t1 = corner(0, 1), z1t1 = corner(1, 1);
            var t0 = z0t0 + (z1t0 - z0t0) * v;
            var t1 = z0t1 + (z1t1 - z0t1) * v;
            return t0 + (t1 - t0) * w;
        }

        return {
            render(out, millis, p) {
                var t = millis / 1000 * p.speed;
                var freq = p.scale;
                for (var i = 0; i < n; i++) {
                    var x = modelX[i] * freq;
                    var z = modelZ[i] * freq;
                    // Two octaves is plenty at this resolution
                    var v = valueNoise(x + 100, z + 100, t) * 0.65
                          + valueNoise(x * 2 + 37, z * 2 + 41, t * 1.7) * 0.35;
                    // Contrast around the midpoint, clamped
                    v = 0.5 + (v - 0.5) * p.contrast;
                    v = v < 0 ? 0 : (v > 1 ? 1 : v);
                    out[i * 3] = p.r1 + (p.r2 - p.r1) * v;
                    out[i * 3 + 1] = p.g1 + (p.g2 - p.g1) * v;
                    out[i * 3 + 2] = p.b1 + (p.b2 - p.b1) * v;
                }
            }
        };
    }
};
