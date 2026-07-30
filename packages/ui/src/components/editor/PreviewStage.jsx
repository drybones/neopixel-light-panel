import React, { useRef } from 'react';
import LedCanvas from '../preview/LedCanvas';
import { subscribeComposite } from '../../api/lightStream';
import { clampHandle } from '../../lib/xyPad';

// Big live preview with direct manipulation: draggable handles are
// overlaid for every draggable `xy` schema entry of the selected layer,
// so you grab the effect on the actual output.
//
// Unlike XYPad this is a picture of the panel itself, so it gets no margin —
// the mapping is straight from xRange/yRange. A source outside those bounds
// has its handle pinned to the edge instead of rendering outside the clipped
// stage, where it used to be both invisible and impossible to grab back.
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
        const px = layer.params[entry.xKey];
        const py = layer.params[entry.yKey];
        const handle = clampHandle(
          (px - xMin) / (xMax - xMin),
          (yMax - py) / (yMax - yMin),
        );
        return (
          <div
            key={i}
            className={`stage-handle${handle.clamped ? ' stage-handle--clamped' : ''}`}
            style={{
              left: `${handle.fx * 100}%`,
              top: `${handle.fy * 100}%`,
              background: layer.params.color || 'var(--accent)',
            }}
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
