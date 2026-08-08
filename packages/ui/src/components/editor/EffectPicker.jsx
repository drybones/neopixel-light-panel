import React, { useEffect } from 'react';
import { useStore } from '../../state/store';
import FilmstripCanvas from '../preview/FilmstripCanvas';

// Effect chooser shown when adding a layer.
//
// Each tile plays a cached filmstrip from GET /api/effects/previews. It
// replaced a strip of representative colours that had to be hand-picked per
// effect, and which said nothing about whether the thing moved.
//
// A tile is not the same thing as an effect. An effect that ships presets —
// emitter does, since it absorbed candy sparkler and embers — contributes one
// tile per preset, so those looks stay one click away rather than becoming
// "add an emitter, then find eight sliders". The server decides the list
// (effects.previewTargets), because it also has to render a strip for each one;
// the tile carries the effectType and params needed to create the layer, so
// this component never has to know which effects have presets.
export default function EffectPicker({ effects, onPick, onClose }) {
  const previews = useStore((s) => s.effectPreviews);
  const tiles = useStore((s) => s.effectTiles);
  const frames = useStore((s) => s.previewFrames);
  const loadEffectPreviews = useStore((s) => s.loadEffectPreviews);

  useEffect(() => { loadEffectPreviews(); }, [loadEffectPreviews]);

  // Until the previews land there are no tiles, so fall back to the effect
  // catalog — one tile each at its defaults, which is what this showed before
  // presets existed and keeps the picker from opening empty.
  const items = tiles.length > 0
    ? tiles
    : effects.map((e) => ({ id: e.type, effectType: e.type, name: e.name, params: null }));

  return (
    <div className="effect-picker">
      <div className="effect-picker-backdrop" onClick={onClose} />
      <div className="effect-picker-panel" role="dialog" aria-label="Choose an effect">
        <div className="effect-picker-title">Add a layer</div>
        <div className="effect-picker-grid">
          {items.map((tile) => (
            <button
              key={tile.id}
              className="effect-picker-item"
              onClick={() => onPick(tile.effectType, tile.params)}
            >
              <span className="effect-picker-preview" aria-hidden="true">
                <FilmstripCanvas
                  strip={previews[tile.id]}
                  frames={frames}
                  // The id feeds phaseFor(), so eight emitter tiles get eight
                  // different places in the loop rather than all reaching the
                  // seam on the same tick.
                  id={tile.id}
                  width={300}
                  height={80}
                  style={{ width: '100%', height: '100%', borderRadius: 4 }}
                />
              </span>
              {tile.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
