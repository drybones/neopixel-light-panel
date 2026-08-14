import React, { useEffect } from 'react';
import { useStore } from '../../state/store';
import { describePower } from '../../lib/power';

// The server averages over a ~1s window, so polling faster only re-reads the
// same figure.
const POLL_MS = 1000;

/*
 * Header readout for what the panel is drawing, and whether frames are being
 * pulled back to fit the supply.
 *
 * Unlike the frame-rate pill this has no off switch and is always lit: the
 * measurement is unconditional on the server, and this is the only way to see
 * the limiter working at all. It cannot be seen in the previews — those
 * stream the compositor's pre-brightness composite deliberately, so they show
 * the scene as authored while only the panel dims.
 */
export default function PowerMeter() {
  const power = useStore((s) => s.power);
  const pollPower = useStore((s) => s.pollPower);

  useEffect(() => {
    // A background tab's readout is worth nothing and the requests still cost
    // the Pi, so pause while hidden — but poll the moment it comes back, or
    // the first thing shown is a frozen number from whenever it was last
    // looked at.
    const poll = () => { if (!document.hidden) pollPower(); };
    poll();
    const id = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [pollPower]);

  const { state, label, detail, title } = describePower(power);

  return (
    <span className={`power-meter power-meter--${state}`} title={title}>
      <span className="power-meter-value">{label}</span>
      {detail && <span className="power-meter-detail">{detail}</span>}
    </span>
  );
}
