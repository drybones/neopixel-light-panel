import React from 'react';
import DraftField from './DraftField';

// Numeric flavour of DraftField — the pad's x/y, the dial's degrees and every
// slider's value. Two decimal places unless the caller formats it itself.
const formatNumber = (v) => String(Math.round(v * 100) / 100);

function parseNumber(text) {
  const parsed = parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function NumField({ value, label, onChange, onCommit, format, width }) {
  return (
    <DraftField
      value={value}
      label={label}
      format={format || formatNumber}
      parse={parseNumber}
      onChange={onChange}
      onCommit={onCommit}
      width={width}
      inputMode="decimal"
    />
  );
}
