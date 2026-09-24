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

test('save creates its target directory if missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonstore-'));
    const file = path.join(dir, 'nested', 'doc.json');
    jsonStore.save(file, { n: 1 });
    assert.deepStrictEqual(jsonStore.load(file), { n: 1 });
});

// writeSync is allowed to write less than it was given. Forced to dribble a few
// bytes a call, the save must still land the whole document.
test('save completes a document across short writes', (t) => {
    const file = tmpFile('doc.json');
    const real = fs.writeSync;
    let calls = 0;
    t.mock.method(fs, 'writeSync', (fd, buf, off, len) => {
        calls++;
        return real(fd, buf, off, Math.min(len, 7));
    });
    const doc = { version: 2, scenes: [{ id: 'ab12cd34', name: 'long enough to need many writes' }] };
    jsonStore.save(file, doc);
    t.mock.restoreAll();

    assert.ok(calls > 5, `expected many short writes, got ${calls}`);
    assert.deepStrictEqual(jsonStore.load(file), doc);
});

// The renames are a change to the directory; without an fsync on it a power
// cut can undo a save whose file contents were already durable.
test('save fsyncs the directory after renaming into place', (t) => {
    const file = tmpFile('doc.json');
    const dir = path.dirname(file);
    const opened = new Map();
    const realOpen = fs.openSync;
    t.mock.method(fs, 'openSync', (p, flags) => {
        const fd = realOpen(p, flags);
        opened.set(fd, p);
        return fd;
    });
    const synced = [];
    const realFsync = fs.fsyncSync;
    t.mock.method(fs, 'fsyncSync', (fd) => { synced.push(opened.get(fd)); return realFsync(fd); });
    jsonStore.save(file, { n: 1 });
    t.mock.restoreAll();

    assert.deepStrictEqual(synced, [`${file}.tmp`, dir]);
});

test('a second save keeps the previous version as .bak', () => {
    const file = tmpFile('doc.json');
    jsonStore.save(file, { n: 1 });
    jsonStore.save(file, { n: 2 });
    assert.deepStrictEqual(jsonStore.load(file), { n: 2 });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(`${file}.bak`)), { n: 1 });
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
    fs.writeFileSync(`${file}.bak`, 'also not json');
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
    await a.load();
    const scene = a.create({ name: 'Keep me', layers: [{ effectType: 'solid', params: {} }] });
    a.setActive(scene.id);
    await a.flush();

    const b = makeStore(file);
    await b.load();
    assert.ok(b.get(scene.id));
    assert.strictEqual(b.get(scene.id).name, 'Keep me');
    assert.strictEqual(b.activeSceneId, scene.id);
});

test('SceneStore recovers scenes from .bak after main-file corruption', async () => {
    const file = tmpFile('scenes.json');
    const a = makeStore(file);
    await a.load();
    const scene = a.create({ name: 'Survivor' });
    await a.flush();
    a.create({ name: 'Later edit' });
    await a.flush();

    fs.writeFileSync(file, '{"version": 2, "scen'); // power cut mid-write

    const b = makeStore(file);
    await b.load();
    assert.ok(b.get(scene.id), 'scene from the .bak generation should survive');
});
