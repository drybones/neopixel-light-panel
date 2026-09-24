/*
 * The byte path both pixel sinks share: an OPC-framed buffer, clamp then
 * brightness, the power estimate, and the limiter's rescale pass. opc.js adds
 * a socket to send the buffer down; virtual-opc.js sends it nowhere.
 *
 * One implementation rather than two copies because the two sinks have to
 * agree byte for byte — dev only predicts the panel, and the power meter's
 * readings only transfer, while they do — and as copies they had already
 * drifted (only the hardware one grew its buffer on an out-of-range pixel).
 * The virtual sink carries the OPC header too, so identity is a whole-buffer
 * comparison rather than an offset each reader has to know about.
 */

const fs = require('fs');
const { PowerMeter } = require('./power');
const { toByte } = require('./color');

// Channel (1) + command (1) + length (2), ahead of the pixel data.
const HEADER_BYTES = 4;

class PixelSink {
    constructor(brightness = 1.0) {
        this.brightness = brightness;
        this.pixelBuffer = null;
        // Owned here rather than injected so setPixel needs no null test in
        // the hot loop. app.js configures it in place, like brightness.
        this.power = new PowerMeter();
    }

    setPixelCount(num) {
        const length = HEADER_BYTES + num * 3;
        if (this.pixelBuffer == null || this.pixelBuffer.length !== length) {
            this.pixelBuffer = Buffer.alloc(length);
        }
        this.power.setPixelCount(num);

        this.pixelBuffer.writeUInt8(0, 0);           // Channel
        this.pixelBuffer.writeUInt8(0, 1);           // Command
        this.pixelBuffer.writeUInt16BE(num * 3, 2);  // Length
    }

    setPixel(num, r, g, b) {
        const offset = HEADER_BYTES + num * 3;
        if (this.pixelBuffer == null || offset + 3 > this.pixelBuffer.length) {
            this.setPixelCount(num + 1);
        }

        // Bytes taken once and reused, so the power estimate is summed over
        // exactly the values Fadecandy receives.
        //
        // THE CLAMP COMES FIRST, then brightness (issue #92). Multiplying
        // first would leave the over-range values in play and let the fader
        // pull them back down into range, so a region the compositor left at
        // 510 would sit pinned at full white until brightness dropped below
        // 0.5 while its neighbours scaled from the start — the fader acting
        // as an exposure control over an HDR buffer rather than as a level.
        // Clamping first discards the headroom here, where it stops being
        // light and starts being bytes, so brightness is a linear scale on
        // the finished frame. The product needs no second clamp: the value
        // is already in range and brightness is clamped to 0–1 on both ways
        // in (routes/system.js and SettingsStore.load).
        const rb = (toByte(r) * this.brightness) | 0;
        const gb = (toByte(g) * this.brightness) | 0;
        const bb = (toByte(b) * this.brightness) | 0;

        const buf = this.pixelBuffer;
        buf[offset] = rb;
        buf[offset + 1] = gb;
        buf[offset + 2] = bb;

        this.power.accumulate(rb, gb, bb);
    }

    /*
     * Closes the power frame and, when the frame exceeds the budget, rescales
     * the buffer before it goes out. A second pass rather than a factor
     * folded into setPixel's multiply, because the frame's total is not known
     * until its last pixel has been written — and it only runs on the frames
     * that are actually over.
     *
     * endFrame() comes before the send so the accumulator is always closed:
     * skipping it while fcserver is down would let one frame's sum roll into
     * the next indefinitely.
     */
    writePixels() {
        const scale = this.power.endFrame();
        const buf = this.pixelBuffer;
        if (scale < 1 && buf != null) {
            // Truncating rather than rounding keeps the result at or under
            // the budget, never over — at most one count per channel, on a
            // frame whose values are large by definition.
            for (let i = HEADER_BYTES; i < buf.length; i++) {
                buf[i] = (buf[i] * scale) | 0;
            }
        }
        this._send(buf);
    }

    // The one hook: where a finished, limited frame goes.
    _send(buf) {}

    static loadModel(filename) {
        // Synchronously load a JSON model from a file on disk
        return JSON.parse(fs.readFileSync(filename));
    }
}

module.exports = { PixelSink, HEADER_BYTES };
