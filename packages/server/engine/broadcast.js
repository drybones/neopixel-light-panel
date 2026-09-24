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
 * exact rather than merely useful: toByte here and the sink's ceiling
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
 * The editor is on the same composite rate as every other preview: `layers`
 * is an attachment to a frame, never a stream of its own.
 */

const WebSocket = require('ws');
const toByte = require('./color').toByte;

const FRAME_INTERVAL_MS = 33;
const LAYER_FRAME_INTERVAL_MS = 66;

// The only inbound messages are the two subscribe/unsubscribe objects, a few
// dozen bytes each. ws's default cap is 100 MiB, buffered before parsing, and
// CORS does not reach a WebSocket — the browser sends Origin, the server has
// to care — so this is the one limit that bounds what a stray page can cost.
const MAX_PAYLOAD_BYTES = 4096;

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

        const port = options && options.port !== undefined ? options.port : 3001;
        this.wss = new WebSocket.Server({ port, maxPayload: MAX_PAYLOAD_BYTES });

        this.wss.on('listening', () => {
            console.log(`Pixel broadcaster: WebSocket listening on port ${this.wss.address().port}`);
        });
        // A server without its previews is not a working server, and the
        // realistic cause (EADDRINUSE from a stale process) needs a human.
        // Exit with the reason on one line rather than an uncaught stack.
        this.wss.on('error', (err) => {
            console.error(`Pixel broadcaster: ${err.message}`);
            process.exit(1);
        });

        this.wss.on('connection', (socket) => {
            socket._layerSceneId = null;
            // 'close' follows and the client set drops it; the listener is
            // here because without one ws *throws* the error, and a phone
            // walking out of wifi range mid-frame took the render loop with
            // it (#108). An over-size message arrives by this path too.
            socket.on('error', () => {});
            socket.on('message', (data) => {
                let msg;
                try { msg = JSON.parse(data); } catch (e) { return; }
                if (msg && msg.type === 'subscribe_layers' && msg.sceneId) {
                    socket._layerSceneId = msg.sceneId;
                } else if (msg && msg.type === 'unsubscribe_layers') {
                    socket._layerSceneId = null;
                }
            });
            if (this._lastMsg) socket.send(this._lastMsg);
        });
    }

    _serialiseBuffer(buf, target) {
        const n = this.numPixels;
        if (!target || target.length !== n) {
            target = new Array(n);
            for (let j = 0; j < n; j++) target[j] = [0, 0, 0];
        }
        for (let i = 0; i < n; i++) {
            const triple = target[i];
            const o = i * 3;
            triple[0] = toByte(buf[o]);
            triple[1] = toByte(buf[o + 1]);
            triple[2] = toByte(buf[o + 2]);
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
        const now = Date.now();
        if (!force && now - this._lastSent < FRAME_INTERVAL_MS) return;
        if (this.wss.clients.size === 0 && !force) return;
        const buf = this.compositor.composite;
        if (!buf) return;
        this._lastSent = now;

        this._pixelArray = this._serialiseBuffer(buf, this._pixelArray);
        // Kept without layers: it is replayed to whoever connects next, who
        // has not subscribed to anything yet.
        this._lastMsg = JSON.stringify({ type: 'frame', composite: this._pixelArray });

        const subscribers = this._layerSubscribers(scene);
        const layerMsg = subscribers.length > 0 ? this._layerMessage(scene, now) : null;

        const plain = this._lastMsg;
        this.wss.clients.forEach((socket) => {
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.send(layerMsg && socket._layerSceneId === scene.id ? layerMsg : plain);
        });
    }

    // Clients wanting the layers of the scene actually being rendered. A
    // subscriber to some other scene is an editor whose scene is not active;
    // it stays on the plain composite.
    _layerSubscribers(scene) {
        const subscribers = [];
        if (!scene) return subscribers;
        this.wss.clients.forEach((socket) => {
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

        const layers = {};
        for (let i = 0; i < scene.layers.length; i++) {
            const layer = scene.layers[i];
            const layerBuf = this.compositor.getLayerBuffer(layer.id);
            if (!layerBuf) continue;
            const arr = this._serialiseBuffer(layerBuf, this._layerArrays.get(layer.id));
            this._layerArrays.set(layer.id, arr);
            layers[layer.id] = arr;
        }

        return JSON.stringify({ type: 'frame', composite: this._pixelArray, layers });
    }

    // Tests only: wss.close() alone leaves connected clients open.
    close() {
        const wss = this.wss;
        wss.clients.forEach((socket) => { socket.terminate(); });
        return new Promise((resolve) => { wss.close(resolve); });
    }
}

module.exports = { Broadcaster };
