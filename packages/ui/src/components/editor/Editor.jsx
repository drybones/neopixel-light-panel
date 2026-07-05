import React, { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { setLayerScene } from '../../api/lightStream';
import PreviewStage from './PreviewStage';
import LayerStack from './LayerStack';
import ParamPanel from './ParamPanel';
import EffectPicker from './EffectPicker';
import BrightnessSlider from '../switcher/BrightnessSlider';

function newLayerId() {
  return crypto.randomUUID().split('-')[0];
}

export default function Editor({ sceneId, onClose }) {
  const scene = useStore((s) => s.sceneDetails[sceneId]);
  const effects = useStore((s) => s.effects);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const activateScene = useStore((s) => s.activateScene);
  const loadSceneDetail = useStore((s) => s.loadSceneDetail);
  const updateScene = useStore((s) => s.updateScene);
  const updateLayer = useStore((s) => s.updateLayer);
  const flushLayer = useStore((s) => s.flushLayer);
  const deleteScene = useStore((s) => s.deleteScene);

  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [picking, setPicking] = useState(false);
  const [name, setName] = useState(scene ? scene.name : '');

  // Editing implies looking at it: activate the scene so the panel (and
  // the live preview) show what's being edited.
  useEffect(() => {
    if (!scene) loadSceneDetail(sceneId).catch(() => onClose());
    if (activeSceneId !== sceneId) activateScene(sceneId);
    setLayerScene(sceneId);
    return () => setLayerScene(null);
  }, [sceneId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scene) setName(scene.name);
    if (scene && !scene.layers.some((l) => l.id === selectedLayerId)) {
      setSelectedLayerId(scene.layers.length ? scene.layers[scene.layers.length - 1].id : null);
    }
  }, [scene, selectedLayerId]);

  if (!scene) return <div className="app-loading">Loading scene…</div>;

  const layer = scene.layers.find((l) => l.id === selectedLayerId) || null;
  const effect = layer ? effects.find((e) => e.type === layer.effectType) : null;

  function handleLayerUpdate(updated, immediate = false) {
    updateLayer(sceneId, updated.id, updated);
    if (immediate) flushLayer(sceneId, updated.id);
  }

  function handleParamsPatch(patch) {
    if (!layer) return;
    handleLayerUpdate({ ...layer, params: { ...layer.params, ...patch } });
  }

  function commitSelected() {
    if (layer) flushLayer(sceneId, layer.id);
  }

  function addLayer(effectType) {
    const def = effects.find((e) => e.type === effectType);
    const newLayer = {
      id: newLayerId(),
      effectType,
      params: { ...def.defaults },
      blendMode: scene.layers.length === 0 ? 'normal' : 'add',
      opacity: 1,
      enabled: true,
      solo: false,
    };
    updateScene(sceneId, { ...scene, layers: [...scene.layers, newLayer] });
    setSelectedLayerId(newLayer.id);
    setPicking(false);
  }

  function duplicateLayer() {
    if (!layer) return;
    const copy = { ...layer, id: newLayerId(), params: JSON.parse(JSON.stringify(layer.params)), solo: false };
    const index = scene.layers.findIndex((l) => l.id === layer.id);
    const layers = [...scene.layers];
    layers.splice(index + 1, 0, copy);
    updateScene(sceneId, { ...scene, layers });
    setSelectedLayerId(copy.id);
  }

  function deleteLayer() {
    if (!layer) return;
    updateScene(sceneId, { ...scene, layers: scene.layers.filter((l) => l.id !== layer.id) });
  }

  // direction +1 = towards the top of the stack (end of the array)
  function moveLayer(layerId, direction) {
    const index = scene.layers.findIndex((l) => l.id === layerId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= scene.layers.length) return;
    const layers = [...scene.layers];
    [layers[index], layers[target]] = [layers[target], layers[index]];
    updateScene(sceneId, { ...scene, layers });
  }

  function commitName() {
    if (name !== scene.name) updateScene(sceneId, { ...scene, name });
  }

  async function handleDeleteScene() {
    if (!window.confirm(`Delete scene "${scene.name}"?`)) return;
    await deleteScene(sceneId);
    onClose();
  }

  async function handleDuplicateScene() {
    const copy = {
      name: `${scene.name} copy`,
      layers: scene.layers.map((l) => ({ ...JSON.parse(JSON.stringify(l)), id: newLayerId() })),
    };
    const created = await useStore.getState().createScene(copy);
    window.location.hash = `#/edit/${created.id}`;
  }

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <button className="btn btn-ghost" onClick={onClose} aria-label="Back to scenes">‹ Scenes</button>
        <input
          className="editor-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
          aria-label="Scene name"
        />
        <div className="editor-toolbar-right">
          <BrightnessSlider />
          <button className="btn btn-ghost" onClick={handleDuplicateScene}>Duplicate</button>
          <button className="btn btn-ghost btn-danger" onClick={handleDeleteScene}>Delete scene</button>
        </div>
      </div>

      <PreviewStage
        layer={layer}
        effect={effect}
        onUpdateParams={handleParamsPatch}
        onCommit={commitSelected}
      />

      <div className="editor-columns">
        <LayerStack
          scene={scene}
          effects={effects}
          selectedLayerId={selectedLayerId}
          onSelect={setSelectedLayerId}
          onUpdateLayer={handleLayerUpdate}
          onMoveLayer={moveLayer}
          onAddClick={() => setPicking(true)}
        />
        <ParamPanel
          layer={layer}
          effect={effect}
          onUpdate={(updated) => handleLayerUpdate(updated)}
          onCommit={commitSelected}
          onDelete={deleteLayer}
          onDuplicate={duplicateLayer}
        />
      </div>

      {picking && (
        <EffectPicker effects={effects} onPick={addLayer} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}
