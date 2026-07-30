import React, { useEffect, useRef } from 'react';
import { COLS, ROWS, cellForFrameIndex } from '../../lib/panelGrid';

// Shared 30×8 LED dot renderer. `subscribe` is a function like
// lightStream.subscribeComposite — it gets a callback and returns an
// unsubscribe function. Frames are painted imperatively; nothing here
// touches React state. Strip-order-to-grid mapping lives in lib/panelGrid so
// the position pad's backdrop cannot drift from this.
export function drawFrame(canvas, pixels, dots = true) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const cw = w / COLS;
  const ch = h / ROWS;
  const radius = Math.min(cw, ch) / 2 * 0.75;
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, w, h);
  const numPixels = pixels.length;
  for (let i = 0; i < numPixels; i++) {
    const [r, g, b] = pixels[i];
    const { col, row } = cellForFrameIndex(i, numPixels);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    if (dots && radius >= 1.5) {
      ctx.beginPath();
      ctx.arc(col * cw + cw / 2, row * ch + ch / 2, radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(col * cw, row * ch, cw - 0.5, ch - 0.5);
    }
  }
}

export default function LedCanvas({ subscribe, width = 600, height = 160, dots = true, className, style }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!subscribe) return undefined;
    const unsubscribe = subscribe((frame) => drawFrame(canvasRef.current, frame, dots));
    return unsubscribe;
  }, [subscribe, dots]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ background: '#0d0d0f', display: 'block', ...style }}
    />
  );
}
