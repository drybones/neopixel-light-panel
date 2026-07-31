import { describe, it, expect } from 'vitest';
import { formatHex, parseHex } from './colors';

describe('parseHex', () => {
  it('accepts a full hex with or without the hash', () => {
    expect(parseHex('#ff5e3a')).toBe('#ff5e3a');
    expect(parseHex('ff5e3a')).toBe('#ff5e3a');
  });

  it('expands the 3-digit shorthand', () => {
    expect(parseHex('#f0c')).toBe('#ff00cc');
    expect(parseHex('fff')).toBe('#ffffff');
  });

  it('normalises case and surrounding space', () => {
    expect(parseHex('  #FF5E3A ')).toBe('#ff5e3a');
  });

  it('returns null for anything that is not a colour, so the edit is abandoned', () => {
    for (const bad of ['', '#', 'ff5e3', '#ff5e3ax', 'rebeccapurple', '#12345', 'rgb(1,2,3)']) {
      expect(parseHex(bad)).toBe(null);
    }
  });
});

describe('formatHex', () => {
  it('displays lower case, whatever a preset stored', () => {
    expect(formatHex('#FF5E3A')).toBe('#ff5e3a');
  });
});
