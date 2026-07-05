import React, { useEffect, useRef } from 'react';
import { drawFrame } from '../preview/LedCanvas';

// Draggable position pad for schema `xy` entries. The pad has the panel's
// aspect and, when a frame subscription is provided, shows the live render
// behind the handle — you drag the effect around on the picture of itself.
//
// Coordinate mapping (see layout.json): canvas x left→right = world
// x −3.625→+3.625; canvas y top→bottom = world z −0.875→+0.875, and
// effect y params negate z (dz = pz + y), so the handle y is inverted.
export default function XYPad({ entry, x, y, color, subscribe, onChange, onCommit }) {
  const padRef = useRef(null);
  const canvasRef = useRef(null);
  const draggingRef = useRef(false);

  const [xMin, xMax] = entry.xRange;
  const [yMin, yMax] = entry.yRange;

  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((frame) => drawFrame(canvasRef.current, frame, false));
  }, [subscribe]);

  function apply(e) {
    const rect = padRef.current.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    onChange(xMin + fx * (xMax - xMin), yMax - fy * (yMax - yMin));
  }

  function handlePointerDown(e) {
    draggingRef.current = true;
    padRef.current.setPointerCapture(e.pointerId);
    apply(e);
  }

  function handlePointerMove(e) {
    if (draggingRef.current) apply(e);
  }

  function handlePointerUp() {
    draggingRef.current = false;
    if (onCommit) onCommit();
  }

  const hx = ((x - xMin) / (xMax - xMin)) * 100;
  const hy = ((yMax - y) / (yMax - yMin)) * 100;

  return (
    <div className="control-row control-row--pad">
      <label className="control-label">{entry.label}</label>
      <div
        ref={padRef}
        className="xy-pad"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="slider"
        aria-label={entry.label}
        aria-valuetext={`x ${x.toFixed(2)}, y ${y.toFixed(2)}`}
        tabIndex={0}
        onKeyDown={(e) => {
          const dx = (xMax - xMin) / 29;
          const dy = (yMax - yMin) / 7;
          if (e.key === 'ArrowLeft') onChange(Math.max(xMin, x - dx), y);
          else if (e.key === 'ArrowRight') onChange(Math.min(xMax, x + dx), y);
          else if (e.key === 'ArrowUp') onChange(x, Math.min(yMax, y + dy));
          else if (e.key === 'ArrowDown') onChange(x, Math.max(yMin, y - dy));
          else return;
          e.preventDefault();
          if (onCommit) onCommit();
        }}
      >
        <canvas ref={canvasRef} width={600} height={160} className="xy-pad-canvas" />
        <div
          className="xy-pad-handle"
          style={{ left: `${hx}%`, top: `${hy}%`, background: color || 'var(--accent)' }}
        />
      </div>
    </div>
  );
}
