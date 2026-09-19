const test = require('node:test');
const assert = require('node:assert');

const text = require('../effects/text');
const { panelCtx } = require('./support/panel-ctx');

// --- text -------------------------------------------------------------------

// panelCtx() lays pixels out as i = row * COLS + col with ascending modelZ
// downward, so a pixel index maps straight onto a panel cell here.
const TEXT_COLS = 30;
function textCell(out, row, col) {
    const i = row * TEXT_COLS + col;
    return Math.max(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
}

function renderText(params, millis, ctx) {
    const p = text.prepare({ ...text.defaults, ...params });
    const out = new Float32Array(ctx.numPixels * 3);
    text.createInstance(ctx).render(out, millis === undefined ? 12345 : millis, p);
    return out;
}

// The 180-degree trap every effect on this panel has: modelZ +0.875 is the
// *bottom* row while a glyph's row 0 is its top. A symmetric glyph would hide a
// flip entirely, so this uses an L — ink at the top left, a full bar along the
// bottom — and checks the two ends separately.
test('a glyph renders the way up it was drawn', () => {
    const ctx = panelCtx();
    const out = renderText({ text: 'L', font: 'bold', softness: 0, color: '#ffffff' }, 12345, ctx);
    const L = require('../engine/text-font').FONTS.bold.glyph('L');
    const origin = Math.round((TEXT_COLS - L.width) / 2);

    // Top row: the stem only, on the left of the glyph.
    assert.ok(textCell(out, 0, origin) > 250, 'the L stem should light the top row');
    assert.ok(textCell(out, 0, origin + 1) > 250);
    assert.strictEqual(textCell(out, 0, origin + 4), 0, 'the top row has no foot');

    // Bottom row: the whole foot.
    for (let c = 0; c < L.width; c++) {
        assert.ok(textCell(out, 7, origin + c) > 250,
            `the L foot should fill the bottom row at column ${c}`);
    }
});

test('a line sits horizontally centred', () => {
    const ctx = panelCtx();
    const out = renderText({ text: 'I', font: 'bold', softness: 0, color: '#ffffff' }, 12345, ctx);
    const lit = [];
    for (let c = 0; c < TEXT_COLS; c++) if (textCell(out, 3, c) > 0) lit.push(c);
    // The bold I is two columns; centred on 30 they are 14 and 15.
    assert.deepStrictEqual(lit, [14, 15]);
});

test('positive scroll reads right-to-left', () => {
    const ctx = panelCtx();
    const centroid = (millis) => {
        const out = renderText({ text: 'I', font: 'bold', softness: 0, scroll: 10, color: '#ffffff' }, millis, ctx);
        let sum = 0, weight = 0;
        for (let c = 0; c < TEXT_COLS; c++) {
            const v = textCell(out, 3, c);
            sum += v * c;
            weight += v;
        }
        return weight > 0 ? sum / weight : null;
    };
    // 10 columns a second, sampled a fifth of a second apart: two columns left.
    const before = centroid(1000000);
    const after = centroid(1000200);
    assert.ok(before !== null && after !== null);
    assert.ok(after < before, `scroll should carry the line left (${after} vs ${before})`);
    assert.ok(Math.abs((before - after) - 2) < 1e-6, `and by 2 columns, not ${before - after}`);
});

test('a clock token resolves against the millis it is rendered for', () => {
    const ctx = panelCtx();
    const p = text.prepare({ ...text.defaults, text: '{HH}:{mm}', softness: 0 });
    const instance = text.createInstance(ctx);
    const a = new Float32Array(ctx.numPixels * 3);
    const b = new Float32Array(ctx.numPixels * 3);
    const at = (h, m) => new Date(2026, 7, 17, h, m, 0).getTime();
    instance.render(a, at(10, 15), p);
    instance.render(b, at(21, 45), p);
    assert.notDeepStrictEqual(Array.from(a), Array.from(b), 'a different time must render differently');
    // And the same instant renders the same frame however often it is asked —
    // the property engine/filmstrip.js depends on.
    const again = new Float32Array(ctx.numPixels * 3);
    instance.render(again, at(10, 15), p);
    assert.deepStrictEqual(Array.from(again), Array.from(a));
});

test('static text allocates no new mask once it is laid out', () => {
    // Not a memory assertion — a behavioural one: the cached mask must not go
    // stale when only the time moves on, and must rebuild when the string does.
    const ctx = panelCtx();
    const instance = text.createInstance(ctx);
    const out = new Float32Array(ctx.numPixels * 3);
    const hello = text.prepare({ ...text.defaults, text: 'Hello' });
    instance.render(out, 1000, hello);
    const first = Array.from(out);
    instance.render(out, 999000, hello);
    assert.deepStrictEqual(Array.from(out), first, 'static text must not drift with time');

    const world = text.prepare({ ...text.defaults, text: 'World' });
    instance.render(out, 999000, world);
    assert.notDeepStrictEqual(Array.from(out), first, 'a changed string must rebuild the mask');
});

// The regression the resolution cache's source-string key defends against.
// Keying it on the clock bucket alone made an edit invisible for as long as the
// bucket lasted — a minute for every token but {ss}/{s} — so the layer sat on
// the line it resolved first while the text kept being typed, then caught up in
// one jump when the minute rolled over.
test('an edit to a string holding a clock token takes effect immediately', () => {
    const ctx = panelCtx();
    const instance = text.createInstance(ctx);
    const out = new Float32Array(ctx.numPixels * 3);
    const at = new Date(2026, 7, 17, 10, 15, 0).getTime();
    const render = (s, millis) => {
        instance.render(out, millis, text.prepare({ ...text.defaults, text: s, softness: 0 }));
        return Array.from(out);
    };

    // {DD} is a minute-period token, so all three renders share one bucket.
    const day = render('{DD}', at);
    assert.notDeepStrictEqual(render('{DD} X', at + 50), day,
        'a keystroke inside the token period must re-resolve');
    assert.notDeepStrictEqual(render('{DD} XYZ', at + 100), day);

    // And the resolved value is still the right one, not merely a different
    // one: it must match what a fresh instance renders for the same string.
    const fresh = new Float32Array(ctx.numPixels * 3);
    text.createInstance(ctx).render(fresh,
        at + 100, text.prepare({ ...text.defaults, text: '{DD} XYZ', softness: 0 }));
    assert.deepStrictEqual(render('{DD} XYZ', at + 100), Array.from(fresh));
});

// The nastier half of the same bug: the token-free path used to leave the bucket
// behind, so a token removed and put back inside one minute matched a stale
// bucket and the layer rendered the string in between — not a prefix of what was
// typed, but arbitrary earlier content.
test('a clock token removed and restored inside its period still re-resolves', () => {
    const ctx = panelCtx();
    const instance = text.createInstance(ctx);
    const out = new Float32Array(ctx.numPixels * 3);
    const at = new Date(2026, 7, 17, 10, 15, 0).getTime();
    const render = (s, millis) => {
        instance.render(out, millis, text.prepare({ ...text.defaults, text: s, softness: 0 }));
        return Array.from(out);
    };

    const clock = render('{HH}', at);
    const plain = render('HELLO', at + 50);
    assert.notDeepStrictEqual(plain, clock);
    assert.deepStrictEqual(render('{HH}', at + 100), clock,
        'restoring the token must render the clock again, not the string it replaced');
});

// The compatibility guarantee for every layer already stored: the background
// lerp has to reduce to exactly what scaling the ink alone used to produce.
test('a black background renders identically to scaling the ink alone', () => {
    const ctx = panelCtx();
    const withBg = renderText({ text: 'Ag', background: '#000000', softness: 0.3 }, 12345, ctx);
    const p = text.prepare({ ...text.defaults, text: 'Ag', softness: 0.3 });
    const manual = new Float32Array(ctx.numPixels * 3);
    text.createInstance(ctx).render(manual, 12345, p);
    assert.deepStrictEqual(Array.from(withBg), Array.from(manual));
    // Nothing outside the letters is lit at all.
    assert.ok(Array.from(withBg).some(v => v === 0), 'the ground must be black, not merely dark');
});

test('a white background with black ink inverts the layer', () => {
    const ctx = panelCtx();
    const normal = renderText({ text: 'PLAY', font: 'bold', color: '#ffffff', background: '#000000', softness: 0 }, 12345, ctx);
    const negative = renderText({ text: 'PLAY', font: 'bold', color: '#000000', background: '#ffffff', softness: 0 }, 12345, ctx);
    for (let i = 0; i < normal.length; i++) {
        assert.ok(Math.abs(normal[i] + negative[i] - 255) < 1e-3,
            `pixel ${i}: ${normal[i]} + ${negative[i]} should be 255`);
    }
});

test('coverage 0 lands exactly on the background, not near it', () => {
    const ctx = panelCtx();
    const out = renderText({ text: 'I', font: 'bold', color: '#000000', background: '#204080', softness: 0 }, 12345, ctx);
    // Column 0 is nowhere near the centred I.
    assert.strictEqual(out[0], 0x20);
    assert.strictEqual(out[1], 0x40);
    assert.strictEqual(out[2], 0x80);
});

test('an unparseable background falls back to black, not to white', () => {
    // hexToRgb answers white for junk, which is right for ink and wrong for a
    // ground: a typo in a colour must not light the whole panel.
    const p = text.prepare({ ...text.defaults, background: 'rebeccapurple' });
    assert.strictEqual(p.bgR, 0);
    assert.strictEqual(p.bgG, 0);
    assert.strictEqual(p.bgB, 0);
});

test('level scales the ground as well as the ink', () => {
    const p = text.prepare({ ...text.defaults, color: '#ffffff', background: '#808080', level: 0.5 });
    assert.strictEqual(p.r, 127.5);
    assert.strictEqual(p.bgR, 64);
});

test('prepare defends against anything the API might send', () => {
    const ctx = panelCtx();
    const cases = [
        { text: null },
        { text: 42 },
        { text: { evil: true } },
        { text: 'x'.repeat(5000) },
        { text: '中文 emoji 😀' },
        { font: 'nope' },
        { font: null },
        { color: 'not a colour' },
        { softness: NaN },
        { softness: 1e9 },
        { softness: -5 },
        { tracking: 1e9 },
        { gap: 1e9 },
        { scroll: 1e12 },
        { level: -5 },
    ];
    for (const patch of cases) {
        const out = renderText(patch, 12345, ctx);
        assert.ok(out.every(v => Number.isFinite(v) && v >= 0),
            `${JSON.stringify(patch)} produced ${Array.from(out).find(v => !Number.isFinite(v) || v < 0)}`);
    }
});

test('every text preset renders and names a font that exists', () => {
    const ctx = panelCtx();
    const fonts = require('../engine/text-font').FONTS;
    for (const preset of text.presets) {
        assert.ok(fonts[preset.params.font], `${preset.id} names font ${preset.params.font}`);
        const out = renderText(preset.params, 12345, ctx);
        assert.ok(out.every(v => Number.isFinite(v)), preset.id);
        assert.ok(Array.from(out).some(v => v > 0), `${preset.id} should light something`);
    }
    // The punch-out is the one preset whose whole point is the ground.
    const punch = text.presets.find(p => p.id === 'punchout');
    assert.strictEqual(punch.params.background, '#ffffff');
    assert.strictEqual(punch.params.color, '#000000');
});

test('text needs no warm-up, so a filmstrip can capture it cold', () => {
    assert.strictEqual(text.warmupMs(text.prepare(text.defaults)), 0);
});
