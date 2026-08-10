/*
 * Effect registry. Each module exports:
 *   type, name          — identity
 *   schema, defaults    — drives UI controls and server-side validation
 *   prepare(params)     — API-write-time precompute; never called per frame
 *   createInstance(ctx) — per-layer instance holding any animation state;
 *                         recreated only when a layer's effectType changes
 */

var modules = [
    require('./wavelet'),
    require('./planewave'),
    require('./solid'),
    require('./gradient_linear'),
    require('./gradient_radial'),
    require('./emitter'),
    require('./particle-trail'),
    require('./noise'),
    require('./twinkle'),
    // Superseded, kept registered so they still render. The one-time
    // engine/emitter-migrate and engine/gradient-migrate convert stored layers,
    // but an *export* taken before a migration can be imported long afterwards
    // and importMerge does not re-run migrations — so these have to keep
    // working indefinitely. `hidden` keeps them out of the catalog, and
    // therefore out of the picker.
    require('./embers'),
    require('./candy-sparkler'),
    require('./gradient'),
];

var byType = {};
modules.forEach(function(m) { byType[m.type] = m; });

function get(type) {
    return byType[type] || null;
}

// The modules themselves, in registration order — for callers that need
// prepare()/createInstance(), which catalog() deliberately leaves out.
function list() {
    return modules.slice();
}

// What the UI offers when adding a layer. Hidden effects are deliberately
// absent: they still render for stored and imported layers, but nothing should
// create a new one. `presets` is optional and does not affect the picker — it
// is the set of starting points the layer editor offers as buttons.
function catalog() {
    return modules.filter(function(m) { return !m.hidden; }).map(function(m) {
        return {
            type: m.type,
            name: m.name,
            schema: m.schema,
            defaults: m.defaults,
            presets: m.presets || null,
        };
    });
}

// The modules the picker offers, in registration order — one tile each, at its
// defaults. An effect's `presets` are *not* expanded here: they are starting
// points inside the layer editor, not separate things to add, so the picker
// stays one row per effect.
function visible() {
    return modules.filter(function(m) { return !m.hidden; });
}

module.exports = {
    get: get,
    list: list,
    catalog: catalog,
    visible: visible,
    register: function(m) { modules.push(m); byType[m.type] = m; },
};
