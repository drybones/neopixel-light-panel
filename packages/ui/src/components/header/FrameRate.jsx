import React from 'react';
import { useStore } from '../../state/store';
import { describeFrameRate } from '../../lib/frameRate';
import ReadoutPill from './ReadoutPill';
import useVisiblePoll from './useVisiblePoll';

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
  useVisiblePoll(pollFps, enabled, POLL_MS);

  const readout = describeFrameRate(fps, isVirtual);

  return (
    <ReadoutPill
      kind="frame-rate"
      {...readout}
      pressed={enabled}
      ariaLabel={enabled ? `Frame rate ${readout.label}. Click to hide.` : 'Show frame rate'}
      onClick={() => setFpsEnabled(!enabled)}
    >
      {enabled && isVirtual && <span className="readout-mode">dev</span>}
    </ReadoutPill>
  );
}
