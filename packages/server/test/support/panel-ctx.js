/*
 * A full panel's worth of pixels, so distribution claims mean something.
 *
 * Laid out as i = row * COLS + col with modelZ ascending by row, matching
 * layout.json — so +modelZ is the panel's bottom, and "toward the top" is
 * modelZ negative. Shared by the effect suites (noise, emitter, text).
 */

function panelCtx() {
    const COLS = 30, ROWS = 8, SPACING = 0.25, n = COLS * ROWS;
    const modelX = new Float32Array(n), modelZ = new Float32Array(n);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const i = r * COLS + c;
            modelX[i] = (c - (COLS - 1) / 2) * SPACING;
            modelZ[i] = (r - (ROWS - 1) / 2) * SPACING;
        }
    }
    return { numPixels: n, modelX, modelZ };
}

module.exports = { panelCtx };
