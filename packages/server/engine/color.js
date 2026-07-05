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

module.exports = { hexToRgb, hsv };
