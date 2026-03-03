/*
 * Virtual OPC client — drop-in replacement for opc.js that broadcasts
 * pixel state via WebSocket instead of sending to a Fadecandy device.
 *
 * Starts a WebSocket server on port 3001. The React UI connects there
 * to show a live preview of the LED panel.
 */

var WebSocket = require('ws');
var fs = require('fs');

var VirtualOPC = function(host, port, brightness)
{
    this.brightness = (brightness !== undefined) ? brightness : 1.0;
    this.pixelBuffer = null;
    this._pixelArray = null;

    this.wss = new WebSocket.Server({ port: 3001 });
    console.log('Virtual OPC: WebSocket server listening on port 3001');
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
    if (!this.pixelBuffer) return;
    // Skip serialization when no browser is watching
    if (this.wss.clients.size === 0) return;

    var numPixels = this.pixelBuffer.length / 3;
    // Allocate once; reuse every frame
    if (!this._pixelArray || this._pixelArray.length !== numPixels) {
        this._pixelArray = new Array(numPixels);
        for (var j = 0; j < numPixels; j++) {
            this._pixelArray[j] = [0, 0, 0];
        }
    }
    // Update in-place — no array allocations
    for (var i = 0; i < numPixels; i++) {
        var offset = i * 3;
        var triple = this._pixelArray[i];
        triple[0] = this.pixelBuffer[offset];
        triple[1] = this.pixelBuffer[offset + 1];
        triple[2] = this.pixelBuffer[offset + 2];
    }
    var msg = JSON.stringify(this._pixelArray);

    this.wss.clients.forEach(function(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
};

VirtualOPC.prototype.mapPixels = function(fn, model)
{
    this.setPixelCount(model.length);
    var unused = [0, 0, 0];

    for (var i = 0; i < model.length; i++) {
        var led = model[i];
        var rgb = led ? fn(led) : unused;
        var offset = i * 3;
        this.pixelBuffer[offset]     = Math.max(0, Math.min(255, (rgb[0] | 0) * this.brightness));
        this.pixelBuffer[offset + 1] = Math.max(0, Math.min(255, (rgb[1] | 0) * this.brightness));
        this.pixelBuffer[offset + 2] = Math.max(0, Math.min(255, (rgb[2] | 0) * this.brightness));
    }

    this.writePixels();
};

VirtualOPC.prototype.mapParticles = function(particles, model, intensityFunction)
{
    var f = intensityFunction || function(distanceSq, intensity, falloff) {
        return intensity / (1 + falloff * distanceSq);
    };

    function shader(p) {
        var r = 0, g = 0, b = 0;
        for (var i = 0; i < particles.length; i++) {
            var particle = particles[i];
            var dx = (p.point[0] - particle.point[0]) || 0;
            var dy = (p.point[1] - particle.point[1]) || 0;
            var dz = (p.point[2] - particle.point[2]) || 0;
            var dist2 = dx * dx + dy * dy + dz * dz;
            var intensity = f(dist2, particle.intensity, particle.falloff);
            r += particle.color[0] * intensity;
            g += particle.color[1] * intensity;
            b += particle.color[2] * intensity;
        }
        return [r, g, b];
    }

    this.mapPixels(shader, model);
};

// Static methods — identical to opc.js

VirtualOPC.loadModel = function(filename)
{
    return JSON.parse(fs.readFileSync(filename));
};

VirtualOPC.hsv = function(h, s, v)
{
    h = (h % 1) * 6;
    if (h < 0) h += 6;
    var i = h | 0,
        f = h - i,
        p = v * (1 - s),
        q = v * (1 - f * s),
        t = v * (1 - (1 - f) * s),
        r = [v, q, p, p, t, v][i],
        g = [t, v, v, q, p, p][i],
        b = [p, p, t, v, v, q][i];
    return [r * 255, g * 255, b * 255];
};

module.exports = VirtualOPC;
