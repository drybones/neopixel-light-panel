import React from 'react';
import { layerSwatches } from '../../lib/colors';

// Layer list, topmost layer first (Photoshop-style; the scene stores
// layers bottom-first). Each row: swatch/thumbnail, effect name, blend +
// opacity summary, visibility eye and solo toggle.
export function LayerRow({ layer, effectName, selected, soloActive, onSelect, onToggleEnabled, onToggleSolo, thumbnail }) {
  const dimmed = soloActive ? !layer.solo : !layer.enabled;
  return (
    <div
      className={`layer-row${selected ? ' layer-row--selected' : ''}${dimmed ? ' layer-row--dimmed' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
    >
      <div className="layer-row-thumb">
        {thumbnail || (
          <div className="layer-row-swatches">
            {layerSwatches(layer).map((c, i) => <span key={i} style={{ background: c }} />)}
          </div>
        )}
      </div>
      <div className="layer-row-main">
        <div className="layer-row-name">{effectName}</div>
        <div className="layer-row-meta">{layer.blendMode} · {Math.round(layer.opacity * 100)}%</div>
      </div>
      <button
        className="icon-btn"
        onClick={(e) => { e.stopPropagation(); onToggleEnabled(); }}
        aria-label={layer.enabled ? 'Hide layer' : 'Show layer'}
        title={layer.enabled ? 'Hide layer' : 'Show layer'}
      >
        {layer.enabled ? '👁' : '–'}
      </button>
      <button
        className={`icon-btn icon-btn-solo${layer.solo ? ' icon-btn-solo--on' : ''}`}
        onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
        aria-label="Solo layer"
        title="Solo layer"
      >
        S
      </button>
    </div>
  );
}

export default function LayerStack({ scene, effects, selectedLayerId, onSelect, onUpdateLayer, onMoveLayer, onAddClick, layerThumbnail }) {
  const soloActive = scene.layers.some((l) => l.solo && l.enabled);
  const topFirst = [...scene.layers].reverse();

  function effectName(layer) {
    const effect = effects.find((e) => e.type === layer.effectType);
    return effect ? effect.name : layer.effectType;
  }

  return (
    <div className="layer-stack">
      <div className="layer-stack-header">
        <span>Layers</span>
        <div className="layer-stack-header-actions">
          <button
            className="icon-btn"
            onClick={() => onMoveLayer(selectedLayerId, +1)}
            disabled={!selectedLayerId}
            aria-label="Move layer up"
            title="Move layer up"
          >↑</button>
          <button
            className="icon-btn"
            onClick={() => onMoveLayer(selectedLayerId, -1)}
            disabled={!selectedLayerId}
            aria-label="Move layer down"
            title="Move layer down"
          >↓</button>
        </div>
      </div>
      {topFirst.map((layer) => (
        <LayerRow
          key={layer.id}
          layer={layer}
          effectName={effectName(layer)}
          selected={layer.id === selectedLayerId}
          soloActive={soloActive}
          onSelect={() => onSelect(layer.id)}
          onToggleEnabled={() => onUpdateLayer({ ...layer, enabled: !layer.enabled }, true)}
          onToggleSolo={() => onUpdateLayer({ ...layer, solo: !layer.solo }, true)}
          thumbnail={layerThumbnail ? layerThumbnail(layer) : null}
        />
      ))}
      <button className="btn layer-stack-add" onClick={onAddClick}>+ Add layer</button>
    </div>
  );
}
