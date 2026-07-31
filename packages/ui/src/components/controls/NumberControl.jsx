import React from 'react';
import NumField from './NumField';
import { sliderToValue, valueToSlider } from '../../lib/perceptual';

// Slider + numeric entry for a schema `number` entry. scale 'atan' uses
// the perceptual mapping (value range unbounded); 'linear' uses min/max.
//
// The field is deliberately not clamped to the schema's min/max: preset data
// carries values well outside what some sliders can express (see lambda), and
// typing is then the only way to put one back after a stray drag. It shows the
// value, never the slider position — those differ under the atan scale.
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
      <NumField
        value={Number(value)}
        label={`${entry.label} value`}
        onChange={onChange}
        onCommit={onCommit}
      />
    </div>
  );
}
