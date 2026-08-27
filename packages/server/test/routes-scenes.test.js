/*
 * HTTP-level tests for routes/scenes.js — gap 1 of #83.
 *
 * The engine suites cover what the store does; these cover what a *request*
 * does, which is the layer that express 5 changed underneath us (req.body is
 * `undefined` for a bodyless mutation where v4 gave `{}`) and that nothing
 * was exercising. Per route: the happy path, a 404 where one exists, and the
 * malformed/absent-body path.
 *
 * The store is real — its behaviour is the interesting half. The preview
 * caches are stubs: filmstrip content has its own suite, and rendering one
 * strip per effect would put seconds into a route test for no extra coverage.
 */

const test = require('node:test');
const assert = require('node:assert');

const { Compositor } = require('../engine/compositor');
const { SceneStore } = require('../engine/scene-store');
const createScenesRouter = require('../routes/scenes');
const effects = require('../effects');
const filmstrip = require('../engine/filmstrip');
const { startApp } = require('./support/http');

function stubPreviewCache() {
    return {
        all: async (items) => items.map((x) => ({ id: x.id || x.type, frames: [] })),
        get: (scene) => ({ id: scene.id, frames: [] }),
    };
}

// Two known scenes, fixed ids, so assertions can name them.
async function harness() {
    const model = [{ point: [0, 0, 0] }, { point: [0.25, 0, 0] }];
    const client = { brightness: 1, setPixel() {}, writePixels() {} };
    const store = new SceneStore(new Compositor(client, model), null);
    store.setScenes([
        { id: 's1', name: 'One', layers: [{ id: 'l1', effectType: 'solid', params: { color: '#ff0000' } }] },
        { id: 's2', name: 'Two', layers: [] },
    ]);

    const app = await startApp((a) => {
        a.use('/api', createScenesRouter(store, stubPreviewCache(), stubPreviewCache()));
    });
    return { app, store };
}

test('GET /api/effects returns the catalog the UI builds controls from', async () => {
    const { app } = await harness();
    try {
        const res = await app.get('/api/effects');
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.json) && res.json.length > 0);
        assert.ok(res.json.every((e) => e.type && e.schema));
    } finally { await app.close(); }
});

test('GET /api/effects/previews carries the filmstrip envelope', async () => {
    const { app } = await harness();
    try {
        const res = await app.get('/api/effects/previews');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.json.version, 1);
        assert.strictEqual(res.json.frames, filmstrip.FRAMES);
        assert.strictEqual(res.json.intervalMs, filmstrip.INTERVAL_MS);
        assert.strictEqual(res.json.previews.length, effects.list().length);
    } finally { await app.close(); }
});

test('GET /api/scenes lists id, name and layer count', async () => {
    const { app } = await harness();
    try {
        const res = await app.get('/api/scenes');
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(res.json, [
            { id: 's1', name: 'One', layerCount: 1 },
            { id: 's2', name: 'Two', layerCount: 0 },
        ]);
    } finally { await app.close(); }
});

test('POST /api/scenes creates, and a bodyless POST still creates a default scene', async () => {
    const { app, store } = await harness();
    try {
        const made = await app.post('/api/scenes', { body: { name: 'Three' } });
        assert.strictEqual(made.status, 201);
        assert.strictEqual(made.json.name, 'Three');
        assert.ok(made.json.id);

        // express 5 gives `undefined` here where v4 gave `{}`; the route's
        // `req.body || {}` is what keeps this a create rather than a 500.
        const bare = await app.post('/api/scenes');
        assert.strictEqual(bare.status, 201);
        assert.strictEqual(bare.json.name, 'New scene');
        assert.deepStrictEqual(bare.json.layers, []);
        assert.strictEqual(store.scenes.length, 4);
    } finally { await app.close(); }
});

test('GET /api/scenes/:id returns a scene, or 404 for an unknown id', async () => {
    const { app } = await harness();
    try {
        const ok = await app.get('/api/scenes/s1');
        assert.strictEqual(ok.status, 200);
        assert.strictEqual(ok.json.name, 'One');
        assert.strictEqual(ok.json.layers[0].effectType, 'solid');
        // stripRuntime: the hot-loop fields never go over the wire
        assert.ok(!('_prepared' in ok.json.layers[0]));

        assert.strictEqual((await app.get('/api/scenes/nope')).status, 404);
    } finally { await app.close(); }
});

test('GET /api/scenes/:id/preview 404s before it reaches the cache', async () => {
    const { app } = await harness();
    try {
        const ok = await app.get('/api/scenes/s1/preview');
        assert.strictEqual(ok.status, 200);
        assert.strictEqual(ok.json.previews.length, 1);

        assert.strictEqual((await app.get('/api/scenes/nope/preview')).status, 404);
    } finally { await app.close(); }
});

test('PUT /api/scenes/:id replaces the whole document, and 404s for an unknown id', async () => {
    const { app, store } = await harness();
    try {
        const res = await app.put('/api/scenes/s1', {
            body: { name: 'Renamed', layers: [{ effectType: 'solid', params: { color: '#00ff00' } }] },
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.json.name, 'Renamed');
        assert.strictEqual(res.json.layers.length, 1);

        const missing = await app.put('/api/scenes/nope', { body: { name: 'x', layers: [] } });
        assert.strictEqual(missing.status, 404);

        // A bodyless PUT is a full-document replace with no layers — it empties
        // the scene rather than erroring. Destructive by design (there is no
        // PATCH), which is why the UI PUTs whole scenes and never fragments.
        const bare = await app.put('/api/scenes/s1');
        assert.strictEqual(bare.status, 200);
        assert.deepStrictEqual(bare.json.layers, []);
        assert.strictEqual(store.get('s1').name, 'Renamed');
    } finally { await app.close(); }
});

test('DELETE /api/scenes/:id removes once, then 404s', async () => {
    const { app, store } = await harness();
    try {
        assert.strictEqual((await app.del('/api/scenes/s2')).status, 200);
        assert.strictEqual(store.get('s2'), null);
        assert.strictEqual((await app.del('/api/scenes/s2')).status, 404);
        assert.strictEqual((await app.del('/api/scenes/nope')).status, 404);
    } finally { await app.close(); }
});

test('PUT /api/scenes/:sceneId/layers/:layerId 404s on either unknown half', async () => {
    const { app } = await harness();
    try {
        const ok = await app.put('/api/scenes/s1/layers/l1', {
            body: { effectType: 'solid', params: { color: '#0000ff' }, blendMode: 'add' },
        });
        assert.strictEqual(ok.status, 200);
        assert.strictEqual(ok.json.id, 'l1');
        assert.strictEqual(ok.json.blendMode, 'add');

        assert.strictEqual((await app.put('/api/scenes/nope/layers/l1', { body: {} })).status, 404);
        assert.strictEqual((await app.put('/api/scenes/s1/layers/nope', { body: {} })).status, 404);
    } finally { await app.close(); }
});

test('a partial layer PUT drops effectType rather than merging', async () => {
    // Pins the hazard the high-frequency edit path carries: this route takes a
    // whole layer, so a body missing effectType produces a layer without one
    // and still answers 200. The UI always sends the complete layer; anything
    // hand-driving this API has to do the same.
    const { app, store } = await harness();
    try {
        const res = await app.put('/api/scenes/s1/layers/l1', { body: { params: { color: '#123456' } } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.json.effectType, undefined);
        assert.strictEqual(store.get('s1').layers[0].effectType, undefined);
    } finally { await app.close(); }
});

test('PUT /api/scenes/order takes a permutation and rejects anything else', async () => {
    const { app, store } = await harness();
    try {
        const ok = await app.put('/api/scenes/order', { body: { ids: ['s2', 's1'] } });
        assert.strictEqual(ok.status, 200);
        assert.deepStrictEqual(store.scenes.map((s) => s.id), ['s2', 's1']);

        for (const body of [{ ids: ['s1'] }, { ids: ['s1', 's1'] }, { ids: ['s1', 'nope'] }, {}, { ids: 's1' }]) {
            assert.strictEqual((await app.put('/api/scenes/order', { body })).status, 400,
                'expected 400 for ' + JSON.stringify(body));
        }
        assert.strictEqual((await app.put('/api/scenes/order')).status, 400);
        // rejected whole, never applied in part
        assert.deepStrictEqual(store.scenes.map((s) => s.id), ['s2', 's1']);
    } finally { await app.close(); }
});

test('GET /api/scenes/export round-trips through POST /api/scenes/import', async () => {
    const { app, store } = await harness();
    try {
        const dump = await app.get('/api/scenes/export');
        assert.strictEqual(dump.status, 200);
        assert.strictEqual(dump.json.version, 2);
        assert.strictEqual(dump.json.scenes.length, 2);

        await app.del('/api/scenes/s1');
        assert.strictEqual(store.scenes.length, 1);

        const back = await app.post('/api/scenes/import', { body: dump.json });
        assert.strictEqual(back.status, 200);
        assert.strictEqual(store.scenes.length, 2);
        assert.ok(store.get('s1'));
    } finally { await app.close(); }
});

test('POST /api/scenes/import rejects every wrong shape with 400', async () => {
    const { app } = await harness();
    try {
        for (const body of [{ version: 1, scenes: [] }, { version: 2 }, { version: 2, scenes: {} }, {}]) {
            assert.strictEqual((await app.post('/api/scenes/import', { body })).status, 400,
                'expected 400 for ' + JSON.stringify(body));
        }
        assert.strictEqual((await app.post('/api/scenes/import')).status, 400);
    } finally { await app.close(); }
});

test('GET/PUT /api/active_scene activates, switches off, and 404s an unknown id', async () => {
    const { app, store } = await harness();
    try {
        assert.deepStrictEqual((await app.get('/api/active_scene')).json, { id: null });

        const on = await app.put('/api/active_scene', { body: { id: 's1' } });
        assert.strictEqual(on.status, 200);
        assert.strictEqual(store.activeSceneId, 's1');

        // `{id: null}` is "off" and must stay distinct from a missing key
        const off = await app.put('/api/active_scene', { body: { id: null } });
        assert.strictEqual(off.status, 200);
        assert.strictEqual(store.activeSceneId, null);

        assert.strictEqual((await app.put('/api/active_scene', { body: { id: 'nope' } })).status, 404);
        assert.strictEqual((await app.put('/api/active_scene', { body: {} })).status, 400);
        assert.strictEqual((await app.put('/api/active_scene')).status, 400);
    } finally { await app.close(); }
});

test('deleting the active scene switches the panel off rather than dangling', async () => {
    const { app, store } = await harness();
    try {
        await app.put('/api/active_scene', { body: { id: 's1' } });
        assert.strictEqual((await app.del('/api/scenes/s1')).status, 200);
        assert.strictEqual(store.activeSceneId, null);
        assert.deepStrictEqual((await app.get('/api/active_scene')).json, { id: null });
    } finally { await app.close(); }
});

test('malformed JSON is a 400 from the body parser, not a 500', async () => {
    const { app } = await harness();
    try {
        const res = await app.post('/api/scenes/import', { body: '{"version":2,', raw: true });
        assert.strictEqual(res.status, 400);
    } finally { await app.close(); }
});
