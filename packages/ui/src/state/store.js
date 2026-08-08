import { create } from 'zustand';
import { api } from '../api/client';
import { createKeyedThrottle } from '../lib/throttle';
import { decodePreviews } from '../lib/filmstrip';
import { setTiming } from '../lib/filmstripClock';

// Layer edits during drags are throttled per-layer; the final value is
// flushed on pointer-up via flushLayer().
const layerThrottle = createKeyedThrottle(80);

// The most recent write to the server, so refreshPreview() can wait for it.
// A filmstrip is rendered from what the server holds, so asking for one while
// the last edit of a drag is still in flight would cache the previous frame.
let lastWrite = Promise.resolve();
function tracked(promise) {
  lastWrite = promise;
  return promise;
}

export const useStore = create((set, get) => ({
  scenes: [],
  sceneDetails: {},   // sceneId → full scene (layers included)
  scenePreviews: {},  // sceneId → { hash, pixels } filmstrip for the card
  effectPreviews: {}, // tile id → { hash, pixels } filmstrip for the picker
  effectTiles: [],    // what the picker lists: one per effect, or per preset
  previewFrames: 0,
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
    get().loadPreviews();
  },

  async loadAllDetails() {
    const { scenes } = await api.exportScenes();
    const details = {};
    scenes.forEach((s) => { details[s.id] = s; });
    set({ sceneDetails: details });
  },

  // Scene-card filmstrips. The server caches them by scene content, so asking
  // for the whole set is only expensive the first time — but decoding is not
  // free, so a single scene is refreshed on its own after an edit.
  async loadPreviews(id) {
    const payload = await (id ? api.scenePreview(id) : api.scenePreviews());
    const { frames, intervalMs, strips } = decodePreviews(payload);
    setTiming(frames, intervalMs);
    set((s) => ({
      scenePreviews: id ? { ...s.scenePreviews, ...strips } : strips,
      previewFrames: frames,
    }));
  },

  // Effect filmstrips for the picker, each effect at its defaults. Fetched
  // when the picker first opens rather than at startup: effect defaults never
  // change, so one fetch per session covers it, and most sessions never add a
  // layer at all.
  async loadEffectPreviews() {
    if (Object.keys(get().effectPreviews).length > 0) return;
    const { frames, intervalMs, strips, tiles } = decodePreviews(await api.effectPreviews());
    setTiming(frames, intervalMs);
    set({ effectPreviews: strips, effectTiles: tiles, previewFrames: frames });
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
    get().loadPreviews(created.id);
    return created;
  },

  async deleteScene(id) {
    set((s) => {
      const sceneDetails = { ...s.sceneDetails };
      const scenePreviews = { ...s.scenePreviews };
      delete sceneDetails[id];
      delete scenePreviews[id];
      return {
        scenes: s.scenes.filter((x) => x.id !== id),
        sceneDetails,
        scenePreviews,
        activeSceneId: s.activeSceneId === id ? null : s.activeSceneId,
      };
    });
    await api.deleteScene(id);
  },

  // Scene order — the switcher's drag. Optimistic, then the whole id list to
  // the server (which rejects anything that isn't a permutation of what it
  // holds). A rejection means another client changed the library underneath
  // this one, so take the server's list rather than guessing at a revert.
  async reorderScenes(ids) {
    set((s) => {
      const byId = new Map(s.scenes.map((x) => [x.id, x]));
      return { scenes: ids.map((id) => byId.get(id)).filter(Boolean) };
    });
    try {
      await api.reorderScenes(ids);
    } catch {
      set({ scenes: await api.scenes() });
    }
  },

  // Structural scene update (rename, add/remove/reorder layers) —
  // optimistic local update + immediate full-scene PUT.
  async updateScene(id, scene) {
    set((s) => ({
      sceneDetails: { ...s.sceneDetails, [id]: scene },
      scenes: s.scenes.map((x) => (x.id === id ? { ...x, name: scene.name, layerCount: scene.layers.length } : x)),
    }));
    await tracked(api.updateScene(id, scene));
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
    layerThrottle.schedule(`${sceneId}/${layerId}`, () => tracked(api.updateLayer(sceneId, layerId, layer)));
  },

  flushLayer(sceneId, layerId) {
    layerThrottle.flush(`${sceneId}/${layerId}`);
  },

  // Re-render one scene's card after editing it. Everything pending has to
  // land first — the server renders the filmstrip from the scene it holds, so
  // a strip fetched over the top of an in-flight write is a frame behind.
  async refreshPreview(sceneId) {
    layerThrottle.flushAll();
    await lastWrite.catch(() => {});
    await get().loadPreviews(sceneId).catch(() => {});
  },
}));
