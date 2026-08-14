import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import SceneCard from './SceneCard';
import useSceneDrag from './useSceneDrag';

export default function SceneGrid({ onEdit }) {
  const scenes = useStore((s) => s.scenes);
  const scenePreviews = useStore((s) => s.scenePreviews);
  const previewFrames = useStore((s) => s.previewFrames);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const activateScene = useStore((s) => s.activateScene);
  const createScene = useStore((s) => s.createScene);
  const reorderScenes = useStore((s) => s.reorderScenes);
  const gridRef = useRef(null);
  const [announcement, setAnnouncement] = useState('');

  const sceneIds = useMemo(() => scenes.map((s) => s.id), [scenes]);

  const handleReorder = useCallback((ids, movedId, to) => {
    reorderScenes(ids);
    const moved = scenes.find((s) => s.id === movedId);
    setAnnouncement(`${moved ? moved.name : 'Scene'} moved to position ${to + 1} of ${ids.length}`);
  }, [reorderScenes, scenes]);

  const drag = useSceneDrag(sceneIds, gridRef, handleReorder);

  async function handleNewScene() {
    const created = await createScene({ name: 'New scene', layers: [{ effectType: 'wavelet' }] });
    onEdit(created.id);
  }

  return (
    <>
      {/* Off and New scene share the grid but are not scenes: no drag handler,
          no data-scene-id, so they are neither draggable nor drop targets. */}
      <div className={`scene-grid${drag.settling ? ' scene-grid--settling' : ''}`} ref={gridRef}>
        <div
          className={`scene-card scene-card--off${activeSceneId === null ? ' scene-card--active' : ''}`}
          onClick={() => activateScene(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') activateScene(null); }}
        >
          <div className="scene-card-off-icon" aria-hidden="true">⏻</div>
          <div className="scene-card-name">Off</div>
        </div>
        {scenes.map((scene, i) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            preview={scenePreviews[scene.id]}
            frames={previewFrames}
            active={scene.id === activeSceneId}
            offset={drag.offsetFor(i)}
            dragging={drag.dragFrom === i}
            onActivate={() => { if (!drag.swallowClick()) activateScene(scene.id); }}
            onEdit={() => onEdit(scene.id)}
            onPointerDown={drag.onPointerDown}
            onKeyDown={drag.onKeyDown}
          />
        ))}
        <div
          className="scene-card scene-card--new"
          onClick={handleNewScene}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleNewScene(); }}
        >
          <div className="scene-card-off-icon" aria-hidden="true">+</div>
          <div className="scene-card-name">New scene</div>
        </div>
      </div>
      <p className="visually-hidden" id="scene-grid-help">
        Drag a scene card to reorder the library, or hold Shift and press an arrow key to move the
        focused scene one place.
      </p>
      <p className="visually-hidden" role="status">{announcement}</p>
    </>
  );
}
