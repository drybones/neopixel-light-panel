/*
 * Colour helpers shared by effects. Extracted from shader.js (hexToRgb)
 * and opc.js (hsv static) so effects don't depend on the OPC classes.
 */

var WHITE = { r: 255, g: 255, b: 255 };

// http://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb
//
// Anything unparseable answers `fallback`, white unless the caller says
// otherwise — right for ink, wrong for a ground, which is why text.js passes
// black for its background.
function hexToRgb(hex, fallback) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
        var f = fallback || WHITE;
        return { r: f.r, g: f.g, b: f.b };
    }
    return {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    };
}

// Channel clamps. clamp255 keeps the fraction, for float layer buffers and
// blend sources; toByte truncates on top, for anything headed out as a
// Uint8 (the WebSocket frames, the filmstrip bytes). NaN reads as 0 in toByte.
function clamp255(v) {
    return v < 0 ? 0 : (v > 255 ? 255 : v);
}

function toByte(v) {
    return v < 0 ? 0 : (v > 255 ? 255 : v | 0);
}

/*
 * Converts an HSV color value to RGB.
 * Normal hsv range is in [0, 1], RGB range is [0, 255].
 * Colors may extend outside these bounds. Hue values will wrap.
 * Based on tinycolor: https://github.com/bgrins/TinyColor
 */
//
// hsvInto writes into a caller-owned [r, g, b] and allocates nothing, which is
// the one to use from a render loop; hsv() is the allocating convenience for
// prepare() and other cold paths.
function hsvInto(out, h, s, v) {
    h = (h % 1) * 6;
    if (h < 0) h += 6;

    var i = h | 0,
        f = h - i,
        p = v * (1 - s),
        q = v * (1 - f * s),
        t = v * (1 - (1 - f) * s),
        r, g, b;

    switch (i) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        default: r = v; g = p; b = q;
    }

    out[0] = r * 255;
    out[1] = g * 255;
    out[2] = b * 255;
    return out;
}

function hsv(h, s, v) {
    return hsvInto([0, 0, 0], h, s, v);
}

/*
 * The inverse of hsv(), for effects whose params carry a hex swatch but whose
 * render works in hue: the emitter jitters hue per particle around the chosen
 * colour, and twinkle spreads a band of hues across its stars. Both need the
 * swatch decomposed once in prepare() so the hot loop only ever calls hsv().
 *
 * RGB in [0, 255], h/s/v out in [0, 1]. Grey has no hue, so h is 0 there —
 * arbitrary, but it keeps a hue jitter around a white swatch producing whites
 * rather than swinging through a ramp the user never asked for.
 */
function rgbToHsv(r, g, b) {
    var rn = r / 255, gn = g / 255, bn = b / 255;
    var max = Math.max(rn, gn, bn);
    var min = Math.min(rn, gn, bn);
    var d = max - min;

    var h = 0;
    if (d > 0) {
        if (max === rn) {
            h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        } else if (max === gn) {
            h = ((bn - rn) / d + 2) / 6;
        } else {
            h = ((rn - gn) / d + 4) / 6;
        }
    }

    return { h: h, s: max > 0 ? d / max : 0, v: max };
}

function hexToHsv(hex) {
    var rgb = hexToRgb(hex);
    return rgbToHsv(rgb.r, rgb.g, rgb.b);
}

module.exports = { hexToRgb, clamp255, toByte, hsv, hsvInto, rgbToHsv, hexToHsv };
