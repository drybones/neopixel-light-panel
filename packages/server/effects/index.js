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
    require('./embers'),
    require('./particle-trail'),
    require('./candy-sparkler'),
    require('./noise'),
    require('./twinkle'),
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

function catalog() {
    return modules.map(function(m) {
        return { type: m.type, name: m.name, schema: m.schema, defaults: m.defaults };
    });
}

module.exports = { get, list, catalog, register: function(m) { modules.push(m); byType[m.type] = m; } };
