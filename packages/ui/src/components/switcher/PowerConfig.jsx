import React from 'react';
import { useStore } from '../../state/store';
import DraftField from '../controls/DraftField';
import { formatAmps, formatVolts } from '../../lib/power';

// Typed entry only — these are numbers you set once from a datasheet or a
// calibration run, not values worth dragging. DraftField is reused for the
// commit-on-blur/Enter, abandon-on-Escape behaviour rather than reimplementing
// it here.
function parseNumber(text) {
  const n = Number(String(text).trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function Field({ label, value, suffix, onChange, hint }) {
  return (
    <label className="power-config-field">
      <span className="power-config-field-label">{label}</span>
      <DraftField
        value={value}
        label={label}
        format={(v) => String(v)}
        parse={parseNumber}
        onChange={onChange}
        width={64}
        inputMode="decimal"
      />
      <span className="power-config-field-suffix">{suffix}</span>
      {hint && <span className="power-config-field-hint">{hint}</span>}
    </label>
  );
}

/*
 * Power budget settings, in the switcher beside the scene library.
 *
 * The panel can ask for far more than the supply can deliver — 240 WS2812B at
 * full white is ~13.4A — and the failure is not dramatic: the rail sags and
 * the Pi browns out. The limiter's job is to make that unreachable while
 * leaving the brightness fader alone, so this is where the budget it works
 * against is set.
 *
 * The rail figures are shown read-only. They come from a measurement, not a
 * preference, and inventing them by hand would produce a limiter that is
 * confidently wrong — so the panel points at the tool that measures them
 * instead of offering a text box.
 */
export default function PowerConfig() {
  const power = useStore((s) => s.power);
  const setPowerConfig = useStore((s) => s.setPowerConfig);

  if (!power) return null;

  const calibrated = !!power.rail;

  return (
    <details className="power-config">
      <summary>Power budget</summary>

      <div className="power-config-body">
        <label className="power-config-toggle">
          <input
            type="checkbox"
            checked={!!power.limit}
            onChange={(e) => setPowerConfig({ limit: e.target.checked })}
          />
          <span>Limit frames to the budget</span>
        </label>
        <p className="power-config-note">
          Off, this still measures — the header shows the draw either way.
        </p>

        <div className="power-config-fields">
          <Field
            label="Supply rating"
            value={power.maxMilliamps / 1000}
            suffix="A"
            onChange={(v) => setPowerConfig({ maxMilliamps: v * 1000 })}
          />
          <Field
            label="Reserved"
            value={power.overheadMilliamps}
            suffix="mA"
            hint="Pi + Fadecandy on the same supply"
            onChange={(v) => setPowerConfig({ overheadMilliamps: v })}
          />
          <Field
            label="Per LED"
            value={power.ledMilliamps}
            suffix="mA"
            hint="WS2812B at full white"
            onChange={(v) => setPowerConfig({ ledMilliamps: v })}
          />
        </div>

        <dl className="power-config-summary">
          <dt>Budget</dt>
          <dd>
            {formatAmps(power.budgetMilliamps)}
            {' '}
            <span className="power-config-dim">
              ({power.boundBy === 'rail' ? 'supply sag' : 'PSU rating'})
            </span>
          </dd>
          <dt>Full white</dt>
          <dd>{formatAmps(power.maxMilliampsFullWhite)}</dd>
          <dt>Rail</dt>
          <dd>
            {calibrated ? (
              <>
                {formatVolts(power.rail.openCircuitVolts)} open circuit,
                {' '}{(power.rail.ohms * 1000).toFixed(1)} mΩ,
                {' '}floor {formatVolts(power.rail.floorVolts)}
              </>
            ) : (
              <span className="power-config-dim">
                not calibrated — run <code>tools/power-sweep.js</code> on the Pi
              </span>
            )}
          </dd>
        </dl>

        <p className="power-config-note">
          Estimated from LED datasheet figures and Fadecandy’s gamma, not measured. It is not
          guaranteed to stay within the budget.
        </p>
      </div>
    </details>
  );
}
