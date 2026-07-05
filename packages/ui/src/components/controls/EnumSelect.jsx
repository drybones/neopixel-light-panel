import React from 'react';

// Segmented buttons for schema `enum` entries (and blend modes).
export default function EnumSelect({ label, options, value, onChange }) {
  return (
    <div className="control-row">
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
