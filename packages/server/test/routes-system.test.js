/*
 * HTTP-level tests for routes/system.js — gap 1 of #83.
 *
 * These routes lived inline in app.js, which binds port 3000 and starts the
 * render loop on require, so none of them were reachable from a test. Real
 * SettingsStore (no persist file) and a real VirtualOPC, which is a pure
 * pixel-buffer sink carrying the real PowerMeter — no hardware, no sockets.
 */

const test = require('node:test');
const assert = require('node:assert');

const VirtualOPC = require('../virtual-opc');
const { SettingsStore } = require('../engine/settings-store');
const { FrameStats } = require('../engine/frame-stats');
const createSystemRouter = require('../routes/system');
const { startApp } = require('./support/http');

async function harness(options) {
    const opts = options || {};
    const client = new VirtualOPC('localhost', 7890);
    client.setPixelCount(4);
    const settings = new SettingsStore(null);
    const frameStats = new FrameStats({ targetMs: 10 });

    const app = await startApp((a) => {
        a.use('/api', createSystemRouter({
            settings,
            client,
            frameStats,
            isVirtual: !!opts.isVirtual,
        }));
    });
    return { app, client, settings, frameStats };
}

test('GET /api/virtual reports the mode the server was started in', async () => {
    const real = await harness({ isVirtual: false });
    try {
        assert.deepStrictEqual((await real.app.get('/api/virtual')).json, { virtual: false });
    } finally { await real.app.close(); }

    const virt = await harness({ isVirtual: true });
    try {
        assert.deepStrictEqual((await virt.app.get('/api/virtual')).json, { virtual: true });
    } finally { await virt.app.close(); }
});

test('GET /api/brightness answers plain text, with or without the trailing slash', async () => {
    const { app } = await harness();
    try {
        const res = await app.get('/api/brightness');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.text, '1');
        // A bare number would be read as a status code, hence the cast
        assert.ok(!(res.headers && res.json));

        const slashed = await app.get('/api/brightness/');
        assert.strictEqual(slashed.status, 200);
        assert.strictEqual(slashed.text, '1');
    } finally { await app.close(); }
});

test('PUT /api/brightness reaches both the store and the pixel sink', async () => {
    const { app, client, settings } = await harness();
    try {
        assert.strictEqual((await app.put('/api/brightness/0.25')).status, 200);
        assert.strictEqual(settings.brightness, 0.25);
        assert.strictEqual(client.brightness, 0.25);
        assert.strictEqual((await app.get('/api/brightness')).text, '0.25');
    } finally { await app.close(); }
});

test('PUT /api/brightness clamps out-of-range values into 0..1', async () => {
    const { app, client } = await harness();
    try {
        await app.put('/api/brightness/5');
        assert.strictEqual(client.brightness, 1);
        await app.put('/api/brightness/-3');
        assert.strictEqual(client.brightness, 0);
    } finally { await app.close(); }
});

test('PUT /api/brightness rejects junk rather than setting NaN', async () => {
    // parseFloat('abc') is NaN and NaN survives both clamps, so before the
    // guard this answered 200 and left client.brightness NaN — opc.js
    // multiplies every byte by it, so the panel went black with no error and
    // no failed request. SettingsStore.load guards the same hazard on the
    // file path; this is the other way in.
    const { app, client, settings } = await harness();
    try {
        for (const junk of ['abc', 'NaN', 'Infinity', '-Infinity', 'null']) {
            const res = await app.put('/api/brightness/' + encodeURIComponent(junk));
            assert.strictEqual(res.status, 400, 'expected 400 for ' + JSON.stringify(junk));
        }
        // An empty segment matches no PUT route at all, so it is a 404 rather
        // than a validation failure — worth pinning as the boundary between
        // "no such route" and "route reached, value refused".
        assert.strictEqual((await app.put('/api/brightness/')).status, 404);

        assert.strictEqual(client.brightness, 1);
        assert.strictEqual(settings.brightness, 1);
    } finally { await app.close(); }
});

test('GET /api/fps reports the tracker off by default, tagged with the mode', async () => {
    const { app } = await harness({ isVirtual: true });
    try {
        const res = await app.get('/api/fps');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.json.enabled, false);
        assert.strictEqual(res.json.virtual, true);
        // ~91, not 100: setInterval(10) clamps, and the UI grades against this
        assert.strictEqual(res.json.targetFps, 100);
        assert.strictEqual(res.json.idle, true);
    } finally { await app.close(); }
});

test('PUT /api/fps toggles the tracker and persists the choice', async () => {
    const { app, settings, frameStats } = await harness();
    try {
        const on = await app.put('/api/fps', { body: { enabled: true } });
        assert.strictEqual(on.status, 200);
        assert.strictEqual(on.json.enabled, true);
        assert.strictEqual(frameStats.enabled, true);
        assert.strictEqual(settings.frameStatsEnabled, true);

        const off = await app.put('/api/fps', { body: { enabled: false } });
        assert.strictEqual(off.json.enabled, false);
        assert.strictEqual(settings.frameStatsEnabled, false);
    } finally { await app.close(); }
});

test('PUT /api/fps demands a boolean, and 400s on an absent body', async () => {
    const { app, frameStats } = await harness();
    try {
        for (const body of [{ enabled: 'yes' }, { enabled: 1 }, { enabled: null }, {}]) {
            assert.strictEqual((await app.put('/api/fps', { body })).status, 400,
                'expected 400 for ' + JSON.stringify(body));
        }
        // express 5: no body means req.body is undefined, not {}
        assert.strictEqual((await app.put('/api/fps')).status, 400);
        assert.strictEqual(frameStats.enabled, false);
    } finally { await app.close(); }
});

test('GET /api/power answers before anything has rendered', async () => {
    const { app } = await harness();
    try {
        const res = await app.get('/api/power');
        assert.strictEqual(res.status, 200);
        // Sized up front, so the meter knows the LED count on a dark panel
        assert.strictEqual(res.json.numLeds, 4);
        assert.strictEqual(res.json.idle, true);
        assert.ok(res.json.budgetMilliamps > 0);
    } finally { await app.close(); }
});

test('PUT /api/power merges field by field rather than resetting to defaults', async () => {
    const { app, client } = await harness();
    try {
        const before = (await app.get('/api/power')).json;

        const res = await app.put('/api/power', { body: { maxMilliamps: 9000 } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.json.maxMilliamps, 9000);
        // the untouched fields survive the partial write
        assert.strictEqual(res.json.overheadMilliamps, before.overheadMilliamps);
        assert.strictEqual(res.json.gamma, before.gamma);
        assert.strictEqual(client.power.config.maxMilliamps, 9000);

        const second = await app.put('/api/power', { body: { limit: true } });
        assert.strictEqual(second.json.limit, true);
        assert.strictEqual(second.json.maxMilliamps, 9000, 'the earlier edit must survive');
    } finally { await app.close(); }
});

test('PUT /api/power rejects a non-object body', async () => {
    const { app } = await harness();
    try {
        for (const body of ['a string', 42, null]) {
            assert.strictEqual((await app.put('/api/power', { body })).status, 400,
                'expected 400 for ' + JSON.stringify(body));
        }
        assert.strictEqual((await app.put('/api/power')).status, 400);
    } finally { await app.close(); }
});

test('a bad power config degrades per field instead of poisoning the meter', async () => {
    const { app } = await harness();
    try {
        const before = (await app.get('/api/power')).json;
        const res = await app.put('/api/power', { body: { maxMilliamps: 'lots', gamma: NaN } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.json.maxMilliamps, before.maxMilliamps);
        assert.strictEqual(res.json.gamma, before.gamma);
        assert.ok(isFinite(res.json.budgetMilliamps));
    } finally { await app.close(); }
});

test('malformed JSON is a 400 from the body parser, not a 500', async () => {
    const { app } = await harness();
    try {
        const res = await app.put('/api/fps', { body: '{"enabled":', raw: true });
        assert.strictEqual(res.status, 400);
    } finally { await app.close(); }
});
