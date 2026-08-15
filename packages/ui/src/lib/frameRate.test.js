import { describe, it, expect } from 'vitest';
import { describeFrameRate, formatMs, formatLatePercent } from './frameRate';

// A healthy dev-machine reading: setInterval(10) clamps to ~11ms, so ~91 fps
// with the render itself taking almost none of the budget.
const healthy = {
  enabled: true,
  targetFps: 100,
  idle: false,
  fps: 91.6,
  frameMs: 10.9,
  renderMs: 0.02,
  tickMs: 0.08,
  worstFrameMs: 11.5,
  worstRenderMs: 0.05,
  overruns: 0,
  frames: 1200,
  latePercent: 0,
  lateFrames: 0,
  windowFrames: 910,
  lateWindowMs: 10000,
};

describe('formatMs', () => {
  it('keeps sub-millisecond detail instead of collapsing to 0.0', () => {
    expect(formatMs(0.023)).toBe('0.02 ms');
    expect(formatMs(0.4)).toBe('0.40 ms');
  });

  it('drops to one decimal once the numbers are big enough to matter', () => {
    expect(formatMs(4.25)).toBe('4.3 ms');
  });

  it('renders a missing figure rather than NaN', () => {
    expect(formatMs(null)).toBe('–');
    expect(formatMs(undefined)).toBe('–');
  });
});

describe('formatLatePercent', () => {
  it('keeps a real stall visible instead of rounding it to zero', () => {
    expect(formatLatePercent(0.04)).toBe('<0.1%');
    expect(formatLatePercent(0)).toBe('0%');
  });

  it('loses the decimal once the loop is in real trouble', () => {
    expect(formatLatePercent(4.23)).toBe('4.2%');
    expect(formatLatePercent(31.6)).toBe('32%');
  });

  it('renders a missing figure rather than NaN', () => {
    expect(formatLatePercent(null)).toBe('–');
  });
});

describe('describeFrameRate', () => {
  it('is off and says nothing before the tracker is switched on', () => {
    const d = describeFrameRate({ enabled: false }, false);
    expect(d.state).toBe('off');
    expect(d.label).toBe('fps');
    expect(d.detail).toBe('');
  });

  it('treats a missing snapshot as off rather than throwing', () => {
    expect(describeFrameRate(null, false).state).toBe('off');
  });

  it('reads a clamped-timer rate as healthy, not as a shortfall', () => {
    // 91.6 of a nominal 100 is what a correct loop looks like; flagging it
    // would leave the pill permanently red.
    const d = describeFrameRate(healthy, true);
    expect(d.state).toBe('ok');
    expect(d.label).toBe('91.6 fps');
    expect(d.detail).toBe('0.02 ms');
  });

  it('flags a loop that is genuinely behind', () => {
    const d = describeFrameRate({ ...healthy, fps: 60, frameMs: 16.7 }, false);
    expect(d.state).toBe('slow');
  });

  it('flags work that is eating the frame budget even while the rate holds', () => {
    // Still ~91 fps, but 8.5ms of a 10ms tick is spent in our own render —
    // the panel is one heavier layer away from dropping frames.
    const d = describeFrameRate({ ...healthy, renderMs: 8.2, tickMs: 8.5 }, false);
    expect(d.state).toBe('slow');
    expect(d.detail).toBe('8.2 ms');
  });

  it('flags a loop dropping frames in bursts that the average absorbs', () => {
    // 91.6 fps and a 0.02ms render: both other tests say healthy. One frame
    // in twelve is still being dropped, and on a phone the colour is the only
    // place that can show.
    const d = describeFrameRate({ ...healthy, latePercent: 8.3, lateFrames: 76 }, false);
    expect(d.state).toBe('slow');
  });

  it('does not go red over the odd coalesced tick', () => {
    expect(describeFrameRate({ ...healthy, latePercent: 0.4, lateFrames: 4 }, false).state).toBe('ok');
  });

  it('shows idle rather than a rate when nothing is rendering', () => {
    // "Off" is one black frame and then an idle loop — correct behaviour,
    // and it must not read as a stalled panel.
    const d = describeFrameRate({ ...healthy, idle: true }, false);
    expect(d.state).toBe('idle');
    expect(d.label).toBe('idle');
    expect(d.title).toContain('Idle');
  });

  it('surfaces dropped frames in the detail line, and only when there are any', () => {
    expect(describeFrameRate(healthy, false).detail).not.toContain('late');
    expect(describeFrameRate({ ...healthy, latePercent: 4.2, lateFrames: 38 }, false).detail)
      .toContain('4.2% late');
  });

  it('reports lateness as a rate, so a recovered loop stops showing it', () => {
    // The cumulative count is still non-zero — it always will be, once the
    // loop has ever stumbled — but nothing is late *now*, and the pill is
    // what says so.
    const recovered = { ...healthy, overruns: 7, latePercent: 0, lateFrames: 0 };
    expect(describeFrameRate(recovered, false).detail).not.toContain('late');
  });

  it('names the window and the scene scope in the tooltip', () => {
    const d = describeFrameRate({ ...healthy, latePercent: 4.2, lateFrames: 38 }, false);
    // A bare percentage is a share of an unstated denominator.
    expect(d.title).toContain('over the last 10s');
    expect(d.title).toContain('38 of 910');
    expect(d.title).toContain('since this scene became active');
  });

  it('drops the window line rather than showing a share of nothing', () => {
    const fresh = { ...healthy, latePercent: null, lateFrames: 0, windowFrames: 0 };
    expect(describeFrameRate(fresh, false).title).not.toContain('over the last');
  });

  it('labels dev mode so a fast laptop reading is not mistaken for the panel', () => {
    expect(describeFrameRate(healthy, true).title).toContain('Dev mode');
    expect(describeFrameRate(healthy, false).title).not.toContain('Dev mode');
  });

  it('always distinguishes the panel rate from the preview stream rate', () => {
    expect(describeFrameRate(healthy, false).title).toContain('not the preview stream');
  });

  it('waits rather than inventing a rate before the first reading', () => {
    const d = describeFrameRate({ enabled: true, targetFps: 100, idle: false, fps: null }, false);
    expect(d.state).toBe('wait');
  });
});
