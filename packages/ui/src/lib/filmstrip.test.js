import { describe, it, expect } from 'vitest';
import { decodeBase64, decodePreviews, fillFrame, makeTriples, phaseFor } from './filmstrip';

// Build the payload the server sends: base64 of a flat, frame-major RGB array.
function encode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe('decodeBase64', () => {
  it('round-trips every byte value, including 0 and 255', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(decodeBase64(encode(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('decodePreviews', () => {
  it('keys the strips by scene id and carries the loop timing', () => {
    const decoded = decodePreviews({
      version: 1,
      frames: 2,
      intervalMs: 100,
      previews: [
        { id: 'a', hash: 'h1', data: encode([1, 2, 3]) },
        { id: 'b', hash: 'h2', data: encode([4, 5, 6]) },
      ],
    });
    expect(decoded.frames).toBe(2);
    expect(decoded.intervalMs).toBe(100);
    expect(Object.keys(decoded.strips)).toEqual(['a', 'b']);
    expect(decoded.strips.a.hash).toBe('h1');
    expect(Array.from(decoded.strips.b.pixels)).toEqual([4, 5, 6]);
  });

  it('survives a payload with no previews', () => {
    expect(decodePreviews({ frames: 20, intervalMs: 100 }).strips).toEqual({});
  });
});

describe('phaseFor', () => {
  it('stays in range', () => {
    for (const id of ['a', 'SkVEkikvf', 'wavelet', '', '9f31ab02']) {
      const p = phaseFor(id, 40);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(40);
      expect(Number.isInteger(p)).toBe(true);
    }
  });

  it('is stable for an id, so a card keeps its place in the loop across reloads', () => {
    expect(phaseFor('SkVEkikvf', 40)).toBe(phaseFor('SkVEkikvf', 40));
  });

  // The point of the offset: without it every card reaches the seam on the
  // same tick and the whole page glitches at once.
  it('spreads a realistic set of scene ids over the loop', () => {
    const ids = ['SkVEkikvf', 'B1hNkiJDf', 'a3b7c901', 'c22e10fa', '9f31ab02',
      'HJ_f5ckwf', 'd1f00b01', 'SJF9d9yPz', 'wavelet', 'embers', 'noise', 'twinkle'];
    const phases = ids.map((id) => phaseFor(id, 40));
    // Not asking for a perfect spread — just that they are not all together.
    expect(new Set(phases).size).toBeGreaterThan(ids.length / 2);
  });

  it('degrades to 0 rather than NaN before the frame count is known', () => {
    expect(phaseFor('a', 0)).toBe(0);
  });
});

describe('fillFrame', () => {
  // Two frames of three pixels: frame 0 counts up from 1, frame 1 from 101.
  const pixels = Uint8Array.from([
    1, 2, 3, 4, 5, 6, 7, 8, 9,
    101, 102, 103, 104, 105, 106, 107, 108, 109,
  ]);

  it('reads the requested frame, not the first one', () => {
    const triples = makeTriples(3);
    expect(fillFrame(pixels, 0, triples)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    expect(fillFrame(pixels, 1, triples)).toEqual([[101, 102, 103], [104, 105, 106], [107, 108, 109]]);
  });

  it('writes into the triples it was given rather than allocating', () => {
    const triples = makeTriples(3);
    const first = triples[0];
    fillFrame(pixels, 1, triples);
    expect(triples[0]).toBe(first);
    expect(first).toEqual([101, 102, 103]);
  });
});
