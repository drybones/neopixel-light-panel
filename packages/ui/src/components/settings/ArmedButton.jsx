import React, { useState } from 'react';

/*
 * A button that asks twice. The first click swaps the label for `armedLabel`
 * and fills the button red; the second calls `onConfirm`. Blur and Escape
 * disarm, so a mis-click never sits waiting to be confirmed by whatever gets
 * pressed next.
 *
 * Deliberately not window.confirm: a native dialog is unstyleable, reads as a
 * browser error rather than part of the app, and on iOS from the Home Screen
 * it throws a modal sheet over everything for a decision that belongs on the
 * control itself. The editor's delete-scene button has worked this way since
 * it was written; this is that pattern lifted out, now that the scene library
 * has three more controls that can destroy something.
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
