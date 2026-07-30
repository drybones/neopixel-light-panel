/*
 * Physical panel extent, derived from layout.json.
 *
 * x is ±3.625 (30 cols × 0.25 spacing), z is ±0.875 (8 rows × 0.25). These are
 * the outermost LED *centres*, so an xy control mapped to exactly this range
 * can address every column and row and nothing beyond.
 *
 * Effect `y` params negate z (dz = pz + y), so a param y of +HALF_Z sits on the
 * top row. RADIUS is the corner distance — the farthest any pixel can be from
 * the panel centre.
 */

var HALF_X = 3.625;
var HALF_Z = 0.875;

module.exports = {
    HALF_X: HALF_X,
    HALF_Z: HALF_Z,
    RADIUS: Math.sqrt(HALF_X * HALF_X + HALF_Z * HALF_Z),
};
