import { describe, it, expect } from 'vitest';
import { describePower, formatAmps } from './power';

// An ordinary scene, well inside the PSU-bound budget.
const healthy = {
  limit: true,
  maxMilliamps: 20000,
  overheadMilliamps: 1200,
  budgetMilliamps: 8800,
  idle: false,
  milliamps: 2400,
  requestedMilliamps: 2400,
  peakMilliamps: 2600,
  limiting: false,
  scale: 1,
  floored: false,
};

describe('formatAmps', () => {
  it('reads in milliamps below an amp and amps above it', () => {
    expect(formatAmps(940)).toBe('940 mA');
    expect(formatAmps(9120)).toBe('9.1 A');
  });

  it('renders a missing figure rather than NaN', () => {
    expect(formatAmps(null)).toBe('–');
  });
});

describe('describePower', () => {
  it('leads with current draw', () => {
    const d = describePower(healthy);
    expect(d.state).toBe('ok');
    expect(d.label).toBe('2.4 A');
  });

  it('warns before the limiter engages, not only after', () => {
    expect(describePower({ ...healthy, milliamps: 8000 }).state).toBe('near');
    expect(describePower({ ...healthy, milliamps: 6000 }).state).toBe('ok');
  });

  it('says so while frames are actually being pulled back', () => {
    const d = describePower({ ...healthy, milliamps: 8800, requestedMilliamps: 13352, limiting: true });
    expect(d.state).toBe('limiting');
    expect(d.detail).toContain('limited');
    expect(d.title).toContain('13.4 A');
  });

  // With no scene active the loop renders one black frame and stops, so the
  // figures are the last ones taken. Showing them as live would be a lie
  // about a dark panel.
  it('reports idle rather than a live reading of nothing', () => {
    const d = describePower({ ...healthy, idle: true });
    expect(d.state).toBe('idle');
    expect(d.detail).toContain('idle');
    expect(d.title).toContain('Idle');
  });

  it('flags a budget below the panel’s own standby draw as a misconfiguration', () => {
    const d = describePower({ ...healthy, floored: true, budgetMilliamps: 100, milliamps: 240 });
    expect(d.state).toBe('floored');
    expect(d.title).toContain('dimming cannot reach it');
  });

  it('names the supply cap in the detail', () => {
    expect(describePower(healthy).title).toContain('20.0 A supply');
  });

  it('says when it is only measuring', () => {
    expect(describePower({ ...healthy, limit: false }).title).toContain('Measuring only');
    expect(describePower(healthy).title).not.toContain('Measuring only');
  });

  it('always carries the estimate disclaimer', () => {
    expect(describePower(healthy).title).toContain('not a measurement');
  });

  it('waits rather than inventing a reading', () => {
    expect(describePower(null).state).toBe('wait');
    expect(describePower({ ...healthy, milliamps: null }).state).toBe('wait');
  });
});
