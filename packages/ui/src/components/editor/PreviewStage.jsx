import React, { useRef } from 'react';
import LedCanvas from '../preview/LedCanvas';
import { subscribeComposite } from '../../api/lightStream';

// Big live preview with direct manipulation: draggable handles are
// overlaid for every draggable `xy` schema entry of the selected layer,
// so you grab the effect on the actual output. Coordinate mapping matches
// XYPad (canvas x = world x, canvas y = -world y).
export default function PreviewStage({ layer, effect, onUpdateParams, onCommit }) {
  const stageRef = useRef(null);
  const dragRef = useRef(null); // active xy entry while dragging

  const xyEntries = (layer && effect)
    ? effect.schema.filter((e) => e.type === 'xy' && e.draggable)
    : [];

  function applyDrag(e, entry) {
    const rect = stageRef.current.getBoundingClientRect();
    const [xMin, xMax] = entry.xRange;
    const [yMin, yMax] = entry.yRange;
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    onUpdateParams({
      [entry.xKey]: xMin + fx * (xMax - xMin),
      [entry.yKey]: yMax - fy * (yMax - yMin),
    });
  }

  function handlePointerDown(e, entry) {
    e.preventDefault();
    dragRef.current = entry;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e) {
    if (dragRef.current) applyDrag(e, dragRef.current);
  }

  function handlePointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (onCommit) onCommit();
  }

  return (
    <div className="preview-stage" ref={stageRef}>
      <LedCanvas
        subscribe={subscribeComposite}
        width={900}
        height={240}
        style={{ width: '100%', height: '100%', borderRadius: 8 }}
      />
      {xyEntries.map((entry, i) => {
        const [xMin, xMax] = entry.xRange;
        const [yMin, yMax] = entry.yRange;
        const hx = ((layer.params[entry.xKey] - xMin) / (xMax - xMin)) * 100;
        const hy = ((yMax - layer.params[entry.yKey]) / (yMax - yMin)) * 100;
        return (
          <div
            key={i}
            className="stage-handle"
            style={{ left: `${hx}%`, top: `${hy}%`, background: layer.params.color || 'var(--accent)' }}
            onPointerDown={(e) => handlePointerDown(e, entry)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            role="slider"
            aria-label={`${entry.label} on panel`}
            aria-valuetext={`x ${layer.params[entry.xKey].toFixed(2)}, y ${layer.params[entry.yKey].toFixed(2)}`}
            title={`Drag to move ${entry.label.toLowerCase()}`}
          />
        );
      })}
    </div>
  );
}
