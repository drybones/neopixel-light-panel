import React from 'react';
import LedCanvas from '../preview/LedCanvas';
import { subscribeComposite } from '../../api/lightStream';
import { sceneSwatches } from '../../lib/colors';

export default function SceneCard({ scene, detail, active, onActivate, onEdit }) {
  const swatches = sceneSwatches(detail);

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
          <LedCanvas subscribe={subscribeComposite} width={300} height={80} dots={false}
            style={{ width: '100%', height: '100%', borderRadius: 6 }} />
        ) : (
          <div className="scene-card-swatches">
            {swatches.length > 0
              ? swatches.map((c, i) => <span key={i} style={{ background: c }} />)
              : <span style={{ background: '#222' }} />}
          </div>
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
