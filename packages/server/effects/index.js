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
    require('./text'),
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

// What the UI offers when adding a layer. `presets` is optional and does not
// affect the picker — it is the set of starting points the layer editor
// offers as buttons.
function catalog() {
    return modules.map(function(m) {
        return {
            type: m.type,
            name: m.name,
            schema: m.schema,
            defaults: m.defaults,
            presets: m.presets || null,
        };
    });
}

module.exports = {
    get: get,
    list: list,
    catalog: catalog,
};
