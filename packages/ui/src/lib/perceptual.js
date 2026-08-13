// Perceptual (arctangent) scaling for brightness sliders. Slider positions
// map non-linearly to values so equal slider movements feel like equal
// brightness changes.
export const sliderScalingParam = 6.7975;

export function sliderToValue(sliderValue) {
  return Math.tan(sliderValue / sliderScalingParam);
}

export function valueToSlider(value) {
  return sliderScalingParam * Math.atan(value);
}

// Logarithmic scaling for the params that span decades — wavelength, the
// speeds, noise scale/contrast, the ambient glow floors. Equal slider travel
// means equal *ratio* change, which is what those quantities actually want:
// a linear track spends most of itself on a range you never use and leaves
// the useful band a hair-trigger. See the schema entries carrying scale:'log'.
//
// The track is integer positions rather than a fractional value, which avoids
// float-step artefacts and gives ~0.7%/step over three decades — finer than
// any of the linear steps it replaces.
export const LOG_STEPS = 1000;

// `zeroable` reserves position 0 for an exact 0 and spreads the log range
// over 1…LOG_STEPS. Params like freq and glow are stored as 0 in real scenes
// ("frozen", "no floor"), and a log scale cannot otherwise express it.
export function logToValue(pos, min, max, zeroable) {
  if (zeroable) {
    if (pos <= 0) return 0;
    return min * Math.pow(max / min, (pos - 1) / (LOG_STEPS - 1));
  }
  return min * Math.pow(max / min, pos / LOG_STEPS);
}

export function valueToLog(value, min, max, zeroable) {
  const span = Math.log(max / min);
  if (zeroable) {
    if (!(value > 0)) return 0;
    // Clamped to 1, not 0: a value between 0 and min must pin to the first
    // lit position, so "nearly off" never reads on the track as "off".
    return clamp(1 + (LOG_STEPS - 1) * (Math.log(value / min) / span), 1, LOG_STEPS);
  }
  if (!(value > 0)) return 0;
  return clamp(LOG_STEPS * (Math.log(value / min) / span), 0, LOG_STEPS);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}
