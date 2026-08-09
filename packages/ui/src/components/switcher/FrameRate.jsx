import React, { useEffect } from 'react';
import { useStore } from '../../state/store';
import { describeFrameRate } from '../../lib/frameRate';

// The server's rolling window is ~1s, so polling faster only re-reads the
// same average. Polling is deliberately plain HTTP rather than a new channel
// on the pixel WebSocket: one request a second, only while the tracker is on.
const POLL_MS = 1000;

/*
 * Header readout for the render loop's actual frame rate. Sits next to the
 * connection dot on both views — the switcher is where you turn it on, but a
 * heavy scene is usually being edited when you want to watch it.
 *
 * Off by default and dim when off, since this is a diagnostic: the point is
 * that it costs nothing and says nothing until asked for.
 */
export default function FrameRate() {
  const fps = useStore((s) => s.fps);
  const isVirtual = useStore((s) => s.isVirtual);
  const setFpsEnabled = useStore((s) => s.setFpsEnabled);
  const pollFps = useStore((s) => s.pollFps);

  const enabled = !!(fps && fps.enabled);

  useEffect(() => {
    if (!enabled) return undefined;
    // A background tab's readout is worth nothing and the requests still
    // cost the Pi, so pause while hidden — but poll the moment it comes
    // back, or the first thing the user sees is a frozen number from
    // however long ago they last looked.
    const poll = () => { if (!document.hidden) pollFps(); };
    poll();
    const id = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [enabled, pollFps]);

  const { state, label, detail, title } = describeFrameRate(fps, isVirtual);

  return (
    <button
      type="button"
      className={`frame-rate frame-rate--${state}`}
      onClick={() => setFpsEnabled(!enabled)}
      aria-pressed={enabled}
      aria-label={enabled ? `Frame rate ${label}. Click to hide.` : 'Show frame rate'}
      title={title}
    >
      <span className="frame-rate-value">{label}</span>
      {detail && <span className="frame-rate-detail">{detail}</span>}
      {enabled && isVirtual && <span className="frame-rate-mode">dev</span>}
    </button>
  );
}
