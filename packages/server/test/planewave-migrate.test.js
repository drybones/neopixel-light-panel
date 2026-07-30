const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Compositor } = require('../engine/compositor');
const { SceneStore } = require('../engine/scene-store');
const migrate = require('../engine/migrate');
const planewave = require('../engine/planewave-migrate');
const effects = require('../effects');
const panel = require('../engine/panel');
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

const waveletEffect = effects.get('wavelet');
const planewaveEffect = effects.get('planewave');
const waveletInstance = waveletEffect.createInstance(ctx);
const planewaveInstance = planewaveEffect.createInstance(ctx);

function renderBoth(params, millis) {
    const a = new Float32Array(model.length * 3);
    const b = new Float32Array(model.length * 3);
    waveletInstance.render(a, millis, waveletEffect.prepare(params));
    planewaveInstance.render(b, millis, planewaveEffect.prepare(planewave.waveletToPlanewave(params)));
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    return worst;
}

function distantLayers() {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../example_wavelet_config.json')));
    const out = [];
    migrate.convert(fixture).forEach((scene) => {
        scene.layers.forEach((layer) => {
            if (planewave.shouldConvert(layer.params)) out.push({ scene: scene.name, params: layer.params });
        });
    });
    return out;
}

// All that separates the two effects is the wavefront curvature the far-field
// approximation drops. That shifts phase by phaseError(), and brightness
// responds at (max-min)/2 per radian over a 0-255 channel — so this is the
// ceiling the difference must stay under. Anything above it is a real bug in
// the conversion rather than an approximation. Note the bound is per-layer:
// presets carrying an out-of-schema min of -10 have a very steep slope, so the
// same phase error shows up as a much larger channel number.
function errorBound(params) {
    const distance = Math.hypot(params.x, params.y);
    return planewave.phaseError(distance, params.lambda) * ((params.max - params.min) / 2) * 255;
}

test('every distant preset layer converts within the curvature bound', () => {
    const layers = distantLayers();
    assert.strictEqual(layers.length, 11, 'expected the known 11 far-away preset layers');

    for (const millis of [0, 1234, 60000, 3600000]) {
        for (const { scene, params } of layers) {
            const worst = renderBoth(params, millis);
            const bound = errorBound(params);
            assert.ok(worst <= bound + 0.01,
                `${scene} at millis=${millis}: channel error ${worst.toFixed(3)} exceeds bound ${bound.toFixed(3)}`);
        }
    }
});

test('presets with an in-schema brightness range are pixel-identical', () => {
    // The human-facing claim: where min/max are inside the 0-1 the UI can
    // express, the difference is far below one 8-bit step and cannot be seen.
    const layers = distantLayers().filter(({ params }) => params.min >= 0 && params.max <= 1);
    assert.ok(layers.length >= 6, 'expected most preset layers to have sane brightness');

    for (const millis of [0, 1234, 60000]) {
        for (const { scene, params } of layers) {
            const worst = renderBoth(params, millis);
            assert.ok(worst < 1, `${scene} at millis=${millis}: channel error ${worst.toFixed(3)}`);
        }
    }
});

test('real-clock timestamps still agree, with float headroom', () => {
    // theta reaches ~2.2e9 at Date.now() scale, where the double ulp is ~5e-7
    // rad. Both effects have always had this; the allowance acknowledges it.
    for (const { scene, params } of distantLayers()) {
        const worst = renderBoth(params, Date.now());
        const bound = errorBound(params) + 1;
        assert.ok(worst <= bound,
            `${scene}: channel error ${worst.toFixed(3)} at real-clock millis, bound ${bound.toFixed(3)}`);
    }
});

test('leaves near sources and short wavelengths alone', () => {
    const base = { color: '#ffffff', freq: 0.2, delta: 0, min: 0.1, max: 0.7 };

    assert.strictEqual(planewave.shouldConvert(Object.assign({ x: 0, y: 0, lambda: 0.5 }, base)), false);
    assert.strictEqual(planewave.shouldConvert(Object.assign({ x: 2, y: -2.5, lambda: 0.5 }, base)), false,
        'the mid-range off-panel case stays a wavelet');
    assert.strictEqual(planewave.shouldConvert(Object.assign({ x: 1000, y: 0, lambda: 0.5 }, base)), true);

    // The phase gate, not the distance gate, is what binds at ordinary
    // wavelengths: at 11x the panel radius a 0.5 wave is still visibly curved.
    assert.strictEqual(planewave.shouldConvert(Object.assign({ x: panel.RADIUS * 11, y: 0, lambda: 0.5 }, base)), false);
    assert.strictEqual(planewave.shouldConvert(Object.assign({ x: 1000, y: 0, lambda: 0.001 }, base)), false,
        'a short wavelength keeps visible curvature even far away');

    // And the distance gate is what stops a *near* source with an enormous
    // wavelength (Green Scanlines carries lambda 1000) sliding through on
    // phase alone.
    assert.strictEqual(planewave.shouldConvert(Object.assign({ x: 20, y: 0, lambda: 1000 }, base)), false);

    assert.strictEqual(planewave.shouldConvert(Object.assign({ x: 1000, y: 0, lambda: 0 }, base)), false);
    assert.strictEqual(planewave.shouldConvert(null), false);
});

test('angle follows the screen convention', () => {
    const base = { color: '#fff', freq: 0.2, lambda: 0.5, delta: 0, min: 0, max: 1 };
    const at = (x, y) => planewave.waveletToPlanewave(Object.assign({ x, y }, base)).angle;

    assert.ok(Math.abs(at(1000, 0) - 0) < 1e-9, 'from the right is 0 degrees');
    assert.ok(Math.abs(at(0, 1000) - 90) < 1e-9, 'from the top is 90 degrees');
    assert.ok(Math.abs(at(-1000, 0) - 180) < 1e-9);
    assert.ok(Math.abs(at(0, -1000) - 270) < 1e-9, 'negative angles wrap into 0-360');
});

test('delta is wrapped into a phase the UI slider can show', () => {
    const p = planewave.waveletToPlanewave({
        color: '#fff', freq: 0.2, lambda: 0.3, delta: 0, x: 50, y: 1000, min: 0, max: 1,
    });
    assert.ok(p.delta >= 0 && p.delta < Math.PI * 2, `delta ${p.delta} outside [0, 2pi)`);
});

test('convertScenes rewrites only what qualifies, and counts it', () => {
    const scenes = [{
        id: 's1',
        name: 'Mixed',
        layers: [
            { id: 'a', effectType: 'wavelet', params: { color: '#fff', freq: 0.2, lambda: 1, delta: 0, x: 1000, y: 500, min: 0.1, max: 0.7 } },
            { id: 'b', effectType: 'wavelet', params: { color: '#fff', freq: 0.2, lambda: 1, delta: 0, x: 1, y: 0, min: 0.1, max: 0.7 } },
            { id: 'c', effectType: 'embers', params: {} },
        ],
    }];
    const result = planewave.convertScenes(scenes);

    assert.strictEqual(result.converted, 1);
    assert.strictEqual(result.scenes[0].layers[0].effectType, 'planewave');
    assert.strictEqual(result.scenes[0].layers[0].id, 'a', 'layer identity survives');
    assert.strictEqual(result.scenes[0].layers[1].effectType, 'wavelet');
    assert.strictEqual(result.scenes[0].layers[2].effectType, 'embers');
    assert.strictEqual(scenes[0].layers[0].effectType, 'wavelet', 'input is not mutated');
});

// ---- store integration ----

function tmpFile(name) {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'planewave-')), name);
}

function makeStore(file) {
    const client = { brightness: 1, setPixel() {}, writePixels() {} };
    return new SceneStore(new Compositor(client, model), file);
}

const DISTANT_SCENE = {
    id: 'aaaaaaaa',
    name: 'Stripes',
    layers: [
        { id: 'far', effectType: 'wavelet', params: { color: '#ff0000', freq: 0.2, lambda: 1, delta: 0, x: 1000, y: 500, min: 0.1, max: 0.7 } },
        { id: 'near', effectType: 'wavelet', params: { color: '#00ff00', freq: 0.2, lambda: 1, delta: 0, x: 1, y: 0, min: 0.1, max: 0.7 } },
    ],
};

test('loading a document converts distant layers and records the flag', async () => {
    const file = tmpFile('scenes.json');
    const store = makeStore(file);
    await store.load({ scenes: [DISTANT_SCENE] });

    assert.strictEqual(store.scenes[0].layers[0].effectType, 'planewave');
    assert.strictEqual(store.scenes[0].layers[1].effectType, 'wavelet');
    assert.strictEqual(store.planeWaveMigrated, true);

    // Converted params get the new effect's defaults, not the old one's, so no
    // orphan x/y hangs around.
    const params = store.scenes[0].layers[0].params;
    assert.ok(typeof params.angle === 'number');
    assert.strictEqual(params.x, undefined);

    await store.flush();
    assert.strictEqual(JSON.parse(fs.readFileSync(file)).planeWaveMigrated, true);
});

test('the pre-conversion document is kept for rollback', async () => {
    const file = tmpFile('scenes.json');
    const store = makeStore(file);
    await store.load({ scenes: [DISTANT_SCENE] });

    const backup = JSON.parse(fs.readFileSync(file.replace(/\.json$/, '') + '.pre-planewave.json'));
    assert.strictEqual(backup.scenes[0].layers[0].effectType, 'wavelet');
    assert.strictEqual(backup.scenes[0].layers[0].params.x, 1000);
});

test('conversion does not run a second time', async () => {
    const file = tmpFile('scenes.json');
    const first = makeStore(file);
    await first.load({ scenes: [DISTANT_SCENE] });
    await first.flush();

    // Someone drags a wavelet handle to the pad's far edge afterwards. That is
    // a legitimate finite position and must survive a restart as a wavelet.
    const scene = first.get('aaaaaaaa');
    scene.layers[1].params.x = 1000;
    scene.layers[1].params.lambda = 1;
    first.markDirty();
    await first.flush();

    const second = makeStore(file);
    await second.load({});
    assert.strictEqual(second.scenes[0].layers[1].effectType, 'wavelet',
        'the one-time flag must stop a later drag being rewritten');
    assert.strictEqual(second.scenes[0].layers[1].params.x, 1000);
});

test('a fresh install skips conversion entirely', async () => {
    const store = makeStore(tmpFile('scenes.json'));
    await store.load({});
    assert.strictEqual(store.planeWaveMigrated, true);
    assert.strictEqual(store.scenes[0].layers[0].effectType, 'wavelet');
});

test('duplicate layer ids across scenes are repaired on load', async () => {
    // The old wave_config data shares one layer id between two presets. That
    // was harmless while both were wavelets, but the compositor caches an
    // instance per layer id, so once conversion makes the effect types differ
    // the two scenes render each other's params — in practice, a black panel.
    const shared = 'dupe1234';
    const store = makeStore(tmpFile('scenes.json'));
    await store.load({
        scenes: [
            { id: 'sceneone', name: 'Far', layers: [{ id: shared, effectType: 'wavelet', params: { color: '#ff0000', freq: 0.2, lambda: 1, delta: 0, x: 1000, y: 500, min: 0.1, max: 0.7 } }] },
            { id: 'scenetwo', name: 'Near', layers: [{ id: shared, effectType: 'wavelet', params: { color: '#00ff00', freq: 0.2, lambda: 1, delta: 0, x: 1, y: 0, min: 0.1, max: 0.7 } }] },
        ],
    });

    const ids = store.scenes.map((s) => s.layers[0].id);
    assert.notStrictEqual(ids[0], ids[1], 'layer ids must be unique across the document');
    assert.strictEqual(store.scenes[0].layers[0].effectType, 'planewave');
    assert.strictEqual(store.scenes[1].layers[0].effectType, 'wavelet');

    // Both must still render real colour after the other has been synced.
    for (const scene of [store.scenes[1], store.scenes[0], store.scenes[1]]) {
        store.compositor.renderFrame(scene, 1234);
        const comp = store.compositor.composite;
        assert.ok(comp.every(Number.isFinite), `${scene.name} rendered non-finite channels`);
        assert.ok(comp.some((v) => v > 0), `${scene.name} rendered black`);
    }
});

test('the compositor refuses to render a layer whose cached instance is stale', () => {
    const store = makeStore(null);
    store.planeWaveMigrated = true;
    store.setScenes([{ id: 'aaaaaaaa', name: 'One', layers: [{ id: 'layer001', effectType: 'solid', params: { color: '#ffffff', level: 1 } }] }]);
    const scene = store.scenes[0];

    // Simulate the collision directly: another scene rebinds the id.
    store.compositor.syncScene({ layers: [{ id: 'layer001', effectType: 'wavelet' }] });
    store.compositor.renderFrame(scene, 0);
    assert.ok(store.compositor.composite.every(Number.isFinite),
        'a stale entry must never put NaN on the panel');
});
