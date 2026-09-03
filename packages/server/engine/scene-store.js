/*
 * Scene store — owns the scene list, the active scene, preprocessing on
 * write (the generalised preprocessConfig pattern: everything stringy or
 * filtery happens here, never in the render loop), and persistence.
 *
 * Persistence goes to a single crash-safe JSON document (engine/json-store,
 * atomic tmp+rename with a .bak fallback). Writes are debounced (trailing
 * 2s) so slider drags don't hammer the SD card; flush() is called from
 * signal handlers on shutdown.
 *
 * Document shape: { version: 2, activeSceneId, scenes: [...] }
 */

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var effects = require('../effects');
var compositorMod = require('./compositor');
var jsonStore = require('./json-store');

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
        throw new Error('Cannot read the default scene set at ' + DEFAULTS_FILE + ': ' + err.message);
    }
    if (!doc || !Array.isArray(doc.scenes)) {
        throw new Error('The default scene set at ' + DEFAULTS_FILE + ' is not {version: 2, scenes: [...]}');
    }
    return doc.scenes;
}

function stripRuntime(scene) {
    var out = {
        id: scene.id,
        name: scene.name,
        layers: (scene.layers || []).map(function(l) {
            return {
                id: l.id,
                effectType: l.effectType,
                params: l.params,
                blendMode: l.blendMode,
                opacity: l.opacity,
                enabled: l.enabled,
                solo: l.solo,
            };
        }),
    };
    return out;
}

function normaliseLayer(layer) {
    var effect = effects.get(layer.effectType);
    var params = Object.assign({}, effect ? effect.defaults : {}, layer.params || {});
    return {
        id: layer.id || newId(),
        effectType: layer.effectType,
        params: params,
        blendMode: compositorMod.BLEND.hasOwnProperty(layer.blendMode) ? layer.blendMode : 'normal',
        opacity: typeof layer.opacity === 'number' ? Math.min(1, Math.max(0, layer.opacity)) : 1,
        enabled: layer.enabled !== false,
        solo: !!layer.solo,
    };
}

class SceneStore {
    constructor(compositor, persistFile) {
        this.compositor = compositor;
        this.persistFile = persistFile || null;
        this.scenes = [];
        this.activeSceneId = null;
        this._saveTimer = null;
        this._dirty = false;
    }

    // ---- preprocessing (write path) ----

    preprocess(scene) {
        var soloed = scene.layers.filter(function(l) { return l.solo && l.enabled; });
        var display = soloed.length > 0
            ? soloed
            : scene.layers.filter(function(l) { return l.enabled; });
        scene.layers.forEach(function(l) {
            var effect = effects.get(l.effectType);
            l._prepared = effect ? effect.prepare(l.params) : {};
            l._blend = compositorMod.BLEND[l.blendMode] || 0;
        });
        scene._displayLayers = display;
        this.compositor.syncScene(scene);
    }

    // ---- persistence ----

    markDirty() {
        this._dirty = true;
        var self = this;
        if (this._saveTimer) return;
        this._saveTimer = setTimeout(function() {
            self._saveTimer = null;
            self.flush();
        }, SAVE_DEBOUNCE_MS);
        if (this._saveTimer.unref) this._saveTimer.unref();
    }

    async flush() {
        if (!this._dirty || !this.persistFile) return;
        this._dirty = false;
        try {
            jsonStore.save(this.persistFile, {
                version: 2,
                activeSceneId: this.activeSceneId,
                scenes: this.scenes.map(stripRuntime),
            });
        } catch (err) {
            console.error('Failed to persist scenes:', err);
            this._dirty = true;
        }
    }

    async load() {
        var doc = this.persistFile ? jsonStore.load(this.persistFile, warn) : null;
        // Array.isArray, not `.length` — an *empty* scenes array is someone
        // who deleted their library, not a fresh install. Only the absence
        // of a usable scenes key means "seed the defaults." This is what
        // stops DELETE /api/scenes silently undoing itself on the next
        // service restart.
        if (doc && Array.isArray(doc.scenes)) {
            this.setScenes(doc.scenes);
            this.activeSceneId = (doc.activeSceneId && this.get(doc.activeSceneId)) ? doc.activeSceneId : null;
            await this.flush();          // no-op unless setScenes repaired an id
            return;
        }
        this.setScenes(defaultScenes());
        this.activeSceneId = null;
        this._dirty = true;
        await this.flush();
    }

    setScenes(rawScenes) {
        var self = this;
        // The compositor caches one render instance per layer id across all
        // scenes, so an id shared by two scenes makes them fight over one
        // entry — harmless while both share an effect type, NaN once they
        // don't. Repair happens here rather than trusting the document.
        var seen = Object.create(null);
        this.scenes = rawScenes.map(function(s) {
            return {
                id: s.id || newId(),
                name: s.name || 'Untitled',
                layers: (s.layers || []).map(function(l) {
                    var layer = normaliseLayer(l);
                    if (seen[layer.id]) {
                        layer.id = newId();
                        self._dirty = true;
                    }
                    seen[layer.id] = true;
                    return layer;
                }),
            };
        });
        this.scenes.forEach(function(s) { self.preprocess(s); });
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
        var scene = {
            id: newId(),
            name: raw && raw.name ? String(raw.name) : 'New scene',
            layers: (raw && raw.layers ? raw.layers : []).map(normaliseLayer),
        };
        this.preprocess(scene);
        this.scenes.push(scene);
        this.markDirty();
        return stripRuntime(scene);
    }

    replace(id, raw) {
        var index = this.scenes.findIndex(function(s) { return s.id === id; });
        if (index === -1) return null;
        var old = this.scenes[index];
        var scene = {
            id: id,
            name: raw.name !== undefined ? String(raw.name) : old.name,
            layers: (raw.layers || []).map(normaliseLayer),
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

    replaceLayer(sceneId, layerId, raw) {
        var scene = this.get(sceneId);
        if (!scene) return null;
        var index = scene.layers.findIndex(function(l) { return l.id === layerId; });
        if (index === -1) return null;
        var layer = normaliseLayer(Object.assign({}, raw, { id: layerId }));
        scene.layers[index] = layer;
        this.preprocess(scene);
        this.markDirty();
        return stripRuntime(scene).layers[index];
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
        this.releaseAllLayers();
        this.setScenes(defaultScenes());
        this.activeSceneId = null;
        this.markDirty();
    }

    // Import *instead of* the current library rather than merged into it.
    // The active id survives if the incoming set still contains it, so
    // round-tripping your own export leaves the panel exactly as it was;
    // otherwise it goes null, like a delete-all.
    importReplace(scenes) {
        var wasActive = this.activeSceneId;
        this.releaseAllLayers();
        this.setScenes(scenes);
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

    importMerge(scenes) {
        var self = this;
        scenes.forEach(function(raw) {
            if (!raw || !raw.id) return;
            var index = self.scenes.findIndex(function(s) { return s.id === raw.id; });
            var scene = {
                id: raw.id,
                name: raw.name || 'Untitled',
                layers: (raw.layers || []).map(normaliseLayer),
            };
            self.preprocess(scene);
            if (index !== -1) self.scenes[index] = scene;
            else self.scenes.push(scene);
        });
        this.markDirty();
    }
}

module.exports = { SceneStore, stripRuntime, normaliseLayer, newId, defaultScenes, DEFAULTS_FILE };
