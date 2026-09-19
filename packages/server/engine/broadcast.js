/*
 * Single WebSocket broadcaster (port 3001) for both hardware and virtual
 * modes — replaces the WSS that lived inside virtual-opc.js plus the
 * hardware-mode mirror in app.js.
 *
 * Frames are serialised from compositor.composite, i.e. *before* global
 * brightness is applied on the client.setPixel() write path: the UI
 * previews are a pre-fader meter, always showing the scene as authored,
 * and only the panel itself dims.
 *
 * Since #92 the sink clamps before it multiplies, which makes that meter
 * exact rather than merely useful: clamp255 here and the sink's ceiling
 * are the same operation, so the panel is this preview scaled by the
 * fader, and nothing appears on one that cannot appear on the other.
 *
 * v1 protocol (default): bare [[r,g,b], ...] JSON frames of the
 * composite, throttled to ~30 fps. New connections get the last frame
 * immediately so the UI never shows a stale canvas (e.g. after "off").
 *
 * v2 protocol (editor): a client sends
 *   {"type": "subscribe_layers", "sceneId": "..."}
 * and, while its scene is the active one, receives
 *   {"type": "frame", "composite": [[r,g,b],...], "layers": {layerId: [[r,g,b],...]}}
 * at ~15 fps instead of v1 frames. Layer frames are the raw per-layer
 * buffers — pre-opacity and pre-brightness, deliberately, so a faint
 * layer's thumbnail is still legible. {"type": "unsubscribe_layers"}
 * reverts to v1. Layer serialisation only happens while at least one
 * subscriber exists.
 */

var WebSocket = require('ws');

var FRAME_INTERVAL_MS = 33;
var LAYER_FRAME_INTERVAL_MS = 66;

// The only inbound messages are the two subscribe/unsubscribe objects, a few
// dozen bytes each. ws's default cap is 100 MiB, buffered before parsing, and
// CORS does not reach a WebSocket — the browser sends Origin, the server has
// to care — so this is the one limit that bounds what a stray page can cost.
var MAX_PAYLOAD_BYTES = 4096;

function clamp255(v) {
    return v < 0 ? 0 : (v > 255 ? 255 : v | 0);
}

class Broadcaster {
    constructor(compositor, numPixels, options) {
        this.compositor = compositor;
        this.numPixels = numPixels;
        this._pixelArray = null;
        this._lastMsg = null;
        this._lastSent = 0;
        this._lastLayerSent = 0;
        this._layerArrays = new Map(); // layerId → reusable [[r,g,b],...]
        this._layerArraysSceneId = null;

        var port = options && options.port !== undefined ? options.port : 3001;
        this.wss = new WebSocket.Server({ port: port, maxPayload: MAX_PAYLOAD_BYTES });

        var self = this;
        this.wss.on('listening', function() {
            console.log('Pixel broadcaster: WebSocket listening on port ' + self.wss.address().port);
        });
        // A server without its previews is not a working server, and the
        // realistic cause (EADDRINUSE from a stale process) needs a human.
        // Exit with the reason on one line rather than an uncaught stack.
        this.wss.on('error', function(err) {
            console.error('Pixel broadcaster: ' + err.message);
            process.exit(1);
        });

        this.wss.on('connection', function(socket) {
            socket._layerSceneId = null;
            // 'close' follows and the client set drops it; the listener is
            // here because without one ws *throws* the error, and a phone
            // walking out of wifi range mid-frame took the render loop with
            // it (#108). An over-size message arrives by this path too.
            socket.on('error', function() {});
            socket.on('message', function(data) {
                var msg;
                try { msg = JSON.parse(data); } catch (e) { return; }
                if (msg && msg.type === 'subscribe_layers' && msg.sceneId) {
                    socket._layerSceneId = msg.sceneId;
                } else if (msg && msg.type === 'unsubscribe_layers') {
                    socket._layerSceneId = null;
                }
            });
            if (self._lastMsg) socket.send(self._lastMsg);
        });
    }

    _serialiseBuffer(buf, target) {
        var n = this.numPixels;
        if (!target || target.length !== n) {
            target = new Array(n);
            for (var j = 0; j < n; j++) target[j] = [0, 0, 0];
        }
        for (var i = 0; i < n; i++) {
            var triple = target[i];
            var o = i * 3;
            triple[0] = clamp255(buf[o]);
            triple[1] = clamp255(buf[o + 1]);
            triple[2] = clamp255(buf[o + 2]);
        }
        return target;
    }

    // Composite broadcast (v1), called every render tick; throttled inside.
    tick(force) {
        var now = Date.now();
        if (!force && now - this._lastSent < FRAME_INTERVAL_MS) return;
        if (this.wss.clients.size === 0 && !force) return;
        var buf = this.compositor.composite;
        if (!buf) return;
        this._lastSent = now;

        this._pixelArray = this._serialiseBuffer(buf, this._pixelArray);
        this._lastMsg = JSON.stringify(this._pixelArray);

        var msg = this._lastMsg;
        this.wss.clients.forEach(function(socket) {
            if (socket.readyState === WebSocket.OPEN && !socket._layerSceneId) socket.send(msg);
        });
    }

    // Layer broadcast (v2), called every render tick with the active scene;
    // does nothing unless someone subscribed to that scene's layers.
    tickLayers(scene, force) {
        var now = Date.now();
        if (!force && now - this._lastLayerSent < LAYER_FRAME_INTERVAL_MS) return;

        var subscribers = [];
        this.wss.clients.forEach(function(socket) {
            if (socket.readyState === WebSocket.OPEN && socket._layerSceneId === scene.id) {
                subscribers.push(socket);
            }
        });
        if (subscribers.length === 0) return;
        this._lastLayerSent = now;

        // One reusable array per layer of the scene being previewed; keyed
        // only by layer id, the map would grow by one entry per layer ever
        // previewed and never shrink.
        if (scene.id !== this._layerArraysSceneId) {
            this._layerArrays.clear();
            this._layerArraysSceneId = scene.id;
        }

        var buf = this.compositor.composite;
        this._pixelArray = this._serialiseBuffer(buf, this._pixelArray);

        var layers = {};
        for (var i = 0; i < scene.layers.length; i++) {
            var layer = scene.layers[i];
            var layerBuf = this.compositor.getLayerBuffer(layer.id);
            if (!layerBuf) continue;
            var arr = this._serialiseBuffer(layerBuf, this._layerArrays.get(layer.id));
            this._layerArrays.set(layer.id, arr);
            layers[layer.id] = arr;
        }

        var msg = JSON.stringify({ type: 'frame', composite: this._pixelArray, layers: layers });
        subscribers.forEach(function(socket) { socket.send(msg); });
    }

    // Tests only: wss.close() alone leaves connected clients open.
    close() {
        var wss = this.wss;
        wss.clients.forEach(function(socket) { socket.terminate(); });
        return new Promise(function(resolve) { wss.close(resolve); });
    }
}

module.exports = { Broadcaster };
