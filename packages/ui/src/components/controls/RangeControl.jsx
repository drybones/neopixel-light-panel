import React from 'react';
import NumField from './NumField';
import { sliderToValue, valueToSlider } from '../../lib/perceptual';

// Min/max slider pair (atan perceptual scale) for schema `range` entries —
// the old wavelet brightness control. Keeps min ≤ max while dragging.
export default function RangeControl({ entry, minValue, maxValue, onChange, onCommit }) {
  // Both the sliders and the typed fields go through these, so the invariant
  // holds however the value was entered: pushing one end past the other takes
  // the other end with it.
  function setMin(v) {
    onChange(v, Math.max(v, maxValue));
  }
  function setMax(v) {
    onChange(Math.min(v, minValue), v);
  }

  return (
    <div className="control-row">
      <label className="control-label">{entry.label}</label>
      <NumField
        value={Number(minValue)}
        label={`${entry.label} minimum`}
        onChange={setMin}
        onCommit={onCommit}
      />
      <input
        type="range" min="-10" max="10" step="0.01"
        value={valueToSlider(minValue)}
        onChange={(e) => setMin(sliderToValue(Number(e.target.value)))}
        onPointerUp={onCommit}
        aria-label={`${entry.label} minimum slider`}
      />
      <input
        type="range" min="-10" max="10" step="0.01"
        value={valueToSlider(maxValue)}
        onChange={(e) => setMax(sliderToValue(Number(e.target.value)))}
        onPointerUp={onCommit}
        aria-label={`${entry.label} maximum slider`}
      />
      <NumField
        value={Number(maxValue)}
        label={`${entry.label} maximum`}
        onChange={setMax}
        onCommit={onCommit}
      />
    </div>
  );
}
