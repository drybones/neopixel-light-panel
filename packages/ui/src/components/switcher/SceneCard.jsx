import React from 'react';
import LedCanvas from '../preview/LedCanvas';
import FilmstripCanvas from '../preview/FilmstripCanvas';
import { subscribeComposite } from '../../api/lightStream';

const KEY_HINT = 'Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown';

// The active card streams the real composite, so it stays exactly in step with
// the panel. Every other card plays its cached filmstrip — the server renders
// only the active scene, so a live frame for the rest does not exist.
//
// `offset` slides the card to the slot it would occupy if the drag in progress
// were dropped now; `dragging` is the card being held. Both come from
// useSceneDrag — but the held card's own transform is written straight to the
// node by the hook, so nothing here fights it.
export default function SceneCard({
  scene, preview, frames, active, offset, dragging, onActivate, onEdit, onPointerDown, onKeyDown,
}) {
  const className = `scene-card${active ? ' scene-card--active' : ''}${dragging ? ' scene-card--dragging' : ''}`;
  return (
    <div
      className={className}
      data-scene-id={scene.id}
      onClick={onActivate}
      onPointerDown={(e) => onPointerDown(e, scene.id)}
      role="button"
      tabIndex={0}
      aria-keyshortcuts={KEY_HINT}
      aria-describedby="scene-grid-help"
      aria-grabbed={dragging || undefined}
      style={offset ? { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` } : undefined}
      onKeyDown={(e) => {
        if (onKeyDown(e, scene.id)) return;
        if (e.key === 'Enter' || e.key === ' ') onActivate();
      }}
    >
      <div className="scene-card-preview">
        {active ? (
          <LedCanvas subscribe={subscribeComposite} width={300} height={80} mode="bloom"
            style={{ width: '100%', height: '100%', borderRadius: 6 }} />
        ) : (
          <FilmstripCanvas strip={preview} frames={frames} id={scene.id} width={300} height={80}
            style={{ width: '100%', height: '100%', borderRadius: 6 }} />
        )}
      </div>
      <div className="scene-card-row">
        <div>
          <div className="scene-card-name">
            {active && <span className="scene-card-live" aria-hidden="true" />}
            {scene.name}
          </div>
          <div className="scene-card-meta">{scene.layerCount} layer{scene.layerCount === 1 ? '' : 's'}</div>
        </div>
        <button
          className="btn btn-ghost scene-card-edit"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          aria-label={`Edit ${scene.name}`}
        >
          Edit
        </button>
      </div>
    </div>
  );
}
