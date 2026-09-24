/*
 * The origin guard (#110): which web pages may drive the API.
 *
 * The routes behind it are stand-ins that count their calls, because the
 * property under test is that a refused request never reaches a handler at
 * all — CORS alone would let the handler run and only hide the answer.
 */

const test = require('node:test');
const assert = require('node:assert');

const { createOriginGuard } = require('../routes/origin');
const { startApp } = require('./support/http');

const DEV = 'http://localhost:3002';
const FOREIGN = 'http://evil.example';

async function harness(allowedOrigins) {
    const calls = { reset: 0, list: 0 };
    const app = await startApp((a) => {
        a.use(createOriginGuard({ allowedOrigins }));
        a.post('/api/scenes/reset', (req, res) => { calls.reset++; res.json([]); });
        a.delete('/api/scenes', (req, res) => { calls.reset++; res.json([]); });
        a.get('/api/scenes', (req, res) => { calls.list++; res.json([]); });
    });
    return { app, calls };
}

test('a bodiless POST from a foreign page is refused before the handler runs', async () => {
    // The hidden-form attack: no preflight, so CORS never gets a say.
    const { app, calls } = await harness([]);
    try {
        const res = await app.post('/api/scenes/reset', { headers: { Origin: FOREIGN } });
        assert.strictEqual(res.status, 403);
        assert.deepStrictEqual(res.json, { error: 'Cross-origin request refused' });
        assert.strictEqual(calls.reset, 0);
    } finally { await app.close(); }
});

test('a DELETE from a foreign page is refused even if its preflight were skipped', async () => {
    const { app, calls } = await harness([DEV]);
    try {
        const res = await app.del('/api/scenes', { headers: { Origin: FOREIGN } });
        assert.strictEqual(res.status, 403);
        assert.strictEqual(calls.reset, 0);
    } finally { await app.close(); }
});

test('Origin: null is foreign, not absent', async () => {
    // Sandboxed iframes and file:// pages send the literal string "null".
    const { app, calls } = await harness([]);
    try {
        const res = await app.post('/api/scenes/reset', { headers: { Origin: 'null' } });
        assert.strictEqual(res.status, 403);
        assert.strictEqual(calls.reset, 0);
    } finally { await app.close(); }
});

test('the production UI is same-origin and passes without any allowlist', async () => {
    const { app, calls } = await harness([]);
    try {
        const res = await app.post('/api/scenes/reset', { headers: { Origin: app.origin } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(calls.reset, 1);
    } finally { await app.close(); }
});

test('same host on another port is not same-origin', async () => {
    // The dev server on 3002 against the API on 3000, with dev origins off.
    const { app, calls } = await harness([]);
    try {
        const other = app.origin.replace(/:\d+$/, ':1');
        const res = await app.post('/api/scenes/reset', { headers: { Origin: other } });
        assert.strictEqual(res.status, 403);
        assert.strictEqual(calls.reset, 0);
    } finally { await app.close(); }
});

test('a request with no Origin is not a browser page and passes', async () => {
    // curl, or a script on the Pi.
    const { app, calls } = await harness([]);
    try {
        const res = await app.post('/api/scenes/reset');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(calls.reset, 1);
    } finally { await app.close(); }
});

test('an allowed dev origin may write, and is granted CORS', async () => {
    const { app, calls } = await harness([DEV]);
    try {
        const res = await app.del('/api/scenes', { headers: { Origin: DEV } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('access-control-allow-origin'), DEV);
        assert.strictEqual(calls.reset, 1);

        const pre = await app.request('OPTIONS', '/api/scenes', {
            headers: { Origin: DEV, 'Access-Control-Request-Method': 'DELETE' },
        });
        assert.strictEqual(pre.status, 204);
        assert.strictEqual(pre.headers.get('access-control-allow-origin'), DEV);
    } finally { await app.close(); }
});

test('a foreign page gets no CORS grant, so it can neither read nor pass a preflight', async () => {
    for (const allowed of [[], [DEV]]) {
        const { app, calls } = await harness(allowed);
        try {
            // A GET is let through the guard — it changes nothing — but
            // without an allow-origin header the browser withholds the body.
            const res = await app.get('/api/scenes', { headers: { Origin: FOREIGN } });
            assert.strictEqual(res.headers.get('access-control-allow-origin'), null);
            assert.strictEqual(calls.list, 1);

            const pre = await app.request('OPTIONS', '/api/scenes', {
                headers: { Origin: FOREIGN, 'Access-Control-Request-Method': 'DELETE' },
            });
            assert.strictEqual(pre.headers.get('access-control-allow-origin'), null);
        } finally { await app.close(); }
    }
});
