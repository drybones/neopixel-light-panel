const test = require('node:test');
const assert = require('node:assert');

const { Compositor } = require('../engine/compositor');
const { SceneStore } = require('../engine/scene-store');

function makeStore() {
    const model = [{ point: [0, 0, 0] }, { point: [0.25, 0, 0] }];
    const client = { brightness: 1, setPixel() {}, writePixels() {} };
    const compositor = new Compositor(client, model);
    return new SceneStore(compositor, null);
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

test('getPublic strips runtime fields', () => {
    const store = makeStore();
    const scene = store.create({ name: 'X', layers: [{ effectType: 'solid', params: {} }] });
    const pub = store.getPublic(scene.id);
    assert.strictEqual(pub._displayLayers, undefined);
    assert.strictEqual(pub.layers[0]._prepared, undefined);
    assert.strictEqual(pub.layers[0]._blend, undefined);
});
