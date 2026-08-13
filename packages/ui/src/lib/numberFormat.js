// How a number reads in the value column beside every drag control.
//
// Two decimal places down to 1, then three significant figures below it. The
// log sliders reach 0.001 (the glow floors) and 0.002 (gradient drift), and a
// flat 2dp would show those as "0" — and a speed of 0.005 as "0.01", which is
// worse than useless because it looks like a real reading. Values at or above
// 1 use plain 2dp formatting, which covers everything the position pad and
// the angle dial produce.
export function formatNumber(v) {
  if (!Number.isFinite(v)) return '';
  if (v === 0) return '0';
  if (Math.abs(v) >= 1) return String(Math.round(v * 100) / 100);
  return String(Number(v.toPrecision(3)));
}

// parseFloat with no bounds check, deliberately: the typed field is the only
// way back to a preset value no slider can reach. `null` means unreadable,
// which DraftField takes as "abandon the edit".
export function parseNumber(text) {
  const parsed = parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}
