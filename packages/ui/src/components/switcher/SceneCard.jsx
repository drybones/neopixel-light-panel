import React from 'react';
import LedCanvas from '../preview/LedCanvas';
import FilmstripCanvas from '../preview/FilmstripCanvas';
import { subscribeComposite } from '../../api/lightStream';

// The active card streams the real composite, so it stays exactly in step with
// the panel. Every other card plays its cached filmstrip — the server renders
// only the active scene, so a live frame for the rest does not exist.
export default function SceneCard({ scene, preview, frames, active, onActivate, onEdit }) {
  return (
    <div
      className={`scene-card${active ? ' scene-card--active' : ''}`}
      onClick={onActivate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onActivate(); }}
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
