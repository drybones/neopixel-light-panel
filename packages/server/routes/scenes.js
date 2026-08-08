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

    // One strip per picker tile, so the picker can show what a layer will look
    // like rather than a swatch of its colours. Same payload shape as the scene
    // filmstrips; the id is the effect type, or `type:presetId` for an effect
    // that ships presets, and each entry carries the effectType and params the
    // picker needs to actually create the layer.
    router.get('/effects/previews', async function(req, res) {
        var previews = await effectPreviewCache.all(effects.previewTargets());
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

    // Export/import before /scenes/:id so "export" isn't matched as an id
    router.get('/scenes/export', function(req, res) {
        res.json(store.exportAll());
    });

    router.post('/scenes/import', function(req, res) {
        var body = req.body;
        if (!body || body.version !== 2 || !Array.isArray(body.scenes)) {
            return res.status(400).json({ error: 'Import body must be {version: 2, scenes: [...]}' });
        }
        store.importMerge(body.scenes);
        res.sendStatus(200);
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
