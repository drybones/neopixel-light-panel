import { describe, it, expect } from 'vitest';
import { formatNumber, parseNumber } from './numberFormat';

describe('formatNumber', () => {
  it('keeps two decimal places at and above 1', () => {
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(2.345)).toBe('2.35');
    expect(formatNumber(360)).toBe('360');
    expect(formatNumber(10000)).toBe('10000');
    // Math.round breaks ties toward +Infinity, so a negative half rounds up.
    // Pre-existing behaviour, pinned here rather than changed.
    expect(formatNumber(-3.625)).toBe('-3.62');
  });

  it('shows the small values the log sliders reach', () => {
    // The whole point: none of these may render as "0" or round up to a
    // reading that isn't the stored value.
    expect(formatNumber(0.001)).toBe('0.001');
    expect(formatNumber(0.002)).toBe('0.002');
    expect(formatNumber(0.005)).toBe('0.005');
    expect(formatNumber(0.0796)).toBe('0.0796');
    expect(formatNumber(0.08)).toBe('0.08');
    expect(formatNumber(0.5)).toBe('0.5');
  });

  it('renders an exact zero as 0', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('survives a non-finite value', () => {
    expect(formatNumber(NaN)).toBe('');
    expect(formatNumber(Infinity)).toBe('');
  });
});

describe('parseNumber', () => {
  it('accepts values no slider can reach', () => {
    expect(parseNumber('10000')).toBe(10000);
    expect(parseNumber('0.001')).toBe(0.001);
    expect(parseNumber('-500')).toBe(-500);
  });

  it('returns null for anything unreadable', () => {
    expect(parseNumber('')).toBe(null);
    expect(parseNumber('abc')).toBe(null);
  });
});
