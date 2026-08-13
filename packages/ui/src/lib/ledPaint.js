// How a streamed frame is painted onto a canvas.
//
// An LED on the panel is diffused light, not a disc: a bright core with a soft
// halo, and neighbouring halos add. So a frame is drawn in two additive passes
// over a scratch canvas of flat cores — a blurred, brightened halo (the
// background glow) and a lightly blurred core (the foreground glow). Additive
// compositing is the point: with `source-over` the halos would paint over each
// other instead of summing, and a smooth effect would still read as dots.
//
// It lives here because two places draw frames — the panel previews and the
// position pad's backdrop — and they were deliberately matched in relative dot
// size, so a change to the look has to land in both. Callers pass their own
// positions rather than a grid, because the pad's LEDs run through
// `worldToPad` and are not on an even grid once zoomed.
//
// Every glow number is a factor of one LED cell in canvas px, so a single set
// of constants holds at every canvas size, from the 900x240 stage down.

import { COLS, ROWS, NUM_PIXELS, cellForFrameIndex } from './panelGrid';

export const BG = '#0d0d0f';

// Three octaves of glow plus a crisp core, every length a factor of one LED
// cell. The panel photographs as two scales at once — a tight halo hugging
// each LED and a broad regional wash that merges a block of them into one
// mass — and a single gaussian cannot be both, so the spread is summed from
// separate blurs with independent gains.
//
// `gain` is a *stack count*, not a brightness. A blur puts all its falloff in
// the alpha channel, and `brightness()` only touches RGB — which is already
// clipped for anything near white, so it measures as a complete no-op. Drawing
// the same blurred layer additively n times scales the result linearly instead,
// with no ceiling.
export const BLOOM = {
  sourceRadius: 0.3,
  haloBlur: 0.35,
  haloGain: 1.6,
  washBlur: 1.2,
  washGain: 1.1,
  fieldBlur: 4,
  fieldGain: 0.8,
  coreRadius: 0.18,
  coreBlur: 0.05,
  coreGain: 1.4,
  glow: 1,
  darkCutoff: 8,
  minCellPx: 8,
};

// Pixel centres for an even COLS x ROWS grid on a w x h canvas, flattened to
// [x0, y0, x1, y1, ...].
//
// Indexed by *frame* index, which is strip order rather than grid order — see
// lib/panelGrid. Getting this wrong renders the panel 180 degrees round, so
// this is the only path: nothing should reimplement the mapping.
export function gridPositions(w, h) {
  const cw = w / COLS;
  const ch = h / ROWS;
  const out = new Float32Array(NUM_PIXELS * 2);
  for (let i = 0; i < NUM_PIXELS; i++) {
    const { col, row } = cellForFrameIndex(i, NUM_PIXELS);
    out[i * 2] = col * cw + cw / 2;
    out[i * 2 + 1] = row * ch + ch / 2;
  }
  return out;
}

// Resolve the cell-relative factors against an actual cell size. `fallback`
// means the cell is too small for a bloom to say anything — a 2px blur over a
// 1px core is just a dimmer dot — so the caller should paint flat instead.
export function bloomParams(cellPx, opts) {
  const p = opts ? { ...BLOOM, ...opts } : BLOOM;
  return {
    sourceRadius: Math.max(0.5, cellPx * p.sourceRadius),
    coreRadius: Math.max(0.5, cellPx * p.coreRadius),
    // Every blur scales with `glow` so one slider opens the whole spread out
    // together, keeping the ratio between the three octaves.
    octaves: [
      { blur: cellPx * p.haloBlur * p.glow, gain: p.haloGain },
      { blur: cellPx * p.washBlur * p.glow, gain: p.washGain },
      { blur: cellPx * p.fieldBlur * p.glow, gain: p.fieldGain },
    ],
    coreBlur: cellPx * p.coreBlur * p.glow,
    coreGain: p.coreGain,
    darkCutoff: p.darkCutoff,
    fallback: cellPx < p.minCellPx,
  };
}

// Canvas `filter` is what makes the blur affordable — one GPU pass over the
// canvas rather than a gradient per LED. There is no second implementation to
// fall back to: a blur in JS measured 294ms a frame on the phone at card size
// (31.7s for one filmstrip), and the `drawImage` pyramid that is fast enough
// cannot reproduce the widest octave — it loses light once its levels are a few
// px across, and it clamps at the canvas edge where the real blur spills off
// and is lost. So a missing blur means flat, and the detection has to be right.
//
// WebKit does not have it — not iOS specifically, WebKit, on either iOS or
// macOS. This is not a gap that ages out: it has stayed absent across every
// other canvas/CSS API landing around it (`ctx.roundRect`, `Object.groupBy`,
// CSS filters, SVG `feGaussianBlur` all work), so a version check or a feature
// list is not a substitute for testing the property itself.
//
// Test for the property, and test for it with `in`, never by assigning a
// value and reading it back: assigning to a property the engine does not
// implement just creates an expando that reads back as whatever was written,
// reporting support on engines that have none. The bloom would then stack
// *unblurred* discs at a combined gain of 4.9x and clip a fifth of the image
// to white, silently, on every Safari.
//
// `in` is correct because WebKit's runtime-enabled features remove the
// attribute from the prototype rather than leaving it inert, so an
// unsupported or flagged-off `filter` is always absent (verified on both
// Safaris: `'filter' in ctx` false, `ctx.filter` undefined). What it cannot
// catch is an engine that has the property and ignores it for `drawImage`;
// no such engine is known.
let filterSupport = null;

export function blurWorks() {
  if (filterSupport === null) {
    filterSupport = 'filter' in document.createElement('canvas').getContext('2d');
  }
  return filterSupport;
}

function fillCores(ctx, pixels, positions, radius, cutoff) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const n = pixels.length;
  for (let i = 0; i < n; i++) {
    const px = pixels[i];
    const r = px[0];
    const g = px[1];
    const b = px[2];
    if (r + g + b < cutoff) continue;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    ctx.arc(positions[i * 2], positions[i * 2 + 1], radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// The flat (pre-bloom) renderer, used for the layer thumbnails (whose cells
// are 4px wide) and as the fallback whenever a bloom cannot say anything.
// `fill` draws cell rectangles instead of dots, which is what reads at
// thumbnail size.
export function paintFlat(ctx, pixels, positions, radius, bg = BG, fill = false) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const cw = w / COLS;
  const ch = h / ROWS;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const dots = !fill && radius >= 1.5;
  const n = pixels.length;
  for (let i = 0; i < n; i++) {
    const px = pixels[i];
    ctx.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`;
    if (dots) {
      ctx.beginPath();
      ctx.arc(positions[i * 2], positions[i * 2 + 1], radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(positions[i * 2] - cw / 2, positions[i * 2 + 1] - ch / 2, cw - 0.5, ch - 0.5);
    }
  }
}

// The two offscreen canvases paintBloom needs, allocated once by the caller:
// `cores` holds the flat discs the glow spreads from, `blurred` holds one
// octave at a time.
export function makeScratch(w, h) {
  const cores = document.createElement('canvas');
  const blurred = document.createElement('canvas');
  cores.width = w;
  blurred.width = w;
  cores.height = h;
  blurred.height = h;
  return { cores, blurred, w, h };
}

// Blur `src` once, then stack the result additively `gain` times. Re-running
// the filter per stacked draw would pay for the blur every time; blurring into
// a temp first makes each extra unit of gain a plain blit. A fractional gain
// lands as one final partial-alpha draw.
function stackOctave(ctx, scratch, src, blurPx, gain) {
  if (gain <= 0.004) return;
  const tmp = scratch.blurred.getContext('2d');
  tmp.globalCompositeOperation = 'copy';
  tmp.globalAlpha = 1;
  tmp.filter = blurPx > 0.05 ? `blur(${blurPx.toFixed(2)}px)` : 'none';
  tmp.drawImage(src, 0, 0);
  tmp.filter = 'none';
  for (let g = gain; g > 0.004; g -= 1) {
    ctx.globalAlpha = g < 1 ? g : 1;
    ctx.drawImage(scratch.blurred, 0, 0);
  }
}

export function paintBloom(ctx, scratch, pixels, positions, params, bg = BG) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (params.fallback || !blurWorks()) {
    // The flat renderer's own radius, not the bloom's core radius — a
    // fallback should look like a complete flat rendering, not a bloom
    // with its halo removed.
    paintFlat(ctx, pixels, positions, Math.min(w / COLS, h / ROWS) / 2 * 0.75, bg, false);
    return;
  }
  // The glow spreads from a disc of its own, wider than the visible core, so
  // the spread can be fed more light without fattening the sharp dot.
  fillCores(scratch.cores.getContext('2d'), pixels, positions, params.sourceRadius, params.darkCutoff);

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < params.octaves.length; i++) {
    stackOctave(ctx, scratch, scratch.cores, params.octaves[i].blur, params.octaves[i].gain);
  }

  // The core is drawn from its own smaller disc, on top of the spread.
  fillCores(scratch.cores.getContext('2d'), pixels, positions, params.coreRadius, params.darkCutoff);
  stackOctave(ctx, scratch, scratch.cores, params.coreBlur, params.coreGain);

  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export { COLS, ROWS, NUM_PIXELS };
