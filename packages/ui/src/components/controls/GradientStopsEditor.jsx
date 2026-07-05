import React, { useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';

// Gradient stop strip: the strip previews the gradient; stops are pins you
// drag along it. Click a pin to edit its colour; double-click the strip to
// add a stop; a pin's × removes it (min 2 stops).
export default function GradientStopsEditor({ entry, stops, onChange, onCommit }) {
  const stripRef = useRef(null);
  const [editing, setEditing] = useState(null); // stop index or null
  const draggingRef = useRef(null);

  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const css = `linear-gradient(90deg, ${sorted.map((s) => `${s.color} ${s.position * 100}%`).join(', ')})`;

  function setStop(index, patch) {
    onChange(stops.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function positionFromEvent(e) {
    const rect = stripRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }

  function handleStripDoubleClick(e) {
    const position = positionFromEvent(e);
    // Sample a colour midway: reuse the nearest stop's colour
    const nearest = sorted.reduce((a, b) => (Math.abs(b.position - position) < Math.abs(a.position - position) ? b : a));
    onChange([...stops, { position, color: nearest.color }]);
    if (onCommit) onCommit();
  }

  function handlePinPointerDown(e, index) {
    e.stopPropagation();
    draggingRef.current = index;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePinPointerMove(e) {
    if (draggingRef.current === null) return;
    setStop(draggingRef.current, { position: positionFromEvent(e) });
  }

  function handlePinPointerUp() {
    if (draggingRef.current === null) return;
    draggingRef.current = null;
    if (onCommit) onCommit();
  }

  function removeStop(index) {
    if (stops.length <= (entry.minStops || 2)) return;
    setEditing(null);
    onChange(stops.filter((_, i) => i !== index));
    if (onCommit) onCommit();
  }

  return (
    <div className="control-row control-row--stops">
      <label className="control-label">{entry.label}</label>
      <div className="gradient-editor">
        <div
          ref={stripRef}
          className="gradient-strip"
          style={{ background: css }}
          onDoubleClick={handleStripDoubleClick}
          title="Double-click to add a stop"
        >
          {stops.map((stop, i) => (
            <button
              key={i}
              className={`gradient-pin${editing === i ? ' gradient-pin--on' : ''}`}
              style={{ left: `${stop.position * 100}%`, background: stop.color }}
              onPointerDown={(e) => handlePinPointerDown(e, i)}
              onPointerMove={handlePinPointerMove}
              onPointerUp={handlePinPointerUp}
              onClick={() => setEditing(editing === i ? null : i)}
              aria-label={`Colour stop at ${Math.round(stop.position * 100)}%`}
            />
          ))}
        </div>
        {editing !== null && stops[editing] && (
          <div className="gradient-stop-editor">
            <HexColorPicker
              color={stops[editing].color}
              onChange={(hex) => setStop(editing, { color: hex })}
            />
            <div className="gradient-stop-actions">
              <button className="btn btn-ghost" onClick={() => { setEditing(null); if (onCommit) onCommit(); }}>Done</button>
              {stops.length > (entry.minStops || 2) && (
                <button className="btn btn-ghost btn-danger" onClick={() => removeStop(editing)}>Remove stop</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
