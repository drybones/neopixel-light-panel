const test = require('node:test');
const assert = require('node:assert');

const textFont = require('../engine/text-font');

const FACES = Object.keys(textFont.FONTS);

// Requiring the module at all compiles every glyph of every face — compile()
// throws on a ragged row, a wrong row count or a character that is neither `.`
// nor `#` — so these tests are about the invariants compile() cannot see.

test('every glyph is one byte per column of its declared width', () => {
    for (const face of FACES) {
        const font = textFont.FONTS[face];
        for (const ch of Object.keys(font.glyphs)) {
            const g = font.glyphs[ch];
            assert.ok(g.width >= 1, `${face} '${ch}' has width ${g.width}`);
            assert.strictEqual(g.cols.length, g.width,
                `${face} '${ch}' has ${g.cols.length} columns for width ${g.width}`);
        }
    }
});

// A column is a byte, so a face taller than eight rows would silently lose its
// bottom row rather than failing — hence the assertion on the height itself.
test('no face is taller than a column byte can hold', () => {
    for (const face of FACES) {
        const font = textFont.FONTS[face];
        assert.ok(font.height <= textFont.CELL_ROWS, `${face} is ${font.height} rows`);
        for (const ch of Object.keys(font.glyphs)) {
            for (const byte of font.glyphs[ch].cols) {
                assert.ok(byte >> font.height === 0,
                    `${face} '${ch}' has a bit set below row ${font.height - 1}`);
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
        assert.ok(Array.from(g.cols).some(v => v !== 0), `${face} tofu must be visible`);
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

// Every caps-only face carries the same marks, so changing face never makes a
// character that was on the panel vanish.
test('the caps-only faces agree on their coverage', () => {
    const marks = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ!"%\'()+,-.:=?/';
    for (const face of FACES) {
        const font = textFont.FONTS[face];
        if (!font.fold) continue;
        for (const ch of marks) {
            assert.ok(font.glyphs[ch], `${face} is missing '${ch}'`);
        }
        assert.strictEqual(Object.keys(font.glyphs).length, marks.length,
            `${face} carries something the others do not`);
    }
});
