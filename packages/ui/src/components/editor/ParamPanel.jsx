import React, { useCallback } from 'react';
import NumberControl from '../controls/NumberControl';
import RangeControl from '../controls/RangeControl';
import EnumSelect from '../controls/EnumSelect';
import ColorControl from '../controls/ColorControl';
import XYPad from '../controls/XYPad';
import GradientStopsEditor from '../controls/GradientStopsEditor';
import { subscribeComposite, subscribeLayer } from '../../api/lightStream';

const BLEND_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'add', label: 'Add' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
];

// Schema-driven editor for the selected layer. Every effect gets blend +
// opacity; the rest of the controls come from the effect's schema, so new
// server-side effects get a UI for free.
export default function ParamPanel({ layer, effect, onUpdate, onCommit, onDelete, onDuplicate }) {
  const layerId = layer ? layer.id : null;
  // The XY pad's background is the selected layer's own live render (WS
  // v2); falls back to the composite until a layer frame arrives.
  const subscribeSelectedLayer = useCallback((cb) => {
    if (!layerId) return subscribeComposite(cb);
    const unsubComposite = subscribeComposite(cb);
    let gotLayerFrame = false;
    const unsubLayer = subscribeLayer(layerId, (frame) => {
      if (!gotLayerFrame) { gotLayerFrame = true; unsubComposite(); }
      cb(frame);
    });
    return () => { unsubLayer(); if (!gotLayerFrame) unsubComposite(); };
  }, [layerId]);

  if (!layer) {
    return <div className="param-panel param-panel--empty">Select a layer to edit it</div>;
  }

  function setParams(patch) {
    onUpdate({ ...layer, params: { ...layer.params, ...patch } });
  }

  function renderEntry(entry, index) {
    switch (entry.type) {
      case 'color':
        return (
          <ColorControl
            key={entry.key}
            label={entry.label}
            value={layer.params[entry.key]}
            onChange={(hex) => setParams({ [entry.key]: hex })}
            onCommit={onCommit}
          />
        );
      case 'number':
        return (
          <NumberControl
            key={entry.key}
            entry={entry}
            value={layer.params[entry.key]}
            onChange={(v) => setParams({ [entry.key]: v })}
            onCommit={onCommit}
          />
        );
      case 'xy':
        return (
          <XYPad
            key={`xy-${index}`}
            entry={entry}
            x={layer.params[entry.xKey]}
            y={layer.params[entry.yKey]}
            color={layer.params.color}
            subscribe={subscribeSelectedLayer}
            onChange={(x, y) => setParams({ [entry.xKey]: x, [entry.yKey]: y })}
            onCommit={onCommit}
          />
        );
      case 'range':
        return (
          <RangeControl
            key={`range-${index}`}
            entry={entry}
            minValue={layer.params[entry.minKey]}
            maxValue={layer.params[entry.maxKey]}
            onChange={(min, max) => setParams({ [entry.minKey]: min, [entry.maxKey]: max })}
            onCommit={onCommit}
          />
        );
      case 'enum':
        return (
          <EnumSelect
            key={entry.key}
            label={entry.label}
            options={entry.options}
            value={layer.params[entry.key]}
            onChange={(v) => { setParams({ [entry.key]: v }); onCommit(); }}
          />
        );
      case 'gradientStops':
        return (
          <GradientStopsEditor
            key={entry.key}
            entry={entry}
            stops={layer.params[entry.key]}
            onChange={(stops) => setParams({ [entry.key]: stops })}
            onCommit={onCommit}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="param-panel">
      <div className="param-panel-header">
        <span className="param-panel-title">{effect ? effect.name : layer.effectType}</span>
        <div className="param-panel-actions">
          <button className="btn btn-ghost" onClick={onDuplicate}>Duplicate</button>
          <button className="btn btn-ghost btn-danger" onClick={onDelete}>Delete</button>
        </div>
      </div>
      <EnumSelect
        label="Blend"
        options={BLEND_OPTIONS}
        value={layer.blendMode}
        onChange={(v) => { onUpdate({ ...layer, blendMode: v }); onCommit(); }}
      />
      <NumberControl
        entry={{ label: 'Opacity', min: 0, max: 1, step: 0.01, scale: 'linear' }}
        value={layer.opacity}
        onChange={(v) => onUpdate({ ...layer, opacity: v })}
        onCommit={onCommit}
      />
      {effect && effect.schema.map(renderEntry)}
    </div>
  );
}
