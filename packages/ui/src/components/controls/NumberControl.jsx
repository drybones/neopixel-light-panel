import React from 'react';
import NumField from './NumField';
import { sliderToValue, valueToSlider, logToValue, valueToLog, LOG_STEPS } from '../../lib/perceptual';

// Slider + numeric entry for a schema `number` entry. scale 'atan' uses the
// perceptual mapping (value range unbounded); 'log' spreads min/max over
// decades on an integer track; 'linear' uses min/max directly.
//
// The field is deliberately not clamped to the schema's min/max: preset data
// carries values well outside what some sliders can express (see lambda), and
// typing is then the only way to put one back after a stray drag. It shows the
// value, never the slider position — those differ under atan and log alike.
export default function NumberControl({ entry, value, onChange, onCommit }) {
  const atan = entry.scale === 'atan';
  const log = entry.scale === 'log';
  // A log track is in integer positions, so entry.step doesn't apply to it —
  // the resolution comes from LOG_STEPS across the range instead.
  const sliderProps = atan
    ? { min: -10, max: 10, step: 0.01, value: valueToSlider(value) }
    : log
      ? { min: 0, max: LOG_STEPS, step: 1, value: valueToLog(value, entry.min, entry.max, entry.zeroable) }
      : { min: entry.min, max: entry.max, step: entry.step || 0.01, value };

  function fromSlider(raw) {
    const n = Number(raw);
    if (atan) return sliderToValue(n);
    if (log) return logToValue(n, entry.min, entry.max, entry.zeroable);
    return n;
  }

  return (
    <div className="control-row">
      <label className="control-label">{entry.label}</label>
      <input
        type="range"
        {...sliderProps}
        onChange={(e) => onChange(fromSlider(e.target.value))}
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
