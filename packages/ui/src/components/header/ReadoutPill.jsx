import React from 'react';

/*
 * The header's clickable readout: a headline value coloured by `state`, an
 * optional grey detail, folded to a dim label when `state` is 'off'. The two
 * pills differ in what they describe (lib/frameRate, lib/power, both
 * returning {state, label, detail, title}) and in what their toggle does, not
 * in how they draw — so the drawing, and its CSS, is this one component.
 *
 * `kind` adds a `readout--<kind>` class for the one rule that is a pill's own
 * (the power pill's limiting border); the state colours are shared.
 */
export default function ReadoutPill({
  kind, state, label, detail, title, pressed, ariaLabel, onClick, children,
}) {
  return (
    <button
      type="button"
      className={`readout readout--${kind} readout--${state}`}
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      title={title}
    >
      <span className="readout-value">{label}</span>
      {detail && <span className="readout-detail">{detail}</span>}
      {children}
    </button>
  );
}
