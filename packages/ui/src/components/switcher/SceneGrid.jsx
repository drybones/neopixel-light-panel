import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { downloadJson } from '../../lib/downloadJson';
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
  const loadAllDetails = useStore((s) => s.loadAllDetails);
  const loadPreviews = useStore((s) => s.loadPreviews);
  const importInputRef = useRef(null);
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

  function handleExport() {
    api.exportScenes().then((data) => {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadJson(data, `lightpanel-scenes-${ts}.json`);
    });
  }

  function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';
    const reader = new FileReader();
    reader.onload = async (e) => {
      let parsed;
      try {
        parsed = JSON.parse(e.target.result);
      } catch {
        alert('Import failed: file is not valid JSON.');
        return;
      }
      try {
        await api.importScenes(parsed);
      } catch {
        alert('Import failed: server rejected the file (expected {version: 2, scenes: [...]}).');
        return;
      }
      const list = await api.scenes();
      useStore.setState({ scenes: list });
      loadAllDetails();
      loadPreviews();
    };
    reader.readAsText(file);
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
      <div className="switcher-footer">
        <button className="btn btn-ghost" onClick={handleExport}>Export</button>
        <button className="btn btn-ghost" onClick={() => importInputRef.current.click()}>Import</button>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </div>
    </>
  );
}
