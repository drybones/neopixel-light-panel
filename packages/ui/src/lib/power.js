// Turns a /api/power snapshot into what the header pill shows. Pure, so the
// states that are awkward to reach in a browser — idle, actively limiting, a
// budget below the panel's own standby draw — are testable without mounting
// anything, and without a panel.

// The point where the pill starts warning rather than reassuring.
const NEAR_FRACTION = 0.85;

export function formatAmps(milliamps) {
  if (milliamps === null || milliamps === undefined) return '–';
  // Below an amp the interesting digits are the hundreds of mA; above it,
  // amps with one decimal is all anyone acts on.
  return milliamps < 1000 ? `${Math.round(milliamps)} mA` : `${(milliamps / 1000).toFixed(1)} A`;
}

/*
 * state is one of:
 *   'off'      — collapsed by the user, the same resting shape as the
 *                frame-rate pill's 'off'. Display only: the server measures
 *                unconditionally and the limiter runs either way, so nothing
 *                here reaches /api/power.
 *   'wait'     — no reading yet
 *   'idle'     — nothing has rendered lately. With no scene active the loop
 *                renders one black frame and stops, so the figures are the
 *                last ones taken, not a live claim about a dark panel.
 *   'ok'       — comfortably inside the budget
 *   'near'     — inside it, but not by much
 *   'limiting' — frames are being pulled back right now
 *   'floored'  — the budget is below what the panel draws doing nothing, so
 *                dimming cannot reach it. A misconfiguration, not a load.
 */
export function describePower(snap, shown = true) {
  // Collapse is absolute — a folded pill says nothing, not even that the
  // limiter is engaged. The alternative was to let 'limiting' and 'floored'
  // push it back open, which would have kept the poll running while
  // collapsed, i.e. the whole cost the collapse saves. The budget is set
  // once against a supply chosen to cover most scenes; the expanded pill is
  // for finding the extreme ones and tuning it, and can be put away after.
  if (!shown) {
    return { state: 'off', label: 'power', detail: '', title: 'Show the panel’s power draw' };
  }
  if (!snap) {
    return { state: 'wait', label: '…', detail: '', title: 'Panel power draw' };
  }

  const { milliamps, budgetMilliamps } = snap;

  let state;
  if (snap.floored) state = 'floored';
  else if (milliamps === null || milliamps === undefined) state = 'wait';
  else if (snap.idle) state = 'idle';
  else if (snap.limiting) state = 'limiting';
  else if (budgetMilliamps > 0 && milliamps / budgetMilliamps > NEAR_FRACTION) state = 'near';
  else state = 'ok';

  const label = state === 'wait' ? '…' : formatAmps(milliamps);

  const detail = [];
  if (state === 'limiting') detail.push('limited');
  else if (state === 'idle') detail.push('idle');
  else if (state === 'floored') detail.push('budget too low');

  const headroom = budgetMilliamps > 0 && milliamps !== null && milliamps !== undefined
    ? `${Math.round((milliamps / budgetMilliamps) * 100)}% of budget`
    : null;

  const title = [
    `Panel drawing ${formatAmps(milliamps)} of a ${formatAmps(budgetMilliamps)} budget`
      + (headroom ? ` (${headroom}).` : '.'),
    snap.requestedMilliamps > milliamps
      ? `The scene is asking for ${formatAmps(snap.requestedMilliamps)}; frames are being scaled back to fit.`
      : '',
    `Limited by the ${formatAmps(snap.maxMilliamps)} supply, less ${formatAmps(snap.overheadMilliamps)} reserved for the Pi.`,
    snap.idle ? 'Idle: no scene is rendering, so these are the last figures taken.' : '',
    snap.floored ? 'The budget is below the panel’s idle draw — dimming cannot reach it. Check the configuration.' : '',
    !snap.limit ? 'Measuring only: the limiter is switched off, so frames are not being scaled.' : '',
    // WLED carries this warning in capitals in its own source, and it is the
    // honest thing to say: this is arithmetic over LED datasheet figures,
    // not a shunt.
    'This is an estimate from datasheet figures, not a measurement.',
  ].filter(Boolean).join('\n');

  return { state, label, detail: detail.join(' · '), title };
}
