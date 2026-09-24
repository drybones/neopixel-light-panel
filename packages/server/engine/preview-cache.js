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

const crypto = require('crypto');
const { stripRuntime } = require('./scene-store');
const filmstrip = require('./filmstrip');

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
    //
    // Async because the render yields to the 10ms tick every few frames (see
    // filmstrip.YIELD_EVERY). A cold library is a few thousand layer renders,
    // and even one scene's capped warm-up is a few hundred; done synchronously
    // either would stall the panel, which is exactly the sort of hitch the
    // render loop exists to avoid.
    async get(scene) {
        const hash = hashScene(scene);
        let entry = this.entries.get(scene.id);
        if (!entry || entry.hash !== hash) {
            const bytes = await filmstrip.renderFilmstripAsync(scene, this.model);
            entry = { hash, data: Buffer.from(bytes).toString('base64') };
            this.entries.set(scene.id, entry);
        }
        return { id: scene.id, hash: entry.hash, data: entry.data };
    }

    async all(scenes) {
        const out = [];
        for (let i = 0; i < scenes.length; i++) {
            out.push(await this.get(scenes[i]));
        }
        this.prune(scenes);
        return out;
    }

    prune(scenes) {
        const live = Object.create(null);
        scenes.forEach((s) => { live[s.id] = true; });
        this.entries.forEach((_entry, id) => {
            if (!live[id]) this.entries.delete(id);
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

    async get(effect) {
        let entry = this.entries.get(effect.type);
        if (!entry) {
            const bytes = await filmstrip.renderEffectFilmstripAsync(effect, this.model);
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
        const out = [];
        for (let i = 0; i < effectModules.length; i++) {
            out.push(await this.get(effectModules[i]));
        }
        return out;
    }
}

module.exports = { PreviewCache, EffectPreviewCache, hashScene };
