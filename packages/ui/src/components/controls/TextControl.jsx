import React from 'react';

// The one control whose value is a string. Every other control in here edits a
// number or a colour, so nothing existing could be reused.
//
// It is *not* a DraftField. A draft field holds an edit back until it parses and
// abandons it if it doesn't — right for a hex or a number, wrong for prose,
// where every intermediate state is valid and the panel should show what you are
// typing as you type it. So this writes through on each keystroke: the store's
// optimistic update means the input keeps showing the character just typed, its
// 80ms trailing throttle coalesces a burst of them into one PUT, and the effect
// re-renders the line only when the resolved string actually changes.
//
// `onCommit` fires on blur and on Enter, not per keystroke: it flushes the
// throttle *and* re-renders the scene's filmstrip, which is far too expensive to
// do once a letter.
export default function TextControl({ entry, value, onChange, onCommit }) {
  function keyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  }

  return (
    <div className="control-row control-row--text">
      <label className="control-label">{entry.label}</label>
      <div className="text-control">
        <input
          type="text"
          className="text-control-input"
          // The visible label is a sibling, not a wrapper, so it needs saying
          // again here — as NumberControl does. Without it the accessible name
          // falls back to the value, and a screen reader announces the line of
          // text as the name of the field that holds it.
          aria-label={entry.label}
          value={value === undefined || value === null ? '' : value}
          maxLength={entry.maxLength}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={keyDown}
        />
        {entry.hint && <span className="text-control-hint">{entry.hint}</span>}
      </div>
    </div>
  );
}
