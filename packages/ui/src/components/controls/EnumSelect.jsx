import React from 'react';

// Segmented buttons for schema `enum` entries (and blend modes).
//
// The row carries `control-row--enum` so a long option list wraps inside the
// control column instead of being dropped below the label and back to the page
// margin — see the CSS, which is where that behaviour actually lives.
export default function EnumSelect({ label, options, value, onChange }) {
  return (
    <div className="control-row control-row--enum">
      {label && <label className="control-label">{label}</label>}
      <div className="segmented" role="group" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value}
            className={`segmented-item${opt.value === value ? ' segmented-item--on' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
