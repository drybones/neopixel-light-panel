/*
 * Schema-driven param coercion — the one place a layer's params are checked
 * against the types its effect declares.
 *
 * Every write reaches this through scene-store's normaliseLayer, so an effect's
 * prepare() and render() can assume the declared *types*: a number is a finite
 * number, a colour parses, an enum is one of its options, a stop list has at
 * least minStops usable stops. The rule is per field — a value of the wrong
 * type falls back to that field's default and leaves its neighbours alone —
 * because the alternative, rejecting the whole write, would make one stray
 * field in an import cost the entire library.
 *
 * Deliberately *not* checked: schema min/max. Those are slider hints, and a
 * typed value outside them is the recovery path for presets no slider can
 * reach (see API.md). A number is coerced to a number, never into a range.
 *
 * Keys the schema does not declare are passed through untouched, and a layer
 * whose effectType has no module keeps its params verbatim, so nothing an older
 * or newer server wrote is thrown away by this one.
 */

// hexToRgb's own pattern: the leading # is optional there, so it is here.
var HEX = /^#?[a-f\d]{6}$/i;

function finiteNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : undefined;
    // A numeric string is a number that went through a text field somewhere;
    // "left" is not, and neither is "" (Number('') is 0).
    if (typeof v === 'string' && v.trim() !== '') {
        var n = Number(v);
        return isFinite(n) ? n : undefined;
    }
    return undefined;
}

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Unusable stops are dropped one by one, and the list falls back to the default
// only if fewer than minStops survive: a single bad stop in an otherwise good
// gradient should cost that stop, not the gradient.
function coerceStops(v, minStops) {
    if (!Array.isArray(v)) return undefined;
    var out = [];
    v.forEach(function(stop) {
        if (!isPlainObject(stop)) return;
        var position = finiteNumber(stop.position);
        if (position === undefined || typeof stop.color !== 'string' || !HEX.test(stop.color)) return;
        out.push(Object.assign({}, stop, { position: position }));
    });
    return out.length >= (minStops || 1) ? out : undefined;
}

// undefined means "not usable, take the default".
function coerceValue(entry, v) {
    switch (entry.type) {
    case 'number':
    case 'angle':
        return finiteNumber(v);
    case 'color':
        return typeof v === 'string' && HEX.test(v) ? v : undefined;
    case 'enum':
        return entry.options.some(function(o) { return o.value === v; }) ? v : undefined;
    case 'text':
        if (typeof v === 'string') return v;
        return typeof v === 'number' && isFinite(v) ? String(v) : undefined;
    case 'gradientStops':
        return coerceStops(v, entry.minStops);
    default:
        return v;
    }
}

var NUMBER = { type: 'number' };

// The params a schema entry owns. `xy` and `range` each own two numbers under
// their own key names; `group` owns none.
function fieldsOf(entry) {
    if (entry.type === 'xy') return [[entry.xKey, NUMBER], [entry.yKey, NUMBER]];
    if (entry.type === 'range') return [[entry.minKey, NUMBER], [entry.maxKey, NUMBER]];
    if (entry.key) return [[entry.key, entry]];
    return [];
}

// Params merged over the effect's defaults, each declared field coerced to its
// type or replaced by a copy of its default. The copy matters for stops: handing
// two layers the same defaults array would have them share it.
function coerceParams(effect, params) {
    var given = isPlainObject(params) ? params : {};
    var out = Object.assign({}, effect.defaults, given);
    effect.schema.forEach(function(entry) {
        fieldsOf(entry).forEach(function(field) {
            var key = field[0];
            var v = Object.prototype.hasOwnProperty.call(given, key) ? coerceValue(field[1], given[key]) : undefined;
            out[key] = v !== undefined ? v : structuredClone(effect.defaults[key]);
        });
    });
    return out;
}

module.exports = { coerceParams, finiteNumber, isPlainObject };
