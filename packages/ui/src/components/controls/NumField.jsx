import React from 'react';
import DraftField from './DraftField';
import { formatNumber, parseNumber } from '../../lib/numberFormat';

// Numeric flavour of DraftField — the pad's x/y, the dial's degrees and every
// slider's value. Formatting lives in lib/numberFormat so it can be tested
// directly; see there for why it isn't a flat two decimal places.

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
