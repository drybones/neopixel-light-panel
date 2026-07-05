/*
 * Compositor — renders a scene's layer stack into a single frame.
 *
 * Layers render bottom→top (layers[0] is the bottom) into per-layer
 * Float32 buffers in 0–255 float range, then blend into the composite.
 * The composite is written through client.setPixel(), which clamps and
 * applies global brightness — no brightness handling here.
 *
 * All buffers and effect instances are allocated on the API write path
 * (syncScene), keyed by layer id; the per-frame path is allocation-free.
 */

var effects = require('../effects');
var color = require('./color');

var BLEND = { normal: 0, add: 1, multiply: 2, screen: 3, overlay: 4 };

function blendInto(dst, src, mode, opacity, n) {
    for (var i = 0; i < n * 3; i++) {
        var a = dst[i];
        var b = src[i];
        var o;
        switch (mode) {
            case 1:
                o = a + b * opacity;
                break;
            case 2: {
                var bn = b < 0 ? 0 : (b > 255 ? 255 : b);
                o = a + (a * bn / 255 - a) * opacity;
                break;
            }
            case 3: {
                var an3 = a < 0 ? 0 : (a > 255 ? 255 : a);
                var bn3 = b < 0 ? 0 : (b > 255 ? 255 : b);
                var s = 255 - (255 - an3) * (255 - bn3) / 255;
                o = a + (s - a) * opacity;
                break;
            }
            case 4: {
                var an4 = a < 0 ? 0 : (a > 255 ? 255 : a);
                var bn4 = b < 0 ? 0 : (b > 255 ? 255 : b);
                var v = an4 < 128
                    ? 2 * an4 * bn4 / 255
                    : 255 - 2 * (255 - an4) * (255 - bn4) / 255;
                o = a + (v - a) * opacity;
                break;
            }
            default:
                o = a + (b - a) * opacity;
        }
        dst[i] = o;
    }
}

class Compositor {
    constructor(client, model) {
        this.client = client;
        this.numPixels = model.length;
        this.composite = new Float32Array(this.numPixels * 3);

        // Pre-flattened layout for effect inner loops
        this.ctx = {
            numPixels: this.numPixels,
            modelX: new Float32Array(this.numPixels),
            modelZ: new Float32Array(this.numPixels),
            hsv: color.hsv,
        };
        for (var i = 0; i < this.numPixels; i++) {
            this.ctx.modelX[i] = model[i].point[0];
            this.ctx.modelZ[i] = model[i].point[2];
        }

        // layerId → { buffer, instance, effectType }
        this.layers = new Map();
    }

    // Write-path: make sure every layer in the scene has a buffer and an
    // effect instance; drop state for layers that no longer exist anywhere.
    syncScene(scene) {
        var self = this;
        (scene.layers || []).forEach(function(layer) {
            var entry = self.layers.get(layer.id);
            if (!entry || entry.effectType !== layer.effectType) {
                var effect = effects.get(layer.effectType);
                if (!effect) return;
                self.layers.set(layer.id, {
                    buffer: new Float32Array(self.numPixels * 3),
                    instance: effect.createInstance(self.ctx),
                    effectType: layer.effectType,
                });
            }
        });
    }

    releaseLayers(layerIds) {
        var self = this;
        layerIds.forEach(function(id) { self.layers.delete(id); });
    }

    // Draw-path: renders scene into this.composite and writes to the client.
    // scene._displayLayers is precomputed on the write path (enabled/solo filter).
    renderFrame(scene, millis) {
        var display = scene._displayLayers || scene.layers;
        var comp = this.composite;
        comp.fill(0);

        for (var li = 0; li < display.length; li++) {
            var layer = display[li];
            var entry = this.layers.get(layer.id);
            if (!entry) continue;
            entry.instance.render(entry.buffer, millis, layer._prepared);
            blendInto(comp, entry.buffer, layer._blend | 0, layer.opacity, this.numPixels);
        }

        this.writeComposite();
    }

    renderBlack() {
        this.composite.fill(0);
        this.writeComposite();
    }

    writeComposite() {
        var comp = this.composite;
        for (var i = 0; i < this.numPixels; i++) {
            this.client.setPixel(i, comp[i * 3], comp[i * 3 + 1], comp[i * 3 + 2]);
        }
        this.client.writePixels();
    }

    getLayerBuffer(layerId) {
        var entry = this.layers.get(layerId);
        return entry ? entry.buffer : null;
    }
}

module.exports = { Compositor, BLEND, blendInto };
