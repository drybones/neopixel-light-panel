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
    require('./gradient'),
    require('./emitter'),
    require('./particle-trail'),
    require('./noise'),
    require('./twinkle'),
    // Superseded by emitter, kept registered so they still render. The one-time
    // engine/emitter-migrate converts stored layers, but an *export* taken
    // before the migration can be imported long afterwards and importMerge does
    // not re-run migrations — so these have to keep working indefinitely.
    // `hidden` keeps them out of the catalog, and therefore out of the picker.
    require('./embers'),
    require('./candy-sparkler'),
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
// create a new one. `presets` is optional — an effect without it gets a single
// picker tile from its defaults, as every effect did before emitter.
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

// One entry per picker tile: an effect with presets contributes one per preset,
// an effect without contributes a single entry at its defaults. Hidden effects
// contribute nothing. This is what the preview cache renders strips for, so it
// and the picker have to agree on the list.
function previewTargets() {
    var out = [];
    modules.forEach(function(m) {
        if (m.hidden) return;
        if (m.presets && m.presets.length) {
            m.presets.forEach(function(p) { out.push({ effect: m, preset: p }); });
        } else {
            out.push({ effect: m, preset: null });
        }
    });
    return out;
}

module.exports = {
    get: get,
    list: list,
    catalog: catalog,
    previewTargets: previewTargets,
    register: function(m) { modules.push(m); byType[m.type] = m; },
};
