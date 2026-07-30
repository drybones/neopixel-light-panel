// Geometry for the position pad.
//
// The pad shows the panel plus a margin measured in *world units*, equal on all
// four sides. That equal-margin choice is the whole point: it keeps one
// world-units-per-pixel scale on both axes, so the direction you drag is the
// direction the effect gets. An aspect-matched margin would compress x against
// 3.625 and y against 0.875 and skew a corner drag by tens of degrees — which
// matters because a far-off wave source is really a direction.
//
// With `farLimit` set, the pad doubles and its outer half compresses, so the
// border reaches that distance. Only the radius is warped, never the angle, so
// direction stays exact out there too. Writing d for the offset from centre
// normalised to the pad half-extents and t = max(|dx|, |dy|):
//
//   t <= 0.5   world = d · half                      exactly linear
//   t >  0.5   world = d · half · m,  m = 0.25 / (t·(1−t))
//
// m is 1 at t = 0.5 and both one-sided derivatives agree there, so the seam is
// C¹ and dragging across it has no felt discontinuity. t is capped just short
// of 1 so the border lands on farLimit rather than an unrepresentable infinity.
//
// Screen y is inverted throughout: effect y params negate z (dz = pz + y), so
// positive y is up.

// The linear zone occupies the inner half of a pad that has a far frame, and
// the whole pad otherwise.
const LINEAR_T = 0.5;

export function padGeometry(entry) {
  const xMax = entry.xRange[1];
  const yMax = entry.yRange[1];
  const margin = entry.margin || 0;
  const linearX = xMax + margin;
  const linearY = yMax + margin;
  const far = entry.farLimit > 0;

  // World units at the pad's edge if the mapping stayed linear all the way out.
  const halfX = far ? linearX / LINEAR_T : linearX;
  const halfY = far ? linearY / LINEAR_T : linearY;

  return {
    far,
    halfX,
    halfY,
    linearX,
    linearY,
    panelX: xMax,
    panelY: yMax,
    // Cap on t. Solving world = halfX·m(t) for m at the far limit gives
    // t = 1 − 0.25/q with q = farLimit / halfX.
    maxT: far ? 1 - 0.25 / (entry.farLimit / halfX) : LINEAR_T,
    // Pad width / height. Same for both kinds — the far frame doubles both axes.
    aspect: halfX / halfY,
    // Where the linear zone sits as a fraction of the pad, for drawing.
    linearFraction: far ? LINEAR_T : 1,
  };
}

// World → pad fractions in [0, 1] (0,0 = top-left). May land outside that range
// when a value exceeds what the pad can show; clampHandle decides what to do.
export function worldToPad(g, x, y) {
  const ex = (x / g.halfX) * 0.5;
  const ey = (-y / g.halfY) * 0.5;
  if (!g.far) return { fx: ex + 0.5, fy: ey + 0.5 };

  // q is what t would be if the mapping were linear; past the seam the actual
  // radius is pulled back to t = 1 − 0.25/q, direction untouched.
  const q = 2 * Math.max(Math.abs(ex), Math.abs(ey));
  if (q <= LINEAR_T) return { fx: ex + 0.5, fy: ey + 0.5 };

  const t = 1 - 0.25 / q;
  return { fx: (ex * t) / q + 0.5, fy: (ey * t) / q + 0.5 };
}

// Pad fractions in [0, 1] → world. Pointer coordinates are clamped to the pad
// first, so this never returns a value beyond the far limit.
export function padToWorld(g, fx, fy) {
  const dx = (Math.min(1, Math.max(0, fx)) - 0.5) * 2;
  const dy = (Math.min(1, Math.max(0, fy)) - 0.5) * 2;
  if (!g.far) return { x: dx * g.halfX, y: -dy * g.halfY };

  const t = Math.max(Math.abs(dx), Math.abs(dy));
  if (t <= LINEAR_T) return { x: dx * g.halfX, y: -dy * g.halfY };

  // The world rect-radius works out to half · 0.25/(1 − t), so capping t is
  // what pins the border to farLimit — but the direction vector has to be
  // pulled back to the capped radius too, hence t rather than capped below.
  const capped = Math.min(t, g.maxT);
  const m = 0.25 / (t * (1 - capped));
  return { x: dx * g.halfX * m, y: -dy * g.halfY * m };
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

// Past this the source reads as planar and the direction is the useful readout,
// not the coordinates. Matches the server's conversion threshold.
export function isFarField(g, x, y) {
  return Math.hypot(x, y) > Math.hypot(g.panelX, g.panelY) * 10;
}
