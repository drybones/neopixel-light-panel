/*
 * Particle trail — a swirling comet of hue-shifting particles. Ported from
 * shader.js particle_trail(); positions are a pure function of time, so
 * the instance just owns a pre-allocated particle pool.
 */

var color = require('../engine/color');
var particles = require('../engine/particles');

var MAX_PARTICLES = 80;

module.exports = {
    type: 'particle_trail',
    name: 'Particle trail',
    schema: [
        { key: 'count', type: 'number', label: 'Trail length', min: 5, max: MAX_PARTICLES - 1, step: 1, scale: 'linear', modulatable: true },
        { key: 'speed', type: 'number', label: 'Speed', min: 0.1, max: 3, step: 0.05, scale: 'linear', modulatable: true },
        { key: 'saturation', type: 'number', label: 'Colourfulness', min: 0, max: 1, step: 0.01, scale: 'linear', modulatable: true },
        { key: 'glow', type: 'number', label: 'Glow', min: 0, max: 0.3, step: 0.005, scale: 'linear', modulatable: true },
    ],
    defaults: {
        count: 49,
        speed: 1,
        saturation: 0.5,
        glow: 0.1,
    },

    prepare(params) {
        return {
            count: Math.min(MAX_PARTICLES - 1, Math.max(1, params.count | 0)),
            speed: params.speed,
            saturation: params.saturation,
            glow: params.glow,
        };
    },

    createInstance(ctx) {
        var pool = new Array(MAX_PARTICLES);
        pool[0] = { point: [], intensity: 0.1, falloff: 0, color: [0, 0, 0] };
        for (var i = 1; i < MAX_PARTICLES; i++) {
            pool[i] = { point: [0, 0, 0], intensity: 0, falloff: 100, color: [0, 0, 0] };
        }

        return {
            render(out, millis, p) {
                var time = 0.009 * millis * p.speed;
                var numParticles = p.count;

                pool[0].intensity = p.glow;
                pool[0].color = color.hsv(time * 0.01, p.saturation * 0.6, 0.8);

                for (var i = 1; i <= numParticles; i++) {
                    var s = i / numParticles;
                    var radius = 0.2 + 0.8 * s;
                    var theta = time + 8 * s;
                    var x = 1.5 * radius * Math.cos(theta) + 1.0 * Math.sin(time * 0.05);
                    var y = radius * Math.sin(theta + 10.0 * Math.sin(theta * 0.15));

                    var q = pool[i];
                    q.point[0] = x;
                    q.point[2] = y;
                    q.intensity = 50.0 / numParticles * s;
                    q.color = color.hsv(time * 0.01 + s * 0.2, p.saturation, 0.8);
                }

                particles.renderParticles(out, pool, numParticles + 1, ctx.modelX, ctx.modelZ, ctx.numPixels);
            }
        };
    }
};
