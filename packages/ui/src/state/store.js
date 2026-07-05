import { create } from 'zustand';
import { api } from '../api/client';
import { createKeyedThrottle } from '../lib/throttle';

// Layer edits during drags are throttled per-layer; the final value is
// flushed on pointer-up via flushLayer().
const layerThrottle = createKeyedThrottle(80);

export const useStore = create((set, get) => ({
  scenes: [],
  sceneDetails: {},   // sceneId → full scene (layers included)
  effects: [],
  activeSceneId: null,
  brightness: 1.0,
  isVirtual: null,
  loaded: false,

  async init() {
    const [scenes, active, brightness, effects, virtual] = await Promise.all([
      api.scenes(),
      api.activeScene(),
      api.brightness(),
      api.effects(),
      api.virtual().catch(() => ({ virtual: null })),
    ]);
    set({
      scenes,
      activeSceneId: active.id,
      brightness: parseFloat(brightness),
      effects,
      isVirtual: virtual.virtual,
      loaded: true,
    });
    get().loadAllDetails();
  },

  async loadAllDetails() {
    const { scenes } = await api.exportScenes();
    const details = {};
    scenes.forEach((s) => { details[s.id] = s; });
    set({ sceneDetails: details });
  },

  async loadSceneDetail(id) {
    const scene = await api.scene(id);
    set((s) => ({ sceneDetails: { ...s.sceneDetails, [id]: scene } }));
    return scene;
  },

  async activateScene(id) {
    set({ activeSceneId: id });
    await api.setActiveScene(id);
  },

  setBrightness(value) {
    set({ brightness: value });
    layerThrottle.schedule('brightness', () => api.setBrightness(value));
  },

  async createScene(scene) {
    const created = await api.createScene(scene);
    set((s) => ({
      scenes: [...s.scenes, { id: created.id, name: created.name, layerCount: created.layers.length }],
      sceneDetails: { ...s.sceneDetails, [created.id]: created },
    }));
    return created;
  },

  async deleteScene(id) {
    set((s) => {
      const sceneDetails = { ...s.sceneDetails };
      delete sceneDetails[id];
      return {
        scenes: s.scenes.filter((x) => x.id !== id),
        sceneDetails,
        activeSceneId: s.activeSceneId === id ? null : s.activeSceneId,
      };
    });
    await api.deleteScene(id);
  },

  // Structural scene update (rename, add/remove/reorder layers) —
  // optimistic local update + immediate full-scene PUT.
  async updateScene(id, scene) {
    set((s) => ({
      sceneDetails: { ...s.sceneDetails, [id]: scene },
      scenes: s.scenes.map((x) => (x.id === id ? { ...x, name: scene.name, layerCount: scene.layers.length } : x)),
    }));
    await api.updateScene(id, scene);
  },

  // High-frequency layer param path — optimistic local update + throttled
  // single-layer PUT. Call flushLayer on pointer-up.
  updateLayer(sceneId, layerId, layer) {
    set((s) => {
      const scene = s.sceneDetails[sceneId];
      if (!scene) return {};
      return {
        sceneDetails: {
          ...s.sceneDetails,
          [sceneId]: {
            ...scene,
            layers: scene.layers.map((l) => (l.id === layerId ? layer : l)),
          },
        },
      };
    });
    layerThrottle.schedule(`${sceneId}/${layerId}`, () => api.updateLayer(sceneId, layerId, layer));
  },

  flushLayer(sceneId, layerId) {
    layerThrottle.flush(`${sceneId}/${layerId}`);
  },
}));
