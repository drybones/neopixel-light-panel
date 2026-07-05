/*
 * Embers — drifting warm sparks with a faint ambient glow. Ported from
 * shader.js embers(); animation state lives per layer instance so several
 * ember layers can run independently and param edits don't reset motion.
 */

var color = require('../engine/color');
var particles = require('../engine/particles');

var MAX_PARTICLES = 60;

module.exports = {
    type: 'embers',
    name: 'Embers',
    schema: [
        { key: 'hue', type: 'number', label: 'Hue', min: 0, max: 1, step: 0.01, scale: 'linear', modulatable: true },
        { key: 'hueSpread', type: 'number', label: 'Hue spread', min: 0, max: 0.5, step: 0.01, scale: 'linear', modulatable: true },
        { key: 'count', type: 'number', label: 'Density', min: 1, max: MAX_PARTICLES - 1, step: 1, scale: 'linear', modulatable: true },
        { key: 'speed', type: 'number', label: 'Speed', min: 0.1, max: 3, step: 0.05, scale: 'linear', modulatable: true },
        { key: 'glow', type: 'number', label: 'Glow', min: 0, max: 0.3, step: 0.005, scale: 'linear', modulatable: true },
    ],
    defaults: {
        hue: 0.035,
        hueSpread: 0.11,
        count: 29,
        speed: 1,
        glow: 0.08,
    },

    prepare(params) {
        return {
            hue: params.hue,
            hueSpread: params.hueSpread,
            count: Math.min(MAX_PARTICLES - 1, Math.max(1, params.count | 0)),
            speed: params.speed,
            glow: params.glow,
        };
    },

    createInstance(ctx) {
        var pool = new Array(MAX_PARTICLES);
        pool[0] = { point: [], intensity: 0.08, falloff: 0.0, color: color.hsv(0.05, 0.8, 1.0) };
        for (var i = 1; i < MAX_PARTICLES; i++) {
            pool[i] = { point: [0, 0, 0], intensity: 0, falloff: 20.0, color: [0, 0, 0], origin: null, velocity: null, born: null, death: 0 };
        }

        return {
            render(out, millis, p) {
                pool[0].intensity = p.glow;
                pool[0].color = color.hsv(p.hue + 0.015, 0.8, 1.0);

                var active = p.count + 1;
                for (var i = 1; i < active; i++) {
                    var q = pool[i];
                    if (!q.born) {
                        q.origin = [Math.random() * 8.0 - 4.0, 0, Math.random() * 2.0 - 0.0];
                        q.velocity = [0.6 * (Math.random() - 0.5), 0, -(Math.random() * 0.4 + 0.2)];
                        q.color = color.hsv(p.hue + p.hueSpread * (Math.random() - 0.15), 1.0, 1.0);
                        q.born = millis;
                        q.death = millis + Math.random() * 5000 + 3000;
                    }
                    var age = (millis - q.born) / 1000 * p.speed;
                    q.point[0] = q.origin[0] + q.velocity[0] * age;
                    q.point[1] = q.origin[1] + q.velocity[1] * age;
                    q.point[2] = q.origin[2] + q.velocity[2] * age;
                    q.intensity = 0.7 * Math.sin((millis - q.born) / (q.death - q.born) * Math.PI);

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
