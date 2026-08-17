const test = require('node:test');
const assert = require('node:assert');

const textFont = require('../engine/text-font');

const FACES = Object.keys(textFont.FONTS);
const LEVELS = Object.keys(textFont.LEVELS).map(k => textFont.LEVELS[k]);

// Requiring the module at all compiles every glyph of every face — compile()
// throws on a ragged row, a wrong row count or a character off the ramp — so
// these tests are about the invariants compile() cannot see.

test('every glyph is a rectangle of its declared width and its face height', () => {
    for (const face of FACES) {
        const font = textFont.FONTS[face];
        for (const ch of Object.keys(font.glyphs)) {
            const g = font.glyphs[ch];
            assert.ok(g.width >= 1, `${face} '${ch}' has width ${g.width}`);
            assert.strictEqual(g.cells.length, g.width * font.height,
                `${face} '${ch}' has ${g.cells.length} cells for ${g.width}x${font.height}`);
            assert.strictEqual(g.ink.length, g.width);
        }
    }
});

test('no glyph carries coverage outside its face height', () => {
    for (const face of FACES) {
        const font = textFont.FONTS[face];
        assert.strictEqual(font.height, textFont.CELL_ROWS);
        for (const ch of Object.keys(font.glyphs)) {
            const g = font.glyphs[ch];
            // The storage cannot express a row past the height, so what this
            // really pins is that the height is the one the face was drawn at:
            // an art table edited to 9 rows would throw in compile() instead.
            assert.strictEqual(g.cells.length % font.height, 0, `${face} '${ch}'`);
        }
    }
});

test('every cell value is on the authoring ramp', () => {
    for (const face of FACES) {
        const font = textFont.FONTS[face];
        for (const ch of Object.keys(font.glyphs)) {
            for (const v of font.glyphs[ch].cells) {
                assert.ok(LEVELS.indexOf(v) !== -1, `${face} '${ch}' has cell value ${v}`);
            }
        }
    }
});

// A clock is the reason this matters: with unequal digit widths the line reflows
// when the minute rolls 19 -> 20 and the whole thing jumps sideways.
test('every digit in a face is the same width', () => {
    for (const face of FACES) {
        const font = textFont.FONTS[face];
        const widths = new Set();
        for (const d of '0123456789') {
            assert.ok(font.glyphs[d], `${face} is missing digit ${d}`);
            widths.add(font.glyphs[d].width);
        }
        assert.strictEqual(widths.size, 1, `${face} digit widths: ${[...widths].join(', ')}`);
    }
});

test('an ink flag is set exactly for the columns that carry coverage', () => {
    for (const face of FACES) {
        const font = textFont.FONTS[face];
        for (const ch of Object.keys(font.glyphs)) {
            const g = font.glyphs[ch];
            for (let c = 0; c < g.width; c++) {
                let any = 0;
                for (let r = 0; r < font.height; r++) {
                    if (g.cells[c * font.height + r] > 0) any = 1;
                }
                assert.strictEqual(g.ink[c], any, `${face} '${ch}' column ${c}`);
            }
        }
    }
});

test('regular covers the whole printable ASCII range', () => {
    const font = textFont.FONTS.regular;
    for (let code = 32; code <= 126; code++) {
        const ch = String.fromCharCode(code);
        assert.ok(font.glyphs[ch], `regular is missing '${ch}' (${code})`);
    }
    assert.strictEqual(font.fold, false, 'regular has lowercase of its own and must not fold');
});

// A caps-only face folding is a reading of what was typed; a line of boxes is
// not. The faces that fold are the ones with no lowercase to fold to.
test('the caps-only faces fold lowercase and regular does not', () => {
    for (const face of FACES) {
        const font = textFont.FONTS[face];
        if (font.fold) {
            assert.strictEqual(font.glyph('a'), font.glyphs.A, `${face} should fold 'a' to 'A'`);
            assert.ok(!font.glyphs.a, `${face} folds, so it should carry no lowercase art`);
        } else {
            assert.ok(font.glyphs.a, `${face} does not fold, so it needs lowercase art`);
            assert.notStrictEqual(font.glyph('a'), font.glyphs.A);
        }
    }
});

test('an unknown character renders as the box rather than nothing', () => {
    for (const face of FACES) {
        const font = textFont.FONTS[face];
        const g = font.glyph('中');
        assert.strictEqual(g, font.tofu, `${face} should answer tofu for an unknown character`);
        assert.ok(g.ink.some(v => v === 1), `${face} tofu must be visible`);
    }
});

// The schema lives beside the data so a face added here is reachable without a
// second edit in the effect — this is the test that keeps them honest.
test('the font schema offers exactly the faces that exist', () => {
    const offered = textFont.FONT_SCHEMA.options.map(o => o.value);
    assert.deepStrictEqual(offered.slice().sort(), FACES.slice().sort());
    for (const o of textFont.FONT_SCHEMA.options) {
        assert.ok(o.label && typeof o.label === 'string');
    }
    assert.ok(textFont.FONTS[textFont.DEFAULT_FONT], 'the default font must exist');
});

test('get falls back to the default face for an unknown key', () => {
    assert.strictEqual(textFont.get('bold'), textFont.FONTS.bold);
    assert.strictEqual(textFont.get('nope'), textFont.FONTS[textFont.DEFAULT_FONT]);
    assert.strictEqual(textFont.get(undefined), textFont.FONTS[textFont.DEFAULT_FONT]);
});

// The rounded face is the reason cells are bytes rather than bits: it is only
// different from `heavy` in the cells that are neither empty nor full.
test('round carries partial coverage and heavy does not', () => {
    const partial = (font) => {
        let count = 0;
        for (const ch of Object.keys(font.glyphs)) {
            for (const v of font.glyphs[ch].cells) if (v > 0 && v < 255) count++;
        }
        return count;
    };
    assert.strictEqual(partial(textFont.FONTS.heavy), 0);
    assert.strictEqual(partial(textFont.FONTS.bold), 0);
    assert.strictEqual(partial(textFont.FONTS.regular), 0);
    assert.ok(partial(textFont.FONTS.round) > 20, 'round should be drawn with partial cells');
});

// Flat-sided letters have nothing to round, and softening them would only lose
// contrast — so they are the same art in both faces.
test('round leaves the flat-sided letters identical to heavy', () => {
    for (const ch of 'EFHILT') {
        assert.deepStrictEqual(
            Array.from(textFont.FONTS.round.glyphs[ch].cells),
            Array.from(textFont.FONTS.heavy.glyphs[ch].cells),
            `'${ch}' should not differ between heavy and round`);
    }
});
