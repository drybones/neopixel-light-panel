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
    require('./solid'),
    require('./gradient'),
    require('./embers'),
    require('./particle-trail'),
    require('./candy-sparkler'),
];

var byType = {};
modules.forEach(function(m) { byType[m.type] = m; });

function get(type) {
    return byType[type] || null;
}

function catalog() {
    return modules.map(function(m) {
        return { type: m.type, name: m.name, schema: m.schema, defaults: m.defaults };
    });
}

module.exports = { get, catalog, register: function(m) { modules.push(m); byType[m.type] = m; } };
