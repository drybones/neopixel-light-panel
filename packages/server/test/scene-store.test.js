const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Compositor } = require('../engine/compositor');
const { SceneStore, DEFAULTS_FILE } = require('../engine/scene-store');
const jsonStore = require('../engine/json-store');
const effects = require('../effects');

const defaultDoc = JSON.parse(fs.readFileSync(DEFAULTS_FILE, 'utf8'));

function makeStore() {
    const model = [{ point: [0, 0, 0] }, { point: [0.25, 0, 0] }];
    const client = { brightness: 1, setPixel() {}, writePixels() {} };
    const compositor = new Compositor(client, model);
    return new SceneStore(compositor, null);
}

function tmpFile(name) {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scenestore-')), name);
}

function makePersistedStore(file) {
    const model = [{ point: [0, 0, 0] }, { point: [0.25, 0, 0] }];
    const client = { brightness: 1, setPixel() {}, writePixels() {} };
    return new SceneStore(new Compositor(client, model), file);
}

test('preprocess filters disabled layers and honours solo', () => {
    const store = makeStore();
    const scene = {
        id: 's1', name: 't',
        layers: [
            { id: 'a', effectType: 'solid', params: {}, blendMode: 'normal', opacity: 1, enabled: true, solo: false },
            { id: 'b', effectType: 'solid', params: {}, blendMode: 'add', opacity: 1, enabled: false, solo: false },
            { id: 'c', effectType: 'solid', params: {}, blendMode: 'add', opacity: 1, enabled: true, solo: false },
        ],
    };
    store.preprocess(scene);
    assert.deepStrictEqual(scene._displayLayers.map(l => l.id), ['a', 'c']);

    scene.layers[2].solo = true;
    store.preprocess(scene);
    assert.deepStrictEqual(scene._displayLayers.map(l => l.id), ['c']);
});

test('preprocess attaches _prepared and _blend', () => {
    const store = makeStore();
    const scene = {
        id: 's1', name: 't',
        layers: [{ id: 'a', effectType: 'solid', params: { color: '#102030', level: 1 }, blendMode: 'screen', opacity: 1, enabled: true, solo: false }],
    };
    store.preprocess(scene);
    assert.strictEqual(scene.layers[0]._blend, 3);
    assert.strictEqual(scene.layers[0]._prepared.r, 16);
});

test('create fills defaults and assigns ids', () => {
    const store = makeStore();
    const scene = store.create({ name: 'X', layers: [{ effectType: 'wavelet', params: { color: '#123456' } }] });
    assert.ok(/^[0-9a-f]{8}$/.test(scene.id));
    assert.strictEqual(scene.layers[0].params.color, '#123456');
    assert.strictEqual(scene.layers[0].params.freq, 0.2);
    assert.strictEqual(scene.layers[0].blendMode, 'normal');
    assert.strictEqual(scene.layers[0].enabled, true);
});

test('replaceLayer updates one layer and repreprocesses', () => {
    const store = makeStore();
    const scene = store.create({ name: 'X', layers: [{ effectType: 'solid', params: { color: '#000000' } }] });
    const layerId = scene.layers[0].id;
    const updated = store.replaceLayer(scene.id, layerId, {
        effectType: 'solid', params: { color: '#ff0000', level: 1 }, blendMode: 'add', opacity: 0.5,
    });
    assert.strictEqual(updated.id, layerId);
    assert.strictEqual(updated.blendMode, 'add');
    const live = store.get(scene.id);
    assert.strictEqual(live.layers[0]._prepared.r, 255);
    assert.strictEqual(live.layers[0]._blend, 1);
});

test('remove clears active scene when it was active', () => {
    const store = makeStore();
    const scene = store.create({ name: 'X' });
    store.setActive(scene.id);
    assert.strictEqual(store.activeSceneId, scene.id);
    store.remove(scene.id);
    assert.strictEqual(store.activeSceneId, null);
});

test('setActive rejects unknown ids and accepts null', () => {
    const store = makeStore();
    assert.strictEqual(store.setActive('nope1234'), false);
    assert.strictEqual(store.setActive(null), true);
    assert.strictEqual(store.activeSceneId, null);
});

test('importMerge replaces by id and appends new', () => {
    const store = makeStore();
    const scene = store.create({ name: 'Old name' });
    store.importMerge([
        { id: scene.id, name: 'New name', layers: [] },
        { id: 'aabbccdd', name: 'Imported', layers: [{ id: 'x1', effectType: 'solid', params: {} }] },
    ]);
    assert.strictEqual(store.get(scene.id).name, 'New name');
    assert.strictEqual(store.get('aabbccdd').layers.length, 1);
    assert.strictEqual(store.scenes.length, 2);
});

test('importMerge accepts a single-scene export, adding a new id', () => {
    const store = makeStore();
    const before = store.scenes.length;
    store.importMerge([
        { id: 'aabbccdd', name: 'Imported solo', layers: [{ id: 'x1', effectType: 'solid', params: {} }] },
    ]);
    assert.strictEqual(store.scenes.length, before + 1);
    assert.strictEqual(store.get('aabbccdd').name, 'Imported solo');
});

test('importMerge accepts a single-scene export, replacing an existing id in place', () => {
    const store = makeStore();
    const scene = store.create({ name: 'Old name', layers: [{ effectType: 'solid', params: {} }] });
    const before = store.scenes.length;
    store.importMerge([
        { id: scene.id, name: 'Edited elsewhere', layers: [{ id: 'y1', effectType: 'wavelet', params: {} }] },
    ]);
    assert.strictEqual(store.scenes.length, before, 'replace must not add a scene');
    const updated = store.get(scene.id);
    assert.strictEqual(updated.name, 'Edited elsewhere');
    assert.strictEqual(updated.layers[0].effectType, 'wavelet');
});

test('getPublic strips runtime fields', () => {
    const store = makeStore();
    const scene = store.create({ name: 'X', layers: [{ effectType: 'solid', params: {} }] });
    const pub = store.getPublic(scene.id);
    assert.strictEqual(pub._displayLayers, undefined);
    assert.strictEqual(pub.layers[0]._prepared, undefined);
    assert.strictEqual(pub.layers[0]._blend, undefined);
});

test('a noise layer with no params at all just gets the defaults', () => {
    const store = makeStore();
    store.setScenes([{ id: 's', name: 'n', layers: [{ id: 'l', effectType: 'noise', params: {} }] }]);
    const params = store.scenes[0].layers[0].params;
    assert.strictEqual(params.min, 0);
    assert.strictEqual(params.max, 1);
});

// ---- duplicate layer ids ----

test('duplicate layer ids across scenes are repaired on load', () => {
    // The compositor caches one render instance per layer id, so a shared id
    // is harmless while both layers are the same effect type but, once their
    // effect types differ, the two scenes render each other's params — in
    // practice, a black or NaN panel.
    const shared = 'dupe1234';
    const store = makeStore();
    store.setScenes([
        { id: 'sceneone', name: 'Solid', layers: [{ id: shared, effectType: 'solid', params: { color: '#ff0000', level: 1 } }] },
        { id: 'scenetwo', name: 'Wavelet', layers: [{ id: shared, effectType: 'wavelet', params: {} }] },
    ]);

    const ids = store.scenes.map((s) => s.layers[0].id);
    assert.notStrictEqual(ids[0], ids[1], 'layer ids must be unique across the document');
    assert.strictEqual(store.scenes[0].layers[0].effectType, 'solid');
    assert.strictEqual(store.scenes[1].layers[0].effectType, 'wavelet');

    // Both must still render real colour after the other has been synced.
    for (const scene of [store.scenes[1], store.scenes[0], store.scenes[1]]) {
        store.compositor.renderFrame(scene, 1234);
        const comp = store.compositor.composite;
        assert.ok(comp.every(Number.isFinite), `${scene.name} rendered non-finite channels`);
        assert.ok(comp.some((v) => v > 0), `${scene.name} rendered black`);
    }
});

// ---- load() / seeding ----

test('a fresh install seeds the default set in order with no NaN', async () => {
    const store = makePersistedStore(tmpFile('scenes.json'));
    await store.load();
    assert.deepStrictEqual(store.scenes.map((s) => s.name), defaultDoc.scenes.map((s) => s.name));

    const catalogTypes = effects.catalog().map((e) => e.type);
    for (const scene of store.scenes) {
        for (const layer of scene.layers) {
            assert.ok(catalogTypes.includes(layer.effectType), `${layer.effectType} missing from catalog`);
        }
        store.compositor.renderFrame(scene, 1000);
        assert.ok(store.compositor.composite.every(Number.isFinite), `${scene.name} rendered non-finite channels`);
    }
});

test('a second store on the same file loads the same set and does not re-seed', async () => {
    const file = tmpFile('scenes.json');
    const first = makePersistedStore(file);
    await first.load();

    const second = makePersistedStore(file);
    await second.load();
    assert.strictEqual(second.scenes.length, defaultDoc.scenes.length);
});

test('{version: 2, scenes: []} loads as zero scenes', async () => {
    const file = tmpFile('scenes.json');
    jsonStore.save(file, { version: 2, activeSceneId: null, scenes: [] });

    const store = makePersistedStore(file);
    await store.load();
    assert.strictEqual(store.scenes.length, 0);
});

test('a missing/non-array scenes key is treated as fresh', async () => {
    const file = tmpFile('scenes.json');
    jsonStore.save(file, { version: 2, activeSceneId: null });

    const store = makePersistedStore(file);
    await store.load();
    assert.strictEqual(store.scenes.length, defaultDoc.scenes.length);
});

test('an activeSceneId naming an absent scene falls back to null', async () => {
    const file = tmpFile('scenes.json');
    jsonStore.save(file, {
        version: 2, activeSceneId: 'ghost123',
        scenes: [{ id: 'real1234', name: 'Real', layers: [] }],
    });

    const store = makePersistedStore(file);
    await store.load();
    assert.strictEqual(store.activeSceneId, null);
});

test('duplicate-id repair from load() is persisted', async () => {
    const file = tmpFile('scenes.json');
    const shared = 'dupe1234';
    jsonStore.save(file, {
        version: 2, activeSceneId: null,
        scenes: [
            { id: 'sceneone', name: 'Solid', layers: [{ id: shared, effectType: 'solid', params: {} }] },
            { id: 'scenetwo', name: 'Wavelet', layers: [{ id: shared, effectType: 'wavelet', params: {} }] },
        ],
    });

    const store = makePersistedStore(file);
    await store.load();
    const ids = store.scenes.map((s) => s.layers[0].id);
    assert.notStrictEqual(ids[0], ids[1]);

    const reloaded = jsonStore.load(file);
    const reloadedIds = reloaded.scenes.map((s) => s.layers[0].id);
    assert.notStrictEqual(reloadedIds[0], reloadedIds[1], 'the repair must have been flushed to disk');
});

// ---- reorder ----

function threeScenes(store) {
    store.setScenes([
        { id: 'a', name: 'A', layers: [] },
        { id: 'b', name: 'B', layers: [] },
        { id: 'c', name: 'C', layers: [] },
    ]);
    return store;
}

test('reorder permutes the scene list', () => {
    const store = threeScenes(makeStore());
    assert.strictEqual(store.reorder(['c', 'a', 'b']), true);
    assert.deepStrictEqual(store.scenes.map(s => s.id), ['c', 'a', 'b']);
    assert.deepStrictEqual(store.list().map(s => s.name), ['C', 'A', 'B']);
});

test('reorder moves the scene objects, not copies', () => {
    const store = threeScenes(makeStore());
    const b = store.get('b');
    store.reorder(['b', 'c', 'a']);
    // The compositor keys instances off the layers these carry; rebuilding the
    // scenes here would drop _prepared and re-seed every particle on reorder.
    assert.strictEqual(store.scenes[0], b);
    assert.ok(store.scenes.every(s => s._displayLayers));
});

test('reorder rejects a list that is not a permutation', () => {
    const store = threeScenes(makeStore());
    const before = store.scenes.slice();
    for (const bad of [undefined, null, ['a', 'b'], ['a', 'b', 'c', 'd'], ['a', 'b', 'z'], ['a', 'b', 'b']]) {
        assert.strictEqual(store.reorder(bad), false, `${JSON.stringify(bad)} should be rejected`);
        assert.deepStrictEqual(store.scenes, before, 'a rejected reorder must not partly apply');
    }
});

test('reorder leaves the active scene active', () => {
    const store = threeScenes(makeStore());
    store.setActive('a');
    store.reorder(['c', 'b', 'a']);
    assert.strictEqual(store.activeSceneId, 'a');
    assert.strictEqual(store.activeScene().name, 'A');
});

// ---- bulk mutations: removeAll / resetToDefaults / importReplace ----
//
// The compositor's instance map is the thing to watch across all three: it is
// keyed by layer id and spans every scene, so a bulk drop that forgets to
// release leaks an instance per layer for the life of the process.

function twoSceneStore() {
    const store = makeStore();
    store.setScenes([
        { id: 'a', name: 'A', layers: [{ id: 'la', effectType: 'solid', params: {} }] },
        { id: 'b', name: 'B', layers: [{ id: 'lb1', effectType: 'wavelet', params: {} }, { id: 'lb2', effectType: 'noise', params: {} }] },
    ]);
    return store;
}

test('removeAll empties the library, nulls the active scene and releases every layer', () => {
    const store = twoSceneStore();
    store.setActive('b');
    assert.strictEqual(store.compositor.layers.size, 3);

    store.removeAll();
    assert.deepStrictEqual(store.scenes, []);
    assert.strictEqual(store.activeSceneId, null);
    assert.strictEqual(store.compositor.layers.size, 0, 'every layer instance must be released');
    assert.deepStrictEqual(store.list(), []);
});

test('an empty library survives a reload rather than re-seeding the defaults', async () => {
    // load() tells an empty scenes array apart from a missing key on purpose;
    // getting it wrong means a delete-all silently undoes itself on the next
    // service restart.
    const file = tmpFile('scenes.json');
    const store = makePersistedStore(file);
    await store.load();
    store.removeAll();
    await store.flush();

    const reloaded = makePersistedStore(file);
    await reloaded.load();
    assert.strictEqual(reloaded.scenes.length, 0);
});

test('resetToDefaults replaces the library and is idempotent', () => {
    const store = twoSceneStore();
    store.setActive('a');

    store.resetToDefaults();
    assert.deepStrictEqual(store.scenes.map((s) => s.id), defaultDoc.scenes.map((s) => s.id));
    assert.strictEqual(store.activeSceneId, null, 'a reset library has no active scene');
    const first = JSON.stringify(store.exportAll());

    store.resetToDefaults();
    assert.strictEqual(JSON.stringify(store.exportAll()), first, 'fixed ids make a second reset a no-op');
});

test('resetToDefaults releases the old layers and holds exactly the new ones', () => {
    const store = twoSceneStore();
    store.resetToDefaults();
    const layerIds = store.scenes.flatMap((s) => s.layers.map((l) => l.id));
    assert.strictEqual(store.compositor.layers.size, layerIds.length);
    assert.ok(layerIds.every((id) => store.compositor.layers.has(id)));
    for (const stale of ['la', 'lb1', 'lb2']) {
        assert.ok(!store.compositor.layers.has(stale), `${stale} was not released`);
    }
});

// Not "renders something": the harness model is two LEDs at the origin, and
// plenty of the defaults legitimately light neither at a given instant.
test('every default scene renders finite channels', () => {
    const store = makeStore();
    store.resetToDefaults();
    for (const scene of store.scenes) {
        store.compositor.renderFrame(scene, 2500);
        const comp = store.compositor.composite;
        assert.ok(comp.every(Number.isFinite), `${scene.name} rendered non-finite channels`);
    }
});

test('importReplace swaps the whole library, not merging into it', () => {
    const store = twoSceneStore();
    store.importReplace([{ id: 'z', name: 'Z', layers: [{ id: 'lz', effectType: 'solid', params: {} }] }]);
    assert.deepStrictEqual(store.scenes.map((s) => s.id), ['z']);
    assert.strictEqual(store.compositor.layers.size, 1, 'the *old* layers are the ones to release');
    assert.ok(store.compositor.layers.has('lz'));
});

test('importReplace keeps an active id the incoming set still contains', () => {
    // Round-tripping your own export leaves the panel exactly as it was.
    const store = twoSceneStore();
    store.setActive('b');
    store.importReplace(store.exportAll().scenes);
    assert.strictEqual(store.activeSceneId, 'b');
});

test('importReplace nulls an active id that vanished with the old library', () => {
    const store = twoSceneStore();
    store.setActive('b');
    store.importReplace([{ id: 'z', name: 'Z', layers: [] }]);
    assert.strictEqual(store.activeSceneId, null);
});

// ---- the defaults file itself ----
//
// It is checked-in code rather than user data, so it is worth asserting the
// things nothing else would tell us about: setScenes() repairs a duplicate
// layer id *silently*, so a hand-edited file with copy-pasted ids would get
// different ids than it says, and an unknown effectType renders as nothing at
// all rather than erroring.

test('the defaults file is a valid import envelope', () => {
    assert.strictEqual(defaultDoc.version, 2);
    assert.ok(Array.isArray(defaultDoc.scenes) && defaultDoc.scenes.length > 0);
    assert.ok(defaultDoc.scenes.every((s) => s.id && s.name && Array.isArray(s.layers)));
});

test('every layer id in the defaults file is unique across the whole document', () => {
    const ids = defaultDoc.scenes.flatMap((s) => s.layers.map((l) => l.id));
    assert.strictEqual(new Set(ids).size, ids.length, 'duplicate layer ids would be repaired silently');
    const sceneIds = defaultDoc.scenes.map((s) => s.id);
    assert.strictEqual(new Set(sceneIds).size, sceneIds.length);
});

test('every effectType in the defaults file is in the catalog', () => {
    const known = effects.catalog().map((e) => e.type);
    for (const scene of defaultDoc.scenes) {
        for (const layer of scene.layers) {
            assert.ok(known.includes(layer.effectType), `${scene.name}: ${layer.effectType} is not an effect`);
        }
    }
});

test('the defaults load without setScenes having to repair anything', () => {
    const store = makeStore();
    store.setScenes(defaultDoc.scenes);
    assert.strictEqual(store._dirty, false, 'a repair means the file does not say what the panel gets');
    assert.deepStrictEqual(
        store.scenes.flatMap((s) => s.layers.map((l) => l.id)),
        defaultDoc.scenes.flatMap((s) => s.layers.map((l) => l.id)),
    );
});
