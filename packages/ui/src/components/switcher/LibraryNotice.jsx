import React, { useEffect } from 'react';
import { useStore } from '../../state/store';

// Long enough to read after a page change, short enough that it is gone by
// the time you come back to the switcher for an unrelated reason.
const DISMISS_MS = 8000;

/*
 * What the last whole-library action did — restore, delete-all, import.
 *
 * It lives here rather than beside the buttons because those buttons are on
 * the settings page and what they change is *this* page: the actions send you
 * here on success, so the confirmation has to be waiting when you land. The
 * switcher's own empty-state buttons set the same notice and are already
 * here, which is why the message is composed in the store and not by either
 * caller.
 *
 * It clears itself as well as offering a ×. Without the timer, going to
 * settings and back an hour later would still be told what you did then —
 * a notice that outlives the moment it describes reads as a status, and this
 * is not one.
 */
export default function LibraryNotice() {
  const message = useStore((s) => s.libraryNotice);
  const clearLibraryNotice = useStore((s) => s.clearLibraryNotice);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(clearLibraryNotice, DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, clearLibraryNotice]);

  if (!message) return null;

  return (
    <div className="library-notice" role="status">
      <span className="library-notice-text">{message}</span>
      <button
        type="button"
        className="library-notice-dismiss"
        onClick={clearLibraryNotice}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
