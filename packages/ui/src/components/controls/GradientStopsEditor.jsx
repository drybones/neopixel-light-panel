import React, { useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import DraftField from './DraftField';
import { formatHex, parseHex } from '../../lib/colors';

// Width of the floating picker, kept in step with .gradient-popover so the
// clamp below can keep it inside the strip instead of hanging off the panel.
const POPOVER_WIDTH = 216;

// Half a pin. A drag has to travel this far before it counts as one rather than
// as a click, and a click this close to a pin is taken as aimed at the pin
// rather than as a new stop — which is also what stops a double-click, an
// ingrained habit from when that was the gesture, landing two stops at once.
const PIN_RADIUS = 8;

// Gradient stop strip: the strip previews the gradient; stops are pins you drag
// along it. Click the strip to add a stop; click a pin to open its picker under
// the pin, and click away to dismiss it, as with ColorControl. The two end
// colours sit under the strip as hex fields, pinned to its ends rather than
// following the pins, so they stay where you last read them however the stops
// are dragged.
export default function GradientStopsEditor({ entry, stops, onChange, onCommit }) {
  const stripRef = useRef(null);
  const [editing, setEditing] = useState(null); // stop index or null
  const draggingRef = useRef(null);
  // A drag ends in a click on the pin it started from, so the picker would open
  // every time you moved a stop. These remember whether the pointer actually
  // travelled, and the click is spent on the drag when it did.
  const startXRef = useRef(0);
  const draggedRef = useRef(false);

  // Indices in stop order, so the ends can be addressed without losing track of
  // where each stop lives in the unsorted array the params hold.
  const order = stops.map((_, i) => i).sort((a, b) => stops[a].position - stops[b].position);
  const sorted = order.map((i) => stops[i]);
  const css = `linear-gradient(90deg, ${sorted.map((s) => `${s.color} ${s.position * 100}%`).join(', ')})`;
  const firstIndex = order[0];
  const lastIndex = order[order.length - 1];
  const removable = stops.length > (entry.minStops || 2);

  function setStop(index, patch) {
    onChange(stops.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function positionFromEvent(e) {
    const rect = stripRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }

  function handleStripClick(e) {
    // A pin stops its own click, so anything arriving here hit the bare strip.
    const rect = stripRef.current.getBoundingClientRect();
    const position = positionFromEvent(e);
    if (stops.some((s) => Math.abs(s.position - position) * rect.width < PIN_RADIUS)) return;
    // Sample a colour midway: reuse the nearest stop's colour
    const nearest = sorted.reduce((a, b) => (Math.abs(b.position - position) < Math.abs(a.position - position) ? b : a));
    onChange([...stops, { position, color: nearest.color }]);
    if (onCommit) onCommit();
  }

  function handlePinPointerDown(e, index) {
    e.stopPropagation();
    draggingRef.current = index;
    startXRef.current = e.clientX;
    draggedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePinPointerMove(e) {
    if (draggingRef.current === null) return;
    // Below the slop this is still a click, and a click must not nudge the stop.
    if (!draggedRef.current && Math.abs(e.clientX - startXRef.current) < PIN_RADIUS) return;
    draggedRef.current = true;
    setStop(draggingRef.current, { position: positionFromEvent(e) });
  }

  function handlePinPointerUp() {
    if (draggingRef.current === null) return;
    draggingRef.current = null;
    if (draggedRef.current && onCommit) onCommit();
  }

  function handlePinClick(index) {
    if (draggedRef.current) return; // the pointer was moving the stop, not choosing it
    setEditing(editing === index ? null : index);
  }

  function closeEditor() {
    setEditing(null);
    if (onCommit) onCommit();
  }

  function removeStop(index) {
    if (!removable) return;
    setEditing(null);
    onChange(stops.filter((_, i) => i !== index));
    if (onCommit) onCommit();
  }

  function endField(index, name) {
    return (
      <DraftField
        value={stops[index].color}
        label={`${entry.label} ${name} hex`}
        format={formatHex}
        parse={parseHex}
        onChange={(hex) => setStop(index, { color: hex })}
        onCommit={onCommit}
        width={70}
      />
    );
  }

  return (
    <div className="control-row control-row--stops">
      <label className="control-label">{entry.label}</label>
      <div className="gradient-editor">
        <div
          ref={stripRef}
          className="gradient-strip"
          style={{ background: css }}
          onClick={handleStripClick}
          title="Click to add a stop"
        >
          {stops.map((stop, i) => (
            <button
              key={i}
              className={`gradient-pin${editing === i ? ' gradient-pin--on' : ''}`}
              style={{ left: `${stop.position * 100}%`, background: stop.color }}
              onPointerDown={(e) => handlePinPointerDown(e, i)}
              onPointerMove={handlePinPointerMove}
              onPointerUp={handlePinPointerUp}
              onClick={(e) => { e.stopPropagation(); handlePinClick(i); }}
              aria-label={`Colour stop at ${Math.round(stop.position * 100)}%`}
            />
          ))}
        </div>
        <div className="gradient-ends">
          {endField(firstIndex, 'start')}
          {lastIndex !== firstIndex && endField(lastIndex, 'end')}
        </div>
        {editing !== null && stops[editing] && (
          <>
            {/* Same dismissal as ColorControl: click anywhere off the picker to
                put it away. The strip sits above the backdrop, so moving to
                another pin is one click rather than two. The picker hangs below
                the end colours rather than the strip, so opening it never hides
                the two values it is there to change. */}
            <div className="color-popover-backdrop" onClick={closeEditor} />
            <div
              className="gradient-popover"
              style={{
                left: `clamp(0px, calc(${stops[editing].position * 100}% - ${POPOVER_WIDTH / 2}px), calc(100% - ${POPOVER_WIDTH}px))`,
              }}
            >
              <HexColorPicker
                color={stops[editing].color}
                onChange={(hex) => setStop(editing, { color: hex })}
              />
              <div className="gradient-popover-actions">
                <DraftField
                  value={stops[editing].color}
                  label={`Stop ${editing + 1} hex`}
                  format={formatHex}
                  parse={parseHex}
                  onChange={(hex) => setStop(editing, { color: hex })}
                  onCommit={onCommit}
                  width={70}
                />
                {removable && (
                  <button className="btn btn-ghost btn-danger" onClick={() => removeStop(editing)}>Remove stop</button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
