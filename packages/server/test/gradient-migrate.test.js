const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Compositor } = require('../engine/compositor');
const { SceneStore } = require('../engine/scene-store');
const gradientMigrate = require('../engine/gradient-migrate');
const oldGradient = require('../effects/gradient');
const linear = require('../effects/gradient_linear');
const radial = require('../effects/gradient_radial');
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
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gradient-migrate-')), name);
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
        emitterMigrated: true,
        scenes: [{ id: 's1', name: 'Washes', layers }],
    };
}

const STOPS = [
    { position: 0.0, color: '#241040' },
    { position: 0.4, color: '#7a2f9e' },
    { position: 1.0, color: '#e04f1f' },
];

function oldParams(over) {
    return Object.assign({
        stops: STOPS, mode: 'linear', angle: 0, cx: 0, cy: 0, animate: 'none', speed: 0.05,
    }, over);
}

function layerWith(params, over) {
    return Object.assign({
        id: 'g1', effectType: 'gradient', blendMode: 'normal', opacity: 1,
        enabled: true, solo: false, params,
    }, over);
}

function render(effect, params, millis) {
    const out = new Float32Array(ctx.numPixels * 3);
    effect.createInstance(ctx).render(out, millis, effect.prepare(params));
    return out;
}

// The old module stays registered, so the migration can be checked the only way
// that really settles a sign question: render both and compare the buffers.
function assertSameFrames(oldP, newEffect, newP, message) {
    for (const millis of [0, 250, 1000, 3700, 12000]) {
        const a = render(oldGradient, oldP, millis);
        const b = render(newEffect, newP, millis);
        for (let i = 0; i < a.length; i++) {
            assert.ok(Math.abs(a[i] - b[i]) < 1e-3,
                `${message}: pixel ${i} at ${millis}ms was ${b[i]}, expected ${a[i]}`);
        }
    }
}

const ANGLES = [0, 45, 90, 135, 180, 270, 315];

// ---- exactness ----

test('a still linear gradient converts pixel for pixel at every angle', () => {
    for (const angle of ANGLES) {
        const p = oldParams({ angle, animate: 'none' });
        assertSameFrames(p, linear, gradientMigrate.toLinear(p), `still linear at ${angle}`);
    }
});

// The old projection was `modelX * ca + modelZ * sa`, missing the negation
// every other effect applies; gradient_linear adds it and the migration mirrors
// the angle to cancel it. Both halves of that have to be true at once, which is
// what the 90 and 270 cases above actually pin — at 0 and 180 the term is zero
// and a missing negation shows nothing.
test('the angle is mirrored, not carried across', () => {
    assert.strictEqual(gradientMigrate.toLinear(oldParams({ angle: 90 })).angle, 270);
    assert.strictEqual(gradientMigrate.toLinear(oldParams({ angle: 45 })).angle, 315);
    assert.strictEqual(gradientMigrate.toLinear(oldParams({ angle: 0 })).angle, 0);
    assert.strictEqual(gradientMigrate.toLinear(oldParams({ angle: 180 })).angle, 180);
});

test('a rotating linear gradient converts exactly, sign and all', () => {
    for (const angle of [0, 45, 90]) {
        const p = oldParams({ angle, animate: 'rotate', speed: 0.3 });
        const converted = gradientMigrate.toLinear(p);
        assert.strictEqual(converted.spin, -0.3, 'the mirrored frame reverses the spin');
        assert.strictEqual(converted.scroll, 0);
        assertSameFrames(p, linear, converted, `rotating linear at ${angle}`);
    }
});

// The one documented inexactness: old linear scroll ran against the ramp
// direction and the new one runs along it, so the migrated layer drifts the
// other way. Rendering the old effect with the speed negated is exactly that
// statement, and pins the magnitude and the geometry at the same time.
test('a scrolling linear gradient keeps its picture and reverses its drift', () => {
    for (const angle of [0, 45, 90, 180]) {
        const p = oldParams({ angle, animate: 'scroll', speed: 0.12 });
        const converted = gradientMigrate.toLinear(p);
        assert.strictEqual(converted.scroll, 0.12);

        // Same picture the instant it starts...
        const a = render(oldGradient, p, 0);
        const b = render(linear, converted, 0);
        for (let i = 0; i < a.length; i++) {
            assert.ok(Math.abs(a[i] - b[i]) < 1e-3, `scrolling linear at ${angle}: t=0 must match`);
        }
        // ...and thereafter it is the old effect run backwards.
        assertSameFrames(oldParams({ angle, animate: 'scroll', speed: -0.12 }),
            linear, converted, `scrolling linear at ${angle}`);
    }
});

test('a still radial gradient converts pixel for pixel, centred or not', () => {
    for (const [cx, cy] of [[0, 0], [1.5, 0], [0, 0.6], [-2.75, -0.5]]) {
        const p = oldParams({ mode: 'radial', cx, cy, animate: 'none' });
        assertSameFrames(p, radial, gradientMigrate.toRadial(p), `still radial at ${cx},${cy}`);
    }
});

test('a scrolling radial gradient converts exactly, and inward is what it was', () => {
    const p = oldParams({ mode: 'radial', cx: 0.5, cy: -0.25, animate: 'scroll', speed: 0.2 });
    const converted = gradientMigrate.toRadial(p);
    assert.strictEqual(converted.travel, 'inward');
    assert.strictEqual(converted.scroll, 0.2);
    assertSameFrames(p, radial, converted, 'scrolling radial');
});

// Rotate never did anything in the radial branch — it does not read the angle —
// so the converted layer must be still rather than inheriting Drift as a scroll.
test('a rotating radial gradient converts to a still one', () => {
    const p = oldParams({ mode: 'radial', animate: 'rotate', speed: 0.4 });
    const converted = gradientMigrate.toRadial(p);
    assert.strictEqual(converted.scroll, 0);
    assertSameFrames(p, radial, converted, 'rotating radial');
});

// ---- shape of the conversion ----

test('converts by mode and leaves everything else alone', () => {
    const other = { id: 'l3', effectType: 'wavelet', params: { color: '#ffffff' } };
    const result = gradientMigrate.convertScenes([{
        id: 's1', name: 'a', layers: [
            layerWith(oldParams({ mode: 'linear' }), { id: 'a' }),
            layerWith(oldParams({ mode: 'radial' }), { id: 'b' }),
            other,
        ],
    }]);
    assert.strictEqual(result.converted, 2);
    assert.deepStrictEqual(result.scenes[0].layers.map((l) => l.effectType),
        ['gradient_linear', 'gradient_radial', 'wavelet']);
    // The untouched layer is the same object, not a rebuilt copy.
    assert.strictEqual(result.scenes[0].layers[2], other);
});

// A layer written before `mode` existed, or with the key lost, is a linear
// gradient — that is what the old prepare() treated anything but 'radial' as.
test('a missing or unknown mode converts to linear', () => {
    const result = gradientMigrate.convertScenes([{
        id: 's1', name: 'a', layers: [layerWith({ stops: STOPS, angle: 30, animate: 'none', speed: 0 })],
    }]);
    assert.strictEqual(result.scenes[0].layers[0].effectType, 'gradient_linear');
});

test('conversion keeps layer identity, blend and enabled state', () => {
    const result = gradientMigrate.convertScenes([{
        id: 's1', name: 'a',
        layers: [layerWith(oldParams({}), { id: 'keep', blendMode: 'screen', opacity: 0.4, enabled: false, solo: true })],
    }]);
    const layer = result.scenes[0].layers[0];
    assert.strictEqual(layer.id, 'keep');
    assert.strictEqual(layer.blendMode, 'screen');
    assert.strictEqual(layer.opacity, 0.4);
    assert.strictEqual(layer.enabled, false);
    assert.strictEqual(layer.solo, true);
});

test('the stop list carries over untouched', () => {
    assert.strictEqual(gradientMigrate.toLinear(oldParams({})).stops, STOPS);
    assert.strictEqual(gradientMigrate.toRadial(oldParams({ mode: 'radial' })).stops, STOPS);
});

// A layer whose params are missing or half-empty still has to boot. Every key
// but `stops` is written unconditionally; `stops` is deliberately left out when
// there is none, because an explicit undefined would survive normaliseLayer's
// Object.assign, beat the effect's default, and throw in buildLut.
test('an empty conversion fills every key but stops, and renders', () => {
    for (const [fn, effect] of [[gradientMigrate.toLinear, linear], [gradientMigrate.toRadial, radial]]) {
        const params = fn({});
        assert.ok(!('stops' in params), `${effect.type} must not write an undefined stops`);
        for (const key of Object.keys(effect.defaults)) {
            if (key === 'stops') continue;
            assert.ok(key in params, `${effect.type} conversion is missing ${key}`);
        }
        const out = new Float32Array(ctx.numPixels * 3);
        effect.createInstance(ctx).render(out, 1000,
            effect.prepare(Object.assign({}, effect.defaults, params)));
        for (let i = 0; i < out.length; i++) {
            assert.ok(Number.isFinite(out[i]), `${effect.type} rendered ${out[i]} at ${i}`);
        }
    }
});

// ---- store wiring ----

test('the store converts on load, snapshots first, and does not re-run', async () => {
    const file = tmpFile('scenes-v2.json');
    fs.writeFileSync(file, JSON.stringify(docWith([
        layerWith(oldParams({ mode: 'linear' }), { id: 'a' }),
        layerWith(oldParams({ mode: 'radial' }), { id: 'b' }),
    ])));

    const store = makeStore(file);
    await store.load({});
    assert.strictEqual(store.gradientMigrated, true);
    assert.deepStrictEqual(store.scenes[0].layers.map((l) => l.effectType),
        ['gradient_linear', 'gradient_radial']);

    const backup = file.replace(/\.json$/, '') + '.pre-gradient.json';
    assert.ok(fs.existsSync(backup), 'pre-conversion snapshot must exist');
    const snapshot = JSON.parse(fs.readFileSync(backup));
    assert.deepStrictEqual(snapshot.scenes[0].layers.map((l) => l.effectType),
        ['gradient', 'gradient']);
    // A scenes-only snapshot would drop seededBuiltins and re-seed duplicates.
    assert.strictEqual(snapshot.seededBuiltins, true);

    // Reloading the migrated file leaves it alone, and does not overwrite the
    // snapshot with the already-converted document.
    const second = makeStore(file);
    await second.load({});
    assert.strictEqual(second.gradientMigrated, true);
    const after = JSON.parse(fs.readFileSync(backup));
    assert.deepStrictEqual(after.scenes[0].layers.map((l) => l.effectType), ['gradient', 'gradient']);
});

test('the flag persists so a restart does not migrate twice', async () => {
    const file = tmpFile('scenes-v2.json');
    fs.writeFileSync(file, JSON.stringify(docWith([layerWith(oldParams({}))])));
    const store = makeStore(file);
    await store.load({});
    await store.flush();
    assert.strictEqual(JSON.parse(fs.readFileSync(file)).gradientMigrated, true);
});

// All three migrations run on the same load and any one of them may be the one
// that has already happened, so they have to be independent.
test('runs alongside the plane-wave and emitter migrations', async () => {
    const file = tmpFile('scenes-v2.json');
    const distantWavelet = {
        id: 'w1', effectType: 'wavelet', blendMode: 'add', opacity: 1, enabled: true, solo: false,
        params: { color: '#ffffff', freq: 0.2, lambda: 0.5, delta: 0, x: 1000, y: 0,
            direction: 'outward', min: 0.1, max: 0.7 },
    };
    const sparkler = { id: 'p1', effectType: 'candy_sparkler', blendMode: 'add', opacity: 1,
        enabled: true, solo: false, params: { count: 49, speed: 1, saturation: 1 } };
    fs.writeFileSync(file, JSON.stringify({
        version: 2, activeSceneId: 's1', seededBuiltins: true,
        scenes: [{ id: 's1', name: 'all three', layers: [distantWavelet, sparkler, layerWith(oldParams({}))] }],
    }));

    const store = makeStore(file);
    await store.load({});
    assert.strictEqual(store.planeWaveMigrated, true);
    assert.strictEqual(store.emitterMigrated, true);
    assert.strictEqual(store.gradientMigrated, true);
    assert.deepStrictEqual(store.scenes[0].layers.map((l) => l.effectType),
        ['planewave', 'emitter', 'gradient_linear']);
});

// Nothing to convert still counts as having run, or the snapshot and the
// conversion would be attempted again on every subsequent boot.
test('a library with no gradient layers still records the migration', async () => {
    const file = tmpFile('scenes-v2.json');
    fs.writeFileSync(file, JSON.stringify(docWith([
        { id: 'l1', effectType: 'solid', params: { color: '#123456' }, opacity: 1, enabled: true },
    ])));
    const store = makeStore(file);
    await store.load({});
    assert.strictEqual(store.gradientMigrated, true);
    assert.ok(!fs.existsSync(file.replace(/\.json$/, '') + '.pre-gradient.json'),
        'nothing to convert means nothing to snapshot');
});

// The old effect has to keep rendering: an export taken before this migration
// can be imported long afterwards through a path that does not re-migrate.
test('the old gradient still renders but is out of the catalog', () => {
    assert.ok(effects.get('gradient'), 'the old module must stay registered');
    const types = effects.catalog().map((e) => e.type);
    assert.ok(!types.includes('gradient'), 'the old gradient must not be offered');
    assert.ok(types.includes('gradient_linear'));
    assert.ok(types.includes('gradient_radial'));
});
