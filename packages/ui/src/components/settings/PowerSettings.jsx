import React from 'react';
import { useStore } from '../../state/store';
import DraftField from '../controls/DraftField';
import { formatAmps, formatVolts } from '../../lib/power';
import SettingsSection, { SettingsRow } from './SettingsSection';

// Typed entry only — these are numbers set once from a datasheet or a
// calibration run, not values worth dragging. DraftField is reused for the
// commit-on-blur/Enter, abandon-on-Escape behaviour rather than
// reimplementing it here.
function parseNumber(text) {
  const n = Number(String(text).trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function NumberEntry({ label, value, suffix, onChange }) {
  return (
    <>
      <DraftField
        value={value}
        label={label}
        format={(v) => String(v)}
        parse={parseNumber}
        onChange={onChange}
        width={64}
        inputMode="decimal"
      />
      <span className="settings-unit">{suffix}</span>
    </>
  );
}

/*
 * The power budget the limiter works against.
 *
 * The panel can ask for far more than the supply can deliver — 240 WS2812B at
 * full white is ~13.4 A — and the failure is not dramatic: the rail sags and
 * a Pi on the same supply browns out. The limiter makes that unreachable
 * while leaving the brightness fader alone.
 *
 * The rail figures are read-only. They come from a measurement, not a
 * preference, and a hand-typed R_eff would produce a limiter that is
 * confidently wrong — so this points at the tool that measures them instead
 * of offering a text box.
 */
export default function PowerSettings() {
  const power = useStore((s) => s.power);
  const setPowerConfig = useStore((s) => s.setPowerConfig);

  if (!power) return null;

  const calibrated = !!power.rail;

  return (
    <SettingsSection
      title="Power budget"
      description="Estimated from LED datasheet figures and Fadecandy’s gamma curve, not measured — so it is not guaranteed to stay within the budget."
    >
      <SettingsRow
        interactive
        label="Limit frames to the budget"
        hint="Switched off, the draw is still measured and shown in the header."
        control={(
          <input
            type="checkbox"
            checked={!!power.limit}
            onChange={(e) => setPowerConfig({ limit: e.target.checked })}
          />
        )}
      />
      <SettingsRow
        interactive
        label="Supply rating"
        control={(
          <NumberEntry
            label="Supply rating"
            value={power.maxMilliamps / 1000}
            suffix="A"
            onChange={(v) => setPowerConfig({ maxMilliamps: v * 1000 })}
          />
        )}
      />
      <SettingsRow
        interactive
        label="Reserved"
        hint="For everything else on the supply — the Pi and the Fadecandy board."
        control={(
          <NumberEntry
            label="Reserved"
            value={power.overheadMilliamps}
            suffix="mA"
            onChange={(v) => setPowerConfig({ overheadMilliamps: v })}
          />
        )}
      />
      <SettingsRow
        interactive
        label="Current per LED"
        hint="WS2812B at full white."
        control={(
          <NumberEntry
            label="Current per LED"
            value={power.ledMilliamps}
            suffix="mA"
            onChange={(v) => setPowerConfig({ ledMilliamps: v })}
          />
        )}
      />

      <SettingsRow
        label="Budget"
        hint={power.boundBy === 'rail'
          ? 'Bound by supply sag, not by the PSU’s rating.'
          : 'Bound by the PSU’s rating, less what is reserved.'}
        control={<span className="settings-value">{formatAmps(power.budgetMilliamps)}</span>}
      />
      <SettingsRow
        label="Full white"
        hint="What the panel would ask for with every LED at maximum."
        control={<span className="settings-value">{formatAmps(power.maxMilliampsFullWhite)}</span>}
      />
      <SettingsRow
        label="Supply rail"
        hint={calibrated
          ? 'Measured by tools/power-sweep.js on the Pi.'
          : 'Run tools/power-sweep.js on the Pi to measure it. Until then only the PSU rating applies.'}
        control={calibrated ? (
          <span className="settings-value">
            {formatVolts(power.rail.openCircuitVolts)} · {(power.rail.ohms * 1000).toFixed(1)} mΩ
            {' '}· floor {formatVolts(power.rail.floorVolts)}
          </span>
        ) : (
          <span className="settings-value settings-value--dim">not calibrated</span>
        )}
      />
    </SettingsSection>
  );
}
