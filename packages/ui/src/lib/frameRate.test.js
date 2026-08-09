import { describe, it, expect } from 'vitest';
import { describeFrameRate, formatMs } from './frameRate';

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
    expect(describeFrameRate({ ...healthy, overruns: 7 }, false).detail).toContain('7 late');
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
