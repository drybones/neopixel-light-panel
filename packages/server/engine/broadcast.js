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
 * Every message is one shape:
 *   {"type": "frame", "composite": [[r,g,b],...], "layers"?: {layerId: [...]}}
 * throttled to ~30 fps, and a new connection is sent the last one at once so
 * the UI never shows a stale canvas (e.g. after "off").
 *
 * `layers` rides along for a client that asked for them:
 *   {"type": "subscribe_layers", "sceneId": "..."}
 * attaches them while that scene is the active one, at ~15 fps — half the
 * frames carry layers, all of them carry the composite. {"type":
 * "unsubscribe_layers"} stops them. Layer frames are the raw per-layer
 * buffers — pre-opacity and pre-brightness, deliberately, so a faint layer's
 * thumbnail is still legible — and are only serialised while a subscriber
 * exists, which is the expensive half.
 *
 * There were two shapes here until #121: a bare [[r,g,b],...] array for
 * ordinary clients and this object for the editor, told apart on the client
 * by the message's first character. They were never versions anyone could be
 * on independently — the Pi builds the UI from the same commit — and the
 * discriminator had a silent failure mode, since an unrecognised shape left
 * the previews frozen with no error anywhere. One consequence of unifying is
 * deliberate: the editor's stage now runs at the composite's rate like every
 * other preview, where it used to be pulled down to the layer rate.
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

    /*
     * One frame out, called every render tick with the scene being rendered
     * (null when the panel is off). Throttled inside; `force` is for the
     * frames the loop only renders once — the black frame after "off", which
     * is the last thing a client connecting to an idle panel will be sent.
     */
    tick(scene, force) {
        var now = Date.now();
        if (!force && now - this._lastSent < FRAME_INTERVAL_MS) return;
        if (this.wss.clients.size === 0 && !force) return;
        var buf = this.compositor.composite;
        if (!buf) return;
        this._lastSent = now;

        this._pixelArray = this._serialiseBuffer(buf, this._pixelArray);
        // Kept without layers: it is replayed to whoever connects next, who
        // has not subscribed to anything yet.
        this._lastMsg = JSON.stringify({ type: 'frame', composite: this._pixelArray });

        var subscribers = this._layerSubscribers(scene);
        var layerMsg = subscribers.length > 0 ? this._layerMessage(scene, now) : null;

        var plain = this._lastMsg;
        this.wss.clients.forEach(function(socket) {
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.send(layerMsg && socket._layerSceneId === scene.id ? layerMsg : plain);
        });
    }

    // Clients wanting the layers of the scene actually being rendered. A
    // subscriber to some other scene is an editor whose scene is not active;
    // it stays on the plain composite.
    _layerSubscribers(scene) {
        var subscribers = [];
        if (!scene) return subscribers;
        this.wss.clients.forEach(function(socket) {
            if (socket.readyState === WebSocket.OPEN && socket._layerSceneId === scene.id) {
                subscribers.push(socket);
            }
        });
        return subscribers;
    }

    // The same frame with `layers` attached, or null while the layer throttle
    // holds — layers are the expensive half, so they run at half the rate and
    // the composite goes out either way.
    _layerMessage(scene, now) {
        if (now - this._lastLayerSent < LAYER_FRAME_INTERVAL_MS) return null;
        this._lastLayerSent = now;

        // One reusable array per layer of the scene being previewed; keyed
        // only by layer id, the map would grow by one entry per layer ever
        // previewed and never shrink.
        if (scene.id !== this._layerArraysSceneId) {
            this._layerArrays.clear();
            this._layerArraysSceneId = scene.id;
        }

        var layers = {};
        for (var i = 0; i < scene.layers.length; i++) {
            var layer = scene.layers[i];
            var layerBuf = this.compositor.getLayerBuffer(layer.id);
            if (!layerBuf) continue;
            var arr = this._serialiseBuffer(layerBuf, this._layerArrays.get(layer.id));
            this._layerArrays.set(layer.id, arr);
            layers[layer.id] = arr;
        }

        return JSON.stringify({ type: 'frame', composite: this._pixelArray, layers: layers });
    }

    // Tests only: wss.close() alone leaves connected clients open.
    close() {
        var wss = this.wss;
        wss.clients.forEach(function(socket) { socket.terminate(); });
        return new Promise(function(resolve) { wss.close(resolve); });
    }
}

module.exports = { Broadcaster };
