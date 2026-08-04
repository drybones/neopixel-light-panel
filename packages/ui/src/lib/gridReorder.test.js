import { describe, it, expect } from 'vitest';
import { edgeScrollVelocity, moveItem, nearestSlot, visualIndex } from './gridReorder';

// The invariant that matters: the visual order the grid paints during a drag
// has to be the order that gets committed on drop, or the cards jump on
// release. Both are derived here, so check them against each other.
function visualOrder(list, from, to) {
  const out = new Array(list.length);
  list.forEach((item, i) => { out[visualIndex(i, from, to)] = item; });
  return out;
}

const LIST = ['a', 'b', 'c', 'd', 'e'];

describe('visualIndex', () => {
  it('sends the dragged card to the slot it is over', () => {
    expect(visualIndex(1, 1, 3)).toBe(3);
    expect(visualIndex(3, 3, 0)).toBe(0);
  });

  it('shifts the cards between the two ends by one, and leaves the rest', () => {
    // 'b' (1) dragged to slot 3: c and d shuffle back, a and e stay put.
    expect([0, 2, 3, 4].map((i) => visualIndex(i, 1, 3))).toEqual([0, 1, 2, 4]);
    // 'd' (3) dragged to slot 1: b and c shuffle forward.
    expect([0, 1, 2, 4].map((i) => visualIndex(i, 3, 1))).toEqual([0, 2, 3, 4]);
  });

  it('is the identity when nothing has moved', () => {
    expect(LIST.map((_, i) => visualIndex(i, 2, 2))).toEqual([0, 1, 2, 3, 4]);
  });

  it('is a permutation for every from/to pair', () => {
    for (let from = 0; from < LIST.length; from++) {
      for (let to = 0; to < LIST.length; to++) {
        const seen = LIST.map((_, i) => visualIndex(i, from, to)).sort();
        expect(seen).toEqual([0, 1, 2, 3, 4]);
      }
    }
  });
});

describe('moveItem', () => {
  it('agrees with the order the grid paints, for every from/to pair', () => {
    for (let from = 0; from < LIST.length; from++) {
      for (let to = 0; to < LIST.length; to++) {
        expect(moveItem(LIST, from, to)).toEqual(visualOrder(LIST, from, to));
      }
    }
  });

  it('does not mutate the list it was given', () => {
    const before = LIST.slice();
    moveItem(LIST, 0, 4);
    expect(LIST).toEqual(before);
  });
});

describe('nearestSlot', () => {
  // Two rows of three, 100x50 cards on a 10px gutter — the wrap is the case a
  // list-shaped insertion index cannot express.
  const centres = [0, 1, 2, 3, 4, 5].map((i) => ({
    x: 50 + (i % 3) * 110,
    y: 25 + Math.floor(i / 3) * 60,
  }));

  it('picks the slot whose centre is closest', () => {
    expect(nearestSlot(centres, 50, 25)).toBe(0);
    expect(nearestSlot(centres, 265, 30)).toBe(2);
    expect(nearestSlot(centres, 160, 85)).toBe(4);
  });

  it('wraps to the row above and below rather than clamping in a row', () => {
    // Just left of the first card of row 2 is the last card of row 1.
    expect(nearestSlot(centres, -20, 80)).toBe(3);
    expect(nearestSlot(centres, 45, 20)).toBe(0);
  });

  it('always answers, even well outside the grid', () => {
    expect(nearestSlot(centres, -500, -500)).toBe(0);
    expect(nearestSlot(centres, 9999, 9999)).toBe(5);
  });
});

describe('edgeScrollVelocity', () => {
  const v = (y) => edgeScrollVelocity(y, 800, 80, 18);

  it('is still through the middle of the viewport', () => {
    expect(v(80)).toBe(0);
    expect(v(400)).toBe(0);
    expect(v(720)).toBe(0);
  });

  it('scrolls up near the top and down near the bottom', () => {
    expect(v(40)).toBeCloseTo(-9);
    expect(v(760)).toBeCloseTo(9);
    expect(v(0)).toBeCloseTo(-18);
    expect(v(800)).toBeCloseTo(18);
  });

  it('holds at full speed once the finger leaves the viewport', () => {
    expect(v(-300)).toBeCloseTo(-18);
    expect(v(1100)).toBeCloseTo(18);
  });
});
