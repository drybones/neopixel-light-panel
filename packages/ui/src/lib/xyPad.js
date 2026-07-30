// Geometry for the position pad.
//
// The pad is the panel plus zero, one or two rings, each a constant world-unit
// border on all four sides. Constant width is the point: it keeps one
// world-units-per-pixel scale on both axes, so the direction you drag is the
// direction the effect gets. A ring scaled to the panel's 4:1 aspect would
// compress x against 3.625 and y against 0.875 and skew a corner drag by tens
// of degrees — which matters because a far-off source is really a direction.
//
// Because the rings are constant width and the panel is not square, each zoom
// level has its own aspect ratio, growing squarer as you zoom out:
//
//   panel   +-3.625 x +-0.875   aspect 4.14   the panel alone
//   near    +-5.625 x +-2.875   aspect 1.96   sources just off the panel
//   far     +-7.625 x +-4.875   aspect 1.56   near, plus a compressed ring
//
// At `far` the outer ring compresses so its edge reaches `farLimit`. Distance
// from the panel is measured as a rectangular offset, s = max(|u| - panelX,
// |v| - panelY), whose contours are exactly the constant-width rings; the ring
// spans s from `margin` to `2 * margin`. Across it the whole vector is scaled
// by m, so only the magnitude is warped and the angle is untouched:
//
//   tau = (s - margin) / margin        0 at the inner edge, 1 at the outer
//   m   = L ^ (tau^2)                  L = farLimit / halfX
//
// The ramp is exponential rather than a 1/(1-tau) pole so the reach spreads
// evenly across the ring instead of bunching into its last few pixels — with a
// pole, four fifths of the ring bought x = 5.6 to 42 and the rest of the range
// lived in the final 3px. Squaring tau makes m'(0) = 0, so the scale factor
// leaves the linear zone flat and the seam has no felt discontinuity, and
// m(1) = L exactly, so the edge lands on farLimit with nothing to clamp.
//
// Screen y is inverted throughout: effect y params negate z (dz = pz + y), so
// positive y is up.

const RINGS = { panel: 0, near: 1, far: 2 };

// Which zoom steps an entry supports. `margin` buys the near ring, `farLimit`
// the compressed one.
export function zoomLevels(entry) {
  if (!(entry.margin > 0)) return ['panel'];
  return entry.farLimit > 0 ? ['panel', 'near', 'far'] : ['panel', 'near'];
}

export function padGeometry(entry, zoom) {
  const levels = zoomLevels(entry);
  const level = levels.indexOf(zoom) >= 0 ? zoom : levels[levels.length - 1];

  const panelX = entry.xRange[1];
  const panelY = entry.yRange[1];
  const margin = entry.margin || 0;
  const rings = RINGS[level];
  const far = level === 'far';

  // The outermost ring is the compressed one, so the linear zone stops one
  // ring short of the pad edge at `far` and fills the pad otherwise.
  const linearOffset = margin * (far ? rings - 1 : rings);
  const halfX = panelX + margin * rings;
  const halfY = panelY + margin * rings;

  return {
    level,
    levels,
    far,
    margin,
    panelX,
    panelY,
    halfX,
    halfY,
    linearOffset,
    linearX: panelX + linearOffset,
    linearY: panelY + linearOffset,
    aspect: halfX / halfY,
    // Total scale across the ring. Along +x the pad edge sits at world
    // halfX * m, so this is what makes that land on farLimit.
    farScale: far ? entry.farLimit / halfX : 1,
  };
}

// Rectangular offset from the panel: 0 on the panel's edge, `margin` on the
// near ring's edge. Its contours are the constant-width rings the pad draws.
function rectOffset(g, u, v) {
  return Math.max(Math.abs(u) - g.panelX, Math.abs(v) - g.panelY);
}

function scaleAt(g, offset) {
  let tau = (offset - g.linearOffset) / g.margin;
  if (tau <= 0) return 1;
  if (tau > 1) tau = 1;
  return Math.pow(g.farScale, tau * tau);
}

// World -> pad fractions in [0, 1] (0,0 = top-left). May land outside that
// range when a value exceeds what the level shows; clampHandle decides what to
// do about it.
export function worldToPad(g, x, y) {
  const k = padScale(g, x, y);
  return {
    fx: (x * k) / (2 * g.halfX) + 0.5,
    fy: -(y * k) / (2 * g.halfY) + 0.5,
  };
}

// The factor taking a world point to its screen position — the inverse of the
// m above. m is defined on the *screen* offset, so this inverts by bisection
// rather than in closed form. Only the handle ever needs it (panel pixels are
// always inside the linear zone), so a few dozen iterations costs nothing.
function padScale(g, x, y) {
  if (!g.far) return 1;
  if (rectOffset(g, x, y) <= g.linearOffset) return 1;

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    // The scale that this candidate screen position would itself imply.
    const implied = 1 / scaleAt(g, rectOffset(g, x * mid, y * mid));
    if (mid < implied) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Pad fractions in [0, 1] -> world. Pointer coordinates are clamped to the pad
// first, so this never returns a value beyond the far limit.
export function padToWorld(g, fx, fy) {
  const u = (Math.min(1, Math.max(0, fx)) - 0.5) * 2 * g.halfX;
  const v = -(Math.min(1, Math.max(0, fy)) - 0.5) * 2 * g.halfY;
  if (!g.far) return { x: u, y: v };

  const m = scaleAt(g, rectOffset(g, u, v));
  return { x: u * m, y: v * m };
}

// Smallest zoom level that can show a value, so opening a layer never starts
// on a clipped handle.
export function fitZoom(entry, x, y) {
  const levels = zoomLevels(entry);
  for (const level of levels) {
    const g = padGeometry(entry, level);
    const { fx, fy } = worldToPad(g, x, y);
    if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) return level;
  }
  return levels[levels.length - 1];
}

// Keeps a handle inside its container so it stays visible and, crucially, still
// hittable — an unclamped handle used to render outside an overflow:hidden box,
// where it could neither be seen nor grabbed.
export function clampHandle(fx, fy) {
  const cx = Math.min(1, Math.max(0, fx));
  const cy = Math.min(1, Math.max(0, fy));
  return { fx: cx, fy: cy, clamped: cx !== fx || cy !== fy };
}

// Bearing of the source from the panel centre, in degrees: 0 is off to the
// right, 90 above. This is where the wave comes *from*; planewave's `angle`
// is the opposite, being the direction of travel.
export function directionDegrees(x, y) {
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

// Past this the source reads as planar and the direction is the useful
// readout, not the coordinates. Matches the server's conversion threshold.
export function isFarField(g, x, y) {
  return Math.hypot(x, y) > Math.hypot(g.panelX, g.panelY) * 10;
}
