/*
 * Twinkle — random pixels swell and fade like slow stars. Per-pixel
 * phase/period state lives in the instance; density decides how many
 * pixels take part.
 *
 * This is not a particle system and deliberately did not fold into `emitter`:
 * nothing here moves, is born, or dies. A star is a per-pixel oscillator, and
 * expressing 240 of them as stationary long-lived particles would cost a
 * 240x240 distance loop to reproduce something this does in one pass.
 */

var color = require('../engine/color');

// How many hues the spread is quantised into. The stars each hold a stable
// per-pixel random already (the density lottery), so a LUT indexed by it keeps
// the hot loop a table lookup and allocates nothing — the alternative was an
// hsv() call per pixel per frame. 32 steps across a spread of 1 is ~11 degrees
// of hue apart, finer than the eye separates at these brightnesses.
var HUE_STEPS = 32;

function buildPalette(hex, spread) {
    var base = color.hexToHsv(hex);
    var lut = new Float32Array(HUE_STEPS * 3);
    for (var i = 0; i < HUE_STEPS; i++) {
        // Symmetric about the chosen colour, so widening the spread does not
        // slide the average hue off the swatch.
        var offset = spread * ((i / (HUE_STEPS - 1)) - 0.5);
        var rgb = color.hsv(base.h + offset, base.s, base.v);
        lut[i * 3] = rgb[0];
        lut[i * 3 + 1] = rgb[1];
        lut[i * 3 + 2] = rgb[2];
    }
    return lut;
}

module.exports = {
    type: 'twinkle',
    name: 'Twinkle',
    schema: [
        { key: 'color', type: 'color', label: 'Colour' },
        // 0 is every star the same colour — the default.
        { key: 'hueSpread', type: 'number', label: 'Hue spread', min: 0, max: 1, step: 0.01, scale: 'linear', zeroable: true, modulatable: true },
        { key: 'density', type: 'number', label: 'Density', min: 0.02, max: 1, step: 0.01, scale: 'linear', modulatable: true },
        { key: 'speed', type: 'number', label: 'Speed', min: 0.05, max: 5, scale: 'log', modulatable: true },
        // Log because the interesting range is 1 (a soft sine swell) to about
        // 16 (a hard blink), and the difference between 1 and 2 is far bigger
        // than between 12 and 16.
        { key: 'sharpness', type: 'number', label: 'Sharpness', min: 0.5, max: 16, scale: 'log', modulatable: true },
        { key: 'background', type: 'number', label: 'Backglow', min: 0.01, max: 0.5, scale: 'log', zeroable: true, modulatable: true },
    ],
    defaults: {
        color: '#ffe9c4',
        hueSpread: 0,
        density: 0.25,
        speed: 1,
        sharpness: 4,
        background: 0.02,
    },

    prepare(params) {
        var rgb = color.hexToRgb(params.color);
        return {
            r: rgb.r, g: rgb.g, b: rgb.b,
            // Only built when it would do something. A spread of 0 keeps the
            // single-colour path, which is both what every stored layer wants
            // and one less indirection in the loop.
            palette: params.hueSpread > 0 ? buildPalette(params.color, params.hueSpread) : null,
            density: params.density,
            speed: params.speed,
            sharpness: params.sharpness,
            background: params.background,
            // The swell is scaled into the headroom *above* the backglow
            // rather than added on top of it, so a star at peak is exactly
            // the configured colour for any backglow (issue #94). Added on
            // top, the peak was 1 + background: at the default 0.02 only red
            // clipped in the sink, so the brightest moment of a star was a
            // desaturated version of the swatch. Clamped at 0 because typed
            // entry is deliberately unclamped — a backglow past 1 is already
            // over full, and nothing above it is left to swell into.
            swell: Math.max(0, 1 - params.background),
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
                var lut = p.palette;
                for (var i = 0; i < n; i++) {
                    var level = p.background;
                    if (lottery[i] < p.density) {
                        var s = Math.sin(phase[i] + t * Math.PI * 2 / period[i]);
                        // Sharpen so pixels are dark most of the cycle.
                        // Math.pow is the price of a per-layer exponent,
                        // paid only on the lit pixels.
                        if (s > 0) level += p.swell * Math.pow(s, p.sharpness);
                    }

                    var r = p.r, g = p.g, b = p.b;
                    if (lut) {
                        // Reuses the density lottery as the hue draw. The two
                        // are correlated as a result — a star's colour is tied
                        // to how likely it was to be lit at all — but the
                        // lottery is uniform, so the hues still come out evenly
                        // spread across whichever stars are taking part.
                        var li = (lottery[i] * HUE_STEPS) | 0;
                        if (li >= HUE_STEPS) li = HUE_STEPS - 1;
                        r = lut[li * 3];
                        g = lut[li * 3 + 1];
                        b = lut[li * 3 + 2];
                    }
                    out[i * 3] = r * level;
                    out[i * 3 + 1] = g * level;
                    out[i * 3 + 2] = b * level;
                }
            }
        };
    }
};
