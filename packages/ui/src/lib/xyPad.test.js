import { describe, it, expect } from 'vitest';
import {
  padGeometry, zoomLevels, fitZoom, worldToPad, padToWorld, clampHandle,
  directionDegrees, isFarField,
} from './xyPad';

const HALF_X = 3.625;      // outermost LED centres
const HALF_Z = 0.875;
const MARGIN = 2;
const FAR_LIMIT = 1000;
// The pad frames the panel as the stage does — a grid of 30x8 cells, half a
// pitch beyond the centres — so the drawn box is wider than xRange/yRange.
const BOX_X = 3.75;
const BOX_Z = 1.0;

// Mirrors the schema entries the server ships.
const waveletEntry = {
  xRange: [-HALF_X, HALF_X], yRange: [-HALF_Z, HALF_Z], margin: MARGIN, farLimit: FAR_LIMIT,
};
const gradientEntry = {
  xRange: [-HALF_X, HALF_X], yRange: [-HALF_Z, HALF_Z], margin: MARGIN,
};

const panel = padGeometry(waveletEntry, 'panel');
const near = padGeometry(waveletEntry, 'near');
const far = padGeometry(waveletEntry, 'far');

function roundTrip(g, x, y) {
  const { fx, fy } = worldToPad(g, x, y);
  return padToWorld(g, fx, fy);
}

describe('zoom levels', () => {
  it('offers a level per zone, gated on what the schema supports', () => {
    expect(zoomLevels(waveletEntry)).toEqual(['panel', 'near', 'far']);
    expect(zoomLevels(gradientEntry)).toEqual(['panel', 'near']);
    expect(zoomLevels({ xRange: [-1, 1], yRange: [-1, 1] })).toEqual(['panel']);
  });

  it('falls back to the widest level for an unknown name', () => {
    expect(padGeometry(waveletEntry, 'nonsense').level).toBe('far');
  });
});

describe('constant-width rings', () => {
  it('adds the same world-unit border on both axes at every level', () => {
    expect(panel.halfX - BOX_X).toBeCloseTo(0, 10);
    expect(panel.halfY - BOX_Z).toBeCloseTo(0, 10);

    // This is the property the whole design rests on: the x and y borders must
    // be equal, or a corner drag points somewhere the value does not.
    expect(near.halfX - BOX_X).toBeCloseTo(MARGIN, 10);
    expect(near.halfY - BOX_Z).toBeCloseTo(MARGIN, 10);

    expect(far.halfX - BOX_X).toBeCloseTo(2 * MARGIN, 10);
    expect(far.halfY - BOX_Z).toBeCloseTo(2 * MARGIN, 10);
  });

  it('frames the panel on the cell box, matching the stage', () => {
    // Drawn on LED centres, the outline bisected the edge LEDs and the pad was
    // 4.14 wide against the stage's 3.75. Half a pitch out fixes both.
    for (const g of [panel, near, far]) {
      expect(g.boxX).toBeCloseTo(BOX_X, 10);
      expect(g.boxY).toBeCloseTo(BOX_Z, 10);
      expect(g.boxX - g.panelX).toBeCloseTo(g.boxY - g.panelY, 10);
    }
    expect(panel.aspect).toBeCloseTo(30 / 8, 10);
  });

  it('makes the compressed ring exactly as wide as the near ring', () => {
    expect(far.halfX - far.linearX).toBeCloseTo(MARGIN, 10);
    expect(far.halfY - far.linearY).toBeCloseTo(MARGIN, 10);
    expect(far.linearX).toBeCloseTo(near.halfX, 10);
    expect(far.linearY).toBeCloseTo(near.halfY, 10);
  });

  it('gives each level its own aspect, growing squarer as it zooms out', () => {
    expect(panel.aspect).toBeCloseTo(3.75 / 1.0, 4);
    expect(near.aspect).toBeCloseTo(5.75 / 3.0, 4);
    expect(far.aspect).toBeCloseTo(7.75 / 5.0, 4);
    expect(near.aspect).toBeLessThan(panel.aspect);
    expect(far.aspect).toBeLessThan(near.aspect);
  });
});

describe('round trips', () => {
  it('is exact and linear at panel and near', () => {
    for (const g of [panel, near]) {
      for (const x of [-g.halfX, -1, 0, 0.5, g.halfX]) {
        for (const y of [-g.halfY, 0, g.halfY]) {
          const back = roundTrip(g, x, y);
          expect(back.x).toBeCloseTo(x, 9);
          expect(back.y).toBeCloseTo(y, 9);
        }
      }
    }
  });

  it('recovers world coordinates across the compressed ring', () => {
    for (const x of [6, 8, 20, 100, 400, 900]) {
      for (const y of [0, 3, 5, 60, 300]) {
        const back = roundTrip(far, x, y);
        expect(back.x).toBeCloseTo(x, 4);
        expect(back.y).toBeCloseTo(y, 4);
      }
    }
  });

  it('leaves the linear zone untouched at far', () => {
    for (const [x, y] of [[0, 0], [3.75, 1.0], [5.75, 3.0], [-4, -2]]) {
      const back = roundTrip(far, x, y);
      expect(back.x).toBeCloseTo(x, 9);
      expect(back.y).toBeCloseTo(y, 9);
    }
  });
});

describe('direction fidelity', () => {
  // The regression test for the entire design: an aspect-matched ring skewed a
  // corner drag by tens of degrees, which is wrong because a distant source is
  // really a direction.
  it('preserves the drag direction at every angle and radius', () => {
    for (const g of [panel, near, far]) {
      for (let deg = 0; deg < 360; deg += 7) {
        const rad = (deg * Math.PI) / 180;
        for (const r of [0.5, 2, 5, 9, 40, 250, 900]) {
          const x = r * Math.cos(rad);
          const y = r * Math.sin(rad);
          const { fx, fy } = worldToPad(g, x, y);

          // Pad offset scaled back into world proportions; if only the
          // magnitude is warped, this points exactly where the value does.
          const ox = (fx - 0.5) * g.halfX;
          const oy = -(fy - 0.5) * g.halfY;
          expect(directionDegrees(ox, oy)).toBeCloseTo(directionDegrees(x, y), 5);
        }
      }
    }
  });
});

describe('the seam at the linear boundary', () => {
  it('is continuous', () => {
    const inside = padToWorld(far, 0.5 + (far.linearX / far.halfX) * 0.5 - 1e-7, 0.5);
    const outside = padToWorld(far, 0.5 + (far.linearX / far.halfX) * 0.5 + 1e-7, 0.5);
    expect(Math.abs(outside.x - inside.x)).toBeLessThan(1e-4);
    expect(inside.x).toBeCloseTo(far.linearX, 4);
  });

  it('has no kink in the drag rate across it', () => {
    // The scale factor is flat where it meets the linear zone (m'(0) = 0), so
    // world-units-per-pad-fraction matches on both sides. Testing that with a
    // fixed tolerance just measures the finite difference's truncation error;
    // what actually separates a smooth join from a kinked one is that the gap
    // vanishes with the step. Halve the step, halve the gap => continuous.
    // A real kink would leave the gap stuck at the size of the jump.
    const seam = 0.5 + (far.linearX / far.halfX) * 0.5;
    const gapAt = (step) => {
      const rate = (f) => (padToWorld(far, f + step, 0.5).x - padToWorld(far, f, 0.5).x) / step;
      const before = rate(seam - 2 * step);
      return Math.abs(rate(seam + step) - before) / before;
    };

    const coarse = gapAt(1e-5);
    const fine = gapAt(1e-6);
    expect(coarse).toBeLessThan(0.01);
    expect(fine).toBeLessThan(coarse / 5);
  });
});

describe('the far limit', () => {
  it('stops the pad edge at farLimit rather than infinity', () => {
    const edge = padToWorld(far, 1, 0.5);
    expect(edge.x).toBeCloseTo(FAR_LIMIT, 4);
    expect(Number.isFinite(edge.x)).toBe(true);
  });

  it('clamps pointer coordinates dragged past the pad', () => {
    expect(padToWorld(far, 5, 0.5).x).toBeCloseTo(FAR_LIMIT, 4);
    expect(padToWorld(far, -5, 0.5).x).toBeCloseTo(-FAR_LIMIT, 4);
  });

  it('stays finite and bounded everywhere on the border', () => {
    // farLimit calibrates the x reach, so a corner is farther than that in
    // magnitude (its x is exactly farLimit and it has a y as well) — what has
    // to hold is that no coordinate runs away.
    for (let f = 0; f <= 1.0001; f += 0.02) {
      for (const p of [padToWorld(far, f, 0), padToWorld(far, f, 1), padToWorld(far, 0, f)]) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(FAR_LIMIT * 1.001);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(FAR_LIMIT * 1.001);
      }
    }
  });

  it('spreads the reach across the ring instead of bunching it at the edge', () => {
    // A 1/(1-tau) pole put four fifths of the ring into x = 5.6 to 42 and the
    // rest of the range into its last three pixels, which is undraggable. The
    // exponential ramp should give roughly even ratios across the ring.
    const inner = 0.5 + far.linearX / (2 * far.halfX);
    const at = (frac) => padToWorld(far, inner + (1 - inner) * frac, 0.5).x;

    expect(at(0)).toBeCloseTo(far.linearX, 6);
    expect(at(0.5)).toBeGreaterThan(15);      // mid-ring is well past the seam
    expect(at(0.9)).toBeGreaterThan(200);
    expect(at(1)).toBeCloseTo(FAR_LIMIT, 4);

    // Every quarter of the ring has to buy a meaningful factor, rather than
    // three of them being nearly flat. It is deliberately not uniform: the
    // ramp leaves the seam flat to stay C1, and gets steeper outwards, which
    // is the right feel — fine control near the panel, coarse control far
    // away. What matters is that no quarter is dead and none runs away.
    const ratios = [0.25, 0.5, 0.75, 1].map((f, i, a) => at(f) / at(i === 0 ? 0 : a[i - 1]));
    for (const r of ratios) expect(r).toBeGreaterThan(1.4);
    for (const r of ratios) expect(r).toBeLessThan(12);
  });

  it('reaches farLimit sideways and proportionally less vertically', () => {
    // The ring is a constant width, so the top edge sits nearer the panel than
    // the right edge does and compresses to a correspondingly shorter reach.
    const scale = FAR_LIMIT / far.halfX;
    expect(padToWorld(far, 1, 0.5).x).toBeCloseTo(FAR_LIMIT, 4);
    expect(padToWorld(far, 0.5, 0).y).toBeCloseTo(far.halfY * scale, 4);
  });

  it('never compresses at panel or near', () => {
    expect(padToWorld(panel, 1, 0.5).x).toBeCloseTo(panel.halfX, 9);
    expect(padToWorld(near, 1, 0.5).x).toBeCloseTo(near.halfX, 9);
  });
});

describe('fitZoom', () => {
  it('picks the tightest level that can show the value', () => {
    expect(fitZoom(waveletEntry, 0, 0)).toBe('panel');
    expect(fitZoom(waveletEntry, 3, 0.8)).toBe('panel');
    expect(fitZoom(waveletEntry, -1.4, -2.5)).toBe('near');   // Warm Glow
    expect(fitZoom(waveletEntry, 1000, 500)).toBe('far');     // a legacy preset
  });

  it('settles on the widest level when nothing can show it', () => {
    expect(fitZoom(waveletEntry, 1e6, 0)).toBe('far');
    expect(fitZoom(gradientEntry, 1e6, 0)).toBe('near');
  });
});

describe('clampHandle', () => {
  it('leaves an in-range handle alone', () => {
    expect(clampHandle(0.3, 0.7)).toEqual({ fx: 0.3, fy: 0.7, clamped: false });
  });

  it('pins an out-of-range handle to the edge and says so', () => {
    expect(clampHandle(139.4, 0.5)).toEqual({ fx: 1, fy: 0.5, clamped: true });
    expect(clampHandle(0.5, -277)).toEqual({ fx: 0.5, fy: 0, clamped: true });
  });
});

describe('far-field detection', () => {
  it('matches the server conversion threshold', () => {
    expect(isFarField(far, 0, 0)).toBe(false);
    expect(isFarField(far, 2, -2.5)).toBe(false);
    expect(isFarField(far, 1000, 500)).toBe(true);
  });
});

describe('directionDegrees', () => {
  it('follows the source-bearing convention', () => {
    expect(directionDegrees(1, 0)).toBeCloseTo(0);
    expect(directionDegrees(0, 1)).toBeCloseTo(90);
    expect(directionDegrees(-1, 0)).toBeCloseTo(180);
    expect(directionDegrees(0, -1)).toBeCloseTo(270);
  });
});
