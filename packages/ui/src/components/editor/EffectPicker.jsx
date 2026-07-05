import React from 'react';
import { layerSwatches } from '../../lib/colors';

// Effect chooser shown when adding a layer.
export default function EffectPicker({ effects, onPick, onClose }) {
  return (
    <div className="effect-picker">
      <div className="effect-picker-backdrop" onClick={onClose} />
      <div className="effect-picker-panel" role="dialog" aria-label="Choose an effect">
        <div className="effect-picker-title">Add a layer</div>
        <div className="effect-picker-grid">
          {effects.map((effect) => (
            <button key={effect.type} className="effect-picker-item" onClick={() => onPick(effect.type)}>
              <span className="effect-picker-swatches" aria-hidden="true">
                {layerSwatches({ effectType: effect.type, params: effect.defaults }).map((c, i) => (
                  <span key={i} style={{ background: c }} />
                ))}
              </span>
              {effect.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
