/*
 * Virtual OPC client — drop-in replacement for opc.js when no Fadecandy
 * is attached. Just a pixel-buffer sink: brightness, clamping and the power
 * limiter are applied exactly like the real client. The browser visualiser
 * is fed by engine/broadcast.js (which owns the WebSocket) straight from the
 * compositor, so pixelBuffer here goes nowhere — it only keeps the
 * virtual client behaviourally identical to the hardware one.
 *
 * That identity is what makes the power meter testable off the panel: the
 * estimate is a pure function of the bytes that would have been sent, so a
 * dev machine reads the same milliamps the Pi would.
 */

var fs = require('fs');
var PowerMeter = require('./engine/power').PowerMeter;

var VirtualOPC = function(host, port, brightness)
{
    this.brightness = (brightness !== undefined) ? brightness : 1.0;
    this.pixelBuffer = null;
    this.power = new PowerMeter();
};

VirtualOPC.prototype.setPixelCount = function(num)
{
    if (this.pixelBuffer == null || this.pixelBuffer.length !== num * 3) {
        this.pixelBuffer = new Array(num * 3).fill(0);
    }
    this.power.setPixelCount(num);
};

VirtualOPC.prototype.setPixel = function(num, r, g, b)
{
    if (this.pixelBuffer == null) {
        this.setPixelCount(num + 1);
    }
    var offset = num * 3;
    // Bytes, not floats: the hardware buffer holds what writeUInt8 truncated
    // it to, and the power estimate is summed over the same values here.
    var rb = Math.max(0, Math.min(255, (r | 0) * this.brightness)) | 0;
    var gb = Math.max(0, Math.min(255, (g | 0) * this.brightness)) | 0;
    var bb = Math.max(0, Math.min(255, (b | 0) * this.brightness)) | 0;

    this.pixelBuffer[offset]     = rb;
    this.pixelBuffer[offset + 1] = gb;
    this.pixelBuffer[offset + 2] = bb;

    this.power.accumulate(rb, gb, bb);
};

VirtualOPC.prototype.writePixels = function()
{
    // Nothing to send anywhere; the broadcaster reads the compositor. The
    // limiter still runs, so the buffer here shows what the panel would have
    // been sent — which is the whole point of verifying this in dev.
    var scale = this.power.endFrame();
    if (scale < 1 && this.pixelBuffer != null) {
        for (var i = 0; i < this.pixelBuffer.length; i++) {
            this.pixelBuffer[i] = (this.pixelBuffer[i] * scale) | 0;
        }
    }
};

// Static methods — identical to opc.js

VirtualOPC.loadModel = function(filename)
{
    return JSON.parse(fs.readFileSync(filename));
};

module.exports = VirtualOPC;
