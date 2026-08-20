// Turns a /api/fps snapshot into what the header pill shows. Pure, so the
// interesting cases — idle, a loop falling behind, sub-millisecond renders —
// are testable without mounting anything.

// Share of late frames at which the pill goes from green to red. One dropped
// frame a second is not something you can see on a 100 fps panel; a twentieth
// of them is.
const LATE_SLOW_PERCENT = 5;
// ...and where it goes from green to amber. This is the band that has to be
// argued rather than copied from the one above: setInterval(10) clamps to
// ~91 fps, so a single late frame a second is already 1.1% and an amber at
// 1% would sit lit on a perfectly healthy loop — the same trap that keeps
// the rate from being compared against targetFps at all. 2% is about two
// late frames a second, clear of ordinary jitter but still well below the
// twentieth that reads as red.
const LATE_NEAR_PERCENT = 2;

// How far past the nominal frame time the loop can drift before the pill
// warns, and then complains. Both are generous on purpose (see the comment
// beside the tests): the amber is simply the softer half of a threshold that
// was already chosen not to fire on a clamped timer.
const BEHIND_SLOW_FACTOR = 1.33;
const BEHIND_NEAR_FACTOR = 1.15;

// The share of the frame budget our own work can take before the same.
const CROWDED_SLOW_FRACTION = 0.8;
const CROWDED_NEAR_FRACTION = 0.6;

// A healthy render is a fraction of a millisecond, so a fixed 1 decimal
// reports the good case as a flat "0.0 ms" and says nothing about how much
// of the 10ms budget is left.
export function formatMs(value) {
  if (value === null || value === undefined) return '–';
  return `${value < 1 ? value.toFixed(2) : value.toFixed(1)} ms`;
}

function num(value, digits) {
  return value === null || value === undefined ? '–' : value.toFixed(digits);
}

// The share of frames that landed late, over the server's rolling window.
// A 10s window at ~91 fps holds ~900 frames, so the smallest rate that can
// occur is about a tenth of a percent — but rounding a real stall to
// "0.0% late" would say the opposite of what happened, so anything non-zero
// keeps a floor.
export function formatLatePercent(value) {
  if (value === null || value === undefined) return '–';
  if (value === 0) return '0%';
  if (value < 0.1) return '<0.1%';
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)}%`;
}

/*
 * state is one of:
 *   'off'   — tracker disabled, the resting state
 *   'idle'  — enabled, but nothing has rendered lately. With no scene active
 *             the loop renders one black frame and stops, which is correct;
 *             showing 0 fps for it would read as a fault.
 *   'ok'    — keeping up
 *   'near'  — keeping up, but with less room than it had
 *   'slow'  — actually behind, or eating the frame budget
 *   'wait'  — enabled, no reading yet
 */
export function describeFrameRate(snap, isVirtual) {
  if (!snap || !snap.enabled) {
    return {
      state: 'off',
      label: 'fps',
      detail: '',
      title: 'Show the render loop’s measured frame rate',
    };
  }

  const targetMs = 1000 / (snap.targetFps || 100);
  let state;
  let label;
  if (snap.idle) {
    state = 'idle';
    label = 'idle';
  } else if (snap.fps === null || snap.fps === undefined) {
    state = 'wait';
    label = '…';
  } else {
    label = `${num(snap.fps, 1)} fps`;
    // Deliberately not "did it hit targetFps": setInterval clamps, so a 10ms
    // timer settles around 91 fps on a perfectly healthy machine and a strict
    // comparison would sit permanently red. What matters is whether the loop
    // is falling behind, or whether our own work is eating its budget.
    const behind = snap.frameMs > targetMs * BEHIND_SLOW_FACTOR;
    const crowded = snap.tickMs > targetMs * CROWDED_SLOW_FRACTION;
    // A loop can drop frames in bursts and still average out fine over one
    // second, so the rate gets its own test. The threshold is well clear of
    // ordinary jitter for the same reason the others are loose: a pill that
    // sits red says nothing. It matters most on a phone, where the detail
    // line is hidden and a tooltip cannot be hovered — the colour is then
    // the only thing lateness can show up in.
    const stumbling = snap.latePercent >= LATE_SLOW_PERCENT;
    // Each test has a softer twin, so the colour can say "watch this" before
    // it says "this is wrong" — again for the phone, where the number's
    // colour is the whole readout.
    const drifting = snap.frameMs > targetMs * BEHIND_NEAR_FACTOR;
    const filling = snap.tickMs > targetMs * CROWDED_NEAR_FRACTION;
    const slipping = snap.latePercent >= LATE_NEAR_PERCENT;
    if (behind || crowded || stumbling) state = 'slow';
    else if (drifting || filling || slipping) state = 'near';
    else state = 'ok';
  }

  const detail = [];
  if (snap.renderMs !== null && snap.renderMs !== undefined) detail.push(formatMs(snap.renderMs));
  // A rate, not a running total: it appears when the loop starts stumbling
  // and goes away again when it recovers, so the pill saying nothing is the
  // good case rather than an old number nobody can date.
  if (snap.latePercent > 0) detail.push(`${formatLatePercent(snap.latePercent)} late`);

  const windowSeconds = Math.round((snap.lateWindowMs || 0) / 1000);
  const title = [
    `Render loop: ${num(snap.fps, 1)} fps measured, ${num(snap.targetFps, 0)} fps nominal `
      + '(setInterval clamps, so a healthy loop sits a little under).',
    `Render ${formatMs(snap.renderMs)}, whole tick ${formatMs(snap.tickMs)} per frame `
      + `(worst render ${formatMs(snap.worstRenderMs)}).`,
    // Both figures, because they answer different questions — is it stumbling
    // now, and has it stumbled at all. The window is named: a bare percentage
    // is a share of an unstated denominator.
    snap.windowFrames
      ? `${formatLatePercent(snap.latePercent)} of frames late over the last ${windowSeconds}s `
        + `(${snap.lateFrames} of ${snap.windowFrames}).`
      : '',
    `${snap.overruns || 0} late frame${snap.overruns === 1 ? '' : 's'} of ${snap.frames || 0} `
      + 'since this scene became active — the tracker restarts when you switch scenes, since '
      + 'render cost is a property of the scene.',
    snap.idle ? 'Idle: no scene is rendering, so these are the last figures taken.' : '',
    isVirtual
      ? 'Dev mode: same loop and compositor, but no hardware write — not comparable to the panel.'
      : '',
    'This is the panel’s frame rate, not the preview stream’s (which is throttled to ~30 fps).',
  ].filter(Boolean).join('\n');

  return { state, label, detail: detail.join(' · '), title };
}
