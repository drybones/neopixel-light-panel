// Decoding for the scene-card filmstrips (GET /api/scenes/previews).
//
// The server sends a fixed-length loop per scene as base64 of a flat
// frame-major RGB byte array. Kept here, pure and free of canvas, because the
// canvas side of the preview can't be tested — this is the part that can.
//
// Frames are emitted in the same *strip order* as the WebSocket ones, so
// anything painting them still goes through lib/panelGrid via ledPaint's
// positions. There is deliberately no grid size in the payload: the mapping
// has one home.

import { NUM_PIXELS } from './panelGrid';

// One payload (bulk or single-scene) → { frames, intervalMs, strips }, where
// strips maps sceneId to { hash, pixels: Uint8Array }.
export function decodePreviews(payload) {
  const strips = {};
  for (const p of payload.previews || []) {
    strips[p.id] = { hash: p.hash, pixels: decodeBase64(p.data) };
  }
  return { frames: payload.frames, intervalMs: payload.intervalMs, strips };
}

export function decodeBase64(data) {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// 240 reusable [r,g,b] triples — the shape ledPaint's painters consume. The
// caller owns them for the life of the canvas, so playing a filmstrip
// allocates nothing per frame, the same reason the broadcaster reuses its
// serialisation arrays.
export function makeTriples(numPixels = NUM_PIXELS) {
  const out = new Array(numPixels);
  for (let i = 0; i < numPixels; i++) out[i] = [0, 0, 0];
  return out;
}

// Where in the loop a given canvas should start.
//
// One clock drives every canvas, so without this all 23 cards reach the seam
// on the same tick and the whole page glitches at once — which reads as a
// fault rather than as an animation, and is far more noticeable than any one
// card wrapping. Offsetting by a hash of the id (djb2) rather than by grid
// position keeps a card's phase stable when scenes are added or reordered.
// Even spread is not the goal and a few collisions do not matter; breaking the
// synchronisation is.
export function phaseFor(id, frames) {
  if (!frames) return 0;
  let h = 5381;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h % frames;
}

// Copy frame `index` out of a decoded strip into `triples`.
export function fillFrame(pixels, index, triples) {
  const n = triples.length;
  const base = index * n * 3;
  for (let i = 0; i < n; i++) {
    const t = triples[i];
    const o = base + i * 3;
    t[0] = pixels[o];
    t[1] = pixels[o + 1];
    t[2] = pixels[o + 2];
  }
  return triples;
}
