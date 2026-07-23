/*
 * Virtual OPC client — drop-in replacement for opc.js when no Fadecandy
 * is attached. Just a pixel-buffer sink: brightness and clamping are
 * applied exactly like the real client. The browser visualiser is fed by
 * engine/broadcast.js (which owns the WebSocket) straight from the
 * compositor, so pixelBuffer here goes nowhere — it only keeps the
 * virtual client behaviourally identical to the hardware one.
 */

var fs = require('fs');

var VirtualOPC = function(host, port, brightness)
{
    this.brightness = (brightness !== undefined) ? brightness : 1.0;
    this.pixelBuffer = null;
};

VirtualOPC.prototype.setPixelCount = function(num)
{
    if (this.pixelBuffer == null || this.pixelBuffer.length !== num * 3) {
        this.pixelBuffer = new Array(num * 3).fill(0);
    }
};

VirtualOPC.prototype.setPixel = function(num, r, g, b)
{
    if (this.pixelBuffer == null) {
        this.setPixelCount(num + 1);
    }
    var offset = num * 3;
    this.pixelBuffer[offset]     = Math.max(0, Math.min(255, (r | 0) * this.brightness));
    this.pixelBuffer[offset + 1] = Math.max(0, Math.min(255, (g | 0) * this.brightness));
    this.pixelBuffer[offset + 2] = Math.max(0, Math.min(255, (b | 0) * this.brightness));
};

VirtualOPC.prototype.writePixels = function()
{
    // Nothing to send anywhere; the broadcaster reads pixelBuffer directly.
};

// Static methods — identical to opc.js

VirtualOPC.loadModel = function(filename)
{
    return JSON.parse(fs.readFileSync(filename));
};

module.exports = VirtualOPC;
