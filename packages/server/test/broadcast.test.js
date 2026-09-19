const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');

const { Broadcaster } = require('../engine/broadcast');

// Connection-edge behaviour of the WebSocket server (#108), then what it
// streams (#112): the composite to everyone, and per-layer frames to whoever
// asked for a scene's layers.

function start(compositor) {
    compositor = compositor || { composite: null, getLayerBuffer: function() { return null; } };
    var log = console.log;
    console.log = function() {};
    var b = new Broadcaster(compositor, 4, { port: 0 });
    return new Promise(function(resolve) {
        b.wss.on('listening', function() {
            console.log = log;
            resolve(b);
        });
    });
}

function connect(b) {
    var ws = new WebSocket('ws://127.0.0.1:' + b.wss.address().port);
    return new Promise(function(resolve, reject) {
        ws.on('open', function() { resolve(ws); });
        ws.on('error', reject);
    });
}

function waitFor(predicate, ms) {
    var deadline = Date.now() + (ms || 1000);
    return new Promise(function(resolve, reject) {
        (function poll() {
            if (predicate()) return resolve();
            if (Date.now() > deadline) return reject(new Error('timed out waiting'));
            setTimeout(poll, 2);
        })();
    });
}

function serverSideOf(b) {
    return Array.from(b.wss.clients)[0];
}

test('a client socket error does not throw out of the broadcaster', async () => {
    // ws emits socket errors on the WebSocket instance and, like any
    // EventEmitter, throws them when nothing is listening. A phone leaving
    // wifi mid-frame was enough to take the render loop down.
    var b = await start();
    try {
        var ws = await connect(b);
        await waitFor(() => b.wss.clients.size === 1);
        var err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
        assert.doesNotThrow(() => serverSideOf(b).emit('error', err));
        ws.close();
    } finally {
        await b.close();
    }
});

test('an over-size message closes that client with 1009 and leaves the server up', async () => {
    // Exceeding maxPayload is reported by ws as an *error on the socket*
    // before the 1009 close, so this is the same missing-listener path
    // reached by a real client rather than a synthetic emit.
    var b = await start();
    try {
        var ws = await connect(b);
        var closed = new Promise(function(resolve) { ws.on('close', resolve); });
        ws.on('error', function() {});
        ws.send('x'.repeat(5000));
        assert.strictEqual(await closed, 1009);

        // The server is still accepting.
        var again = await connect(b);
        await waitFor(() => b.wss.clients.size === 1);
        again.close();
    } finally {
        await b.close();
    }
});

test('a subscribe message within the limit still routes', async () => {
    var b = await start();
    try {
        var ws = await connect(b);
        await waitFor(() => b.wss.clients.size === 1);
        ws.send(JSON.stringify({ type: 'subscribe_layers', sceneId: 's1' }));
        await waitFor(() => serverSideOf(b)._layerSceneId === 's1');
        ws.send(JSON.stringify({ type: 'unsubscribe_layers' }));
        await waitFor(() => serverSideOf(b)._layerSceneId === null);
        ws.close();
    } finally {
        await b.close();
    }
});

// ---- the streams ----
//
// Named for what they carry rather than as "v1" and "v2": nothing outside
// this repo reads port 3001, and the server and UI deploy from one commit, so
// the two message shapes are not versions anyone depends on — #121 is about
// unifying them. What is pinned here is behaviour; the shape is asserted
// only where lightStream's parser would silently drop a frame that changed.
//
// Four pixels, so a frame is small enough to read in an assertion. The fake
// compositor's buffers are plain arrays standing in for its Float32Arrays —
// the serialiser only indexes them.

function fakeCompositor() {
    var layerReads = [];
    return {
        composite: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        layers: {},
        layerReads: layerReads,
        getLayerBuffer: function(id) { layerReads.push(id); return this.layers[id] || null; },
    };
}

// Every message a client receives, as strings — lightStream routes on the
// raw first character, so parsing on arrival would hide what it sees. The
// listener goes on before the socket opens: the server replays its last frame
// on connection, which can arrive in the same read as the handshake.
async function listen(b) {
    var ws = new WebSocket('ws://127.0.0.1:' + b.wss.address().port);
    var got = [];
    ws.on('message', function(data) { got.push(data.toString()); });
    var before = b.wss.clients.size;
    await new Promise(function(resolve, reject) {
        ws.on('open', resolve);
        ws.on('error', reject);
    });
    await waitFor(() => b.wss.clients.size > before);
    return { ws: ws, got: got };
}

// A forced composite frame with a marker in its first pixel. Messages on one
// socket arrive in order, so once the barrier is in, anything sent before it
// has arrived too — which is how "nothing was sent" is asserted without a
// sleep. Not usable on a layer subscriber, which is deliberately not sent
// composite frames at all.
async function barrier(b, c, client, marker) {
    c.composite[0] = marker;
    b.tick(true);
    await waitFor(() => client.got.some((m) => m.startsWith('[[' + marker + ',')));
    return client.got.filter((m) => !m.startsWith('[[' + marker + ','));
}

test('a composite frame is the panel as clamped integer triples', async () => {
    // Asserted as the bare array it is today because lightStream routes on
    // the first character: wrap it in an object and the UI would drop every
    // frame without an error. Unify the two shapes (#121) and this changes with it.
    var c = fakeCompositor();
    c.composite = [300, -5, 12.7, 1, 2, 3, 4, 5, 6, 255, 256, 0];
    var b = await start(c);
    try {
        var client = await listen(b);
        b.tick(true);
        await waitFor(() => client.got.length === 1);

        assert.strictEqual(client.got[0][0], '[');
        assert.deepStrictEqual(JSON.parse(client.got[0]), [[255, 0, 12], [1, 2, 3], [4, 5, 6], [255, 255, 0]]);
        client.ws.close();
    } finally {
        await b.close();
    }
});

test('composite frames are throttled to one per interval, and force bypasses it', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
    var c = fakeCompositor();
    var b = await start(c);
    try {
        var client = await listen(b);
        b.tick();              // sent
        b.tick();              // same instant: throttled
        t.mock.timers.tick(20);
        b.tick();              // 20ms on: still throttled
        t.mock.timers.tick(20);
        b.tick();              // 40ms on: sent
        var before = await barrier(b, c, client, 7);  // forced, inside the window
        assert.strictEqual(before.length, 2);
        client.ws.close();
    } finally {
        await b.close();
    }
});

test('with no clients an ordinary tick serialises nothing, but the off frame is kept for replay', async () => {
    // Serialising 240 triples at 30 FPS for nobody is the cost this skips;
    // the forced off frame is the exception, because it is the last frame a
    // client connecting to an idle panel will ever be sent.
    var c = fakeCompositor();
    var b = await start(c);
    try {
        b.tick();
        assert.strictEqual(b._lastMsg, null);

        c.composite[0] = 9;
        b.tick(true);
        var client = await listen(b);
        await waitFor(() => client.got.length === 1);
        assert.deepStrictEqual(JSON.parse(client.got[0])[0], [9, 0, 0]);
        client.ws.close();
    } finally {
        await b.close();
    }
});

test('a new connection is sent the last frame at once, so an idle panel is not blank', async () => {
    var c = fakeCompositor();
    var b = await start(c);
    try {
        var first = await listen(b);
        c.composite[3] = 42;
        b.tick(true);
        await waitFor(() => first.got.length === 1);

        var late = await listen(b);
        await waitFor(() => late.got.length === 1);
        assert.strictEqual(late.got[0], first.got[0]);
        first.ws.close();
        late.ws.close();
    } finally {
        await b.close();
    }
});

test('a layer subscriber gets its scene\'s layers, with the composite inside the same frame', async () => {
    var c = fakeCompositor();
    c.layers.l1 = [10, 20, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    c.layers.l2 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 999, 0, 0];
    var scene = { id: 's1', layers: [{ id: 'l1' }, { id: 'l2' }] };
    var b = await start(c);
    try {
        var editor = await listen(b);
        editor.ws.send(JSON.stringify({ type: 'subscribe_layers', sceneId: 's1' }));
        await waitFor(() => serverSideOf(b)._layerSceneId === 's1');

        b.tick(true);            // the plain composite stream: not for this client
        b.tickLayers(scene, true);
        await waitFor(() => editor.got.length >= 1);

        assert.strictEqual(editor.got.length, 1);
        assert.strictEqual(editor.got[0][0], '{');
        var msg = JSON.parse(editor.got[0]);
        assert.strictEqual(msg.type, 'frame');
        assert.strictEqual(msg.composite.length, 4);
        assert.deepStrictEqual(Object.keys(msg.layers).sort(), ['l1', 'l2']);
        assert.deepStrictEqual(msg.layers.l1[0], [10, 20, 30]);
        // Layer buffers are clamped like the composite.
        assert.deepStrictEqual(msg.layers.l2[3], [255, 0, 0]);
        editor.ws.close();
    } finally {
        await b.close();
    }
});

test('layer frames go only to subscribers of the scene being rendered', async () => {
    var c = fakeCompositor();
    c.layers.l1 = new Array(12).fill(0);
    var b = await start(c);
    try {
        var other = await listen(b);
        other.ws.send(JSON.stringify({ type: 'subscribe_layers', sceneId: 'elsewhere' }));
        await waitFor(() => serverSideOf(b)._layerSceneId === 'elsewhere');

        b.tickLayers({ id: 's1', layers: [{ id: 'l1' }] }, true);
        // Nobody wanted s1, so its layers were never even read.
        assert.deepStrictEqual(c.layerReads, []);

        // And the subscriber to another scene hears nothing — a layer
        // subscriber is off the plain composite stream too. Unsubscribing
        // puts it back on.
        other.ws.send(JSON.stringify({ type: 'unsubscribe_layers' }));
        await waitFor(() => serverSideOf(b)._layerSceneId === null);
        var before = await barrier(b, c, other, 5);
        assert.deepStrictEqual(before, []);
        other.ws.close();
    } finally {
        await b.close();
    }
});

test('layer frames are throttled to their own, slower interval', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
    var c = fakeCompositor();
    c.layers.l1 = new Array(12).fill(0);
    var scene = { id: 's1', layers: [{ id: 'l1' }] };
    var b = await start(c);
    try {
        var editor = await listen(b);
        editor.ws.send(JSON.stringify({ type: 'subscribe_layers', sceneId: 's1' }));
        await waitFor(() => serverSideOf(b)._layerSceneId === 's1');

        b.tickLayers(scene);     // sent
        t.mock.timers.tick(40);
        b.tickLayers(scene);     // 40ms: past the composite's 33, not the layers' 66
        t.mock.timers.tick(30);
        b.tickLayers(scene);     // 70ms: sent
        b.tickLayers(scene, true); // barrier: forced
        await waitFor(() => editor.got.length >= 3);
        assert.strictEqual(editor.got.length, 3);
        editor.ws.close();
    } finally {
        await b.close();
    }
});

test('an unparseable or unknown message is ignored', async () => {
    var b = await start();
    try {
        var ws = await connect(b);
        await waitFor(() => b.wss.clients.size === 1);
        ws.send('{not json');
        ws.send(JSON.stringify({ type: 'subscribe_layers' })); // no sceneId
        ws.send(JSON.stringify({ type: 'something_else', sceneId: 'x' }));
        ws.send(JSON.stringify({ type: 'subscribe_layers', sceneId: 'ok' }));
        await waitFor(() => serverSideOf(b)._layerSceneId === 'ok');
        ws.close();
    } finally {
        await b.close();
    }
});
