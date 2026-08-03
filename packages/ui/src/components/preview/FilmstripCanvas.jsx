import React, { useEffect, useRef } from 'react';
import { COLS } from '../../lib/panelGrid';
import {
  BG, bloomParams, gridPositions, makeScratch, paintBloom,
} from '../../lib/ledPaint';
import { fillFrame, makeTriples, phaseFor } from '../../lib/filmstrip';
import { currentFrame, queueBuild, subscribeFrames } from '../../lib/filmstripClock';

// Plays a pre-rendered loop — a scene on a switcher card, an effect at its
// defaults on a picker tile. Sibling to LedCanvas: same imperative contract,
// nothing here touches React state — only the source of the frames differs (a
// cached filmstrip rather than the live WebSocket).
//
// The frames are bloomed *once* into a sprite sheet and then blitted, instead
// of being painted per frame like the live previews. A bloom is four blur
// passes plus 480 arc fills; the switcher shows every scene at once, so
// painting them all live is upwards of 200 blooms a second on a phone. Paying
// it once per frame per card and then drawing one image per tick moves the
// whole cost to the moment a card scrolls into view.
//
// Which is also why an IntersectionObserver gates it: a sheet is ~3.7MB of
// canvas at card size, so only the cards on screen hold one.
//
// `id` only sets the loop phase — see phaseFor. It is not an identity for the
// strip; changing it restarts nothing but where in the loop this canvas sits.
export default function FilmstripCanvas({
  strip, frames, id, width = 300, height = 80, className, style,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !strip || !frames) return undefined;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

    const positions = gridPositions(width, height);
    const params = bloomParams(width / COLS);
    const scratch = makeScratch(width, height);
    const triples = makeTriples();
    const phase = phaseFor(id, frames);
    const bandFor = (index) => (index + phase) % frames;

    // Dropped when the card leaves the viewport — a sheet is ~1.9MB, and the
    // canvas keeps its last frame, so scrolling back shows the scene rather
    // than a flash of black while it rebuilds.
    let sheet = null;
    let unsubFrames = null;
    let cancelBuild = null;

    // One frame, straight onto the card. The sheet is built on a later
    // animation frame, and rAF does not run at all in a background tab — so
    // without this a card could sit on its background colour indefinitely,
    // which is worse than the swatches it replaced.
    function paintCurrent() {
      fillFrame(strip.pixels, bandFor(currentFrame(frames)), triples);
      paintBloom(ctx, scratch, triples, positions, params, BG);
    }

    function build() {
      // One tall offscreen canvas, one band per frame. paintBloom sizes its
      // background fill and blurs from ctx.canvas, so it cannot draw into a
      // band directly — each frame is bloomed at card size and blitted in.
      const next = document.createElement('canvas');
      next.width = width;
      next.height = height * frames;
      const sheetCtx = next.getContext('2d');

      const frame = document.createElement('canvas');
      frame.width = width;
      frame.height = height;
      const frameCtx = frame.getContext('2d');

      for (let i = 0; i < frames; i++) {
        fillFrame(strip.pixels, i, triples);
        paintBloom(frameCtx, scratch, triples, positions, params, BG);
        sheetCtx.drawImage(frame, 0, i * height);
      }
      sheet = next;

      unsubFrames = subscribeFrames((index) => {
        if (!sheet) return;
        const band = bandFor(index);
        ctx.drawImage(sheet, 0, band * height, width, height, 0, 0, width, height);
      });
    }

    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      if (visible && !unsubFrames && !cancelBuild) {
        paintCurrent();
        cancelBuild = queueBuild(() => { cancelBuild = null; build(); });
      } else if (!visible) {
        if (cancelBuild) { cancelBuild(); cancelBuild = null; }
        if (unsubFrames) { unsubFrames(); unsubFrames = null; }
        sheet = null;
      }
    }, { rootMargin: '100px' });
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      if (cancelBuild) cancelBuild();
      if (unsubFrames) unsubFrames();
      sheet = null;
    };
  }, [strip, frames, id, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ background: BG, display: 'block', ...style }}
    />
  );
}
