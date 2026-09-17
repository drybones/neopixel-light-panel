const test = require('node:test');
const assert = require('node:assert');
const net = require('net');

const OPC = require('../opc');

// The hardware sink's connection handling (#108). Byte-path behaviour is in
// sinks.test.js; this file is only about what happens to the socket.

function listen() {
    return new Promise(function(resolve) {
        var server = net.createServer();
        server.listen(0, '127.0.0.1', function() { resolve(server); });
    });
}

function closeServer(server) {
    return new Promise(function(resolve) { server.close(resolve); });
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

test('a graceful close from fcserver resets the client, and the next frame reconnects', async () => {
    // The fcserver-restart case: the far end sends a FIN, no error. Before
    // #108 the client assigned `socket.onclose`, which net.Socket never
    // calls, so `connected` stayed true on a destroyed socket and every
    // subsequent frame was written into it. The panel froze on its last
    // frame and nothing crashed to restart the service.
    var server = await listen();
    var accepted = [];
    server.on('connection', function(s) { accepted.push(s); });

    var sink = new OPC('127.0.0.1', server.address().port, 1, { reconnectMs: 20 });
    sink.setPixelCount(1);
    try {
        sink.writePixels();
        await waitFor(() => sink.connected);
        assert.strictEqual(accepted.length, 1);

        accepted[0].end();
        await waitFor(() => sink.socket === null);
        assert.strictEqual(sink.connected, false, 'a closed socket must not read as connected');

        assert.doesNotThrow(() => sink.writePixels(), 'a frame after the drop must not write into a dead socket');
        // Keep ticking, as the render loop does: the drop can land inside
        // the reconnect gate, and it is the *next* attempt that reconnects.
        await waitFor(() => { sink.writePixels(); return accepted.length === 2 && sink.connected; });
    } finally {
        accepted.forEach((s) => s.destroy());
        await closeServer(server);
    }
});

test('while fcserver is absent, connection attempts are gated, not one per tick', async () => {
    // A port that refuses: listen, take the number, close.
    var server = await listen();
    var port = server.address().port;
    await closeServer(server);

    var sink = new OPC('127.0.0.1', port, 1, { reconnectMs: 100 });
    sink.setPixelCount(1);
    var attempts = 0;
    var realConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function() { attempts++; return realConnect.apply(this, arguments); };
    var logged = console.error;
    console.error = function() {};
    var frames = 0;
    var timer = setInterval(function() { sink.writePixels(); frames++; }, 2);
    try {
        await new Promise((r) => setTimeout(r, 40));
        assert.strictEqual(attempts, 1, 'one attempt inside the first gate window');

        await new Promise((r) => setTimeout(r, 260));
        // ~300ms at a 100ms gate: a handful of attempts against ~150 frames.
        // Ungated, every frame after a refused connect opened a new socket.
        assert.ok(attempts >= 2 && attempts <= 5, 'expected 2–5 attempts, got ' + attempts + ' over ' + frames + ' frames');
        assert.strictEqual(sink.connected, false);
    } finally {
        // In finally, or a failing assertion leaves the interval keeping the
        // worker alive with no test left to time out.
        clearInterval(timer);
        net.Socket.prototype.connect = realConnect;
        console.error = logged;
        if (sink.socket) sink.socket.destroy();
    }
});
