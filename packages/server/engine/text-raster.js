/*
 * Line layout, clock tokens, and the sampling of a glyph mask onto the LED
 * lattice — the maths behind the text effect, kept apart from it for the reason
 * particles.js is kept apart from the emitter: it is the part worth testing on
 * its own.
 *
 * The mask is a lattice of cells and the panel is another lattice, and they do
 * not line up: a scrolling line sits at a fractional column offset almost all of
 * the time. Looking up the nearest mask cell per LED makes a stroke pop from one
 * column to the next, which at 100 FPS reads as a stutter rather than as motion.
 * So an LED *integrates over* the mask: a normalised tent of radius
 * `1 + softness` cells, separable, computed per column and per row once a frame.
 *
 * Radius 1 is exactly linear interpolation — sub-pixel positioning for free — so
 * that is the floor, not zero width. Above it, softness is the aesthetic part,
 * meeting the panel's own diffusion; what it should be depends on the scroll
 * speed and on whether the layer is being read as type or feeding a blend, which
 * is why it is a control rather than a tuned constant.
 */

/*
 * Clamps. Schema min/max is only a slider hint everywhere else in this codebase
 * and typed entry is deliberately unclamped — but these size the mask buffer and
 * bound loops that run inside the 10ms tick, so a typed-in absurdity has to be
 * caught here rather than merely pinned on a track.
 */
var MAX_TEXT = 256;
var MAX_TRACKING = 8;
var MAX_GAP = 64;
var MAX_SOFTNESS = 8;

/*
 * Clock tokens live *in the string*, so the Text field never stops meaning what
 * it says and "Clock" is a preset rather than a mode. moment-ish and
 * case-sensitive (MM month, mm minutes) is the least surprising set, and an
 * unrecognised brace passes through verbatim so nothing is stolen from ordinary
 * text.
 */
var TOKEN = /\{(HH|H|hh|h|mm|m|ss|s|a|A|DD|D|MM|M|YYYY|YY)\}/g;

function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}

/*
 * How often the resolved string can change, so the render path can skip
 * rebuilding it — and allocating a string — on every one of 100 frames a second:
 * 0 for text with no tokens at all, 1s if it shows seconds, else a minute.
 */
function tokenPeriod(text) {
    if (typeof text !== 'string') return 0;
    var period = 0;
    var m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text)) !== null) {
        var t = m[1];
        if (t === 'ss' || t === 's') return 1000;
        period = 60000;
    }
    return period;
}

/*
 * Resolved against the `millis` the render loop passes, never Date.now() inside
 * the effect: every effect being a pure function of absolute millis is what
 * engine/filmstrip.js depends on to render a 4s loop in 40 renders.
 */
function resolveTokens(text, millis) {
    if (typeof text !== 'string') return '';
    if (text.indexOf('{') === -1) return text;
    var d = new Date(millis);
    return text.replace(TOKEN, function(all, t) {
        var h24 = d.getHours();
        var h12 = h24 % 12 === 0 ? 12 : h24 % 12;
        switch (t) {
            case 'HH': return pad2(h24);
            case 'H': return '' + h24;
            case 'hh': return pad2(h12);
            case 'h': return '' + h12;
            case 'mm': return pad2(d.getMinutes());
            case 'm': return '' + d.getMinutes();
            case 'ss': return pad2(d.getSeconds());
            case 's': return '' + d.getSeconds();
            case 'a': return h24 < 12 ? 'am' : 'pm';
            case 'A': return h24 < 12 ? 'AM' : 'PM';
            case 'DD': return pad2(d.getDate());
            case 'D': return '' + d.getDate();
            case 'MM': return pad2(d.getMonth() + 1);
            case 'M': return '' + (d.getMonth() + 1);
            case 'YYYY': return '' + d.getFullYear();
            case 'YY': return pad2(d.getFullYear() % 100);
            default: return all;
        }
    });
}

/*
 * One line of type as cells: `cells[c * rows + r]` is the coverage of row r in
 * column c, and `ink[c]` says whether column c has any at all. `tracking` is the
 * gap *between* glyphs and never after the last one, so a line's width does not
 * depend on which end you measure from.
 */
function layoutLine(font, text, tracking) {
    var t = tracking > 0 ? Math.round(tracking) : 0;
    var chars = typeof text === 'string' ? text.slice(0, MAX_TEXT) : '';
    var rows = font.height;
    var width = 0;
    var i;
    for (i = 0; i < chars.length; i++) {
        if (i > 0) width += t;
        width += font.glyph(chars[i]).width;
    }
    var cells = new Uint8Array(width * rows);
    var ink = new Uint8Array(width);
    var at = 0;
    for (i = 0; i < chars.length; i++) {
        if (i > 0) at += t;
        var g = font.glyph(chars[i]);
        cells.set(g.cells, at * rows);
        ink.set(g.ink, at);
        at += g.width;
    }
    return { cells: cells, ink: ink, width: width, rows: rows };
}

/*
 * The line repeats every max(lineWidth, panelWidth) + gap columns, so a word
 * that fits on the panel never appears on it twice whatever the gap is — and
 * scroll 0 is then genuinely one static instance of the line.
 */
function wrapPeriod(lineWidth, panelCols, gap) {
    var g = Math.max(0, Math.min(MAX_GAP, Math.round(gap)));
    return Math.max(1, Math.max(lineWidth, panelCols) + g);
}

/*
 * The column and row lattice, read off the model rather than hardcoded 30x8:
 * layout.json is the source of truth for the panel's shape and a second copy of
 * it is how something ends up rendered 180 degrees round. Coordinates arrive as
 * float32, so positions are grouped with a tolerance rather than compared.
 *
 * Ascending modelX is rightwards and ascending modelZ is *downwards* — modelZ
 * +0.875 is the panel's bottom row, the negation every effect owes the xy pad
 * somewhere — so both axes sort straight into ascending grid indices and row 0
 * of a glyph lands on the panel's top row.
 */
function makeGrid(ctx, tolerance) {
    var tol = tolerance || 0.05;
    var n = ctx.numPixels;
    var xs = uniqueSorted(ctx.modelX, n, tol);
    var zs = uniqueSorted(ctx.modelZ, n, tol);
    var colOf = new Int16Array(n);
    var rowOf = new Int16Array(n);
    for (var i = 0; i < n; i++) {
        colOf[i] = nearestIndex(xs, ctx.modelX[i]);
        rowOf[i] = nearestIndex(zs, ctx.modelZ[i]);
    }
    return { cols: xs.length, rows: zs.length, colOf: colOf, rowOf: rowOf };
}

function uniqueSorted(values, n, tol) {
    var sorted = Array.prototype.slice.call(values, 0, n).sort(function(a, b) { return a - b; });
    var out = [];
    for (var i = 0; i < sorted.length; i++) {
        if (out.length === 0 || sorted[i] - out[out.length - 1] > tol) out.push(sorted[i]);
    }
    return out;
}

function nearestIndex(sorted, v) {
    var best = 0;
    var bestD = Infinity;
    for (var i = 0; i < sorted.length; i++) {
        var d = Math.abs(sorted[i] - v);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

// The per-frame buffers, allocated once. `maxRows` is the tallest face, so
// switching font does not reallocate mid-render.
function createSampler(gridCols, gridRows, maxRows) {
    return {
        gridCols: gridCols,
        gridRows: gridRows,
        maxRows: maxRows,
        temp: new Float32Array(maxRows * gridCols),
        coverage: new Float32Array(gridRows * gridCols),
    };
}

/*
 * Fills `sampler.coverage` with 0..1 per LED cell and returns it.
 *
 * `originCol` / `originRow` are where mask cell (0,0) lands on the panel, in
 * panel cells and fractional; `period` is the scroll wrap.
 *
 * Normalisation is over the whole support the kernel touches, *including cells
 * outside the glyph box*. Normalising over only the covered cells would scale a
 * sliver of weight back up to a full-brightness stroke and type would stop
 * fading out at its edges — which is the same thing as saying the blur would
 * stop being a blur.
 */
function sample(sampler, mask, period, originCol, originRow, softness) {
    var gridCols = sampler.gridCols;
    var gridRows = sampler.gridRows;
    var rows = mask.rows;
    var temp = sampler.temp;
    var cov = sampler.coverage;
    var c, r, m, w, wsum, lo, hi;
    temp.fill(0, 0, rows * gridCols);
    cov.fill(0, 0, gridRows * gridCols);

    var R = 1 + Math.max(0, Math.min(MAX_SOFTNESS, softness));

    // Horizontal pass: mask columns -> panel columns, at fractional positions.
    for (c = 0; c < gridCols; c++) {
        var u = c - originCol;
        lo = Math.ceil(u - R);
        hi = Math.floor(u + R);
        wsum = 0;
        for (m = lo; m <= hi; m++) {
            w = 1 - Math.abs(m - u) / R;
            if (w <= 0) continue;
            wsum += w;
            var mm = maskColumn(mask, m, period);
            if (mm < 0) continue;
            // A glyph cell carries coverage, not a bit — the `round` face draws
            // its curves in partial cells, and the tent multiplies through them
            // exactly as it does through a whole one.
            var src = mm * rows;
            var ww = w / 255;
            for (r = 0; r < rows; r++) {
                var v = mask.cells[src + r];
                if (v !== 0) temp[r * gridCols + c] += ww * v;
            }
        }
        if (wsum > 0 && wsum !== 1) {
            for (r = 0; r < rows; r++) temp[r * gridCols + c] /= wsum;
        }
    }

    // Vertical pass: mask rows -> panel rows. No wrap here; a row off the top or
    // the bottom of the panel is simply gone.
    for (r = 0; r < gridRows; r++) {
        var y = r - originRow;
        var base = r * gridCols;
        lo = Math.ceil(y - R);
        hi = Math.floor(y + R);
        wsum = 0;
        for (m = lo; m <= hi; m++) {
            w = 1 - Math.abs(m - y) / R;
            if (w <= 0) continue;
            wsum += w;
            if (m < 0 || m >= rows) continue;
            var from = m * gridCols;
            for (c = 0; c < gridCols; c++) cov[base + c] += temp[from + c] * w;
        }
        if (wsum > 0 && wsum !== 1) {
            for (c = 0; c < gridCols; c++) cov[base + c] /= wsum;
        }
    }
    return cov;
}

// The mask column a tap lands on, or -1 for one that is off the end of the line
// or entirely empty — the early-out that keeps spaces and the wrap gap cheap.
function maskColumn(mask, m, period) {
    var mm = m % period;
    if (mm < 0) mm += period;
    return mm < mask.width && mask.ink[mm] !== 0 ? mm : -1;
}

module.exports = {
    MAX_TEXT: MAX_TEXT,
    MAX_TRACKING: MAX_TRACKING,
    MAX_GAP: MAX_GAP,
    MAX_SOFTNESS: MAX_SOFTNESS,
    tokenPeriod: tokenPeriod,
    resolveTokens: resolveTokens,
    layoutLine: layoutLine,
    wrapPeriod: wrapPeriod,
    makeGrid: makeGrid,
    createSampler: createSampler,
    sample: sample,
};
