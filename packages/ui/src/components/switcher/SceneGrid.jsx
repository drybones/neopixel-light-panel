import React, { useRef } from 'react';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import SceneCard from './SceneCard';

export default function SceneGrid({ onEdit }) {
  const scenes = useStore((s) => s.scenes);
  const sceneDetails = useStore((s) => s.sceneDetails);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const activateScene = useStore((s) => s.activateScene);
  const createScene = useStore((s) => s.createScene);
  const loadAllDetails = useStore((s) => s.loadAllDetails);
  const importInputRef = useRef(null);

  async function handleNewScene() {
    const created = await createScene({ name: 'New scene', layers: [{ effectType: 'wavelet' }] });
    onEdit(created.id);
  }

  function handleExport() {
    api.exportScenes().then((data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `lightpanel-scenes-${ts}.json`;
      a.click();
      URL.revokeObjectURL(url);
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
    };
    reader.readAsText(file);
  }

  return (
    <>
      <div className="scene-grid">
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
        {scenes.map((scene) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            detail={sceneDetails[scene.id]}
            active={scene.id === activeSceneId}
            onActivate={() => activateScene(scene.id)}
            onEdit={() => onEdit(scene.id)}
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
