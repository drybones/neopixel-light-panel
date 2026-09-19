import React, { useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import DraftField from './DraftField';
import { formatHex, parseHex } from '../../lib/colors';

const SWATCHES = ['#ffffff', '#ff5e3a', '#ffd23f', '#2ee6a8', '#3fd0ff', '#4f8bff', '#b44fff', '#ff3fa4'];

// Swatch row + hex field + full picker for schema `color` entries.
export default function ColorControl({ label, value: raw, onChange, onCommit }) {
  const [open, setOpen] = useState(false);
  // The server coerces params on every write and on load, so this should
  // always be a string — but a missing one threw on toLowerCase() and took
  // the whole editor with it. Black is what a bad colour renders as anyway.
  const value = typeof raw === 'string' ? raw : '#000000';

  function pick(hex) {
    onChange(hex);
    if (onCommit) onCommit();
  }

  return (
    <div className="control-row control-row--color">
      <label className="control-label">{label}</label>
      <div className="color-swatches">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={`color-swatch${value.toLowerCase() === c ? ' color-swatch--on' : ''}`}
            style={{ background: c }}
            onClick={() => pick(c)}
            aria-label={`Set colour ${c}`}
          />
        ))}
        <button
          type="button"
          className="color-swatch color-swatch--custom"
          style={{ background: value }}
          onClick={() => setOpen(!open)}
          aria-label="Custom colour picker"
        >
          <span aria-hidden="true">◐</span>
        </button>
      </div>
      <DraftField
        value={value}
        label={`${label} hex`}
        format={formatHex}
        parse={parseHex}
        onChange={onChange}
        onCommit={onCommit}
        width={70}
      />
      {open && (
        <div className="color-popover">
          <div className="color-popover-backdrop" onClick={() => { setOpen(false); if (onCommit) onCommit(); }} />
          <HexColorPicker color={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
