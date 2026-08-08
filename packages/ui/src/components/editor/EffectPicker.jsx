import React, { useEffect } from 'react';
import { useStore } from '../../state/store';
import FilmstripCanvas from '../preview/FilmstripCanvas';

// Effect chooser shown when adding a layer.
//
// Each tile plays the effect rendered at its own defaults — the same cached
// filmstrips the scene cards use, from GET /api/effects/previews. It replaced a
// strip of representative colours that had to be hand-picked per effect, and
// which said nothing about whether the thing moved.
//
// One tile per effect, never one per preset: an effect's presets are starting
// points offered inside its layer editor, so this stays a list of the things
// you can add rather than a list of looks.
export default function EffectPicker({ effects, onPick, onClose }) {
  const previews = useStore((s) => s.effectPreviews);
  const frames = useStore((s) => s.previewFrames);
  const loadEffectPreviews = useStore((s) => s.loadEffectPreviews);

  useEffect(() => { loadEffectPreviews(); }, [loadEffectPreviews]);

  return (
    <div className="effect-picker">
      <div className="effect-picker-backdrop" onClick={onClose} />
      <div className="effect-picker-panel" role="dialog" aria-label="Choose an effect">
        <div className="effect-picker-title">Add a layer</div>
        <div className="effect-picker-grid">
          {effects.map((effect) => (
            <button key={effect.type} className="effect-picker-item" onClick={() => onPick(effect.type)}>
              <span className="effect-picker-preview" aria-hidden="true">
                <FilmstripCanvas
                  strip={previews[effect.type]}
                  frames={frames}
                  id={effect.type}
                  width={300}
                  height={80}
                  style={{ width: '100%', height: '100%', borderRadius: 4 }}
                />
              </span>
              {effect.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
