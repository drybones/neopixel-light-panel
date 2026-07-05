import React, { useState } from 'react';
import { HexColorPicker } from 'react-colorful';

const SWATCHES = ['#ffffff', '#ff5e3a', '#ffd23f', '#2ee6a8', '#3fd0ff', '#4f8bff', '#b44fff', '#ff3fa4'];

// Swatch row + full picker for schema `color` entries.
export default function ColorControl({ label, value, onChange, onCommit }) {
  const [open, setOpen] = useState(false);

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
            className={`color-swatch${value.toLowerCase() === c ? ' color-swatch--on' : ''}`}
            style={{ background: c }}
            onClick={() => pick(c)}
            aria-label={`Set colour ${c}`}
          />
        ))}
        <button
          className="color-swatch color-swatch--custom"
          style={{ background: value }}
          onClick={() => setOpen(!open)}
          aria-label="Custom colour picker"
        >
          <span aria-hidden="true">◐</span>
        </button>
      </div>
      {open && (
        <div className="color-popover">
          <div className="color-popover-backdrop" onClick={() => { setOpen(false); if (onCommit) onCommit(); }} />
          <HexColorPicker color={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
