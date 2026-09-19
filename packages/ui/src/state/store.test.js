// @vitest-environment jsdom
/*
 * The store's write plumbing on the happy path: the layer throttle, the
 * flush that ends a drag, the ordering refreshPreview relies on, and the
 * reorder's recovery. Failures are in writeFailure.test.js; the library
 * notices in libraryNotice.test.js.
 */

import {
  afterEach, beforeEach, expect, test, vi,
} from 'vitest';

const api = vi.hoisted(() => ({
  scenes: vi.fn(),
  activeScene: vi.fn(),
  scene: vi.fn(),
  updateLayer: vi.fn(),
  reorderScenes: vi.fn(),
  scenePreview: vi.fn(),
}));
vi.mock('../api/client', () => ({ api }));

const { useStore } = await import('./store');

const EMPTY_PREVIEWS = { version: 1, frames: 0, intervalMs: 100, previews: [] };
const LAYER = { id: 'l1', effectType: 'solid', params: { color: '#000000' } };
const SCENE = { id: 's1', name: 'One', layers: [LAYER] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  api.updateLayer.mockResolvedValue({});
  api.scenePreview.mockResolvedValue(EMPTY_PREVIEWS);
  useStore.setState({
    scenes: [
      { id: 's1', name: 'One', layerCount: 1 },
      { id: 's2', name: 'Two', layerCount: 1 },
      { id: 's3', name: 'Three', layerCount: 1 },
    ],
    sceneDetails: { s1: SCENE },
    writeError: null,
  });
});
afterEach(() => { vi.useRealTimers(); });

const withColor = (c) => ({ ...LAYER, params: { color: c } });

test('a burst of layer edits is one PUT, carrying the last value', () => {
  const { updateLayer } = useStore.getState();
  updateLayer('s1', 'l1', withColor('#111111'));
  updateLayer('s1', 'l1', withColor('#222222'));
  updateLayer('s1', 'l1', withColor('#333333'));
  // Optimistic: the store shows the newest value before anything is sent.
  expect(useStore.getState().sceneDetails.s1.layers[0].params.color).toBe('#333333');
  expect(api.updateLayer).not.toHaveBeenCalled();

  vi.advanceTimersByTime(80);
  expect(api.updateLayer).toHaveBeenCalledTimes(1);
  expect(api.updateLayer).toHaveBeenCalledWith('s1', 'l1', withColor('#333333'));
});

test('flushLayer sends the pending edit at once — the end of a drag', () => {
  // Same `${sceneId}/${layerId}` key on both sides, or the flush finds
  // nothing and the drag's last value waits out the throttle (or is lost).
  const { updateLayer, flushLayer } = useStore.getState();
  updateLayer('s1', 'l1', withColor('#444444'));
  flushLayer('s1', 'l1');
  expect(api.updateLayer).toHaveBeenCalledWith('s1', 'l1', withColor('#444444'));

  vi.advanceTimersByTime(200);
  expect(api.updateLayer).toHaveBeenCalledTimes(1);
});

test('edits to two layers are throttled separately', () => {
  const { updateLayer } = useStore.getState();
  useStore.setState({ sceneDetails: { s1: { ...SCENE, layers: [LAYER, { ...LAYER, id: 'l2' }] } } });
  updateLayer('s1', 'l1', withColor('#555555'));
  updateLayer('s1', 'l2', { ...withColor('#666666'), id: 'l2' });
  vi.advanceTimersByTime(80);
  expect(api.updateLayer).toHaveBeenCalledTimes(2);
});

test('refreshPreview flushes, waits for the write to land, then fetches', async () => {
  // A filmstrip is rendered from what the server holds, so fetching it over
  // an in-flight edit caches the frame before the edit.
  const order = [];
  let land;
  api.updateLayer.mockImplementation(() => {
    order.push('PUT sent');
    return new Promise((r) => { land = () => { order.push('PUT landed'); r({}); }; });
  });
  api.scenePreview.mockImplementation(async () => { order.push('preview fetched'); return EMPTY_PREVIEWS; });

  useStore.getState().updateLayer('s1', 'l1', withColor('#777777'));
  const done = useStore.getState().refreshPreview('s1');
  await vi.advanceTimersByTimeAsync(0);
  expect(order).toEqual(['PUT sent']);

  land();
  await done;
  expect(order).toEqual(['PUT sent', 'PUT landed', 'preview fetched']);
});

test('a refused reorder takes the server\'s list rather than guessing at a revert', async () => {
  vi.useRealTimers();
  api.reorderScenes.mockRejectedValue(new Error('PUT → 400'));
  const server = [
    { id: 's2', name: 'Two', layerCount: 1 },
    { id: 's1', name: 'One', layerCount: 1 },
  ];
  api.scenes.mockResolvedValue(server);
  api.activeScene.mockResolvedValue({ id: null });

  await useStore.getState().reorderScenes(['s3', 's2', 's1']);
  expect(useStore.getState().scenes).toEqual(server);
});

test('an accepted reorder keeps the optimistic order', async () => {
  vi.useRealTimers();
  api.reorderScenes.mockResolvedValue({});
  await useStore.getState().reorderScenes(['s3', 's1', 's2']);
  expect(useStore.getState().scenes.map((s) => s.id)).toEqual(['s3', 's1', 's2']);
  expect(api.scenes).not.toHaveBeenCalled();
});
