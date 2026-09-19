/*
 * Virtual OPC client — drop-in replacement for opc.js when no Fadecandy
 * is attached. The whole byte path (clamp, brightness, power limiter) is the
 * shared one in engine/pixel-sink.js; this sink just never sends the frame.
 * The browser visualiser is fed by engine/broadcast.js (which owns the
 * WebSocket) straight from the compositor, so pixelBuffer here goes nowhere —
 * it holds what the panel would have been sent.
 *
 * That identity is what makes the power meter testable off the panel: the
 * estimate is a pure function of the bytes that would have been sent, so a
 * dev machine reads the same milliamps the Pi would.
 */

const { PixelSink } = require('./engine/pixel-sink');

class VirtualOPC extends PixelSink {
    // host and port are accepted so app.js can construct either sink alike.
    constructor(host, port, brightness = 1.0) {
        super(brightness);
    }
}

module.exports = VirtualOPC;
