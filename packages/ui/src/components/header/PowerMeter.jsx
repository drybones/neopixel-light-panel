import React, { useState } from 'react';
import { useStore } from '../../state/store';
import { describePower } from '../../lib/power';
import ReadoutPill from './ReadoutPill';
import useVisiblePoll from './useVisiblePoll';

// The server averages over a ~1s window, so polling faster only re-reads the
// same figure.
const POLL_MS = 1000;

// Whether the pill is expanded. The frame-rate pill's toggle rides on the
// server setting it turns on and off; this one has no server state to ride
// on — the measurement is unconditional — so it is a per-device display
// preference and lives here. localStorage can throw outright in a locked-down
// browser, and a header pill is not worth a blank page.
const SHOWN_KEY = 'lightpanel.powerMeter.shown';

function readShown() {
  try {
    return window.localStorage.getItem(SHOWN_KEY) !== '0';
  } catch (e) {
    return true;
  }
}

function writeShown(shown) {
  try {
    window.localStorage.setItem(SHOWN_KEY, shown ? '1' : '0');
  } catch (e) { /* private mode, quota, a blocked origin — not worth reporting */ }
}

/*
 * Header readout for what the panel is drawing, and whether frames are being
 * pulled back to fit the supply.
 *
 * Click to fold it away, like the frame-rate pill — but only the display
 * folds. That toggle turns the server's tracker off because the
 * instrumentation sits inside the 10ms tick and costs something; power is
 * measured unconditionally and the limiter runs whatever this says, so
 * nothing here reaches PUT /api/power. Collapsed, the pill stops polling,
 * since it has nothing left to show.
 *
 * What that gives up: this is the only place the limiter is visible at all —
 * the previews stream the compositor's pre-brightness composite deliberately,
 * so a limited panel and an unlimited one look identical in the UI. Folding
 * it away therefore hides "the panel is being pulled back" too, and that is
 * accepted rather than worked around (see lib/power.js).
 */
export default function PowerMeter() {
  const power = useStore((s) => s.power);
  const pollPower = useStore((s) => s.pollPower);
  const [shown, setShown] = useState(readShown);
  useVisiblePoll(pollPower, shown, POLL_MS);

  const readout = describePower(power, shown);

  const toggle = () => {
    const next = !shown;
    setShown(next);
    writeShown(next);
  };

  return (
    <ReadoutPill
      kind="power"
      {...readout}
      pressed={shown}
      ariaLabel={shown ? `Panel drawing ${readout.label}. Click to hide.` : 'Show power draw'}
      onClick={toggle}
    />
  );
}
