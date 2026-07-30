import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { COLS, ROWS, NUM_PIXELS, cellForFrameIndex } from './panelGrid';

const layout = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../server/layout.json', import.meta.url)),
));

describe('cellForFrameIndex', () => {
  it('covers every grid cell exactly once', () => {
    const seen = new Set();
    for (let i = 0; i < NUM_PIXELS; i++) {
      const { col, row } = cellForFrameIndex(i);
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(COLS);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(ROWS);
      seen.add(`${col},${row}`);
    }
    expect(seen.size).toBe(NUM_PIXELS);
  });

  it('is the reverse of row-major, i.e. a 180 degree rotation', () => {
    // Stated explicitly because dropping the reversal is exactly the bug that
    // put the position pad's render upside-down under its own handle.
    for (let i = 0; i < NUM_PIXELS; i++) {
      const { col, row } = cellForFrameIndex(i);
      const naive = { col: i % COLS, row: Math.floor(i / COLS) };
      expect(col).toBe(COLS - 1 - naive.col);
      expect(row).toBe(ROWS - 1 - naive.row);
    }
  });

  it('agrees with the physical layout the server ships', () => {
    // layout.json is the wiring order. Screen left-to-right is world x
    // ascending, and screen top-to-bottom is world z ascending — so mapping a
    // frame index through cellForFrameIndex must land on a cell whose column
    // and row match that pixel's real position.
    const xs = [...new Set(layout.map((p) => p.point[0]))].sort((a, b) => a - b);
    const zs = [...new Set(layout.map((p) => p.point[2]))].sort((a, b) => a - b);
    expect(xs).toHaveLength(COLS);
    expect(zs).toHaveLength(ROWS);

    for (let i = 0; i < layout.length; i++) {
      const { col, row } = cellForFrameIndex(i, layout.length);
      expect(col).toBe(xs.indexOf(layout[i].point[0]));
      expect(row).toBe(zs.indexOf(layout[i].point[2]));
    }
  });

  it('puts the first streamed pixel at the bottom right', () => {
    expect(cellForFrameIndex(0)).toEqual({ col: COLS - 1, row: ROWS - 1 });
    expect(cellForFrameIndex(NUM_PIXELS - 1)).toEqual({ col: 0, row: 0 });
  });
});
