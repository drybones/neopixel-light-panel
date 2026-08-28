import React from 'react';

// Segmented buttons for schema `enum` entries (and blend modes).
//
// `groups` is the multi-row form: each entry is its own row of buttons, and
// the rows sit in a column that is a single flex item beside the label. That
// is the whole point of it — a long flat `options` list is one item whose
// max-content width exceeds the row, so .control-row's wrap drops it below the
// label and back to the page margin before shrinking is ever considered. The
// column can shrink instead, so the first row stays beside the label and any
// row too wide for the panel wraps inside its own indent.
export default function EnumSelect({ label, options, groups, onChange, value }) {
  const rows = groups || [options];
  const multi = Boolean(groups);
  return (
    <div className={`control-row${multi ? ' control-row--groups' : ''}`}>
      {label && <label className="control-label">{label}</label>}
      <div
        className={multi ? 'segmented-groups' : 'segmented'}
        role="group"
        aria-label={label}
      >
        {rows.map((row, i) => {
          const buttons = row.map((opt) => (
            <button
              key={opt.value}
              className={`segmented-item${opt.value === value ? ' segmented-item--on' : ''}`}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          ));
          return multi ? <div className="segmented" key={i}>{buttons}</div> : buttons;
        })}
      </div>
    </div>
  );
}
