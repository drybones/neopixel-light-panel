import { describe, it, expect } from 'vitest';
import {
  padGeometry, worldToPad, padToWorld, clampHandle, directionDegrees, isFarField,
} from './xyPad';

const HALF_X = 3.625;
const HALF_Z = 0.875;

// Mirrors the schema entries the server ships.
const waveletEntry = {
  xRange: [-HALF_X, HALF_X], yRange: [-HALF_Z, HALF_Z], margin: 2, farLimit: 1000,
};
const gradientEntry = {
  xRange: [-HALF_X, HALF_X], yRange: [-HALF_Z, HALF_Z], margin: 2,
};

const wavelet = padGeometry(waveletEntry);
const gradient = padGeometry(gradientEntry);

function roundTrip(g, x, y) {
  const { fx, fy } = worldToPad(g, x, y);
  return padToWorld(g, fx, fy);
}

describe('padGeometry', () => {
  it('expands the panel by an equal world-unit margin on both axes', () => {
    expect(wavelet.linearX).toBeCloseTo(5.625, 10);
    expect(wavelet.linearY).toBeCloseTo(2.875, 10);
  });

  it('gives both pad kinds the same aspect', () => {
    expect(wavelet.aspect).toBeCloseTo(gradient.aspect, 10);
    expect(wavelet.aspect).toBeCloseTo(5.625 / 2.875, 10);
  });

  it('puts the linear zone in the inner half only when there is a far frame', () => {
    expect(wavelet.linearFraction).toBe(0.5);
    expect(gradient.linearFraction).toBe(1);
  });
});

describe('round trips', () => {
  it('recovers world coordinates across the linear zone', () => {
    for (const x of [-5.6, -3.625, -1, 0, 0.5, 3.625, 5.6]) {
      for (const y of [-2.8, -0.875, 0, 0.875, 2.8]) {
        const back = roundTrip(wavelet, x, y);
        expect(back.x).toBeCloseTo(x, 9);
        expect(back.y).toBeCloseTo(y, 9);
      }
    }
  });

  it('recovers world coordinates across the compressed frame', () => {
    for (const x of [8, 20, 100, 400, 900]) {
      for (const y of [0, 5, 60, 300]) {
        const back = roundTrip(wavelet, x, y);
        expect(back.x).toBeCloseTo(x, 5);
        expect(back.y).toBeCloseTo(y, 5);
      }
    }
  });

  it('round trips on a pad with no far frame', () => {
    for (const [x, y] of [[0, 0], [5.625, 2.875], [-3, 1.2]]) {
      const back = roundTrip(gradient, x, y);
      expect(back.x).toBeCloseTo(x, 9);
      expect(back.y).toBeCloseTo(y, 9);
    }
  });
});

describe('direction fidelity', () => {
  // The regression test for the entire change: an aspect-matched pad skewed a
  // corner drag by tens of degrees, which is wrong because a distant source is
  // really a direction.
  it('preserves the drag direction at every angle and radius', () => {
    for (let deg = 0; deg < 360; deg += 7) {
      const rad = (deg * Math.PI) / 180;
      for (const r of [1, 4, 9, 40, 250, 900]) {
        const x = r * Math.cos(rad);
        const y = r * Math.sin(rad);
        const { fx, fy } = worldToPad(wavelet, x, y);

        // Pad offset scaled back into world proportions; if only the radius is
        // warped, this points exactly where the value does.
        const ox = (fx - 0.5) * wavelet.halfX;
        const oy = -(fy - 0.5) * wavelet.halfY;
        expect(directionDegrees(ox, oy)).toBeCloseTo(directionDegrees(x, y), 6);
      }
    }
  });
});

describe('the seam at the linear boundary', () => {
  it('is continuous', () => {
    // The seam sits at t = 0.5, i.e. a quarter of the pad either side of centre.
    const inside = padToWorld(wavelet, 0.75 - 1e-7, 0.5);
    const outside = padToWorld(wavelet, 0.75 + 1e-7, 0.5);
    expect(outside.x - inside.x).toBeLessThan(1e-4);
    expect(inside.x).toBeCloseTo(wavelet.linearX, 4);
  });

  it('has no kink in the drag rate across it', () => {
    // C¹ means the world-units-per-pad-fraction rate matches on both sides.
    const step = 1e-5;
    const rateAt = (f) => (padToWorld(wavelet, f + step, 0.5).x - padToWorld(wavelet, f, 0.5).x) / step;
    expect(rateAt(0.75 - 2 * step)).toBeCloseTo(rateAt(0.75 + step), 2);
  });
});

describe('the far limit', () => {
  it('stops the pad border at farLimit rather than infinity', () => {
    const edge = padToWorld(wavelet, 1, 0.5);
    expect(edge.x).toBeCloseTo(1000, 6);
    expect(Number.isFinite(edge.x)).toBe(true);
  });

  it('clamps pointer coordinates dragged past the pad', () => {
    expect(padToWorld(wavelet, 5, 0.5).x).toBeCloseTo(1000, 6);
    expect(padToWorld(wavelet, -5, 0.5).x).toBeCloseTo(-1000, 6);
  });

  it('never exceeds the limit anywhere on the border', () => {
    for (let f = 0; f <= 1.0001; f += 0.02) {
      const corner = padToWorld(wavelet, f, 0);
      expect(Math.abs(corner.x)).toBeLessThanOrEqual(1000.001);
      expect(Number.isFinite(corner.y)).toBe(true);
    }
  });
});

describe('clampHandle', () => {
  it('leaves an in-range handle alone', () => {
    expect(clampHandle(0.3, 0.7)).toEqual({ fx: 0.3, fy: 0.7, clamped: false });
  });

  it('pins an out-of-range handle to the edge and says so', () => {
    // This is what keeps a legacy x:1000 layer grabbable in PreviewStage.
    expect(clampHandle(139.4, 0.5)).toEqual({ fx: 1, fy: 0.5, clamped: true });
    expect(clampHandle(0.5, -277)).toEqual({ fx: 0.5, fy: 0, clamped: true });
  });
});

describe('far-field detection', () => {
  it('matches the server conversion threshold', () => {
    expect(isFarField(wavelet, 0, 0)).toBe(false);
    expect(isFarField(wavelet, 2, -2.5)).toBe(false);
    expect(isFarField(wavelet, 1000, 500)).toBe(true);
  });
});

describe('directionDegrees', () => {
  it('follows the planewave convention', () => {
    expect(directionDegrees(1, 0)).toBeCloseTo(0);
    expect(directionDegrees(0, 1)).toBeCloseTo(90);
    expect(directionDegrees(-1, 0)).toBeCloseTo(180);
    expect(directionDegrees(0, -1)).toBeCloseTo(270);
  });
});
