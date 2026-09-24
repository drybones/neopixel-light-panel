/*
 * Scene store — owns the scene list, the active scene, preprocessing on
 * write (the generalised preprocessConfig pattern: everything stringy or
 * filtery happens here, never in the render loop), and persistence.
 *
 * Persistence goes to a single crash-safe JSON document (engine/json-store,
 * atomic tmp+rename with a .bak fallback), written at most every 2s by
 * DebouncedDoc so slider drags don't hammer the SD card; flush() is called
 * from signal handlers on shutdown.
 *
 * Document shape: { version: 2, activeSceneId, scenes: [...] }
 */

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var effects = require('../effects');
var compositorMod = require('./compositor');
var jsonStore = require('./json-store');
var { DebouncedDoc } = require('./debounced-doc');
var { coerceParams, finiteNumber, isPlainObject } = require('./params');

var SAVE_DEBOUNCE_MS = 2000;

// The curated starting library, in the same {version: 2, scenes: [...]} shape
// as an export. It lives in the *source tree*, not under data/: it is code —
// checked in, diffable, regenerable from a curated export — while data/ is
// gitignored and owned by whatever is running there. One file feeds both the
// fresh-install seed and resetToDefaults(), so "what a new panel looks like"
// has a single definition.
var DEFAULTS_FILE = path.join(__dirname, '..', 'default-scenes.json');

function newId() {
    return crypto.randomUUID().split('-')[0];
}

function warn(msg) {
    console.warn('Scene store: ' + msg);
}

// A refused write, in the http-errors shape (err.status) that routes/errors.js
// answers as {error}. Only for a request whose *shape* is wrong — a bad value
// inside a good shape is coerced instead (engine/params). Always thrown before
// the store is touched.
function rejected(message) {
    var err = new Error(message);
    err.status = 400;
    return err;
}

// Ids are compared with === against URL segments, so a number is kept as its
// string rather than becoming an id no route can ever match.
function idOf(v) {
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number' && isFinite(v)) return String(v);
    return newId();
}

// Read fresh rather than require()d: require caches one object, and handing
// the same nested params (a gradient's stops, an emitter's colour list) to two
// resets would have both libraries sharing them. A 15KB parse on a reset is
// nothing. Ids in the file are fixed (`default-sun`, not a fresh uuid slice),
// which is what makes resetting twice idempotent and a merging import of a
// defaults file update rather than duplicate.
function defaultScenes() {
    var doc;
    try {
        doc = JSON.parse(fs.readFileSync(DEFAULTS_FILE, 'utf8'));
    } catch (err) {
        throw new Error('Cannot read the default scene set at ' + DEFAULTS_FILE + ': ' + err.message, { cause: err });
    }
    if (!doc || !Array.isArray(doc.scenes)) {
        throw new Error('The default scene set at ' + DEFAULTS_FILE + ' is not {version: 2, scenes: [...]}');
    }
    return doc.scenes;
}

function stripLayer(l) {
    return {
        id: l.id,
        effectType: l.effectType,
        params: l.params,
        blendMode: l.blendMode,
        opacity: l.opacity,
        enabled: l.enabled,
        solo: l.solo,
    };
}

function stripRuntime(scene) {
    return {
        id: scene.id,
        name: scene.name,
        layers: (scene.layers || []).map(stripLayer),
    };
}

// Never throws, whatever it is given: this is what load() runs on a document
// from disk, and a throw there costs the whole library. Params go through the
// effect's schema; a layer whose effectType has no module keeps its params as
// they are, and renders nothing (see the compositor).
function normaliseLayer(layer) {
    var effect = effects.get(layer.effectType);
    var given = isPlainObject(layer.params) ? layer.params : {};
    var opacity = finiteNumber(layer.opacity);
    return {
        id: idOf(layer.id),
        effectType: layer.effectType,
        params: effect ? coerceParams(effect, given) : Object.assign({}, given),
        blendMode: Object.prototype.hasOwnProperty.call(compositorMod.BLEND, layer.blendMode) ? layer.blendMode : 'normal',
        opacity: opacity === undefined ? 1 : Math.min(1, Math.max(0, opacity)),
        enabled: layer.enabled !== false,
        solo: !!layer.solo,
    };
}

function checkLayers(layers) {
    if (layers !== undefined && !Array.isArray(layers)) throw rejected('layers must be an array');
}

// prepare() is effect code running on whatever params a client sent, and a
// throw out of it used to leave the layer without _prepared — the panel kept
// the stale frame and every later write to the scene threw too. Falling back
// to the defaults means any effect, including one not written yet, fails soft:
// the layer renders *something*, and the journal says which one and why. The
// params stay as sent, so the editor still shows what needs fixing.
function prepareLayer(effect, layer) {
    try {
        return effect.prepare(layer.params);
    } catch (err) {
        warn('layer ' + layer.id + ' (' + layer.effectType + ') failed to prepare, rendering its defaults: ' + err.message);
        return effect.prepare(effect.defaults);
    }
}

// Everything preprocess() does short of the compositor, so it can run on a
// scene that is not in the library yet. That is what lets every write build
// and prepare its whole result first and only then commit it: anything that
// throws, throws before the library or the compositor has changed.
function prepareScene(scene) {
    var soloed = scene.layers.filter(function(l) { return l.solo && l.enabled; });
    scene._displayLayers = soloed.length > 0
        ? soloed
        : scene.layers.filter(function(l) { return l.enabled; });
    scene.layers.forEach(function(l) {
        var effect = effects.get(l.effectType);
        l._prepared = effect ? prepareLayer(effect, l) : {};
        l._blend = compositorMod.BLEND[l.blendMode] || 0;
    });
}

class SceneStore extends DebouncedDoc {
    constructor(compositor, persistFile) {
        super(persistFile, { debounceMs: SAVE_DEBOUNCE_MS, label: 'scenes' });
        this.compositor = compositor;
        this.scenes = [];
        this.activeSceneId = null;
    }

    // ---- preprocessing (write path) ----

    preprocess(scene) {
        prepareScene(scene);
        this.compositor.syncScene(scene);
    }

    // ---- layer ids ----

    // The compositor caches one render instance per layer id across all
    // scenes, so an id shared by two scenes makes them fight over one entry —
    // harmless while both share an effect type, a black or NaN layer once
    // they don't. Every path that brings layers in comes through here with the
    // ids its result must not collide with, and a clash is repaired by giving
    // the *incoming* layer a fresh id, never one already in the library.
    // `seen` accumulates, so duplicates within one write are caught as well.
    adoptLayers(rawLayers, seen) {
        var self = this;
        return (Array.isArray(rawLayers) ? rawLayers : []).filter(isPlainObject).map(function(raw) {
            var layer = normaliseLayer(raw);
            if (seen[layer.id]) {
                layer.id = newId();
                self._dirty = true;         // load() persists a repair it made
            }
            seen[layer.id] = true;
            return layer;
        });
    }

    // Every layer id in the library, bar the scenes a write is about to
    // replace — their ids are the write's to reuse.
    layerIdsExcept(sceneIds) {
        var seen = Object.create(null);
        this.scenes.forEach(function(s) {
            if (sceneIds && sceneIds.indexOf(s.id) !== -1) return;
            s.layers.forEach(function(l) { seen[l.id] = true; });
        });
        return seen;
    }

    // A whole library from raw scenes, normalised and prepared but not yet
    // committed or synced.
    buildLibrary(rawScenes) {
        var self = this;
        var seen = Object.create(null);
        return rawScenes.filter(isPlainObject).map(function(s) {
            var scene = {
                id: idOf(s.id),
                name: s.name ? String(s.name) : 'Untitled',
                layers: self.adoptLayers(s.layers, seen),
            };
            prepareScene(scene);
            return scene;
        });
    }

    commitLibrary(scenes) {
        var self = this;
        this.scenes = scenes;
        scenes.forEach(function(s) { self.compositor.syncScene(s); });
    }

    // ---- persistence ----

    toDocument() {
        return {
            version: 2,
            activeSceneId: this.activeSceneId,
            scenes: this.scenes.map(stripRuntime),
        };
    }

    load() {
        var doc = this.persistFile ? jsonStore.load(this.persistFile, warn) : null;
        // Array.isArray, not `.length` — an *empty* scenes array is someone
        // who deleted their library, not a fresh install. Only the absence
        // of a usable scenes key means "seed the defaults." This is what
        // stops DELETE /api/scenes silently undoing itself on the next
        // service restart.
        if (doc && Array.isArray(doc.scenes)) {
            this.setScenes(doc.scenes);
            this.activeSceneId = (doc.activeSceneId && this.get(doc.activeSceneId)) ? doc.activeSceneId : null;
            this.flush();                // no-op unless setScenes repaired an id
            return;
        }
        this.setScenes(defaultScenes());
        this.activeSceneId = null;
        this._dirty = true;
        this.flush();
    }

    // Repairs rather than trusts the document — duplicate layer ids, params of
    // the wrong type, entries that are not objects at all — because this is
    // the load path, and a document it rejected would cost the whole library.
    setScenes(rawScenes) {
        this.commitLibrary(this.buildLibrary(rawScenes));
    }

    // ---- queries ----

    list() {
        return this.scenes.map(function(s) {
            return { id: s.id, name: s.name, layerCount: s.layers.length };
        });
    }

    get(id) {
        return this.scenes.find(function(s) { return s.id === id; }) || null;
    }

    getPublic(id) {
        var scene = this.get(id);
        return scene ? stripRuntime(scene) : null;
    }

    activeScene() {
        return this.activeSceneId ? this.get(this.activeSceneId) : null;
    }

    // ---- mutations (all mark dirty) ----

    create(raw) {
        raw = isPlainObject(raw) ? raw : {};
        checkLayers(raw.layers);
        var scene = {
            id: newId(),
            name: raw.name ? String(raw.name) : 'New scene',
            layers: this.adoptLayers(raw.layers, this.layerIdsExcept(null)),
        };
        this.preprocess(scene);
        this.scenes.push(scene);
        this.markDirty();
        return stripRuntime(scene);
    }

    replace(id, raw) {
        var index = this.scenes.findIndex(function(s) { return s.id === id; });
        if (index === -1) return null;
        if (!isPlainObject(raw)) throw rejected('Body must be a scene object');
        checkLayers(raw.layers);
        var old = this.scenes[index];
        var scene = {
            id: id,
            name: raw.name !== undefined ? String(raw.name) : old.name,
            layers: this.adoptLayers(raw.layers, this.layerIdsExcept([id])),
        };
        var removed = old.layers
            .filter(function(l) { return !scene.layers.some(function(nl) { return nl.id === l.id; }); })
            .map(function(l) { return l.id; });
        this.preprocess(scene);
        this.scenes[index] = scene;
        this.compositor.releaseLayers(removed);
        this.markDirty();
        return stripRuntime(scene);
    }

    // Merges over the stored layer rather than replacing it: the body is
    // whichever fields are changing, and `params` merges one level down, so
    // `{params: {speed: 2}}` is a complete request. A replace here meant any
    // field left out reset to its default — effectType included, leaving a
    // layer that rendered nothing and persisted that way two seconds later.
    // effectType is refused outright rather than merged, since the stored
    // params belong to the old effect; changing it is a whole-scene PUT.
    //
    // Validate-then-commit, like replace(): the new scene is built and
    // prepared off to the side and swapped in only once that has succeeded.
    replaceLayer(sceneId, layerId, raw) {
        var sceneIndex = this.scenes.findIndex(function(s) { return s.id === sceneId; });
        if (sceneIndex === -1) return null;
        var scene = this.scenes[sceneIndex];
        var index = scene.layers.findIndex(function(l) { return l.id === layerId; });
        if (index === -1) return null;

        var old = scene.layers[index];
        if (!isPlainObject(raw)) throw rejected('Body must be a layer object');
        if (raw.params !== undefined && !isPlainObject(raw.params)) throw rejected('params must be an object');
        if (raw.effectType !== undefined && raw.effectType !== old.effectType) {
            throw rejected('effectType cannot change through a layer PUT (this layer is "' + old.effectType + '"); PUT the whole scene instead');
        }

        var next = { id: scene.id, name: scene.name, layers: scene.layers.slice() };
        next.layers[index] = normaliseLayer(Object.assign({}, stripLayer(old), raw, {
            id: layerId,
            params: Object.assign({}, old.params, raw.params),
        }));
        this.preprocess(next);
        this.scenes[sceneIndex] = next;
        this.markDirty();
        return stripLayer(next.layers[index]);
    }

    remove(id) {
        var index = this.scenes.findIndex(function(s) { return s.id === id; });
        if (index === -1) return false;
        var removed = this.scenes.splice(index, 1)[0];
        this.compositor.releaseLayers(removed.layers.map(function(l) { return l.id; }));
        if (this.activeSceneId === id) this.activeSceneId = null;
        this.markDirty();
        return true;
    }

    // The compositor caches one render instance per layer id across *all*
    // scenes, so anything that drops scenes in bulk owes the same release
    // remove() does for one — miss it and every layer of the old library
    // leaks an instance, permanently. Always called *before* the replacement
    // is synced, or it releases the instances just created.
    releaseAllLayers() {
        var ids = [];
        this.scenes.forEach(function(s) {
            s.layers.forEach(function(l) { ids.push(l.id); });
        });
        this.compositor.releaseLayers(ids);
    }

    // Empty the library. The active id goes with it: the render loop then
    // draws one black frame and fast-exits, and frameStats.restart() picks
    // the change up from tick() without help. An empty library persists as
    // an empty array, which load() deliberately tells apart from a missing
    // scenes key — see there.
    removeAll() {
        this.releaseAllLayers();
        this.scenes = [];
        this.activeSceneId = null;
        this.markDirty();
    }

    // Restore defaults is a *replace*, not a merge: merging them into a
    // library holding edited copies is the confusing case, where some scenes
    // revert and others don't depending on whether their ids happen to match.
    resetToDefaults() {
        var scenes = this.buildLibrary(defaultScenes());
        this.releaseAllLayers();
        this.commitLibrary(scenes);
        this.activeSceneId = null;
        this.markDirty();
    }

    // Import *instead of* the current library rather than merged into it.
    // The active id survives if the incoming set still contains it, so
    // round-tripping your own export leaves the panel exactly as it was;
    // otherwise it goes null, like a delete-all.
    //
    // Built before the release, so anything that throws does so while the
    // old library is still whole — the route's promise that a rejected body
    // leaves it exactly as it was.
    importReplace(rawScenes) {
        var scenes = this.buildLibrary(rawScenes);
        var wasActive = this.activeSceneId;
        this.releaseAllLayers();
        this.commitLibrary(scenes);
        this.activeSceneId = (wasActive && this.get(wasActive)) ? wasActive : null;
        this.markDirty();
    }

    // Scene order is the array order — nothing else in the API can rewrite it
    // (create appends, replace is in place, importMerge replaces or appends).
    // Takes the complete id list rather than a move, so a stale client can't
    // silently drop or duplicate a scene: the set has to match exactly, and a
    // request that doesn't is rejected whole rather than applied in part.
    reorder(ids) {
        if (!Array.isArray(ids) || ids.length !== this.scenes.length) return false;
        var byId = Object.create(null);
        this.scenes.forEach(function(s) { byId[s.id] = s; });
        var ordered = [];
        for (var i = 0; i < ids.length; i++) {
            var scene = byId[ids[i]];
            if (!scene) return false;       // unknown id, or the same id twice
            delete byId[ids[i]];
            ordered.push(scene);
        }
        this.scenes = ordered;
        this.markDirty();
        return true;
    }

    setActive(id) {
        if (id === null) {
            this.activeSceneId = null;
            this.markDirty();
            return true;
        }
        if (!this.get(id)) return false;
        this.activeSceneId = id;
        this.markDirty();
        return true;
    }

    exportAll() {
        return { version: 2, scenes: this.scenes.map(stripRuntime) };
    }

    // Scenes without an id are skipped: merging is by id, and one without has
    // nothing to merge with. Built and prepared in full before anything is
    // committed, as importReplace is.
    //
    // A scene replaced here owes the release replace() does for the layers it
    // no longer has. "No longer has" is checked against everything incoming,
    // not just its own replacement: another incoming scene may carry the id.
    importMerge(rawScenes) {
        var self = this;
        var incoming = rawScenes.filter(function(s) { return isPlainObject(s) && s.id; });
        var seen = this.layerIdsExcept(incoming.map(function(s) { return idOf(s.id); }));
        var built = incoming.map(function(raw) {
            var scene = {
                id: idOf(raw.id),
                name: raw.name ? String(raw.name) : 'Untitled',
                layers: self.adoptLayers(raw.layers, seen),
            };
            prepareScene(scene);
            return scene;
        });

        var released = [];
        built.forEach(function(scene) {
            var old = self.get(scene.id);
            if (!old) return;
            old.layers.forEach(function(l) { if (!seen[l.id]) released.push(l.id); });
        });
        this.compositor.releaseLayers(released);

        built.forEach(function(scene) {
            var index = self.scenes.findIndex(function(s) { return s.id === scene.id; });
            if (index !== -1) self.scenes[index] = scene;
            else self.scenes.push(scene);
            self.compositor.syncScene(scene);
        });
        this.markDirty();
    }
}

module.exports = { SceneStore, stripRuntime, normaliseLayer, newId, defaultScenes, DEFAULTS_FILE };
