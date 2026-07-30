import React, { useRef, useState } from 'react';

// Small numeric entry for the direct-manipulation controls — the pad's x/y and
// the dial's degrees. Dragging is the primary gesture; this is the escape hatch
// when you want an exact value, so it is styled to read as a label until you go
// for it (see .control-num, which follows .editor-name).
//
// While focused it holds a draft string rather than the number, so typing "-",
// "1." or clearing the field does not clobber the live value mid-keystroke and
// an incoming frame cannot overwrite what is being typed.
export default function NumField({ value, label, onChange, onCommit, format, width }) {
  const [draft, setDraft] = useState(null);
  // commit() has to read the draft synchronously: Escape clears it and blurs on
  // the same tick, and a setState is not visible to the blur handler that runs
  // next — reading through the ref is what makes Escape actually abandon the
  // edit rather than commit the value it just discarded.
  const draftRef = useRef(null);

  function updateDraft(next) {
    draftRef.current = next;
    setDraft(next);
  }

  // A drag elsewhere should still update the field — unless it is being typed
  // in, in which case the draft wins until it is committed or abandoned.
  const shown = draft !== null
    ? draft
    : (format ? format(value) : String(Math.round(value * 100) / 100));

  function commit() {
    const pending = draftRef.current;
    if (pending === null) return;
    updateDraft(null);
    const parsed = parseFloat(pending);
    if (!Number.isFinite(parsed) || parsed === value) return;
    onChange(parsed);
    // No pointer-up to piggyback on: the store throttles param writes and
    // flushes on release, so a typed edit has to ask for the flush itself.
    if (onCommit) onCommit();
  }

  return (
    <input
      className="control-num"
      type="text"
      inputMode="decimal"
      style={width ? { width } : undefined}
      value={shown}
      aria-label={label}
      onChange={(e) => updateDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commit(); e.target.blur(); }
        else if (e.key === 'Escape') { updateDraft(null); e.target.blur(); }
        // Arrow keys belong to the pad/dial behind this field, not the text box.
        else if (e.key.startsWith('Arrow')) e.stopPropagation();
      }}
    />
  );
}
