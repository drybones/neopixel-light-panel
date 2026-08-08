/*
 * Cache of scene filmstrips, keyed by scene *content*.
 *
 * Rendering a filmstrip is ~60 renders per layer, so the whole library is a
 * burst of a few thousand — around 100ms of Pi CPU. That is fine once, and
 * unacceptable on every load of the switcher, hence the cache. The key is a
 * hash of stripRuntime(scene) rather than the scene id: an edit changes the
 * hash and the strip is re-rendered, an unrelated write leaves it alone, and
 * runtime fields (_prepared, _blend, _displayLayers) can't leak into it.
 *
 * In memory only, ~440KB for 23 scenes. Nothing is persisted: a reboot
 * recomputes in about as long as it would take to read the file back, and the
 * scene document's crash-safety story is not something to complicate for a
 * cache of thumbnails.
 */

var crypto = require('crypto');
var { stripRuntime } = require('./scene-store');
var filmstrip = require('./filmstrip');

function hashScene(scene) {
    return crypto.createHash('sha1')
        .update(JSON.stringify(stripRuntime(scene)))
        .digest('hex');
}

class PreviewCache {
    constructor(model) {
        this.model = model;
        this.entries = new Map(); // sceneId → { hash, data }
    }

    // { id, hash, data } for one scene; renders on a miss or a content change.
    get(scene) {
        var hash = hashScene(scene);
        var entry = this.entries.get(scene.id);
        if (!entry || entry.hash !== hash) {
            var bytes = filmstrip.renderFilmstrip(scene, this.model);
            entry = { hash: hash, data: Buffer.from(bytes).toString('base64') };
            this.entries.set(scene.id, entry);
        }
        return { id: scene.id, hash: entry.hash, data: entry.data };
    }

    // Every scene's strip, yielding between scenes so the 10ms render tick can
    // run. A cold library is a few thousand layer renders; done synchronously
    // it would stall the panel for the whole burst, which is exactly the sort
    // of hitch the render loop exists to avoid.
    async all(scenes) {
        var out = [];
        for (var i = 0; i < scenes.length; i++) {
            out.push(this.get(scenes[i]));
            await new Promise(function(resolve) { setImmediate(resolve); });
        }
        this.prune(scenes);
        return out;
    }

    prune(scenes) {
        var live = Object.create(null);
        scenes.forEach(function(s) { live[s.id] = true; });
        var self = this;
        this.entries.forEach(function(_entry, id) {
            if (!live[id]) self.entries.delete(id);
        });
    }
}

// The same thing for the effect picker, keyed by effect type. Effect defaults
// are code, not data, so there is nothing to invalidate against — rendered
// once on first request and kept. Deliberately a separate map from the scene
// cache, whose prune() would otherwise throw these away as unknown scene ids.
//
// One strip per effect, never per preset: an effect's presets are starting
// points inside the layer editor, not separate entries in the picker.
class EffectPreviewCache {
    constructor(model) {
        this.model = model;
        this.entries = new Map(); // effect type → { hash, data }
    }

    get(effect) {
        var entry = this.entries.get(effect.type);
        if (!entry) {
            var bytes = filmstrip.renderEffectFilmstrip(effect, this.model);
            entry = {
                hash: crypto.createHash('sha1')
                    .update(JSON.stringify({ type: effect.type, defaults: effect.defaults }))
                    .digest('hex'),
                data: Buffer.from(bytes).toString('base64'),
            };
            this.entries.set(effect.type, entry);
        }
        return { id: effect.type, hash: entry.hash, data: entry.data };
    }

    async all(effectModules) {
        var out = [];
        for (var i = 0; i < effectModules.length; i++) {
            out.push(this.get(effectModules[i]));
            await new Promise(function(resolve) { setImmediate(resolve); });
        }
        return out;
    }
}

module.exports = { PreviewCache, EffectPreviewCache, hashScene };
