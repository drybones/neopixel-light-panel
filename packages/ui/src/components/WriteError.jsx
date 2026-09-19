import React from 'react';
import { useStore } from '../state/store';
import Notice from './Notice';

// Longer than the library notice: this one arrives unasked, in the middle of
// doing something else, and has to survive a glance away from the screen.
const DISMISS_MS = 10000;

/*
 * A write the server refused or never answered.
 *
 * Every edit here is optimistic, so without this a failed one is invisible —
 * the control shows the value you set, and only a reload reveals that the
 * panel never got it. The store has already taken the server's view back by
 * the time this renders (see reconcile), so the message is the whole of what
 * is left to do. Above the routed view rather than inside one, because the
 * write that failed may belong to a screen you have already left: a refused
 * delete lands after the editor has closed.
 */
export default function WriteError() {
  const message = useStore((s) => s.writeError);
  const clearWriteError = useStore((s) => s.clearWriteError);
  return (
    <Notice
      message={message}
      onDismiss={clearWriteError}
      dismissMs={DISMISS_MS}
      className="notice--error"
      role="alert"
    />
  );
}
