/*
 * Text — one line of type on the panel, static or scrolling, with clock tokens
 * resolved inside the string.
 *
 * The tokens are *in the text* rather than behind a mode enum: "Clock" is a
 * preset, not a variant, so `{HH}:{mm}` and `It is {h}:{mm}{a}` are the same
 * effect doing the same thing, and no control changes meaning when a scene
 * happens to be telling the time.
 *
 * There are no position params. The line is centred — the case that wants
 * placing is a line narrower than the panel, and there is exactly one sensible
 * place for it; a line wider than the panel shows its middle standing still and
 * a scroll is how you read the rest. Vertically a face is centred in the panel's
 * eight rows, which is a whole-row offset for the six-row faces and nothing at
 * all for the rest — no face has anything hanging below its baseline.
 *
 * `background` is what makes the layer able to *remove* something. It renders
 * `background + coverage * (colour - background)` — a lerp, not a scale — so
 * black (the default) draws nothing but the letters, exactly as scaling the ink
 * would, while white with black ink makes the layer a negative and a `multiply`
 * blend punches the letters out of everything below it. The lerp is the point:
 * a partial coverage cell lands *between* the two colours, so the punch-out
 * inherits the same antialiased edge the type has. Note the punch is only as
 * deep as the coverage is complete — a one-column stroke never reaches 1, so a
 * negative mask wants a two-column-stem face and a low softness (see API.md).
 *
 * Cost is about 0.007ms a frame against a 10ms tick, and the per-frame path
 * allocates nothing: the mask is rebuilt only when the *resolved* string
 * changes, so a {ss} clock rebuilds once a second, a {mm} clock once a minute,
 * and static text never.
 */

var color = require('../engine/color');
var textFont = require('../engine/text-font');
var raster = require('../engine/text-raster');

var MAX_ROWS = textFont.CELL_ROWS;
var DEFAULT_SOFTNESS = 0.2;

function clamp(v, lo, hi, fallback) {
    var n = typeof v === 'number' && isFinite(v) ? v : fallback;
    return n < lo ? lo : (n > hi ? hi : n);
}

// hexToRgb answers white for anything unparseable, which is right for ink and
// wrong for a ground: a bad background would light the whole panel. Black there
// degrades to ordinary type instead.
function bgToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return { r: 0, g: 0, b: 0 };
    return color.hexToRgb(hex);
}

module.exports = {
    type: 'text',
    name: 'Text',
    schema: [
        { key: 'text', type: 'text', label: 'Text', maxLength: raster.MAX_TEXT,
          hint: '{HH}:{mm} clock · {ss} {a} {DD} {MM}' },
        textFont.FONT_SCHEMA,

        { type: 'group', label: 'Colour' },
        { key: 'color', type: 'color', label: 'Colour' },
        // Black is "no background". Anything else and the layer covers the whole
        // panel, which is what a negative mask needs it to do.
        { key: 'background', type: 'color', label: 'Background' },
        { key: 'level', type: 'number', label: 'Level', min: 0, max: 2, step: 0.01, scale: 'linear', modulatable: true },

        { type: 'group', label: 'Shape' },
        // 0 is plain linear interpolation, which is already sub-pixel — this is
        // the aesthetic part on top of it. Linear, not log: it spans one order,
        // and 0 has to be reachable without `zeroable` gymnastics.
        { key: 'softness', type: 'number', label: 'Softness', min: 0, max: 1.5, step: 0.05, scale: 'linear', modulatable: true },
        { key: 'tracking', type: 'number', label: 'Tracking', min: 0, max: 4, step: 1, scale: 'linear' },

        { type: 'group', label: 'Motion' },
        // Columns per second, signed, and linear for gradient_linear's `spin`
        // reason: it does not span decades, and a log track cannot reach a
        // negative at all — which would need a direction enum beside it for a
        // quantity with no other use for one. Positive reads right-to-left.
        { key: 'scroll', type: 'number', label: 'Scroll', min: -40, max: 40, step: 0.5, scale: 'linear', modulatable: true },
        // Blank columns between the end of the line and its next repeat. Only
        // does anything while scrolling.
        { key: 'gap', type: 'number', label: 'Gap', min: 0, max: 40, step: 1, scale: 'linear' },
    ],
    defaults: {
        text: 'Hello',
        font: 'regular',
        color: '#ffb84d',
        background: '#000000',
        level: 1,
        softness: DEFAULT_SOFTNESS,
        tracking: 1,
        scroll: 0,
        gap: 8,
    },

    // Starting points inside the layer editor, not picker tiles. The punch-out
    // is here because the pairing it needs — bold face, low softness, white
    // ground, black ink, and a multiply blend on the layer — is the one thing
    // about this effect that is not discoverable from the controls.
    presets: [
        { id: 'clock', name: 'Clock', params: {
            text: '{HH}:{mm}', font: 'regular', color: '#ffb84d', background: '#000000',
            level: 1, softness: 0.2, tracking: 1, scroll: 0, gap: 8 } },
        { id: 'marquee', name: 'Marquee', params: {
            text: 'The quick brown fox jumps over the lazy dog!', font: 'regular',
            color: '#ffb84d', background: '#000000',
            level: 1, softness: 0.25, tracking: 1, scroll: 12, gap: 8 } },
        { id: 'banner', name: 'Bold banner', params: {
            text: 'NOW PLAYING', font: 'bold', color: '#4fd0ff', background: '#000000',
            level: 1, softness: 0.3, tracking: 1, scroll: 10, gap: 10 } },
        // Set this layer's blend to Multiply to see what it is for.
        { id: 'punchout', name: 'Punch-out mask', params: {
            text: 'PLAY', font: 'bold', color: '#000000', background: '#ffffff',
            level: 1, softness: 0.1, tracking: 1, scroll: 0, gap: 8 } },
    ],

    /*
     * Params are never type-checked anywhere else — scene-store's
     * normaliseLayer merges them over defaults and validates nothing but
     * opacity — so everything that could arrive over the API as the wrong type
     * or an absurd number is defended here, on the write path, rather than
     * thrown inside the 10ms tick.
     */
    prepare(params) {
        var text = typeof params.text === 'string' ? params.text.slice(0, raster.MAX_TEXT) : '';
        var font = textFont.FONTS[params.font] ? params.font : textFont.DEFAULT_FONT;
        var rgb = color.hexToRgb(params.color);
        var bg = bgToRgb(params.background);
        var level = clamp(params.level, 0, 8, 1);
        return {
            text: text,
            font: font,
            tokenMs: raster.tokenPeriod(text),
            r: rgb.r * level,
            g: rgb.g * level,
            b: rgb.b * level,
            // Level scales the ground too: dimming a mask means dimming what it
            // does to the layer below, and against the default black ground it
            // is indistinguishable from scaling the ink alone.
            bgR: bg.r * level,
            bgG: bg.g * level,
            bgB: bg.b * level,
            softness: clamp(params.softness, 0, raster.MAX_SOFTNESS, DEFAULT_SOFTNESS),
            tracking: Math.round(clamp(params.tracking, 0, raster.MAX_TRACKING, 1)),
            gap: Math.round(clamp(params.gap, 0, raster.MAX_GAP, 8)),
            scroll: clamp(params.scroll, -200, 200, 0),
        };
    },

    // Nothing to settle: every frame is a pure function of the time it is asked
    // for, so a filmstrip can capture this layer cold.
    warmupMs() {
        return 0;
    },

    createInstance(ctx) {
        var grid = raster.makeGrid(ctx);
        var sampler = raster.createSampler(grid.cols, grid.rows, MAX_ROWS);
        var n = ctx.numPixels;
        var maskKey = null;
        var mask = null;
        var resolved = '';
        var resolvedAt = null;
        var resolvedFrom = null;

        return {
            render(out, millis, p) {
                // The resolution cache is keyed on the *source* string as well
                // as the clock bucket, and both halves are load-bearing. The
                // bucket alone is what a clock needs — {ss} re-resolves once a
                // second and {HH} once a minute — but it makes the source
                // string invisible to the cache, so a keystroke landing inside
                // the bucket a token last resolved in never re-resolves and the
                // layer keeps rendering the old line. tokenPeriod() is a minute
                // for every token but {ss}/{s}, so that is up to 60s of typing
                // into a panel that does not change and then catches up all at
                // once, which reads as a flaky layer rather than a stale cache.
                // The source string alone is not enough either: it is the same
                // string every frame while a clock ticks. Note the bucket has to
                // be reset on the token-free path too — otherwise removing a
                // token and putting it back inside one minute leaves a stale
                // bucket matching, and the layer renders neither string.
                var bucket = p.tokenMs === 0 ? 0 : Math.floor(millis / p.tokenMs);
                if (bucket !== resolvedAt || p.text !== resolvedFrom) {
                    resolved = p.tokenMs === 0 ? p.text : raster.resolveTokens(p.text, millis);
                    resolvedAt = bucket;
                    resolvedFrom = p.text;
                }
                var key = p.font + '|' + p.tracking + '|' + resolved;
                if (key !== maskKey) {
                    mask = raster.layoutLine(textFont.FONTS[p.font], resolved, p.tracking);
                    maskKey = key;
                }

                var period = raster.wrapPeriod(mask.width, grid.cols, p.gap);
                // Positive scroll reads right-to-left, the default reading
                // direction: the origin walks left, so a fixed LED sees later
                // mask columns as time passes.
                var phase = (p.scroll * (millis / 1000)) % period;
                // The centring term is *rounded to a whole column*: half of an
                // odd remainder would leave every static line permanently
                // smeared across two columns at half brightness, which reads as
                // a soft font rather than as an off-by-half-a-cell.
                var originCol = Math.round((grid.cols - mask.width) / 2) - phase;
                // Rounded to a whole row: the six-row faces sit one row down,
                // and a half-row offset would smear every line across two rows
                // the way a half-column one smears it across two columns.
                var originRow = Math.round((grid.rows - mask.rows) / 2);

                var cov = raster.sample(sampler, mask, period, originCol, originRow, p.softness);
                var cols = grid.cols;
                var dr = p.r - p.bgR;
                var dg = p.g - p.bgG;
                var db = p.b - p.bgB;
                for (var i = 0; i < n; i++) {
                    var a = cov[grid.rowOf[i] * cols + grid.colOf[i]];
                    out[i * 3] = p.bgR + a * dr;
                    out[i * 3 + 1] = p.bgG + a * dg;
                    out[i * 3 + 2] = p.bgB + a * db;
                }
            }
        };
    }
};
