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

/*
 * Blend modes split into two families, and which family a mode is in decides
 * what `opacity` means and whether headroom survives the layer:
 *
 *   Gain family (add, subtract) — opacity scales the *source*, and nothing is
 *   clamped on either side. The composite is free to run past 255 or below 0;
 *   setPixel clips at the very end, so an add above a subtract recovers what
 *   the subtract pushed under zero. This is the family that keeps headroom.
 *
 *   Mix family (everything else) — the source is clamped to 0–255, the mode
 *   computes a displayable result, and opacity lerps from the *raw* dst toward
 *   it. Clamping the source is what makes "difference with white is an invert"
 *   true rather than approximately true.
 *
 * The backdrop is clamped only where the formula needs a bounded one. Multiply
 * is the exception and stays raw on purpose: a·255/255 is a at any magnitude,
 * so multiplying by white carries headroom through, where a screen or an
 * overlay above the same stack throws it away at opacity 1.
 *
 * New modes go in the family whose opacity semantics they want, not the one
 * whose formula looks tidier.
 */
var BLEND = {
    normal: 0,
    add: 1,
    multiply: 2,
    screen: 3,
    overlay: 4,
    subtract: 5,
    difference: 6,
    lighten: 7,
    darken: 8,
    soft_light: 9,
    linear_light: 10,
};

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
            // Subtract is add's mirror down to the unclamped result, which is
            // the whole point: it is the only mode that can take light away,
            // and a composite driven negative here is still recoverable by an
            // add above it. Clamping to 0 per layer would make the order of
            // two layers change the answer for no visible gain.
            case 5:
                o = a - b * opacity;
                break;
            case 6: {
                var an6 = a < 0 ? 0 : (a > 255 ? 255 : a);
                var bn6 = b < 0 ? 0 : (b > 255 ? 255 : b);
                var d = an6 - bn6;
                o = a + ((d < 0 ? -d : d) - a) * opacity;
                break;
            }
            case 7: {
                var an7 = a < 0 ? 0 : (a > 255 ? 255 : a);
                var bn7 = b < 0 ? 0 : (b > 255 ? 255 : b);
                o = a + ((an7 > bn7 ? an7 : bn7) - a) * opacity;
                break;
            }
            case 8: {
                var an8 = a < 0 ? 0 : (a > 255 ? 255 : a);
                var bn8 = b < 0 ? 0 : (b > 255 ? 255 : b);
                o = a + ((an8 < bn8 ? an8 : bn8) - a) * opacity;
                break;
            }
            // Pegtop's soft light, (1-2B)A² + 2AB in unit terms, rather than
            // the W3C piecewise one. They differ by under a byte across the
            // whole domain, but W3C's needs a sqrt and a cubic behind a branch
            // on every channel of every pixel — 72k sqrt/s per soft-light
            // layer at 100 FPS — where this is branch-free and smooth at the
            // mid-grey pivot. Mid-grey is exactly identity, black squares the
            // backdrop and white is its complement.
            case 9: {
                var an9 = a < 0 ? 0 : (a > 255 ? 255 : a);
                var bn9 = b < 0 ? 0 : (b > 255 ? 255 : b);
                var sl = (an9 * an9 * (255 - 2 * bn9) / 255 + 2 * an9 * bn9) / 255;
                o = a + (sl - a) * opacity;
                break;
            }
            // The only mode that is bidirectional about a neutral: below
            // mid-grey it subtracts, above it adds, at 127.5 it is identity.
            // That makes a noise or gradient layer a signed modulator of the
            // stack instead of a one-way contribution. Output is clamped
            // because both inputs were — a mix-family mode stays displayable;
            // reach for add if you want the headroom.
            case 10: {
                var an10 = a < 0 ? 0 : (a > 255 ? 255 : a);
                var bn10 = b < 0 ? 0 : (b > 255 ? 255 : b);
                var ll = an10 + 2 * bn10 - 255;
                ll = ll < 0 ? 0 : (ll > 255 ? 255 : ll);
                o = a + (ll - a) * opacity;
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
            // A stale entry means some other scene claimed this layer id and
            // syncScene swapped the instance underneath us. Skipping loses one
            // layer; rendering would feed the wrong params in and push NaN to
            // the panel. SceneStore de-duplicates ids so this should not fire.
            if (!entry || entry.effectType !== layer.effectType) continue;
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
