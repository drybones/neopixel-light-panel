// Turns a /api/fps snapshot into what the header pill shows. Pure, so the
// interesting cases — idle, a loop falling behind, sub-millisecond renders —
// are testable without mounting anything.

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

/*
 * state is one of:
 *   'off'   — tracker disabled, the resting state
 *   'idle'  — enabled, but nothing has rendered lately. With no scene active
 *             the loop renders one black frame and stops, which is correct;
 *             showing 0 fps for it would read as a fault.
 *   'ok'    — keeping up
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
    const behind = snap.frameMs > targetMs * 1.33;
    const crowded = snap.tickMs > targetMs * 0.8;
    state = behind || crowded ? 'slow' : 'ok';
  }

  const detail = [];
  if (snap.renderMs !== null && snap.renderMs !== undefined) detail.push(formatMs(snap.renderMs));
  if (snap.overruns > 0) detail.push(`${snap.overruns} late`);

  const title = [
    `Render loop: ${num(snap.fps, 1)} fps measured, ${num(snap.targetFps, 0)} fps nominal `
      + '(setInterval clamps, so a healthy loop sits a little under).',
    `Render ${formatMs(snap.renderMs)}, whole tick ${formatMs(snap.tickMs)} per frame `
      + `(worst render ${formatMs(snap.worstRenderMs)}).`,
    `${snap.overruns || 0} late frames of ${snap.frames || 0} since the tracker was switched on.`,
    snap.idle ? 'Idle: no scene is rendering, so these are the last figures taken.' : '',
    isVirtual
      ? 'Dev mode: same loop and compositor, but no hardware write — not comparable to the panel.'
      : '',
    'This is the panel’s frame rate, not the preview stream’s (which is throttled to ~30 fps).',
  ].filter(Boolean).join('\n');

  return { state, label, detail: detail.join(' · '), title };
}
