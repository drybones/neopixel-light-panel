import React, { useEffect, useMemo, useRef } from 'react';
import { COLS, ROWS } from '../../lib/panelGrid';
import {
  BG, bloomParams, gridPositions, makeScratch, paintBloom, paintFlat,
} from '../../lib/ledPaint';

// Shared 30x8 LED renderer. `subscribe` is a function like
// lightStream.subscribeComposite — it gets a callback and returns an
// unsubscribe function. Frames are painted imperatively; nothing here touches
// React state.
//
// `mode` picks how a pixel is drawn:
//   bloom — core plus multi-scale glow, how the panel actually looks
//   dots  — flat discs, the pre-bloom look
//   fill  — flat cell rectangles, for canvases too small for either
// Below `minCellPx` the painter falls back to flat on its own, so the
// thumbnails stay cheap whatever they ask for.
//
// The strip-order-to-grid mapping and the drawing both live in lib/ledPaint,
// so the position pad's backdrop cannot drift from this.
export default function LedCanvas({
  subscribe, width = 600, height = 160, mode = 'bloom', className, style,
}) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const scratchRef = useRef(null);
  const frameRef = useRef(null);

  // Resolved once per size rather than per frame — this repaints at the
  // stream rate, for every layer thumbnail as well as the composite.
  const positions = useMemo(() => gridPositions(width, height), [width, height]);
  const params = useMemo(() => bloomParams(width / COLS), [width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    // A canvas swap would strand a cached context on a detached node.
    ctxRef.current = canvas.getContext('2d');
    scratchRef.current = mode === 'bloom' ? makeScratch(width, height) : null;

    function paint(frame) {
      const ctx = ctxRef.current;
      if (!ctx || !frame) return;
      if (mode === 'bloom') {
        paintBloom(ctx, scratchRef.current, frame, positions, params, BG);
      } else {
        paintFlat(
          ctx, frame, positions,
          Math.min(width / COLS, height / ROWS) / 2 * 0.75, BG, mode === 'fill',
        );
      }
    }

    // Repaint whatever we last had, so a size or mode change is visible
    // without waiting for the next frame.
    paint(frameRef.current);
    if (!subscribe) return undefined;
    return subscribe((frame) => {
      frameRef.current = frame;
      paint(frame);
    });
  }, [subscribe, mode, width, height, positions, params]);

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
