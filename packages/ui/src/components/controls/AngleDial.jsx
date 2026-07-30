import React, { useEffect, useRef } from 'react';
import NumField from './NumField';

// Direction control for schema `angle` entries. The dial draws the wavefronts
// themselves — parallel lines perpendicular to the direction — which is what
// makes "the wave arrives from here" legible at a glance; a bare rotary knob
// would not say which way the stripes run.
//
// Convention matches the planewave effect: 0 degrees arrives from the right,
// 90 from the top, increasing anticlockwise on screen.
const SIZE = 128;

function normalise(deg) {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

export default function AngleDial({ entry, value, color, onChange, onCommit }) {
  const canvasRef = useRef(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const c = SIZE / 2;
    const radius = c - 8;
    const rad = (value * Math.PI) / 180;
    const dirX = Math.cos(rad);
    const dirY = -Math.sin(rad);

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#0d0d0f';
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.fill();

    // Wavefronts: perpendicular to the direction, so they show the stripes.
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.clip();
    for (let k = -4; k <= 4; k += 1) {
      const ox = dirY * k * 13;
      const oy = -dirX * k * 13;
      ctx.beginPath();
      ctx.moveTo(c + ox - dirX * radius, c + oy - dirY * radius);
      ctx.lineTo(c + ox + dirX * radius, c + oy + dirY * radius);
      ctx.strokeStyle = color || '#7aa2ff';
      ctx.globalAlpha = Math.max(0.08, 0.5 - Math.abs(k) * 0.1);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Pointer towards the source.
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + dirX * radius, c + dirY * radius);
    ctx.strokeStyle = color || '#7aa2ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c + dirX * radius, c + dirY * radius, 5, 0, Math.PI * 2);
    ctx.fillStyle = color || '#7aa2ff';
    ctx.fill();
  }, [value, color]);

  function apply(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const deg = (Math.atan2(cy - e.clientY, e.clientX - cx) * 180) / Math.PI;
    onChange(normalise(Math.round(deg)));
  }

  const step = entry.step || 1;

  return (
    <div className="control-row control-row--dial">
      <label className="control-label">{entry.label}</label>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="angle-dial"
        role="slider"
        aria-label={entry.label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuetext={`${Math.round(value)} degrees`}
        tabIndex={0}
        onPointerDown={(e) => {
          draggingRef.current = true;
          canvasRef.current.setPointerCapture(e.pointerId);
          apply(e);
        }}
        onPointerMove={(e) => { if (draggingRef.current) apply(e); }}
        onPointerUp={() => {
          draggingRef.current = false;
          if (onCommit) onCommit();
        }}
        onKeyDown={(e) => {
          const big = e.shiftKey ? 15 : step;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') onChange(normalise(value + big));
          else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') onChange(normalise(value - big));
          else return;
          e.preventDefault();
          if (onCommit) onCommit();
        }}
      />
      <div className="dial-readout">
        <NumField
          value={value}
          label={`${entry.label} in degrees`}
          width={44}
          format={(v) => String(Math.round(v))}
          onChange={(v) => onChange(normalise(v))}
          onCommit={onCommit}
        />
        <span className="control-value control-value--left">°</span>
      </div>
    </div>
  );
}
