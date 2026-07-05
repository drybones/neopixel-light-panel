/*
 * Simple Open Pixel Control client for Node.js
 *
 * 2013-2014 Micah Elizabeth Scott
 * This file is released into the public domain.
 */

const net = require('net');
const fs = require('fs');


/********************************************************************************
 * Core OPC Client
 */

class OPC {
    constructor(host, port, brightness = 1.0) {
        this.host = host;
        this.port = port;
        this.brightness = brightness; // Could implement this via a whitepoint config instead?
        this.pixelBuffer = null;
    }

    _reconnect() {
        this.socket = new net.Socket();
        this.connected = false;

        this.socket.onclose = () => {
            console.log("Connection closed");
            this.socket = null;
            this.connected = false;
        };

        this.socket.on('error', (e) => {
            if (e.code == 'ECONNREFUSED' || e.code == 'ECONNRESET') {
                this.socket = null;
                this.connected = false;
            }
        });

        this.socket.connect(this.port, this.host, () => {
            console.log("Connected to " + this.socket.remoteAddress);
            this.connected = true;
            this.socket.setNoDelay();
        });
    }

    writePixels() {
        if (!this.socket) {
            this._reconnect();
        }
        if (!this.connected) {
            return;
        }
        this.socket.write(this.pixelBuffer);
    }

    setPixelCount(num) {
        var length = 4 + num * 3;
        if (this.pixelBuffer == null || this.pixelBuffer.length != length) {
            this.pixelBuffer = new Buffer.alloc(length);
        }

        // Initialize OPC header
        this.pixelBuffer.writeUInt8(0, 0);           // Channel
        this.pixelBuffer.writeUInt8(0, 1);           // Command
        this.pixelBuffer.writeUInt16BE(num * 3, 2);  // Length
    }

    setPixel(num, r, g, b) {
        var offset = 4 + num * 3;
        if (this.pixelBuffer == null || offset + 3 > this.pixelBuffer.length) {
            this.setPixelCount(num + 1);
        }

        this.pixelBuffer.writeUInt8(Math.max(0, Math.min(255, (r | 0) * this.brightness)), offset);
        this.pixelBuffer.writeUInt8(Math.max(0, Math.min(255, (g | 0) * this.brightness)), offset + 1);
        this.pixelBuffer.writeUInt8(Math.max(0, Math.min(255, (b | 0) * this.brightness)), offset + 2);
    }

    /********************************************************************************
     * Global convenience methods
     */

    static loadModel(filename) {
        // Synchronously load a JSON model from a file on disk
        return JSON.parse(fs.readFileSync(filename));
    }
}


module.exports = OPC;
