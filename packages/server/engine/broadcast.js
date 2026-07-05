/*
 * Single WebSocket broadcaster (port 3001) for both hardware and virtual
 * modes — replaces the WSS that lived inside virtual-opc.js plus the
 * hardware-mode mirror in app.js (which assumed a 4-byte OPC header that
 * virtual buffers don't have; headerOffset makes that explicit).
 *
 * v1 protocol: bare [[r,g,b], ...] JSON frames of the composite,
 * throttled to ~30 fps. New connections get the last frame immediately so
 * the UI never shows a stale canvas (e.g. after "off").
 */

var WebSocket = require('ws');

var FRAME_INTERVAL_MS = 33;

class Broadcaster {
    constructor(client, numPixels, options) {
        this.client = client;
        this.numPixels = numPixels;
        this.headerOffset = (options && options.headerOffset) || 0;
        this._pixelArray = null;
        this._lastMsg = null;
        this._lastSent = 0;

        var port = (options && options.port) || 3001;
        this.wss = new WebSocket.Server({ port: port });
        console.log('Pixel broadcaster: WebSocket listening on port ' + port);

        var self = this;
        this.wss.on('connection', function(socket) {
            if (self._lastMsg) socket.send(self._lastMsg);
        });
    }

    // Called every render tick; internally throttled.
    tick(force) {
        var now = Date.now();
        if (!force && now - this._lastSent < FRAME_INTERVAL_MS) return;
        if (this.wss.clients.size === 0 && !force) return;
        var buf = this.client.pixelBuffer;
        if (!buf) return;
        this._lastSent = now;

        var n = this.numPixels;
        if (!this._pixelArray || this._pixelArray.length !== n) {
            this._pixelArray = new Array(n);
            for (var j = 0; j < n; j++) this._pixelArray[j] = [0, 0, 0];
        }
        var offset = this.headerOffset;
        for (var i = 0; i < n; i++) {
            var triple = this._pixelArray[i];
            var o = offset + i * 3;
            triple[0] = buf[o];
            triple[1] = buf[o + 1];
            triple[2] = buf[o + 2];
        }
        this._lastMsg = JSON.stringify(this._pixelArray);

        var msg = this._lastMsg;
        this.wss.clients.forEach(function(socket) {
            if (socket.readyState === WebSocket.OPEN) socket.send(msg);
        });
    }
}

module.exports = { Broadcaster };
