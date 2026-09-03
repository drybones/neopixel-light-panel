/*
 * Scene / effect REST API. Express router; the store handles all state.
 */

var express = require('express');
var effects = require('../effects');
var filmstrip = require('../engine/filmstrip');

function createRouter(store, previewCache, effectPreviewCache) {
    var router = express.Router();

    router.get('/effects', function(req, res) {
        res.json(effects.catalog());
    });

    // Each effect at its defaults, so the picker can show what a layer will
    // look like rather than a swatch of its colours. Same payload shape as
    // the scene filmstrips, keyed by effect type instead of scene id.
    router.get('/effects/previews', async function(req, res) {
        var previews = await effectPreviewCache.all(effects.list());
        res.json({
            version: 1,
            frames: filmstrip.FRAMES,
            intervalMs: filmstrip.INTERVAL_MS,
            previews: previews,
        });
    });

    router.get('/scenes', function(req, res) {
        res.json(store.list());
    });

    router.post('/scenes', function(req, res) {
        var scene = store.create(req.body || {});
        res.status(201).json(scene);
    });

    // Empty the library. A DELETE on the collection, so — unlike reset below
    // — there is no id to be confused with; the store nulls the active scene
    // and the render loop falls to its one-black-frame fast exit.
    router.delete('/scenes', function(req, res) {
        store.removeAll();
        res.json(store.list());
    });

    // Export/import before /scenes/:id so "export" isn't matched as an id
    router.get('/scenes/export', function(req, res) {
        res.json(store.exportAll());
    });

    // `mode` defaults to "merge", which is what every existing client sends
    // (nothing). "replace" swaps the library for the incoming set instead —
    // worth its own mode rather than a client-side delete-all-then-import,
    // because the envelope is validated *before* the store is touched: a
    // rejected body leaves the library exactly as it was, where the
    // two-request version would already have thrown it away.
    router.post('/scenes/import', function(req, res) {
        var body = req.body;
        if (!body || body.version !== 2 || !Array.isArray(body.scenes)) {
            return res.status(400).json({ error: 'Import body must be {version: 2, scenes: [...]}' });
        }
        var mode = body.mode === undefined ? 'merge' : body.mode;
        if (mode !== 'merge' && mode !== 'replace') {
            return res.status(400).json({ error: 'mode must be "merge" or "replace"' });
        }
        if (mode === 'replace') store.importReplace(body.scenes);
        else store.importMerge(body.scenes);
        res.sendStatus(200);
    });

    // Restore the curated starting library, replacing whatever is there —
    // see SceneStore.resetToDefaults for why replace and not merge. Before
    // /scenes/:id alongside export/import/order/previews: there is no POST
    // /scenes/:id today, but the rule is the path shape, not the verb, and
    // adding one later would silently swallow this.
    router.post('/scenes/reset', function(req, res) {
        store.resetToDefaults();
        res.json(store.list());
    });

    // Reorder, before /scenes/:id so "order" isn't matched as a scene id.
    // The whole id list, not a move — see SceneStore.reorder. The store's
    // 2s debounce is what makes this safe to call on every drop.
    router.put('/scenes/order', function(req, res) {
        var ids = req.body ? req.body.ids : undefined;
        if (!store.reorder(ids)) {
            return res.status(400).json({ error: 'Body must be {ids: [...]} listing every scene id exactly once' });
        }
        res.json(store.list());
    });

    // Filmstrips, before /scenes/:id for the same reason export/import are —
    // "previews" would otherwise be matched as a scene id.
    //
    // The payload carries no grid dimensions on purpose: the client already
    // owns the strip-order-to-grid mapping (ui/src/lib/panelGrid.js), and a
    // second copy of it travelling over the wire is how a preview ends up
    // rendered 180 degrees round.
    router.get('/scenes/previews', async function(req, res) {
        var previews = await previewCache.all(store.scenes);
        res.json({
            version: 1,
            frames: filmstrip.FRAMES,
            intervalMs: filmstrip.INTERVAL_MS,
            previews: previews,
        });
    });

    router.get('/scenes/:id/preview', function(req, res) {
        var scene = store.get(req.params.id);
        if (!scene) return res.sendStatus(404);
        var preview = previewCache.get(scene);
        res.json({
            version: 1,
            frames: filmstrip.FRAMES,
            intervalMs: filmstrip.INTERVAL_MS,
            previews: [preview],
        });
    });

    router.get('/scenes/:id', function(req, res) {
        var scene = store.getPublic(req.params.id);
        if (!scene) return res.sendStatus(404);
        res.json(scene);
    });

    router.put('/scenes/:id', function(req, res) {
        var scene = store.replace(req.params.id, req.body || {});
        if (!scene) return res.sendStatus(404);
        res.json(scene);
    });

    router.delete('/scenes/:id', function(req, res) {
        if (!store.remove(req.params.id)) return res.sendStatus(404);
        res.sendStatus(200);
    });

    router.put('/scenes/:sceneId/layers/:layerId', function(req, res) {
        var layer = store.replaceLayer(req.params.sceneId, req.params.layerId, req.body || {});
        if (!layer) return res.sendStatus(404);
        res.json(layer);
    });

    router.get('/active_scene', function(req, res) {
        res.json({ id: store.activeSceneId });
    });

    router.put('/active_scene', function(req, res) {
        var id = req.body ? req.body.id : undefined;
        if (id === undefined) return res.status(400).json({ error: 'Body must be {id: "..."} or {id: null}' });
        if (!store.setActive(id)) return res.sendStatus(404);
        res.json({ id: store.activeSceneId });
    });

    return router;
}

module.exports = createRouter;
