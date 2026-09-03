import { create } from 'zustand';
import { api } from '../api/client';
import { createKeyedThrottle } from '../lib/throttle';
import { decodePreviews } from '../lib/filmstrip';
import { setTiming } from '../lib/filmstripClock';

// Layer edits during drags are throttled per-layer; the final value is
// flushed on pointer-up via flushLayer().
const layerThrottle = createKeyedThrottle(80);

// "1 scene" / "4 scenes" — a count is the whole point of these messages, so
// it must not read as "1 scenes" the one time the library holds a single one.
function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

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
  effectPreviews: {}, // effectType → { hash, pixels } filmstrip for the picker
  previewFrames: 0,
  effects: [],
  activeSceneId: null,
  brightness: 1.0,
  isVirtual: null,
  fps: null, // last /api/fps snapshot; null until the first read succeeds
  power: null, // last /api/power snapshot; config and live figures together
  // What the last whole-library action did, shown on the switcher. Set by the
  // action rather than by the button, because the settings page navigates
  // here to show it and the empty state's buttons are already here.
  libraryNotice: null,
  loaded: false,

  async init() {
    const [scenes, active, brightness, effects, virtual, fps, power] = await Promise.all([
      api.scenes(),
      api.activeScene(),
      api.brightness(),
      api.effects(),
      api.virtual().catch(() => ({ virtual: null })),
      api.fps().catch(() => null),
      api.power().catch(() => null),
    ]);
    set({
      scenes,
      activeSceneId: active.id,
      brightness: parseFloat(brightness),
      effects,
      isVirtual: virtual.virtual,
      fps,
      power,
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
    const { frames, intervalMs, strips } = decodePreviews(await api.effectPreviews());
    setTiming(frames, intervalMs);
    set({ effectPreviews: strips, previewFrames: frames });
  },

  async loadSceneDetail(id) {
    const scene = await api.scene(id);
    set((s) => ({ sceneDetails: { ...s.sceneDetails, [id]: scene } }));
    return scene;
  },

  // Optimistic, then reverted if the server refuses. It refuses for one
  // reason — the scene isn't there — which is reachable now that the whole
  // library can be replaced or emptied underneath a bookmarked #/edit/:id.
  // Without the revert that PUT rejects unhandled and the header goes on
  // claiming a scene the panel isn't playing.
  async activateScene(id) {
    const previous = get().activeSceneId;
    set({ activeSceneId: id });
    try {
      await api.setActiveScene(id);
    } catch {
      set({ activeSceneId: previous });
    }
  },

  setBrightness(value) {
    set({ brightness: value });
    layerThrottle.schedule('brightness', () => api.setBrightness(value));
  },

  // Frame-rate tracker. The server owns the toggle (it persists it), so the
  // enabled flag always comes back from the response rather than being
  // assumed here — a rejected PUT must not leave the pill lit.
  async setFpsEnabled(enabled) {
    set((s) => ({
      fps: {
        ...(s.fps || {}),
        enabled,
        idle: true,
        fps: null,
        frames: 0,
        overruns: 0,
        latePercent: null,
        lateFrames: 0,
        windowFrames: 0,
      },
    }));
    try {
      set({ fps: await api.setFps(enabled) });
    } catch {
      set({ fps: await api.fps().catch(() => null) });
    }
  },

  // Polled while the tracker is on. A failed poll keeps the last reading
  // rather than blanking the readout — the panel dropping off the network
  // for one second is not a frame-rate result.
  async pollFps() {
    try {
      set({ fps: await api.fps() });
    } catch { /* keep the last snapshot */ }
  },

  // Power meter. Polled once a second like the frame rate; a failed poll
  // keeps the last reading rather than blanking a diagnostic because the
  // panel dropped off the network for a second.
  async pollPower() {
    try {
      set({ power: await api.power() });
    } catch { /* keep the last snapshot */ }
  },

  // The response carries the config back, so the controls always show what
  // the server actually accepted rather than what was typed — a rejected or
  // clamped field must not leave the UI claiming otherwise.
  async setPowerConfig(patch) {
    set((s) => ({ power: { ...(s.power || {}), ...patch } }));
    try {
      set({ power: await api.setPower(patch) });
    } catch {
      set({ power: await api.power().catch(() => null) });
    }
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

  // ---- whole-library swaps: reset, delete-all, replacing import ----
  //
  // One path rather than looping deleteScene: after a swap every id can have
  // changed at once, and the server is the authority on all of it — including
  // the active id, which a reset nulls and a replacing import may or may not
  // have kept.
  //
  // Details and previews are *replaced* when they land rather than blanked
  // first. Both maps are keyed by scene id, so a leftover entry for a scene
  // that just vanished is never read and a surviving scene keeps a usable
  // card in the meantime; blanking them would flash every card in the
  // switcher empty for the length of a round trip.
  //
  // It resolves as soon as the scene *list* is known, and does not wait for
  // details or filmstrips: a reset invalidates every strip, so awaiting them
  // would hold the button for as long as the Pi takes to render the whole
  // library. Cards mount without a strip and fill in when it lands, which is
  // the ordinary first paint anyway.
  async reloadLibrary() {
    const [scenes, active] = await Promise.all([api.scenes(), api.activeScene()]);
    set({ scenes, activeSceneId: active.id });
    get().loadAllDetails().catch(() => {});
    get().loadPreviews().catch(() => {});
  },

  // Each of the three composes its own message rather than leaving that to
  // the caller: the same action fires from the settings page and from the
  // switcher's empty state, and the two must not word it differently. Every
  // count is known here — the file says how much came in, the reloaded list
  // says what the library holds now.
  async clearLibrary() {
    await api.deleteAllScenes();
    set({
      scenes: [],
      sceneDetails: {},
      scenePreviews: {},
      activeSceneId: null,
      libraryNotice: 'Deleted every scene. The panel is off.',
    });
  },

  async resetLibrary() {
    await api.resetScenes();
    await get().reloadLibrary();
    set({ libraryNotice: `Restored the ${get().scenes.length} default scenes.` });
  },

  async importLibrary(payload, mode) {
    const incoming = (payload.scenes || []).length;
    await api.importScenes(payload, mode);
    await get().reloadLibrary();
    const total = get().scenes.length;
    set({
      libraryNotice: mode === 'replace'
        ? `Replaced the library with the file's ${plural(incoming, 'scene')}.`
        : `Imported ${plural(incoming, 'scene')}; the library now has ${total}.`,
    });
  },

  clearLibraryNotice() {
    set({ libraryNotice: null });
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
