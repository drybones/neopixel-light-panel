/*
 * Emitter — a general particle source. This is what candy sparkler and embers
 * both turned out to be: the same program with different constants baked into
 * createInstance(). Origin, direction, spread, speed, lifetime, colour source
 * and the intensity envelope were all literals in there, which is why each of
 * them had exactly one look. They are params here, and the two old effects come
 * back as presets (see `presets` below).
 *
 * The source is an origin plus a width/height box rather than a
 * point/panel/edge enum. An enum was the first cut and it was worse in both
 * directions: it made `x`/`y` inert in two of its three states, and its three
 * names could not reach an emitting line, a shallow band, or a wide soft
 * source. A continuous extent makes nothing inert and reaches all of them —
 * the same trade noise.js made when Levels replaced contrast.
 *
 * Gravity is a magnitude and an angle, not an up/down toggle. `dir` is the
 * launch velocity and gravity is a sustained acceleration; no launch angle
 * reproduces a particle that sets off upward and ends up drifting right.
 *
 * Every position, angle and acceleration here is in *param* space, where +y is
 * up and 90 degrees points at the top of the panel — the frame the xy pad and
 * the angle dials draw. The panel's own modelZ runs the other way (+0.875 is
 * the bottom row), so the two are reconciled by a single negation on the write
 * to point[2]. Do not "simplify" that away, and do not add a second one: the
 * whole vertical axis — origin, travel, gravity — inverts together, and a
 * symmetric preset like the sparkler will not show it.
 */

var color = require('../engine/color');
var particles = require('../engine/particles');
var panel = require('../engine/panel');

var MAX_PARTICLES = 80;

// The panel is 30x8 on a square pitch, so it is 4.1x wider than it is tall.
// Emitted velocity and gravity are both stretched in x by this, which is what
// makes an omnidirectional burst read as a circle rather than a tall ellipse,
// and what makes a gravity angle and a travel angle of the same number point
// the same way on screen. Migrated embers drift about 1.5x wider horizontally
// than they used to as a result.
var X_STRETCH = 1.5;

// falloff is 1/size^2, so a size of 0 divides to Infinity and then
// intensity / (1 + Infinity * 0) is NaN, straight into the layer buffer and
// out through setPixel. The slider cannot reach 0 but the typed field is
// deliberately unclamped — same guard as wavelet's MIN_LAMBDA.
var MIN_SIZE = 1e-3;

// Extent maxes as a multiple of the panel, so they follow engine/panel rather
// than being re-hardcoded here. Wider than the panel is useful: it thins the
// particles out towards the edges instead of packing them all on-screen.
var MAX_EXT_X = 4 * panel.HALF_X;
var MAX_EXT_Y = 4 * panel.HALF_Z;

function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

module.exports = {
    type: 'emitter',
    name: 'Emitter',
    // Ordered as the thing is built: what colour it is, where it comes from,
    // how much of it there is, then how it moves. Colour leads and sits in the
    // unnamed section above the first heading, alongside blend and opacity —
    // every other effect opens on its colour too, and it is the one control
    // that never needs a section to explain it.
    schema: [
        { key: 'color', type: 'color', label: 'Colour' },
        // 1 is a fully random hue per particle, which is candy sparkler's
        // rainbow. The swatch's saturation and brightness still apply there —
        // only its hue is overridden — so a pale swatch gives pastel sparks.
        { key: 'hueSpread', type: 'number', label: 'Hue spread', min: 0, max: 1, step: 0.01, scale: 'linear', modulatable: true },

        { type: 'group', label: 'Source' },
        { type: 'xy', label: 'Origin', xKey: 'x', yKey: 'y',
          xRange: [-panel.HALF_X, panel.HALF_X], yRange: [-panel.HALF_Z, panel.HALF_Z],
          margin: 2, extXKey: 'extX', extYKey: 'extY', gravKey: 'grav', gravDirKey: 'gravDir' },
        // Full width and height of the box births scatter across, not half-
        // extents. Both 0 is a point source.
        { key: 'extX', type: 'number', label: 'Width', min: 0, max: MAX_EXT_X, step: 0.05, scale: 'linear', modulatable: true },
        { key: 'extY', type: 'number', label: 'Height', min: 0, max: MAX_EXT_Y, step: 0.05, scale: 'linear', modulatable: true },

        { type: 'group', label: 'Emission' },
        { key: 'count', type: 'number', label: 'Density', min: 1, max: MAX_PARTICLES - 1, step: 1, scale: 'linear', modulatable: true },
        // How many and how big sit together: they are the two knobs you trade
        // against each other to fill the panel. A radius in world units — the
        // LED pitch is 0.25, so 0.25 is one LED across. Log because 1/size^2
        // means this is two decades of the quantity that reaches the pixels.
        { key: 'size', type: 'number', label: 'Size', min: 0.06, max: 0.6, scale: 'log', modulatable: true },
        { key: 'life', type: 'number', label: 'Lifetime', min: 0.2, max: 10, scale: 'log', modulatable: true },
        { key: 'lifeSpread', type: 'number', label: 'Life spread', min: 0, max: 1, step: 0.01, scale: 'linear', modulatable: true },
        // The fraction of a particle's life spent brightening; the rest is the
        // fade. Not called "attack" — this codebase says Colourfulness, not
        // saturation, and Levels, not contrast.
        { key: 'swell', type: 'number', label: 'Swell', min: 0, max: 1, step: 0.01, scale: 'linear', zeroable: true, modulatable: true },

        { type: 'group', label: 'Motion' },
        // Labelled to match wavelet and planewave, which both use Travel for
        // the direction the thing goes rather than where it comes from.
        { key: 'dir', type: 'angle', label: 'Travel', min: 0, max: 360, step: 1, render: 'cone', spreadKey: 'spread', modulatable: true },
        // The cone angle in degrees. Log because the look changes fast at the
        // narrow end — 5 to 60 degrees is the whole range from a jet to a
        // fountain, and the top half of a linear track would all read as
        // "basically omnidirectional".
        { key: 'spread', type: 'number', label: 'Spread', min: 1, max: 360, scale: 'log', zeroable: true, modulatable: true },
        { key: 'speed', type: 'number', label: 'Speed', min: 0.05, max: 6, scale: 'log', zeroable: true, modulatable: true },
        { key: 'speedSpread', type: 'number', label: 'Speed spread', min: 0, max: 1, step: 0.01, scale: 'linear', modulatable: true },
        { key: 'grav', type: 'number', label: 'Gravity', min: 0.02, max: 4, scale: 'log', zeroable: true, modulatable: true },
        // Plain arrow rather than the wavefront stripes: this is not a wave,
        // and it must not look like the Travel dial three rows above it.
        { key: 'gravDir', type: 'angle', label: 'Gravity angle', min: 0, max: 360, step: 1, render: 'arrow', modulatable: true },
    ],

    defaults: {
        color: '#ff0000',
        hueSpread: 1,
        size: 0.183,
        dir: 90,
        spread: 360,
        speed: 1.75,
        speedSpread: 0.14,
        grav: 0,
        gravDir: 270,
        count: 49,
        life: 1.5,
        lifeSpread: 0.33,
        swell: 0.25,
        x: 0,
        y: 0,
        extX: 0,
        extY: 0,
    },

    // Starting points, offered as buttons at the top of the layer editor —
    // deliberately a handful, not a catalogue. The picker shows one Emitter
    // tile; these are how the two effects this replaced stay one click away
    // once you are in the panel, and each one sets the whole param set rather
    // than patching it.
    presets: [
        { id: 'sparkler', name: 'Candy sparkler', params: {
            color: '#ff0000', hueSpread: 1, size: 0.183, dir: 90, spread: 360,
            speed: 1.75, speedSpread: 0.14, grav: 0, gravDir: 270, count: 49,
            life: 1.5, lifeSpread: 0.33, swell: 0.25, x: 0, y: 0, extX: 0, extY: 0 } },
        // Embers rise: the effect this replaced was born over modelZ 0..2 —
        // the panel's lower half and below it — with an upward velocity.
        { id: 'embers', name: 'Embers', params: {
            color: '#ff3600', hueSpread: 0.11, size: 0.224, dir: 90, spread: 70,
            speed: 0.45, speedSpread: 0.5, grav: 0, gravDir: 270, count: 29,
            life: 5.5, lifeSpread: 0.6, swell: 0.5, x: 0, y: -1, extX: 8, extY: 2 } },
        { id: 'snow', name: 'Drifting snow', params: {
            color: '#dbe9ff', hueSpread: 0.03, size: 0.2, dir: 270, spread: 60,
            speed: 0.3, speedSpread: 0.6, grav: 0.22, gravDir: 340, count: 34,
            life: 6, lifeSpread: 0.5, swell: 0.35, x: 0, y: 1.2, extX: 9, extY: 1 } },
        { id: 'fireflies', name: 'Fireflies', params: {
            color: '#ffd426', hueSpread: 0.06, size: 0.169, dir: 0, spread: 360,
            speed: 0.1, speedSpread: 0.8, grav: 0, gravDir: 270, count: 18,
            life: 6, lifeSpread: 0.7, swell: 0.5, x: 0, y: 0, extX: 7.5, extY: 1.8 } },
    ],

    prepare(params) {
        var base = color.hexToHsv(params.color);
        var ga = params.gravDir * Math.PI / 180;
        var size = params.size > MIN_SIZE ? params.size : MIN_SIZE;
        return {
            h: base.h, s: base.s, v: base.v,
            hueSpread: params.hueSpread,
            // The renderer wants a falloff, not a radius.
            falloff: 1 / (size * size),
            dir: params.dir * Math.PI / 180,
            // Halved once here rather than per particle: the jitter is
            // +/- half the cone.
            halfSpread: params.spread * Math.PI / 360,
            speed: params.speed,
            speedSpread: params.speedSpread,
            ax: params.grav * Math.cos(ga) * X_STRETCH,
            az: params.grav * Math.sin(ga),
            count: Math.min(MAX_PARTICLES - 1, Math.max(1, params.count | 0)),
            // Seconds in, milliseconds out — the render loop works in millis.
            life: params.life * 1000,
            lifeSpread: params.lifeSpread,
            swell: params.swell,
            x: params.x,
            y: params.y,
            extX: params.extX,
            extY: params.extY,
        };
    },

    createInstance(ctx) {
        var pool = new Array(MAX_PARTICLES);
        for (var i = 0; i < MAX_PARTICLES; i++) {
            pool[i] = {
                point: [0, 0, 0],
                intensity: 0,
                falloff: 30,
                color: [0, 0, 0],
                ox: 0, oz: 0,
                vx: 0, vz: 0,
                // alive is an explicit flag rather than the truthiness of
                // born, which is the documented filmstrip trap: a born time of
                // 0 makes `if (!q.born)` re-seed every particle every frame and
                // the layer renders black.
                alive: false,
                born: 0,
                death: 0,
                // Only the first birth is staggered. Without it every particle
                // is born on the same tick and the layer pulses in lockstep for
                // its first cycle — the filmstrip's warm-up hides that, the
                // live panel does not.
                virgin: true,
            };
        }

        function spawn(q, millis, p) {
            var speed = p.speed * (1 + (Math.random() - 0.5) * 2 * p.speedSpread);
            var theta = p.dir + (Math.random() - 0.5) * 2 * p.halfSpread;

            q.ox = p.x + (Math.random() - 0.5) * p.extX;
            q.oz = p.y + (Math.random() - 0.5) * p.extY;
            q.vx = X_STRETCH * speed * Math.cos(theta);
            q.vz = speed * Math.sin(theta);

            var hue = p.hueSpread >= 1
                ? Math.random()
                : p.h + p.hueSpread * (Math.random() - 0.5);
            q.color = color.hsv(hue, p.s, p.v);

            var delay = q.virgin ? Math.random() * p.life : 0;
            q.virgin = false;
            q.born = millis + delay;
            q.death = q.born + p.life * (1 + (Math.random() - 0.5) * 2 * p.lifeSpread);
            q.alive = true;
        }

        // Smoothstepped rise, linear fall. The fall is deliberately not
        // smoothstepped: it would leave a spark at 0.013 rather than 0.067 at
        // 95% of its life, and for a sparkler the tail is the visible streak.
        function envelope(f, swell) {
            if (f < 0 || f > 1) return 0;
            var rise = swell <= 0 ? 1 : smoothstep(f < swell ? f / swell : 1);
            var fall = swell >= 1 ? 1 : (1 - f) / (1 - swell);
            return rise * (fall > 1 ? 1 : fall);
        }

        return {
            render(out, millis, p) {
                var active = p.count;
                for (var i = 0; i < active; i++) {
                    var q = pool[i];
                    if (!q.alive) spawn(q, millis, p);

                    if (millis > q.death) {
                        q.intensity = 0;
                        q.alive = false;
                        continue;
                    }

                    var age = (millis - q.born) / 1000;
                    // Still inside its birth delay: nothing to draw yet, and
                    // integrating a negative age would fling it backwards.
                    if (age < 0) {
                        q.intensity = 0;
                        continue;
                    }

                    var half = 0.5 * age * age;
                    q.point[0] = q.ox + q.vx * age + p.ax * half;
                    // Everything above is in *param* space, where y is up —
                    // which is what the pad and the dials show. modelZ runs the
                    // other way (+0.875 is the bottom row), so negate on the
                    // write. This is the one place the two frames meet, and it
                    // is the same convention wavelet spells as dz = modelZ + y.
                    q.point[2] = -(q.oz + q.vz * age + p.az * half);
                    q.falloff = p.falloff;
                    q.intensity = envelope((millis - q.born) / (q.death - q.born), p.swell);
                }

                particles.renderParticles(out, pool, active, ctx.modelX, ctx.modelZ, ctx.numPixels);
            }
        };
    }
};
