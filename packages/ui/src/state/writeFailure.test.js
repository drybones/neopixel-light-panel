// @vitest-environment jsdom
/*
 * The store's unhappy path: a first load that fails, and optimistic writes
 * the server refuses.
 *
 * Every edit in the UI is optimistic, so a refused one is invisible unless
 * the store does something about it — the control keeps showing the value
 * you set, and only a reload reveals the panel never got it. These pin the
 * two halves of that: the store takes the server's view back, and it says so.
 */

import {
  beforeEach, expect, test, vi,
} from 'vitest';

const api = vi.hoisted(() => ({
  scenes: vi.fn(),
  scene: vi.fn(),
  activeScene: vi.fn(),
  brightness: vi.fn(),
  effects: vi.fn(),
  blendModes: vi.fn(),
  virtual: vi.fn(),
  fps: vi.fn(),
  power: vi.fn(),
  scenePreviews: vi.fn(),
  scenePreview: vi.fn(),
  createScene: vi.fn(),
  updateScene: vi.fn(),
  updateLayer: vi.fn(),
  deleteScene: vi.fn(),
  setActiveScene: vi.fn(),
  setBrightness: vi.fn(),
}));
vi.mock('../api/client', () => ({ api }));

const { useStore } = await import('./store');

const EMPTY_PREVIEWS = { version: 1, frames: 0, intervalMs: 100, previews: [] };
const LAYER = { id: 'l1', effectType: 'solid', params: { color: '#ff0000' } };
const SERVER_SCENE = { id: 's1', name: 'Embers', layers: [LAYER] };

function serverUp() {
  api.scenes.mockResolvedValue([{ id: 's1', name: 'Embers', layerCount: 1 }]);
  api.scene.mockResolvedValue(SERVER_SCENE);
  api.activeScene.mockResolvedValue({ id: 's1' });
  api.brightness.mockResolvedValue('0.5');
  api.effects.mockResolvedValue([]);
  api.blendModes.mockResolvedValue([]);
  api.virtual.mockResolvedValue({ virtual: true });
  api.fps.mockResolvedValue(null);
  api.power.mockResolvedValue(null);
  api.scenePreviews.mockResolvedValue(EMPTY_PREVIEWS);
  api.scenePreview.mockResolvedValue(EMPTY_PREVIEWS);
}

const refused = () => Promise.reject(new Error('PUT → 400'));

beforeEach(() => {
  vi.resetAllMocks();
  serverUp();
  useStore.setState({
    loaded: false,
    initError: null,
    writeError: null,
    scenes: [{ id: 's1', name: 'Embers', layerCount: 1 }],
    sceneDetails: { s1: SERVER_SCENE },
    activeSceneId: 's1',
  });
});

test('a failed first load says why instead of staying on "Connecting…"', async () => {
  api.scenes.mockRejectedValue(new TypeError('Failed to fetch'));
  await useStore.getState().init();

  expect(useStore.getState().loaded).toBe(false);
  expect(useStore.getState().initError).toBe('Failed to fetch');
});

test('a retry after the server comes back loads and clears the error', async () => {
  api.scenes.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await useStore.getState().init();
  await useStore.getState().init();

  expect(useStore.getState().loaded).toBe(true);
  expect(useStore.getState().initError).toBeNull();
});

test('two retries at once make one load, not two', async () => {
  // The Try again button and the WebSocket reconnect can land together.
  await Promise.all([useStore.getState().init(), useStore.getState().init()]);
  expect(api.scenes).toHaveBeenCalledTimes(1);
});

test('a refused structural edit takes the server\'s scene back and says so', async () => {
  api.updateScene.mockImplementation(refused);
  const phantom = { ...SERVER_SCENE, layers: [LAYER, { id: 'l2', effectType: 'solid', params: {} }] };
  await useStore.getState().updateScene('s1', phantom);

  // No phantom layer left behind until a reload.
  expect(useStore.getState().sceneDetails.s1.layers).toHaveLength(1);
  expect(useStore.getState().writeError).toBe("Couldn't save that change.");
});

test('a refused delete puts the scene back in the switcher', async () => {
  api.deleteScene.mockImplementation(refused);
  await useStore.getState().deleteScene('s1');

  expect(useStore.getState().scenes.map((s) => s.id)).toEqual(['s1']);
  expect(useStore.getState().activeSceneId).toBe('s1');
  expect(useStore.getState().writeError).toBe("Couldn't delete the scene.");
});

test('an edit to a scene the server no longer has drops it, so the editor closes', async () => {
  api.updateScene.mockImplementation(() => Promise.reject(new Error('PUT → 404')));
  api.scenes.mockResolvedValue([]);
  api.activeScene.mockResolvedValue({ id: null });
  await useStore.getState().updateScene('s1', { ...SERVER_SCENE, name: 'Renamed' });

  expect(useStore.getState().scenes).toEqual([]);
  expect(useStore.getState().sceneDetails.s1).toBeUndefined();
});

test('a server that is simply unreachable keeps the edit and reports it', async () => {
  // There is no better view to take — the refetch fails too.
  api.updateScene.mockImplementation(refused);
  api.scenes.mockRejectedValue(new TypeError('Failed to fetch'));
  api.activeScene.mockRejectedValue(new TypeError('Failed to fetch'));
  await useStore.getState().updateScene('s1', { ...SERVER_SCENE, name: 'Renamed' });

  expect(useStore.getState().sceneDetails.s1.name).toBe('Renamed');
  expect(useStore.getState().writeError).toBe("Couldn't save that change.");
});

test('a refused layer edit is reconciled once the throttle lets it go', async () => {
  let settle;
  const landed = new Promise((r) => { settle = r; });
  api.updateLayer.mockImplementation(() => { settle(); return refused(); });
  const edited = { ...LAYER, params: { color: '#00ff00' } };
  useStore.getState().updateLayer('s1', 'l1', edited);
  expect(useStore.getState().sceneDetails.s1.layers[0].params.color).toBe('#00ff00');

  useStore.getState().flushLayer('s1', 'l1');
  await landed;
  await vi.waitFor(() => expect(useStore.getState().writeError).toBe("Couldn't save that change."));
  await vi.waitFor(() => expect(useStore.getState().sceneDetails.s1.layers[0].params.color).toBe('#ff0000'));
});

test('a failed create resolves null rather than rejecting into the caller', async () => {
  api.createScene.mockImplementation(refused);
  await expect(useStore.getState().createScene({ name: 'New', layers: [] })).resolves.toBeNull();
  expect(useStore.getState().writeError).toBe("Couldn't create the scene.");
});

test('a refused activation reverts and says so', async () => {
  api.setActiveScene.mockImplementation(refused);
  await useStore.getState().activateScene(null);

  expect(useStore.getState().activeSceneId).toBe('s1');
  expect(useStore.getState().writeError).toBe("Couldn't switch scenes.");
});
