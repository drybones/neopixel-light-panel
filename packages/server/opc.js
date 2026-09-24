/*
 * Simple Open Pixel Control client for Node.js
 *
 * 2013-2014 Micah Elizabeth Scott
 * This file is released into the public domain.
 */

const net = require('net');
const { PixelSink } = require('./engine/pixel-sink');

// One connection attempt per this many ms while fcserver is unreachable.
// writePixels asks for a socket on every tick it hasn't got one, so without
// a gate an absent fcserver costs ~90 fresh sockets a second (#108).
const RECONNECT_MS = 1000;


/********************************************************************************
 * Core OPC Client
 */

class OPC extends PixelSink {
    constructor(host, port, brightness = 1.0, options = {}) {
        super(brightness);
        this.host = host;
        this.port = port;
        this.socket = null;
        this.connected = false;
        this.reconnectMs = options.reconnectMs !== undefined ? options.reconnectMs : RECONNECT_MS;
        this._nextAttemptAt = 0;
        this._outageLogged = false;
    }

    /*
     * State is reset from 'close', which net.Socket emits after every kind of
     * end: a graceful FIN from fcserver restarting, a reset, a refused
     * connect. An earlier version assigned `socket.onclose` — a property
     * net.Socket does not have — and reset on two error codes only, so a
     * graceful close left `connected` true on a destroyed socket and the
     * panel froze on its last frame with nothing crashing to restart the
     * service (#108).
     */
    _reconnect(now) {
        if (now < this._nextAttemptAt) return;
        this._nextAttemptAt = now + this.reconnectMs;

        const socket = new net.Socket();
        this.socket = socket;
        this.connected = false;

        const drop = () => {
            // A later attempt may already own this.socket; only clear our own.
            if (this.socket !== socket) return;
            socket.destroy();
            this.socket = null;
            this.connected = false;
        };
        socket.on('error', (e) => {
            // Once per outage rather than once per attempt, so a long
            // fcserver absence is one journal line, not one a second.
            if (!this._outageLogged) {
                this._outageLogged = true;
                console.error(`fcserver connection failed: ${e.code || e.message}`);
            }
            drop();
        });
        socket.on('close', () => {
            if (this.connected) console.log('fcserver connection closed');
            drop();
        });

        socket.connect(this.port, this.host, () => {
            console.log(`Connected to fcserver at ${socket.remoteAddress}`);
            this.connected = true;
            this._outageLogged = false;
            socket.setNoDelay();
        });
    }

    // The frame is already limited by PixelSink.writePixels; this only
    // decides whether there is anywhere to send it.
    _send(buf) {
        if (!this.socket) {
            this._reconnect(Date.now());
        }
        if (!this.connected) {
            return;
        }
        this.socket.write(buf);
    }
}


module.exports = OPC;
