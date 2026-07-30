import React, { useEffect, useMemo, useRef } from 'react';
import NumField from './NumField';
import {
  padGeometry, worldToPad, padToWorld, clampHandle, directionDegrees, isFarField,
} from '../../lib/xyPad';
import { COLS, ROWS, NUM_PIXELS, cellForFrameIndex } from '../../lib/panelGrid';

const CANVAS_W = 600;

// Draggable position pad for schema `xy` entries. The pad shows the panel plus
// an equal world-unit margin on all four sides, and — where the schema sets
// farLimit — an outer frame that compresses out to that distance. See
// lib/xyPad for the mapping and why the margin is equal rather than
// aspect-matched.
//
// The live layer render is drawn through the same mapping, so the LEDs sit
// where the effect actually is and you drag it around on a picture of itself.
export default function XYPad({ entry, x, y, color, subscribe, onChange, onCommit }) {
  const padRef = useRef(null);
  const canvasRef = useRef(null);
  const draggingRef = useRef(false);
  const frameRef = useRef(null);

  const geo = useMemo(() => padGeometry(entry), [entry]);
  const canvasH = Math.round(CANVAS_W / geo.aspect);

  // Pixel positions are fixed by the geometry, so resolve them once rather than
  // per frame — this redraws at the stream rate.
  //
  // Indexed by *frame* index, which is strip order rather than grid order —
  // see lib/panelGrid. Getting this wrong puts the render 180 degrees from a
  // correctly-placed handle.
  const ledPositions = useMemo(() => {
    const n = NUM_PIXELS;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const { col, row } = cellForFrameIndex(i, n);
      const wx = -geo.panelX + col * (geo.panelX * 2) / (COLS - 1);
      const wy = geo.panelY - row * (geo.panelY * 2) / (ROWS - 1);
      const { fx, fy } = worldToPad(geo, wx, wy);
      out[i] = [fx * CANVAS_W, fy * canvasH];
    }
    return out;
  }, [geo, canvasH]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0d0d0f';
    ctx.fillRect(0, 0, CANVAS_W, canvasH);

    if (geo.far) {
      const f = geo.linearFraction;
      const w = CANVAS_W * f;
      const h = canvasH * f;
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      ctx.strokeRect((CANVAS_W - w) / 2, (canvasH - h) / 2, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '11px sans-serif';
      ctx.fillText('far', 6, 14);
    }

    const frame = frameRef.current;
    const dot = Math.max(1.5, (CANVAS_W / COLS) * geo.panelX / geo.halfX * 0.4);
    for (let i = 0; i < ledPositions.length; i++) {
      const px = frame ? frame[i] : null;
      ctx.fillStyle = px ? `rgb(${px[0]},${px[1]},${px[2]})` : '#1a1a1f';
      ctx.beginPath();
      ctx.arc(ledPositions[i][0], ledPositions[i][1], dot, 0, Math.PI * 2);
      ctx.fill();
    }

    // Panel outline, so the margin reads as "outside the panel" rather than
    // just more pad.
    const tl = worldToPad(geo, -geo.panelX, geo.panelY);
    const br = worldToPad(geo, geo.panelX, -geo.panelY);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      tl.fx * CANVAS_W, tl.fy * canvasH,
      (br.fx - tl.fx) * CANVAS_W, (br.fy - tl.fy) * canvasH,
    );
  }

  useEffect(() => {
    if (!subscribe) { draw(); return undefined; }
    return subscribe((frame) => { frameRef.current = frame; draw(); });
  }, [subscribe, geo, canvasH]);

  useEffect(draw, [geo, canvasH]);

  function apply(e) {
    const rect = padRef.current.getBoundingClientRect();
    const world = padToWorld(
      geo,
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
    );
    onChange(world.x, world.y);
  }

  function handlePointerDown(e) {
    draggingRef.current = true;
    padRef.current.setPointerCapture(e.pointerId);
    apply(e);
  }

  const raw = worldToPad(geo, x, y);
  const handle = clampHandle(raw.fx, raw.fy);
  const far = isFarField(geo, x, y);

  // One LED of travel inside the linear zone.
  const stepX = (geo.linearX * 2) / (COLS - 1);
  const stepY = (geo.linearY * 2) / (ROWS - 1);

  return (
    <div className="control-row control-row--pad">
      <label className="control-label">{entry.label}</label>
      <div className="xy-pad-wrap">
        <div
          ref={padRef}
          className="xy-pad"
          style={{ aspectRatio: `${geo.aspect}` }}
          onPointerDown={handlePointerDown}
          onPointerMove={(e) => { if (draggingRef.current) apply(e); }}
          onPointerUp={() => { draggingRef.current = false; if (onCommit) onCommit(); }}
          role="slider"
          aria-label={entry.label}
          aria-valuetext={`x ${x.toFixed(2)}, y ${y.toFixed(2)}`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') onChange(x - stepX, y);
            else if (e.key === 'ArrowRight') onChange(x + stepX, y);
            else if (e.key === 'ArrowUp') onChange(x, y + stepY);
            else if (e.key === 'ArrowDown') onChange(x, y - stepY);
            else return;
            e.preventDefault();
            if (onCommit) onCommit();
          }}
        >
          <canvas ref={canvasRef} width={CANVAS_W} height={canvasH} className="xy-pad-canvas" />
          <div
            className={`xy-pad-handle${handle.clamped ? ' xy-pad-handle--clamped' : ''}`}
            style={{
              left: `${handle.fx * 100}%`,
              top: `${handle.fy * 100}%`,
              background: color || 'var(--accent)',
            }}
          />
        </div>
        <div className="xy-pad-fields">
          <span className="control-value control-value--left">x</span>
          <NumField value={x} label={`${entry.label} x`} width={56}
            onChange={(v) => onChange(v, y)} onCommit={onCommit} />
          <span className="control-value control-value--left">y</span>
          <NumField value={y} label={`${entry.label} y`} width={56}
            onChange={(v) => onChange(x, v)} onCommit={onCommit} />
          {far && (
            <span className="xy-pad-note">
              {/* The source's bearing, not the direction of travel — the wave
                  moves the other way. Said explicitly so this cannot be read
                  as the same quantity the Plane Wave dial shows. */}
              planar · from {Math.round(directionDegrees(x, y))}°
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
