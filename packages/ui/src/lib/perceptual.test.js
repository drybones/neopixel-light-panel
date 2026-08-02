import { describe, it, expect } from 'vitest';
import { sliderToValue, valueToSlider, logToValue, valueToLog, LOG_STEPS } from './perceptual';

describe('perceptual slider scaling', () => {
  it('lands the track endpoint on value 10', () => {
    // This identity is the whole reason sliderScalingParam is 10/atan(10):
    // it is what makes the hardcoded -10..10 track span values -10..10.
    expect(sliderToValue(10)).toBeCloseTo(10, 3);
    expect(valueToSlider(10)).toBeCloseTo(10, 3);
  });

  it('is odd, so negative values work', () => {
    for (const v of [-0.1, -1, -5]) {
      expect(sliderToValue(valueToSlider(v))).toBeCloseTo(v, 6);
    }
  });

  it('round-trips values through the atan mapping', () => {
    for (const v of [0, 0.1, 0.5, 1, 2, 5]) {
      expect(sliderToValue(valueToSlider(v))).toBeCloseTo(v, 6);
    }
  });

  it('maps slider 0 to value 0', () => {
    expect(sliderToValue(0)).toBe(0);
  });

  it('is monotonic', () => {
    let prev = -Infinity;
    for (let s = 0; s <= 10; s += 0.5) {
      const v = sliderToValue(s);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

describe('logarithmic slider scaling', () => {
  // wavelet's lambda and twinkle's glow — one of each kind.
  const LAMBDA = [0.001, 50, false];
  const GLOW = [0.01, 0.5, true];

  it('puts the track ends exactly on min and max', () => {
    expect(logToValue(0, ...LAMBDA)).toBeCloseTo(0.001, 9);
    expect(logToValue(LOG_STEPS, ...LAMBDA)).toBeCloseTo(50, 9);
    // Zeroable spends position 0 on the zero, so min starts one step in.
    expect(logToValue(1, ...GLOW)).toBeCloseTo(0.01, 9);
    expect(logToValue(LOG_STEPS, ...GLOW)).toBeCloseTo(0.5, 9);
  });

  it('round-trips values through the log mapping', () => {
    // 0.001 is the Blinky Blue preset — the slider has to reach it exactly.
    for (const v of [0.001, 0.01, 0.05, 0.5, 2, 10, 50]) {
      expect(logToValue(valueToLog(v, ...LAMBDA), ...LAMBDA)).toBeCloseTo(v, 9);
    }
    for (const v of [0.01, 0.02, 0.08, 0.2, 0.5]) {
      expect(logToValue(valueToLog(v, ...GLOW), ...GLOW)).toBeCloseTo(v, 9);
    }
  });

  it('spaces equal slider travel as equal ratios', () => {
    // The point of the scale: a fixed number of steps is a fixed factor,
    // wherever on the track you are.
    const ratio = (pos) => logToValue(pos + 100, ...LAMBDA) / logToValue(pos, ...LAMBDA);
    expect(ratio(300)).toBeCloseTo(ratio(0), 9);
    expect(ratio(700)).toBeCloseTo(ratio(0), 9);
  });

  it('is monotonic across the whole track', () => {
    for (const args of [LAMBDA, GLOW]) {
      let prev = -Infinity;
      for (let pos = 0; pos <= LOG_STEPS; pos += 10) {
        const v = logToValue(pos, ...args);
        expect(v).toBeGreaterThan(prev);
        prev = v;
      }
    }
  });

  it('reserves position 0 for an exact zero when zeroable', () => {
    // freq: 0 and glow: 0 are stored in real scenes and must survive a
    // round trip through the slider unchanged.
    expect(logToValue(0, ...GLOW)).toBe(0);
    expect(valueToLog(0, ...GLOW)).toBe(0);
    expect(logToValue(valueToLog(0, ...GLOW), ...GLOW)).toBe(0);
  });

  it('pins a value below min to position 1, not 0', () => {
    // Otherwise "nearly off" would read on the track as "off". A typed glow of
    // 0.005 now sits under the 0.01 floor, so this is the reachable case.
    expect(valueToLog(0.005, ...GLOW)).toBe(1);
    expect(logToValue(valueToLog(0.005, ...GLOW), ...GLOW)).toBeGreaterThan(0);
  });

  it('pins out-of-range values to the track ends without going past', () => {
    // The presets carry lambda up to 10000; typing keeps it, and the slider
    // just has nowhere further to go.
    expect(valueToLog(0.0001, ...LAMBDA)).toBe(0);
    expect(valueToLog(10000, ...LAMBDA)).toBe(LOG_STEPS);
    expect(valueToLog(0.9, ...GLOW)).toBe(LOG_STEPS);
  });
});
