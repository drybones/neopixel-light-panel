import React, { useState } from 'react';

/*
 * A button that asks twice. The first click swaps the label for `armedLabel`
 * and fills the button red; the second calls `onConfirm`. Blur and Escape
 * disarm, so a mis-click never sits waiting to be confirmed by whatever gets
 * pressed next.
 *
 * Deliberately not window.confirm, and the reason is correctness rather than
 * taste: **a browser is free to refuse the dialog silently**, in which case
 * confirm() returns false without ever appearing and the control does nothing
 * while everything around it keeps working. Editor.handleDeleteScene carries
 * the full account — iOS from the Home Screen, Chrome's "prevent additional
 * dialogs" — and has worked this way since it was written; this is that
 * pattern lifted out, now that the scene library has three more controls that
 * can destroy something. The same hazard is why ImportScenesButton reports
 * failures in the page instead of through window.alert.
 *
 * `armedLabel` omitted means no arming — one click fires, and the button
 * loses the danger styling with it. That is not a degenerate case:
 * ImportScenesButton renders this for both its merging (harmless) and its
 * replacing (destructive) row, and the difference between the two should be
 * one prop rather than two code paths.
 */
export default function ArmedButton({
  label, armedLabel, onConfirm, className = 'btn btn-ghost', disabled,
}) {
  const [armed, setArmed] = useState(false);

  function handleClick() {
    if (armedLabel && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onConfirm();
  }

  return (
    <button
      type="button"
      className={`${className}${armedLabel ? ' btn-danger' : ''}${armed ? ' btn-danger-armed' : ''}`}
      disabled={disabled}
      onClick={handleClick}
      onBlur={() => setArmed(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') setArmed(false); }}
    >
      {armed ? armedLabel : label}
    </button>
  );
}
