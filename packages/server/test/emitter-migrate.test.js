const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Compositor } = require('../engine/compositor');
const { SceneStore } = require('../engine/scene-store');
const emitterMigrate = require('../engine/emitter-migrate');
const effects = require('../effects');
const OPC = require('../opc');

const model = OPC.loadModel(path.join(__dirname, '../layout.json'));
const ctx = {
    modelX: new Float32Array(model.length),
    modelZ: new Float32Array(model.length),
    numPixels: model.length,
};
for (let i = 0; i < model.length; i++) {
    ctx.modelX[i] = model[i].point[0];
    ctx.modelZ[i] = model[i].point[2];
}

function tmpFile(name) {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'emitter-migrate-')), name);
}

function makeStore(file) {
    const sink = { setPixel() {}, writePixels() {} };
    return new SceneStore(new Compositor(sink, model), file);
}

function docWith(layers) {
    return {
        version: 2,
        activeSceneId: 's1',
        seededBuiltins: true,
        planeWaveMigrated: true,
        scenes: [{ id: 's1', name: 'Sparks', layers }],
    };
}

const SPARKLER = { id: 'l1', effectType: 'candy_sparkler', blendMode: 'add', opacity: 1,
    enabled: true, solo: false, params: { count: 49, speed: 1, saturation: 1, glow: 0.02 } };
const EMBERS = { id: 'l2', effectType: 'embers', blendMode: 'add', opacity: 1,
    enabled: true, solo: false, params: { hue: 0.035, hueSpread: 0.11, count: 29, speed: 1, glow: 0.08 } };

test('converts both old particle types and leaves everything else alone', () => {
    const other = { id: 'l3', effectType: 'wavelet', params: { color: '#ffffff' } };
    const result = emitterMigrate.convertScenes([
        { id: 's1', name: 'a', layers: [SPARKLER, EMBERS, other] },
    ]);
    assert.strictEqual(result.converted, 2);
    const types = result.scenes[0].layers.map((l) => l.effectType);
    assert.deepStrictEqual(types, ['emitter', 'emitter', 'wavelet']);
    // The untouched layer is the same object, not a rebuilt copy.
    assert.strictEqual(result.scenes[0].layers[2], other);
});

test('conversion keeps layer identity, blend and enabled state', () => {
    const result = emitterMigrate.convertScenes([{ id: 's1', name: 'a', layers: [SPARKLER] }]);
    const layer = result.scenes[0].layers[0];
    assert.strictEqual(layer.id, 'l1');
    assert.strictEqual(layer.blendMode, 'add');
    assert.strictEqual(layer.enabled, true);
});

test('every converted layer produces params the emitter accepts', () => {
    const emitter = effects.get('emitter');
    const result = emitterMigrate.convertScenes([{ id: 's1', name: 'a', layers: [SPARKLER, EMBERS] }]);
    for (const layer of result.scenes[0].layers) {
        const params = { ...emitter.defaults, ...layer.params };
        // No key survives that the schema does not know about — a stray `glow`
        // would sit in the document forever with nothing to edit it.
        for (const key of Object.keys(layer.params)) {
            assert.ok(key in emitter.defaults, `converted params carry unknown key ${key}`);
        }
        const out = new Float32Array(ctx.numPixels * 3);
        const inst = emitter.createInstance(ctx);
        const p = emitter.prepare(params);
        for (let f = 0; f < 120; f++) inst.render(out, 1000 + f * 40, p);
        assert.ok(out.every((v) => Number.isFinite(v)));
        let sum = 0;
        for (let i = 0; i < out.length; i++) sum += out[i];
        assert.ok(sum > 0, `${layer.id} converted to a black layer`);
    }
});

// The old embers envelope peaked at 0.7 and the sparkler's at 1.0. Without
// this the converted layer is 1.43x brighter than it was.
test('embers folds its 0.7 envelope peak into layer opacity', () => {
    const result = emitterMigrate.convertScenes([
        { id: 's1', name: 'a', layers: [EMBERS, { ...EMBERS, id: 'l9', opacity: 0.5 }] },
    ]);
    assert.ok(Math.abs(result.scenes[0].layers[0].opacity - 0.7) < 1e-9);
    // Multiplied into a stored opacity, not replacing it.
    assert.ok(Math.abs(result.scenes[0].layers[1].opacity - 0.35) < 1e-9);
    // The sparkler peaked at 1.0, so it keeps its opacity untouched.
    const sparkler = emitterMigrate.convertScenes([{ id: 's', name: 'a', layers: [SPARKLER] }]);
    assert.strictEqual(sparkler.scenes[0].layers[0].opacity, 1);
});

// Old jitter was `hue + hueSpread * (random() - 0.15)`, biased up by
// 0.35 * hueSpread; the emitter's is symmetric. The swatch absorbs the bias.
test('embers hue is shifted to preserve its mean under a symmetric jitter', () => {
    const color = require('../engine/color');
    const params = emitterMigrate.embersToEmitter({ hue: 0.035, hueSpread: 0.11 });
    const shifted = color.hexToHsv(params.color).h;
    assert.ok(Math.abs(shifted - (0.035 + 0.35 * 0.11)) < 0.01,
        `hue ${shifted.toFixed(4)} does not carry the bias`);
});

test('candy sparkler keeps its random hue and its saturation', () => {
    const color = require('../engine/color');
    const full = emitterMigrate.sparklerToEmitter({ count: 49, speed: 1, saturation: 1 });
    assert.strictEqual(full.hueSpread, 1, 'a random hue per particle is hueSpread 1');
    assert.ok(Math.abs(color.hexToHsv(full.color).s - 1) < 0.01);
    // Colourfulness was a param; it rides on the swatch now.
    const pale = emitterMigrate.sparklerToEmitter({ count: 49, speed: 1, saturation: 0.6 });
    assert.ok(Math.abs(color.hexToHsv(pale.color).s - 0.6) < 0.01);
});

test('speed carries through both conversions', () => {
    const slow = emitterMigrate.sparklerToEmitter({ speed: 0.5 });
    const fast = emitterMigrate.sparklerToEmitter({ speed: 2 });
    assert.ok(fast.speed > slow.speed * 3.5);
    assert.ok(emitterMigrate.embersToEmitter({ speed: 2 }).speed
        > emitterMigrate.embersToEmitter({ speed: 1 }).speed);
});

test('missing params fall back rather than producing NaN', () => {
    for (const params of [undefined, {}, { count: 'nonsense' }]) {
        for (const fn of [emitterMigrate.sparklerToEmitter, emitterMigrate.embersToEmitter]) {
            const out = fn(params);
            for (const [key, value] of Object.entries(out)) {
                if (typeof value === 'number') {
                    assert.ok(Number.isFinite(value), `${key} was ${value}`);
                }
            }
        }
    }
});

test('the store converts on load, snapshots first, and does not re-run', async () => {
    const file = tmpFile('scenes-v2.json');
    fs.writeFileSync(file, JSON.stringify(docWith([SPARKLER, EMBERS])));

    const store = makeStore(file);
    await store.load({});
    assert.strictEqual(store.emitterMigrated, true);
    assert.deepStrictEqual(store.scenes[0].layers.map((l) => l.effectType), ['emitter', 'emitter']);

    const backup = file.replace(/\.json$/, '') + '.pre-emitter.json';
    assert.ok(fs.existsSync(backup), 'pre-conversion snapshot must exist');
    const snapshot = JSON.parse(fs.readFileSync(backup));
    assert.deepStrictEqual(snapshot.scenes[0].layers.map((l) => l.effectType),
        ['candy_sparkler', 'embers']);
    // A scenes-only snapshot would drop seededBuiltins and re-seed duplicates.
    assert.strictEqual(snapshot.seededBuiltins, true);

    // Reloading the migrated file leaves it alone, and does not overwrite the
    // snapshot with the already-converted document.
    const second = makeStore(file);
    await second.load({});
    assert.strictEqual(second.emitterMigrated, true);
    assert.deepStrictEqual(second.scenes[0].layers.map((l) => l.effectType), ['emitter', 'emitter']);
    const after = JSON.parse(fs.readFileSync(backup));
    assert.deepStrictEqual(after.scenes[0].layers.map((l) => l.effectType),
        ['candy_sparkler', 'embers']);
});

test('the flag persists so a restart does not migrate twice', async () => {
    const file = tmpFile('scenes-v2.json');
    fs.writeFileSync(file, JSON.stringify(docWith([SPARKLER])));
    const store = makeStore(file);
    await store.load({});
    await store.flush();
    assert.strictEqual(JSON.parse(fs.readFileSync(file)).emitterMigrated, true);
});

// Both migrations run on the same load and either may be the one that has
// already happened, so they have to be independent.
test('runs alongside the plane-wave migration without disturbing it', async () => {
    const file = tmpFile('scenes-v2.json');
    const distantWavelet = {
        id: 'w1', effectType: 'wavelet', blendMode: 'add', opacity: 1, enabled: true, solo: false,
        params: { color: '#ffffff', freq: 0.2, lambda: 0.5, delta: 0, x: 1000, y: 0,
            direction: 'outward', min: 0.1, max: 0.7 },
    };
    fs.writeFileSync(file, JSON.stringify({
        version: 2, activeSceneId: 's1', seededBuiltins: true,
        scenes: [{ id: 's1', name: 'both', layers: [distantWavelet, SPARKLER] }],
    }));

    const store = makeStore(file);
    await store.load({});
    assert.strictEqual(store.planeWaveMigrated, true);
    assert.strictEqual(store.emitterMigrated, true);
    assert.deepStrictEqual(store.scenes[0].layers.map((l) => l.effectType), ['planewave', 'emitter']);
});

// Nothing to convert still counts as having run, or the snapshot and the
// conversion would be attempted again on every subsequent boot.
test('a library with no particle layers still records the migration', async () => {
    const file = tmpFile('scenes-v2.json');
    fs.writeFileSync(file, JSON.stringify(docWith([
        { id: 'l1', effectType: 'solid', params: { color: '#123456' }, opacity: 1, enabled: true },
    ])));
    const store = makeStore(file);
    await store.load({});
    assert.strictEqual(store.emitterMigrated, true);
    assert.ok(!fs.existsSync(file.replace(/\.json$/, '') + '.pre-emitter.json'),
        'nothing to convert means nothing to snapshot');
});
