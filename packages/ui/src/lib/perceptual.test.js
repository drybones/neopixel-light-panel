import { describe, it, expect } from 'vitest';
import { sliderToValue, valueToSlider } from './perceptual';

describe('perceptual slider scaling', () => {
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
