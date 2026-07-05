/*
 * Candy sparkler — rainbow sparks bursting from the centre. Ported from
 * shader.js candy_sparkler() with per-instance particle state.
 */

var color = require('../engine/color');
var particles = require('../engine/particles');

var MAX_PARTICLES = 80;

module.exports = {
    type: 'candy_sparkler',
    name: 'Candy sparkler',
    schema: [
        { key: 'count', type: 'number', label: 'Density', min: 5, max: MAX_PARTICLES - 1, step: 1, scale: 'linear', modulatable: true },
        { key: 'speed', type: 'number', label: 'Speed', min: 0.2, max: 3, step: 0.05, scale: 'linear', modulatable: true },
        { key: 'saturation', type: 'number', label: 'Colourfulness', min: 0, max: 1, step: 0.01, scale: 'linear', modulatable: true },
        { key: 'glow', type: 'number', label: 'Glow', min: 0, max: 0.2, step: 0.005, scale: 'linear', modulatable: true },
    ],
    defaults: {
        count: 49,
        speed: 1,
        saturation: 1,
        glow: 0.02,
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
        pool[0] = { point: [], intensity: 0.02, falloff: 0.0, color: color.hsv(0.0, 0.0, 1.0) };
        for (var i = 1; i < MAX_PARTICLES; i++) {
            pool[i] = { point: [0, 0, 0], intensity: 0, falloff: 30.0, color: [0, 0, 0], origin: [0, 0, 0], velocity: null, born: null, death: 0, virgin: true };
        }

        return {
            render(out, millis, p) {
                pool[0].intensity = p.glow;

                var active = p.count + 1;
                for (var i = 1; i < active; i++) {
                    var q = pool[i];
                    if (!q.born) {
                        var v_r = (Math.random() * 0.5 + 1.5) * p.speed;
                        var v_theta = Math.random() * 2 * Math.PI;
                        var delay = q.virgin ? Math.random() * 2000 : 0; // Don't start them all at once on first run
                        q.virgin = false;
                        q.velocity = [1.5 * v_r * Math.cos(v_theta), 0, 1.0 * v_r * Math.sin(v_theta)];
                        q.color = color.hsv(Math.random() * 1.0, p.saturation, 1.0);
                        q.born = millis + delay;
                        q.death = millis + delay + Math.random() * 1000 + 1000;
                    }
                    var age = (millis - q.born) / 1000;
                    q.point[0] = q.origin[0] + q.velocity[0] * age;
                    q.point[1] = q.origin[1] + q.velocity[1] * age;
                    q.point[2] = q.origin[2] + q.velocity[2] * age;

                    var life_fraction = (millis - q.born) / (q.death - q.born);
                    var pivot = 0.25;
                    if (life_fraction < pivot) {
                        q.intensity = Math.max(life_fraction / pivot, 0); // Can be < 0 while birth is delayed
                    } else {
                        q.intensity = 1.0 - (life_fraction - pivot) / (1 - pivot);
                    }

                    if (millis > q.death) {
                        q.intensity = 0.0;
                        q.born = null;
                    }
                }

                particles.renderParticles(out, pool, active, ctx.modelX, ctx.modelZ, ctx.numPixels);
            }
        };
    }
};
