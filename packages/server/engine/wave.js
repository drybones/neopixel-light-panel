/*
 * What wavelet and planewave share. They differ only in the distance term that
 * builds theta — radial against projected — which is the whole of plane wave's
 * claim to be wavelet's far-field limit, so everything either side of that
 * term lives here once rather than twice.
 */

const clamp255 = require('./color').clamp255;

// 2π/1000 to three figures, so `freq` is (very nearly) hertz. The truncated
// value is shader.js's, and kept: test/compositor.test.js pins wavelet
// byte-for-byte against that original loop.
const RAD_PER_MS = 0.00628;

// Floor for a lambda of 0, which the unclamped typed field allows. Far below
// the LED pitch, so it renders as the same per-pixel speckle as any other
// sub-Nyquist wavelength rather than changing the look.
const MIN_LAMBDA = 1e-6;

// The time half of theta, once per frame.
function phase(millis, p) {
    return millis * RAD_PER_MS * p.freq + p.delta;
}

// One pixel: theta onto the min..max brightness band, times the colour,
// clamped per layer to [0, 255].
function shade(out, i, theta, p) {
    const brightness = p.min + (p.max - p.min) * 0.5 * (Math.sin(theta) + 1);
    out[i * 3] = clamp255(p.r * brightness);
    out[i * 3 + 1] = clamp255(p.g * brightness);
    out[i * 3 + 2] = clamp255(p.b * brightness);
}

module.exports = { RAD_PER_MS, MIN_LAMBDA, phase, shade };
