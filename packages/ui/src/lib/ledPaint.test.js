import { describe, it, expect } from 'vitest';
import { gridPositions, bloomParams, BLOOM } from './ledPaint';
import { COLS, ROWS, NUM_PIXELS, cellForFrameIndex } from './panelGrid';

describe('gridPositions', () => {
  it('puts every frame index on its panelGrid cell centre', () => {
    const w = 900;
    const h = 240;
    const cw = w / COLS;
    const ch = h / ROWS;
    const pos = gridPositions(w, h);
    expect(pos.length).toBe(NUM_PIXELS * 2);
    for (let i = 0; i < NUM_PIXELS; i++) {
      const { col, row } = cellForFrameIndex(i, NUM_PIXELS);
      expect(pos[i * 2]).toBeCloseTo(col * cw + cw / 2, 5);
      expect(pos[i * 2 + 1]).toBeCloseTo(row * ch + ch / 2, 5);
    }
  });

  // Frames arrive in strip order, so index 0 is the *last* grid cell. Losing
  // the reversal renders the panel 180 degrees round, which is the bug the
  // position pad shipped once.
  it('runs from the bottom-right corner to the top-left', () => {
    const pos = gridPositions(900, 240);
    const last = NUM_PIXELS - 1;
    expect(pos[0]).toBeCloseTo(900 - 15, 5);
    expect(pos[1]).toBeCloseTo(240 - 15, 5);
    expect(pos[last * 2]).toBeCloseTo(15, 5);
    expect(pos[last * 2 + 1]).toBeCloseTo(15, 5);
  });

  it('scales to the thumbnail size without changing the ordering', () => {
    const big = gridPositions(900, 240);
    const small = gridPositions(120, 32);
    for (let i = 0; i < NUM_PIXELS; i++) {
      expect(small[i * 2]).toBeCloseTo(big[i * 2] / 7.5, 4);
      expect(small[i * 2 + 1]).toBeCloseTo(big[i * 2 + 1] / 7.5, 4);
    }
  });
});

describe('bloomParams', () => {
  // The three sizes the app actually paints at: the 900x240 stage and the
  // 600x160 pad both give 30px cells, the 300x80 scene card gives 10px.
  it('resolves the cell factors at the stage and card sizes', () => {
    const stage = bloomParams(30);
    expect(stage.coreRadius).toBeCloseTo(30 * BLOOM.coreRadius, 6);
    expect(stage.sourceRadius).toBeCloseTo(30 * BLOOM.sourceRadius, 6);
    expect(stage.coreBlur).toBeCloseTo(30 * BLOOM.coreBlur, 6);
    expect(stage.fallback).toBe(false);

    const card = bloomParams(10);
    expect(card.octaves[0].blur).toBeCloseTo(stage.octaves[0].blur / 3, 6);
    expect(card.fallback).toBe(false);
  });

  // The three scales are the substance of the look: a single gaussian cannot
  // be both a tight halo and a broad regional wash.
  it('builds three octaves of increasing blur, each with its own gain', () => {
    const { octaves } = bloomParams(30);
    expect(octaves).toHaveLength(3);
    expect(octaves[0].blur).toBeCloseTo(30 * BLOOM.haloBlur, 6);
    expect(octaves[1].blur).toBeCloseTo(30 * BLOOM.washBlur, 6);
    expect(octaves[2].blur).toBeCloseTo(30 * BLOOM.fieldBlur, 6);
    expect(octaves[1].blur).toBeGreaterThan(octaves[0].blur);
    expect(octaves[2].blur).toBeGreaterThan(octaves[1].blur);
    expect(octaves.map((o) => o.gain))
      .toEqual([BLOOM.haloGain, BLOOM.washGain, BLOOM.fieldGain]);
  });

  // Gain is a stack count rather than a brightness, so it is deliberately
  // allowed past 1 — that is the only lever with no ceiling.
  it('leaves gains untouched by the cell size', () => {
    const stage = bloomParams(30);
    const card = bloomParams(10);
    expect(card.octaves.map((o) => o.gain)).toEqual(stage.octaves.map((o) => o.gain));
    expect(card.coreGain).toBe(stage.coreGain);
  });

  it('falls back at the layer thumbnail size', () => {
    // 120px wide over 30 columns.
    expect(bloomParams(4).fallback).toBe(true);
    expect(bloomParams(BLOOM.minCellPx).fallback).toBe(false);
  });

  it('opens every scale together with glow, leaving the radii alone', () => {
    const base = bloomParams(30);
    const more = bloomParams(30, { glow: 2 });
    for (let i = 0; i < 3; i++) {
      expect(more.octaves[i].blur).toBeCloseTo(base.octaves[i].blur * 2, 6);
    }
    expect(more.coreBlur).toBeCloseTo(base.coreBlur * 2, 6);
    expect(more.coreRadius).toBeCloseTo(base.coreRadius, 6);
    expect(more.sourceRadius).toBeCloseTo(base.sourceRadius, 6);
  });

  it('overrides without mutating the defaults', () => {
    const before = { ...BLOOM };
    bloomParams(30, { haloBoost: 9, minCellPx: 40 });
    expect(BLOOM).toEqual(before);
    expect(bloomParams(30, { minCellPx: 40 }).fallback).toBe(true);
  });

  it('keeps a drawable core radius at any cell size', () => {
    expect(bloomParams(0.4).coreRadius).toBeGreaterThanOrEqual(0.5);
  });
});
