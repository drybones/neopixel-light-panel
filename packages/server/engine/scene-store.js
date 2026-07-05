/*
 * Scene store — owns the scene list, the active scene, preprocessing on
 * write (the generalised preprocessConfig pattern: everything stringy or
 * filtery happens here, never in the render loop), and persistence.
 *
 * Persistence is debounced (trailing 2s) so slider drags don't hammer the
 * SD card; flush() is called from signal handlers on shutdown.
 */

var crypto = require('crypto');
var effects = require('../effects');
var compositorMod = require('./compositor');

var SCENES_KEY = 'scenes_v2';
var ACTIVE_KEY = 'active_scene_id';
var SAVE_DEBOUNCE_MS = 2000;

function newId() {
    return crypto.randomUUID().split('-')[0];
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
    constructor(compositor, storage) {
        this.compositor = compositor;
        this.storage = storage;
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
        if (!this._dirty || !this.storage) return;
        this._dirty = false;
        try {
            await this.storage.setItem(SCENES_KEY, this.scenes.map(stripRuntime));
            await this.storage.setItem(ACTIVE_KEY, this.activeSceneId);
        } catch (err) {
            console.error('Failed to persist scenes:', err);
        }
    }

    async load(migrated) {
        var stored = await this.storage.getItem(SCENES_KEY);
        if (stored) {
            this.setScenes(stored);
        } else if (migrated && migrated.scenes.length > 0) {
            this.setScenes(migrated.scenes);
            this._dirty = true;
            await this.flush();
            console.log('Migrated ' + migrated.scenes.length + ' wavelet preset(s) to scenes.');
        } else {
            this.setScenes([this.defaultScene()]);
            this._dirty = true;
            await this.flush();
        }

        var active = await this.storage.getItem(ACTIVE_KEY);
        if (active === undefined && migrated) active = migrated.activeSceneId;
        this.activeSceneId = (active && this.get(active)) ? active : null;
    }

    setScenes(rawScenes) {
        var self = this;
        this.scenes = rawScenes.map(function(s) {
            return {
                id: s.id || newId(),
                name: s.name || 'Untitled',
                layers: (s.layers || []).map(normaliseLayer),
            };
        });
        this.scenes.forEach(function(s) { self.preprocess(s); });
    }

    defaultScene() {
        return {
            id: newId(),
            name: 'Default',
            layers: [normaliseLayer({ effectType: 'wavelet', params: { color: '#ffffff', freq: 0.3, lambda: 0.3, min: 0.2, max: 0.4 }, blendMode: 'add' })],
        };
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

module.exports = { SceneStore, stripRuntime, normaliseLayer, newId, SCENES_KEY, ACTIVE_KEY };
