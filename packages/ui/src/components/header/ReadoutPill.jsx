import React, { useId } from 'react';

/*
 * The header's clickable readout: a headline value coloured by `state`, an
 * optional grey detail, folded to a dim label when `state` is 'off'. The two
 * pills differ in what they describe (lib/frameRate, lib/power, both
 * returning {state, label, detail, title}) and in what their toggle does, not
 * in how they draw — so the drawing, and its CSS, is this one component.
 *
 * `kind` adds a `readout--<kind>` class for the one rule that is a pill's own
 * (the power pill's limiting border); the state colours are shared.
 *
 * `title` is drawn as our own tooltip, not the native attribute (#127). Both
 * pills re-describe themselves on every 1s poll and the figures in the text
 * genuinely change each time, so there is no "only when it changed" to
 * memoise on — and a browser treats a new `title` as a new tooltip: Chrome on
 * Windows dismisses and re-shows it, Safari ignores the change and shows the
 * stale text. A span React re-renders just updates in place under the
 * pointer, which makes the tooltip a live readout rather than a snapshot.
 * Shown by CSS on hover and keyboard focus; aria-describedby gives a screen
 * reader what the title attribute used to.
 */
export default function ReadoutPill({
  kind, state, label, detail, title, pressed, ariaLabel, onClick, children,
}) {
  const tipId = useId();
  return (
    <span className="readout-wrap">
      <button
        type="button"
        className={`readout readout--${kind} readout--${state}`}
        onClick={onClick}
        aria-pressed={pressed}
        aria-label={ariaLabel}
        aria-describedby={title ? tipId : undefined}
      >
        <span className="readout-value">{label}</span>
        {detail && <span className="readout-detail">{detail}</span>}
        {children}
      </button>
      {title && <span id={tipId} role="tooltip" className="readout-tip">{title}</span>}
    </span>
  );
}
