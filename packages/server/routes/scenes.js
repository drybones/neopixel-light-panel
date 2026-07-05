/*
 * Scene / effect REST API. Express router; the store handles all state.
 */

var express = require('express');
var effects = require('../effects');

function createRouter(store) {
    var router = express.Router();

    router.get('/effects', function(req, res) {
        res.json(effects.catalog());
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
