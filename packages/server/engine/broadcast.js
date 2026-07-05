/*
 * Single WebSocket broadcaster (port 3001) for both hardware and virtual
 * modes — replaces the WSS that lived inside virtual-opc.js plus the
 * hardware-mode mirror in app.js (which assumed a 4-byte OPC header that
 * virtual buffers don't have; headerOffset makes that explicit).
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

function clamp255(v) {
    return v < 0 ? 0 : (v > 255 ? 255 : v | 0);
}

class Broadcaster {
    constructor(client, numPixels, options) {
        this.client = client;
        this.numPixels = numPixels;
        this.headerOffset = (options && options.headerOffset) || 0;
        this._pixelArray = null;
        this._lastMsg = null;
        this._lastSent = 0;
        this._lastLayerSent = 0;
        this._layerArrays = new Map(); // layerId → reusable [[r,g,b],...]

        var port = (options && options.port) || 3001;
        this.wss = new WebSocket.Server({ port: port });
        console.log('Pixel broadcaster: WebSocket listening on port ' + port);

        var self = this;
        this.wss.on('connection', function(socket) {
            socket._layerSceneId = null;
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

    _serialiseBuffer(buf, offset, target) {
        var n = this.numPixels;
        if (!target || target.length !== n) {
            target = new Array(n);
            for (var j = 0; j < n; j++) target[j] = [0, 0, 0];
        }
        for (var i = 0; i < n; i++) {
            var triple = target[i];
            var o = offset + i * 3;
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
        var buf = this.client.pixelBuffer;
        if (!buf) return;
        this._lastSent = now;

        this._pixelArray = this._serialiseBuffer(buf, this.headerOffset, this._pixelArray);
        this._lastMsg = JSON.stringify(this._pixelArray);

        var msg = this._lastMsg;
        this.wss.clients.forEach(function(socket) {
            if (socket.readyState === WebSocket.OPEN && !socket._layerSceneId) socket.send(msg);
        });
    }

    // Layer broadcast (v2), called every render tick with the active scene;
    // does nothing unless someone subscribed to that scene's layers.
    tickLayers(scene, compositor, force) {
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

        var buf = this.client.pixelBuffer;
        this._pixelArray = this._serialiseBuffer(buf, this.headerOffset, this._pixelArray);

        var layers = {};
        for (var i = 0; i < scene.layers.length; i++) {
            var layer = scene.layers[i];
            var layerBuf = compositor.getLayerBuffer(layer.id);
            if (!layerBuf) continue;
            var arr = this._serialiseBuffer(layerBuf, 0, this._layerArrays.get(layer.id));
            this._layerArrays.set(layer.id, arr);
            layers[layer.id] = arr;
        }

        var msg = JSON.stringify({ type: 'frame', composite: this._pixelArray, layers: layers });
        subscribers.forEach(function(socket) { socket.send(msg); });
    }
}

module.exports = { Broadcaster };
