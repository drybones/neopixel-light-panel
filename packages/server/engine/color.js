/*
 * Colour helpers shared by effects. Extracted from shader.js (hexToRgb)
 * and opc.js (hsv static) so effects don't depend on the OPC classes.
 */

// http://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb
function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 255, g: 255, b: 255 };
}

/*
 * Converts an HSV color value to RGB.
 * Normal hsv range is in [0, 1], RGB range is [0, 255].
 * Colors may extend outside these bounds. Hue values will wrap.
 * Based on tinycolor: https://github.com/bgrins/TinyColor
 */
function hsv(h, s, v) {
    h = (h % 1) * 6;
    if (h < 0) h += 6;

    var i = h | 0,
        f = h - i,
        p = v * (1 - s),
        q = v * (1 - f * s),
        t = v * (1 - (1 - f) * s),
        r = [v, q, p, p, t, v][i],
        g = [t, v, v, q, p, p][i],
        b = [p, p, t, v, v, q][i];

    return [r * 255, g * 255, b * 255];
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

module.exports = { hexToRgb, hsv, rgbToHsv, hexToHsv };
