/*
 * Scene store — owns the scene list, the active scene, preprocessing on
 * write (the generalised preprocessConfig pattern: everything stringy or
 * filtery happens here, never in the render loop), and persistence.
 *
 * Persistence goes to a single crash-safe JSON document (engine/json-store,
 * atomic tmp+rename with a .bak fallback) — deliberately NOT node-persist,
 * whose non-atomic writes lost scene data to a power cut once. Writes are
 * debounced (trailing 2s) so slider drags don't hammer the SD card;
 * flush() is called from signal handlers on shutdown.
 *
 * Document shape: { version: 2, activeSceneId, seededBuiltins, scenes: [...] }
 */

var crypto = require('crypto');
var effects = require('../effects');
var compositorMod = require('./compositor');
var jsonStore = require('./json-store');
var planewaveMigrate = require('./planewave-migrate');
var emitterMigrate = require('./emitter-migrate');

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
    // An effect may rewrite params it has outgrown (noise's contrast -> levels).
    // It runs on the stored params *before* the defaults are merged over them,
    // or a layer carrying only the old key would be given the new key's default
    // and silently change look. Both the load path and importMerge come through
    // here, so an old export still converts however long from now.
    var raw = layer.params || {};
    if (effect && effect.upgradeParams) raw = effect.upgradeParams(raw);
    var params = Object.assign({}, effect ? effect.defaults : {}, raw);
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
        this.seededBuiltins = false;
        this.planeWaveMigrated = false;
        this.emitterMigrated = false;
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
                seededBuiltins: this.seededBuiltins,
                planeWaveMigrated: this.planeWaveMigrated,
                emitterMigrated: this.emitterMigrated,
                scenes: this.scenes.map(stripRuntime),
            });
        } catch (err) {
            console.error('Failed to persist scenes:', err);
            this._dirty = true;
        }
    }

    // legacy: { scenes, activeSceneId, seeded, migrated } — values recovered
    // from node-persist (pre-json-store deployments and the original
    // wave_config presets). Only consulted when the scene file is absent.
    async load(legacy) {
        var doc = this.persistFile
            ? jsonStore.load(this.persistFile, function(msg) { console.warn('Scene store: ' + msg); })
            : null;
        legacy = legacy || {};

        if (doc && Array.isArray(doc.scenes)) {
            this.planeWaveMigrated = !!doc.planeWaveMigrated;
            this.emitterMigrated = !!doc.emitterMigrated;
            var migrated = this.convertPlaneWaves(doc.scenes, doc);
            var emitters = this.convertEmitters(migrated.scenes, doc);
            this.setScenes(emitters.scenes);
            this.seededBuiltins = !!doc.seededBuiltins;
            this.activeSceneId = (doc.activeSceneId && this.get(doc.activeSceneId)) ? doc.activeSceneId : null;
            if (migrated.ranNow || emitters.ranNow) {
                this._dirty = true;
                await this.flush();
            }
            return;
        }

        var active = null;
        var raw = null;
        var source = '';
        if (legacy.scenes && legacy.scenes.length > 0) {
            raw = legacy.scenes;
            this.seededBuiltins = !!legacy.seeded;
            active = legacy.activeSceneId;
            source = 'Recovered {n} scene(s) from node-persist.';
        } else if (legacy.migrated && legacy.migrated.scenes.length > 0) {
            raw = legacy.migrated.scenes;
            active = legacy.migrated.activeSceneId;
            source = 'Migrated {n} wavelet preset(s) to scenes.';
        }

        if (raw) {
            this.setScenes(this.convertEmitters(this.convertPlaneWaves(raw).scenes).scenes);
            console.log(source.replace('{n}', this.scenes.length));
        } else {
            this.planeWaveMigrated = true;
            this.emitterMigrated = true;
            this.setScenes([this.defaultScene()]);
        }
        this.activeSceneId = (active && this.get(active)) ? active : null;
        this._dirty = true;
        await this.flush();
    }

    // Distant wavelets are a hand-rolled plane wave the old UI could not edit;
    // convert them once so they get a Direction control. The pre-conversion
    // document is snapshotted alongside the scene file for rollback — the same
    // caution engine/migrate takes by leaving the old wave_config key in place.
    // Takes and returns raw (un-normalised) scenes, so the new effect's
    // defaults are applied by setScenes rather than the old effect's.
    // sourceDoc, when present, is the file exactly as it was read — snapshot
    // that rather than just the scenes, so copying the backup over the scene
    // file is a complete rollback. A scenes-only snapshot would drop
    // seededBuiltins and re-seed the built-in scenes as duplicates.
    convertPlaneWaves(rawScenes, sourceDoc) {
        if (this.planeWaveMigrated) return { scenes: rawScenes, ranNow: false };
        this.planeWaveMigrated = true;

        var result = planewaveMigrate.convertScenes(rawScenes);
        if (result.converted === 0) return { scenes: rawScenes, ranNow: true };

        if (this.persistFile) {
            var backup = this.persistFile.replace(/\.json$/, '') + '.pre-planewave.json';
            try {
                jsonStore.save(backup, sourceDoc || { version: 2, scenes: rawScenes });
                console.log('Saved pre-conversion scenes to ' + backup);
            } catch (err) {
                console.error('Failed to snapshot scenes before plane-wave conversion:', err);
            }
        }
        console.log('Converted ' + result.converted + ' distant wavelet layer(s) to plane waves.');
        return { scenes: result.scenes, ranNow: true };
    }

    // candy_sparkler and embers were one engine with different constants baked
    // in; convert them once so their knobs become editable. Same shape as
    // convertPlaneWaves — raw scenes in and out, its own snapshot, its own flag
    // — because the two run in sequence on the same load and either can be the
    // one that has already happened.
    //
    // The old effects stay registered (hidden) rather than being deleted: this
    // runs once against the stored document, and an export taken beforehand can
    // be imported long afterwards through a path that does not re-migrate.
    convertEmitters(rawScenes, sourceDoc) {
        if (this.emitterMigrated) return { scenes: rawScenes, ranNow: false };
        this.emitterMigrated = true;

        var result = emitterMigrate.convertScenes(rawScenes);
        if (result.converted === 0) return { scenes: rawScenes, ranNow: true };

        if (this.persistFile) {
            var backup = this.persistFile.replace(/\.json$/, '') + '.pre-emitter.json';
            try {
                jsonStore.save(backup, sourceDoc || { version: 2, scenes: rawScenes });
                console.log('Saved pre-conversion scenes to ' + backup);
            } catch (err) {
                console.error('Failed to snapshot scenes before emitter conversion:', err);
            }
        }
        console.log('Converted ' + result.converted + ' particle layer(s) to emitters.');
        return { scenes: result.scenes, ranNow: true };
    }

    setScenes(rawScenes) {
        var self = this;
        // The compositor caches a render instance per layer id across all
        // scenes, so an id shared by two scenes makes them fight over one
        // entry. That was survivable while every legacy preset was a wavelet
        // — same effectType, so the cached instance still fitted — but two
        // scenes with different effect types on one id render each other's
        // params and produce NaN. The old wave_config data does contain a
        // duplicate, so repair ids here rather than trusting the document.
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

module.exports = { SceneStore, stripRuntime, normaliseLayer, newId };
