const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');

const { Broadcaster } = require('../engine/broadcast');

// Connection-edge behaviour of the WebSocket server (#108). The frame
// protocol itself is not covered here yet — see #112.

function start() {
    var compositor = { composite: null, getLayerBuffer: function() { return null; } };
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
