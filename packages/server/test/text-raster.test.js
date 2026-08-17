const test = require('node:test');
const assert = require('node:assert');

const raster = require('../engine/text-raster');
const textFont = require('../engine/text-font');

const REGULAR = textFont.FONTS.regular;
const HEAVY = textFont.FONTS.heavy;
const ROUND = textFont.FONTS.round;

// A fixed instant to resolve tokens against: 2026-08-17 15:04:05 local, so the
// hour is unambiguous in both 24h and 12h and every field is two digits.
const AT = new Date(2026, 7, 17, 15, 4, 5).getTime();

// A synthetic lattice in the panel's own geometry — ascending modelX is
// rightwards, ascending modelZ is downwards — with pixel i = row * cols + col so
// the tests can index a cell directly.
function gridCtx(cols, rows) {
    const n = cols * rows;
    const modelX = new Float32Array(n);
    const modelZ = new Float32Array(n);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            modelX[r * cols + c] = (c - (cols - 1) / 2) * 0.25;
            modelZ[r * cols + c] = (r - (rows - 1) / 2) * 0.25;
        }
    }
    return { numPixels: n, modelX, modelZ };
}

// Coverage for one line, sampled straight rather than through the effect.
function coverageOf(font, text, opts) {
    const o = opts || {};
    const cols = o.cols || 30;
    const rows = o.rows || 8;
    const grid = raster.makeGrid(gridCtx(cols, rows));
    const sampler = raster.createSampler(grid.cols, grid.rows, 8);
    const mask = raster.layoutLine(font, text, o.tracking === undefined ? 1 : o.tracking);
    const period = raster.wrapPeriod(mask.width, grid.cols, o.gap === undefined ? 8 : o.gap);
    const originCol = o.originCol === undefined
        ? Math.round((grid.cols - mask.width) / 2)
        : o.originCol;
    const originRow = o.originRow === undefined ? 0 : o.originRow;
    const cov = raster.sample(sampler, mask, period, originCol, originRow, o.softness || 0);
    return { cov, grid, mask, at: (r, c) => cov[r * grid.cols + c] };
}

// --- tokens -----------------------------------------------------------------

test('tokenPeriod says how often the resolved string can change', () => {
    assert.strictEqual(raster.tokenPeriod('Hello'), 0);
    assert.strictEqual(raster.tokenPeriod('{HH}:{mm}'), 60000);
    assert.strictEqual(raster.tokenPeriod('{HH}:{mm}:{ss}'), 1000);
    assert.strictEqual(raster.tokenPeriod('{DD}/{MM}'), 60000);
    assert.strictEqual(raster.tokenPeriod(42), 0);
    // A second anywhere in the string wins, whatever comes after it.
    assert.strictEqual(raster.tokenPeriod('{ss} of {YYYY}'), 1000);
});

test('resolveTokens reads the millis it is given, never the wall clock', () => {
    assert.strictEqual(raster.resolveTokens('{HH}:{mm}:{ss}', AT), '15:04:05');
    assert.strictEqual(raster.resolveTokens('{h}{a}', AT), '3pm');
    assert.strictEqual(raster.resolveTokens('{hh} {A}', AT), '03 PM');
    assert.strictEqual(raster.resolveTokens('{DD}/{MM}/{YY}', AT), '17/08/26');
    assert.strictEqual(raster.resolveTokens('{D}/{M}/{YYYY}', AT), '17/8/2026');
    // MM is the month and mm the minutes, as everywhere else that spells dates.
    assert.notStrictEqual(raster.resolveTokens('{MM}', AT), raster.resolveTokens('{mm}', AT));
});

test('an unrecognised brace is ordinary text', () => {
    assert.strictEqual(raster.resolveTokens('a {nope} b', AT), 'a {nope} b');
    assert.strictEqual(raster.resolveTokens('{HH', AT), '{HH');
    assert.strictEqual(raster.resolveTokens('50% {off}', AT), '50% {off}');
});

test('resolveTokens answers a string for anything that is not one', () => {
    assert.strictEqual(raster.resolveTokens(null, AT), '');
    assert.strictEqual(raster.resolveTokens(undefined, AT), '');
    assert.strictEqual(raster.resolveTokens({ evil: true }, AT), '');
});

// --- layout -----------------------------------------------------------------

test('a line is the sum of its glyphs plus tracking between them, never after', () => {
    const w = (ch) => REGULAR.glyph(ch).width;
    for (const tracking of [0, 1, 3]) {
        const mask = raster.layoutLine(REGULAR, 'Hi!', tracking);
        assert.strictEqual(mask.width, w('H') + w('i') + w('!') + tracking * 2,
            `tracking ${tracking}`);
    }
});

test('an empty line has no width and no cells', () => {
    const mask = raster.layoutLine(REGULAR, '', 1);
    assert.strictEqual(mask.width, 0);
    assert.strictEqual(mask.cells.length, 0);
    assert.strictEqual(mask.rows, REGULAR.height);
});

test('layout truncates at MAX_TEXT rather than sizing a buffer off user input', () => {
    const mask = raster.layoutLine(REGULAR, 'x'.repeat(5000), 0);
    assert.strictEqual(mask.width, raster.MAX_TEXT * REGULAR.glyph('x').width);
});

test('the glyphs land in the order they were typed', () => {
    const mask = raster.layoutLine(HEAVY, 'IL', 0);
    const I = HEAVY.glyph('I');
    const L = HEAVY.glyph('L');
    assert.strictEqual(mask.width, I.width + L.width);
    // The narrow I is first, so the wide L's columns start after it.
    assert.deepStrictEqual(Array.from(mask.cells.slice(0, I.width * mask.rows)), Array.from(I.cells));
    assert.deepStrictEqual(Array.from(mask.cells.slice(I.width * mask.rows)), Array.from(L.cells));
});

test('the wrap period never shows a fitting line twice, and clamps its gap', () => {
    assert.strictEqual(raster.wrapPeriod(6, 30, 0), 30);
    assert.strictEqual(raster.wrapPeriod(6, 30, 8), 38);
    assert.strictEqual(raster.wrapPeriod(200, 30, 8), 208);
    assert.strictEqual(raster.wrapPeriod(6, 30, 1e9), 30 + raster.MAX_GAP);
    assert.strictEqual(raster.wrapPeriod(6, 30, -5), 30);
    assert.ok(raster.wrapPeriod(0, 0, 0) >= 1, 'the period must never be zero — it is a modulus');
});

// --- the lattice ------------------------------------------------------------

test('the grid comes off the model, top row first', () => {
    const grid = raster.makeGrid(gridCtx(30, 8));
    assert.strictEqual(grid.cols, 30);
    assert.strictEqual(grid.rows, 8);
    // Pixel 0 is the most negative modelX and modelZ: leftmost column, top row.
    assert.strictEqual(grid.colOf[0], 0);
    assert.strictEqual(grid.rowOf[0], 0);
    // The last pixel is the opposite corner.
    assert.strictEqual(grid.colOf[239], 29);
    assert.strictEqual(grid.rowOf[239], 7);
});

// --- sampling ---------------------------------------------------------------

test('softness 0 on a whole column reproduces the mask exactly', () => {
    const { at, mask, grid } = coverageOf(HEAVY, 'L', { softness: 0 });
    const originCol = Math.round((grid.cols - mask.width) / 2);
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < mask.width; c++) {
            const expected = mask.cells[c * mask.rows + r] / 255;
            assert.ok(Math.abs(at(r, originCol + c) - expected) < 1e-6,
                `cell ${r},${c}: ${at(r, originCol + c)} vs ${expected}`);
        }
    }
});

test('a half-column offset splits a stroke evenly across two columns', () => {
    const whole = coverageOf(HEAVY, 'I', { softness: 0, originCol: 10 });
    const half = coverageOf(HEAVY, 'I', { softness: 0, originCol: 10.5 });
    // The I is a 2-column block, so whole lands on 10 and 11 at full coverage.
    assert.ok(Math.abs(whole.at(3, 10) - 1) < 1e-6);
    assert.ok(Math.abs(whole.at(3, 11) - 1) < 1e-6);
    assert.ok(whole.at(3, 12) < 1e-6);
    // Shifted half a column it covers three, half-lit at each end — sub-pixel
    // positioning, which is what stops a scroll stepping column to column.
    assert.ok(Math.abs(half.at(3, 10) - 0.5) < 1e-6, `${half.at(3, 10)}`);
    assert.ok(Math.abs(half.at(3, 11) - 1) < 1e-6, `${half.at(3, 11)}`);
    assert.ok(Math.abs(half.at(3, 12) - 0.5) < 1e-6, `${half.at(3, 12)}`);
});

test('partial glyph cells carry through the tent proportionally', () => {
    // The rounded face's corner cells are the whole reason coverage is a byte.
    const { at, mask, grid } = coverageOf(ROUND, 'O', { softness: 0 });
    const originCol = Math.round((grid.cols - mask.width) / 2);
    const authored = [];
    const rendered = [];
    for (let c = 0; c < mask.width; c++) {
        const v = mask.cells[c * mask.rows + 0];
        if (v > 0 && v < 255) {
            authored.push(v / 255);
            rendered.push(at(0, originCol + c));
        }
    }
    assert.ok(authored.length >= 2, 'the O should have partial cells on its top row');
    for (let i = 0; i < authored.length; i++) {
        assert.ok(Math.abs(rendered[i] - authored[i]) < 1e-6,
            `partial cell ${i}: rendered ${rendered[i]} for authored ${authored[i]}`);
    }
});

// Normalising over only the covered cells would scale a sliver of weight back up
// to a full-brightness stroke, and type would stop fading at its edges.
test('the tent normalises over cells outside the glyph too, so softness dims', () => {
    const sharp = coverageOf(REGULAR, 'l', { softness: 0 });
    const soft = coverageOf(REGULAR, 'l', { softness: 0.5 });
    const peak = (cov) => Math.max.apply(null, Array.from(cov));
    assert.ok(Math.abs(peak(sharp.cov) - 1) < 1e-6, 'a whole cell is fully covered');
    assert.ok(peak(soft.cov) < 0.95, `softness should dim an isolated stroke, got ${peak(soft.cov)}`);
    assert.ok(peak(soft.cov) > 0.4, 'but not extinguish it');
    // Light spreads rather than disappearing: the total is roughly conserved.
    const total = (cov) => Array.from(cov).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total(soft.cov) - total(sharp.cov)) / total(sharp.cov) < 0.1,
        `blurring should conserve light: ${total(soft.cov)} vs ${total(sharp.cov)}`);
});

// The measurement behind "use a bold face for a negative mask": a punch-out is
// only as deep as the coverage is complete, and how complete that gets is set by
// how many cells wide the run is against the tent's radius. At softness 0.2 a
// six-wide bar reaches 0.98, a two-column stem 0.88 and a one-column stroke 0.77
// — so the same mask leaves a quarter of the layer below showing through
// `regular` and a fiftieth through `heavy`.
test('coverage completes on a wide run and falls short on a thin stroke', () => {
    const peak = (c) => Math.max.apply(null, Array.from(c.cov));
    const bar = peak(coverageOf(HEAVY, 'L', { softness: 0.2 }));
    const stem = peak(coverageOf(HEAVY, 'I', { softness: 0.2 }));
    const thin = peak(coverageOf(REGULAR, 'l', { softness: 0.2 }));
    assert.ok(bar > stem && stem > thin, `expected bar > stem > thin, got ${bar}, ${stem}, ${thin}`);
    assert.ok(bar > 0.95, `a six-wide bar should all but complete: ${bar}`);
    assert.ok(thin < 0.8, `a one-column stroke cannot: ${thin}`);
    // At softness 0 every one of them is exact — the shortfall is the blur, not
    // the font, which is why the punch-out preset carries a low softness.
    assert.strictEqual(peak(coverageOf(REGULAR, 'l', { softness: 0 })), 1);
});

test('the line wraps at the period and repeats identically', () => {
    const grid = raster.makeGrid(gridCtx(30, 8));
    const sampler = raster.createSampler(grid.cols, grid.rows, 8);
    const mask = raster.layoutLine(HEAVY, 'AB', 1);
    const period = raster.wrapPeriod(mask.width, grid.cols, 8);
    const a = Array.from(raster.sample(sampler, mask, period, 3, 0, 0));
    const b = Array.from(raster.sample(sampler, mask, period, 3 - period, 0, 0));
    assert.deepStrictEqual(b, a, 'one period of scroll must land back on the same frame');
});

test('rows off the top or bottom of the panel are gone, not wrapped', () => {
    // Vertical has no period: a glyph pushed off the top must not reappear below.
    const shifted = coverageOf(HEAVY, 'L', { softness: 0, originRow: -4 });
    for (let c = 0; c < 30; c++) {
        for (let r = 4; r < 8; r++) {
            assert.strictEqual(shifted.at(r, c), 0, `row ${r} should be empty`);
        }
    }
});

test('sampling an empty line leaves the panel dark', () => {
    const { cov } = coverageOf(REGULAR, '', { softness: 0.5 });
    assert.ok(Array.from(cov).every(v => v === 0));
});

test('an absurd softness is clamped rather than sizing an unbounded loop', () => {
    const { cov } = coverageOf(HEAVY, 'A', { softness: 1e9 });
    assert.ok(Array.from(cov).every(v => Number.isFinite(v) && v >= 0 && v <= 1));
});
