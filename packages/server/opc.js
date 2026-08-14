/*
 * Simple Open Pixel Control client for Node.js
 *
 * 2013-2014 Micah Elizabeth Scott
 * This file is released into the public domain.
 */

const net = require('net');
const fs = require('fs');
const { PowerMeter } = require('./engine/power');


/********************************************************************************
 * Core OPC Client
 */

class OPC {
    constructor(host, port, brightness = 1.0) {
        this.host = host;
        this.port = port;
        this.brightness = brightness; // Could implement this via a whitepoint config instead?
        this.pixelBuffer = null;
        // Owned here rather than injected so setPixel needs no null test in
        // the hot loop. app.js configures it in place, like brightness.
        this.power = new PowerMeter();
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

    /*
     * Closes the power frame and, when the frame exceeds the budget, rescales
     * the buffer before it goes out. A second pass rather than a factor
     * folded into setPixel's multiply, because the frame's total is not known
     * until its last pixel has been written — and it only runs on the frames
     * that are actually over.
     *
     * endFrame() comes before the connection test so the accumulator is
     * always closed: skipping it while fcserver is down would let one frame's
     * sum roll into the next indefinitely.
     */
    writePixels() {
        var scale = this.power.endFrame();
        if (scale < 1 && this.pixelBuffer != null) {
            var buf = this.pixelBuffer;
            // From 4: the OPC header is not pixel data. Truncating rather
            // than rounding keeps the result at or under the budget, never
            // over — at most one count per channel, on a frame whose values
            // are large by definition.
            for (var i = 4; i < buf.length; i++) {
                buf[i] = (buf[i] * scale) | 0;
            }
        }

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
        this.power.setPixelCount(num);

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

        // Bytes taken once and reused, so the power estimate is summed over
        // exactly the values Fadecandy receives. `| 0` is what writeUInt8
        // would have done to the float anyway.
        var rb = Math.max(0, Math.min(255, (r | 0) * this.brightness)) | 0;
        var gb = Math.max(0, Math.min(255, (g | 0) * this.brightness)) | 0;
        var bb = Math.max(0, Math.min(255, (b | 0) * this.brightness)) | 0;

        this.pixelBuffer.writeUInt8(rb, offset);
        this.pixelBuffer.writeUInt8(gb, offset + 1);
        this.pixelBuffer.writeUInt8(bb, offset + 2);

        this.power.accumulate(rb, gb, bb);
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
