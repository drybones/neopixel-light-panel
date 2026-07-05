// Perceptual (arctangent) scaling for brightness sliders, moved verbatim
// from the old App.jsx. Slider positions map non-linearly to values so
// equal slider movements feel like equal brightness changes.
export const sliderScalingParam = 6.7975;

export function sliderToValue(sliderValue) {
  return Math.tan(sliderValue / sliderScalingParam);
}

export function valueToSlider(value) {
  return sliderScalingParam * Math.atan(value);
}
