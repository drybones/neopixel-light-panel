import React from 'react';
import { sliderToValue, valueToSlider } from '../../lib/perceptual';

// Min/max slider pair (atan perceptual scale) for schema `range` entries —
// the old wavelet brightness control. Keeps min ≤ max while dragging.
export default function RangeControl({ entry, minValue, maxValue, onChange, onCommit }) {
  function handleMin(sliderValue) {
    const v = sliderToValue(sliderValue);
    onChange(v, Math.max(v, maxValue));
  }
  function handleMax(sliderValue) {
    const v = sliderToValue(sliderValue);
    onChange(Math.min(v, minValue), v);
  }

  return (
    <div className="control-row">
      <label className="control-label">{entry.label}</label>
      <span className="control-value control-value--left">{Number(minValue).toFixed(2)}</span>
      <input
        type="range" min="-10" max="10" step="0.01"
        value={valueToSlider(minValue)}
        onChange={(e) => handleMin(Number(e.target.value))}
        onPointerUp={onCommit}
        aria-label={`${entry.label} minimum`}
      />
      <input
        type="range" min="-10" max="10" step="0.01"
        value={valueToSlider(maxValue)}
        onChange={(e) => handleMax(Number(e.target.value))}
        onPointerUp={onCommit}
        aria-label={`${entry.label} maximum`}
      />
      <span className="control-value">{Number(maxValue).toFixed(2)}</span>
    </div>
  );
}
