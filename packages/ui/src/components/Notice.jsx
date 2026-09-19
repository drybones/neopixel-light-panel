import React, { useEffect } from 'react';

/*
 * A one-line message above the current view, with a × and a timer.
 *
 * Shared by the two things the store has to say after the fact: what a
 * whole-library action did (LibraryNotice) and that a write didn't land
 * (WriteError). Both are transient on purpose — a notice that outlives the
 * moment it describes reads as a status, and neither is one — so the timer
 * lives here rather than being left to each caller to remember.
 *
 * `onDismiss` must clear the message in the store, not just hide it here, or
 * the next render of the parent brings it straight back.
 */
export default function Notice({
  message, onDismiss, dismissMs, className = '', role = 'status',
}) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(onDismiss, dismissMs);
    return () => clearTimeout(timer);
  }, [message, onDismiss, dismissMs]);

  if (!message) return null;

  return (
    <div className={`notice ${className}`} role={role}>
      <span className="notice-text">{message}</span>
      <button
        type="button"
        className="notice-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
