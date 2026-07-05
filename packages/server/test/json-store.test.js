const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const jsonStore = require('../engine/json-store');
const { Compositor } = require('../engine/compositor');
const { SceneStore } = require('../engine/scene-store');

function tmpFile(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonstore-'));
    return path.join(dir, name);
}

test('save/load round-trips a document', () => {
    const file = tmpFile('doc.json');
    jsonStore.save(file, { version: 2, scenes: [{ id: 'ab12cd34' }] });
    assert.deepStrictEqual(jsonStore.load(file), { version: 2, scenes: [{ id: 'ab12cd34' }] });
});

test('load returns null when the file never existed', () => {
    assert.strictEqual(jsonStore.load(tmpFile('missing.json')), null);
});

test('a second save keeps the previous version as .bak', () => {
    const file = tmpFile('doc.json');
    jsonStore.save(file, { n: 1 });
    jsonStore.save(file, { n: 2 });
    assert.deepStrictEqual(jsonStore.load(file), { n: 2 });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file + '.bak')), { n: 1 });
});

test('a truncated main file falls back to .bak', () => {
    const file = tmpFile('doc.json');
    jsonStore.save(file, { n: 1 });
    jsonStore.save(file, { n: 2 });
    // Simulate a power cut mid-write: main file half-written garbage
    fs.writeFileSync(file, '{"n": 2, "scen');
    const warnings = [];
    const doc = jsonStore.load(file, (msg) => warnings.push(msg));
    assert.deepStrictEqual(doc, { n: 1 });
    assert.ok(warnings.some((w) => w.includes('corrupt')));
});

test('load returns null when both main and .bak are corrupt', () => {
    const file = tmpFile('doc.json');
    fs.writeFileSync(file, 'not json');
    fs.writeFileSync(file + '.bak', 'also not json');
    assert.strictEqual(jsonStore.load(file), null);
});

function makeStore(file) {
    const model = [{ point: [0, 0, 0] }, { point: [0.25, 0, 0] }];
    const client = { brightness: 1, setPixel() {}, writePixels() {} };
    return new SceneStore(new Compositor(client, model), file);
}

test('SceneStore persists and reloads through the file', async () => {
    const file = tmpFile('scenes.json');
    const a = makeStore(file);
    await a.load({});
    const scene = a.create({ name: 'Keep me', layers: [{ effectType: 'solid', params: {} }] });
    a.setActive(scene.id);
    a.seededBuiltins = true;
    await a.flush();

    const b = makeStore(file);
    await b.load({});
    assert.ok(b.get(scene.id));
    assert.strictEqual(b.get(scene.id).name, 'Keep me');
    assert.strictEqual(b.activeSceneId, scene.id);
    assert.strictEqual(b.seededBuiltins, true);
});

test('SceneStore recovers scenes from .bak after main-file corruption', async () => {
    const file = tmpFile('scenes.json');
    const a = makeStore(file);
    await a.load({});
    const scene = a.create({ name: 'Survivor' });
    await a.flush();
    a.create({ name: 'Later edit' });
    await a.flush();

    fs.writeFileSync(file, '{"version": 2, "scen'); // power cut mid-write

    const b = makeStore(file);
    await b.load({});
    assert.ok(b.get(scene.id), 'scene from the .bak generation should survive');
});

test('SceneStore prefers the file over legacy node-persist data', async () => {
    const file = tmpFile('scenes.json');
    const a = makeStore(file);
    await a.load({});
    a.create({ name: 'From file' });
    await a.flush();

    const b = makeStore(file);
    await b.load({ scenes: [{ id: 'aaaaaaaa', name: 'From legacy', layers: [] }] });
    assert.ok(b.scenes.some((s) => s.name === 'From file'));
    assert.ok(!b.scenes.some((s) => s.name === 'From legacy'));
});

test('SceneStore falls back to legacy scenes, then migration, then default', async () => {
    const legacyStore = makeStore(tmpFile('scenes.json'));
    await legacyStore.load({
        scenes: [{ id: 'aaaaaaaa', name: 'From legacy', layers: [] }],
        activeSceneId: 'aaaaaaaa',
        seeded: true,
    });
    assert.strictEqual(legacyStore.scenes[0].name, 'From legacy');
    assert.strictEqual(legacyStore.activeSceneId, 'aaaaaaaa');
    assert.strictEqual(legacyStore.seededBuiltins, true);

    const migratedStore = makeStore(tmpFile('scenes.json'));
    await migratedStore.load({
        migrated: { scenes: [{ id: 'bbbbbbbb', name: 'From migration', layers: [] }], activeSceneId: null },
    });
    assert.strictEqual(migratedStore.scenes[0].name, 'From migration');

    const defaultStore = makeStore(tmpFile('scenes.json'));
    await defaultStore.load({});
    assert.strictEqual(defaultStore.scenes.length, 1);
    assert.strictEqual(defaultStore.scenes[0].name, 'Default');
});
