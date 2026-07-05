import React from 'react';
import { sliderToValue, valueToSlider } from '../../lib/perceptual';

// Slider + numeric readout for a schema `number` entry. scale 'atan' uses
// the perceptual mapping (value range unbounded); 'linear' uses min/max.
export default function NumberControl({ entry, value, onChange, onCommit }) {
  const atan = entry.scale === 'atan';
  const sliderProps = atan
    ? { min: -10, max: 10, step: 0.01, value: valueToSlider(value) }
    : { min: entry.min, max: entry.max, step: entry.step || 0.01, value };

  return (
    <div className="control-row">
      <label className="control-label">{entry.label}</label>
      <input
        type="range"
        {...sliderProps}
        onChange={(e) => onChange(atan ? sliderToValue(Number(e.target.value)) : Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={(e) => { if (e.key.startsWith('Arrow')) onCommit(); }}
        aria-label={entry.label}
      />
      <span className="control-value">{Number(value).toFixed(2)}</span>
    </div>
  );
}
