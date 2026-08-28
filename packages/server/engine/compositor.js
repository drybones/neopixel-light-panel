/*
 * Compositor — renders a scene's layer stack into a single frame.
 *
 * Layers render bottom→top (layers[0] is the bottom) into per-layer
 * Float32 buffers in 0–255 float range, then blend into the composite.
 * The composite is written through client.setPixel(), which clamps and then
 * applies global brightness — no brightness handling here.
 *
 * THE COMPOSITE IS UNBOUNDED LINEAR LIGHT. The sink clamps; nothing here
 * does. The over-range values are real accumulated light rather than noise:
 * engine/particles.js sums each particle's contribution and writes the raw
 * total, so `emitter` reaches ~765 and `particle_trail` ~1104 at their own
 * defaults. A three-particle overlap and a single hit genuinely differ, and
 * flattening them to the same white here would destroy a gradation a later
 * `multiply` or partial-opacity layer can still recover.
 *
 * All buffers and effect instances are allocated on the API write path
 * (syncScene), keyed by layer id; the per-frame path is allocation-free.
 */

var effects = require('../effects');
var color = require('./color');

/*
 * The rule every mode obeys:
 *
 *   A blend may clamp its SOURCE operand where its formula needs a bounded
 *   domain. No blend may clamp the ACCUMULATOR.
 *
 * The test for whether a mode needs a guard at all is whether its identity
 * element still behaves like one off the end of the range. Screening with
 * black, multiplying by white, darkening with white — each is a no-op by
 * definition, and a mode that turns one into a truncation is broken, because
 * a layer that is merely dark over part of the panel then silently flattens
 * everything beneath it and nothing surfaces that.
 *
 *   Identity holds unbounded — no guard needed:
 *       normal, add, subtract, multiply, linear_light
 *   Identity breaks off the end — guarded below:
 *       screen, overlay, difference, lighten, darken, soft_light
 *
 * Unclamping the guarded ones is not the fix. Screen is 1-(1-a)(1-b), so
 * ds/db is (1-a): once a runs past 255 the derivative goes negative and the
 * blend inverts, brightening the source darkening the result. Overlay is
 * worse, since its mid-grey pivot has no meaning in an unbounded range. The
 * guard is legitimate; it was simply applied to the wrong operand.
 *
 * So a guarded mode splits the accumulator into the part its formula is
 * defined on and the excess, blends the first and lets the second ride:
 *
 *     an = clamp(a)        the part the formula is defined on
 *     ex = a - an          headroom, signed, passed through untouched
 *     o  = a + (v + ex - a) * opacity
 *
 * and since a is exactly an + ex, that last line collapses to
 *
 *     o  = a + (v - an) * opacity
 *
 * which is one subtraction more than the unguarded form and no branch. It is
 * a strict no-op for an in-range accumulator (ex is 0, an is a), so a guarded
 * mode is unchanged for every scene that never overflowed.
 *
 * `opacity` still means two different things, and that is deliberate. For the
 * two gain modes (add, subtract) it scales the source, so nothing is clamped
 * and the pair compose: an add above a subtract recovers exactly what the
 * subtract buried. For every other mode it lerps from the raw accumulator
 * toward the blended result.
 *
 * Two modes are worth knowing by behaviour rather than by formula. `difference`
 * against white is an invert, which is the cheapest mask this stack has. And
 * `overlay`/`soft_light` pivot on mid-grey, so over the near-black backdrops
 * LED scenes actually have, both collapse toward zero and read as doing
 * nothing — they belong above a `solid`, not above an `emitter`.
 *
 * THE MODE LIST IS DUPLICATED, unlike effects, which the UI discovers from
 * /api/effects: this map and BLEND_OPTIONS in the UI's ParamPanel.jsx. A mode
 * missing from that list is simply unreachable from the UI with nothing to
 * tell you, and a mode listed there that this map lacks falls back to
 * `normal` on write.
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
                o = a + (s - an3) * opacity;
                break;
            }
            case 4: {
                var an4 = a < 0 ? 0 : (a > 255 ? 255 : a);
                var bn4 = b < 0 ? 0 : (b > 255 ? 255 : b);
                var v = an4 < 128
                    ? 2 * an4 * bn4 / 255
                    : 255 - 2 * (255 - an4) * (255 - bn4) / 255;
                o = a + (v - an4) * opacity;
                break;
            }
            // Subtract is add's mirror down to the unclamped result, which is
            // the whole point: it is the only mode that can take light away,
            // and a composite driven negative here is still recoverable by an
            // add above it. Clamping to 0 per layer would make the order of
            // two layers change the answer for no visible gain — and would
            // break the same identity rule from the other end.
            case 5:
                o = a - b * opacity;
                break;
            // Against white this is an invert — the cheapest mask available
            // here, and the reason the mode earns its case.
            case 6: {
                var an6 = a < 0 ? 0 : (a > 255 ? 255 : a);
                var bn6 = b < 0 ? 0 : (b > 255 ? 255 : b);
                var d = an6 - bn6;
                o = a + ((d < 0 ? -d : d) - an6) * opacity;
                break;
            }
            case 7: {
                var an7 = a < 0 ? 0 : (a > 255 ? 255 : a);
                var bn7 = b < 0 ? 0 : (b > 255 ? 255 : b);
                o = a + ((an7 > bn7 ? an7 : bn7) - an7) * opacity;
                break;
            }
            case 8: {
                var an8 = a < 0 ? 0 : (a > 255 ? 255 : a);
                var bn8 = b < 0 ? 0 : (b > 255 ? 255 : b);
                o = a + ((an8 < bn8 ? an8 : bn8) - an8) * opacity;
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
                o = a + (sl - an9) * opacity;
                break;
            }
            // The only mode that is bidirectional about a neutral: below
            // mid-grey it subtracts, above it adds, at 127.5 it is identity.
            // That makes a noise or gradient layer a signed modulator of the
            // stack instead of a one-way contribution.
            //
            // Written as a signed gain rather than a lerp, which is what the
            // identity rule forces: a + 2b - 255 with the accumulator clamped
            // first would make a black layer truncate a hot stack to 255, and
            // clamping the result would cap the mode's own output at white.
            // Neither is wanted, and dropping both leaves a mode that reads
            // only the source — the exact mirror of add and subtract, with a
            // mid-grey pivot instead of a black one.
            case 10: {
                var bn10 = b < 0 ? 0 : (b > 255 ? 255 : b);
                o = a + (2 * bn10 - 255) * opacity;
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
