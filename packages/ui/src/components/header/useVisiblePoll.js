import { useEffect } from 'react';

/*
 * Calls `poll` now and every `ms` while `enabled` and the tab is visible.
 *
 * A background tab's readout is worth nothing and the requests still cost
 * the Pi, so polling pauses while hidden — but fires the moment the tab comes
 * back, or the first thing shown is a frozen number from whenever it was last
 * looked at. Both header pills poll this way; it was one effect copied twice.
 *
 * Note the Browser pane reports `document.hidden` permanently, so a readout
 * there looks frozen when it is fine in a real browser.
 */
export default function useVisiblePoll(poll, enabled, ms) {
  useEffect(() => {
    if (!enabled) return undefined;
    const tick = () => { if (!document.hidden) poll(); };
    tick();
    const id = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [poll, enabled, ms]);
}
