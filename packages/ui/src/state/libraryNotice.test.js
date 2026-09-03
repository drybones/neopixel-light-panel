// @vitest-environment jsdom
/*
 * The wording and counts of the whole-library notices.
 *
 * They are composed in the store rather than by the button because the same
 * three actions fire from the settings page and from the switcher's empty
 * state, and the two must not describe the same thing differently. That makes
 * this the only place the messages exist — and a count that reads "1 scenes"
 * is exactly the kind of thing nothing else would catch.
 */

import {
  afterEach, beforeEach, expect, test, vi,
} from 'vitest';

const api = vi.hoisted(() => ({
  scenes: vi.fn(),
  activeScene: vi.fn(),
  exportScenes: vi.fn(),
  scenePreviews: vi.fn(),
  deleteAllScenes: vi.fn(),
  resetScenes: vi.fn(),
  importScenes: vi.fn(),
}));
vi.mock('../api/client', () => ({ api }));

const { useStore } = await import('./store');

// The library the server reports after whatever just happened.
function serverHolds(n) {
  api.scenes.mockResolvedValue(
    Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `S${i}`, layerCount: 1 })),
  );
  api.activeScene.mockResolvedValue({ id: null });
  // reloadLibrary fires these without awaiting them; they must not reject.
  api.exportScenes.mockResolvedValue({ scenes: [] });
  api.scenePreviews.mockResolvedValue({ version: 1, frames: 0, intervalMs: 100, previews: [] });
}

beforeEach(() => { useStore.setState({ libraryNotice: null, scenes: [] }); });
afterEach(() => { vi.clearAllMocks(); });

test('delete-all says the panel went off with the scenes', async () => {
  api.deleteAllScenes.mockResolvedValue([]);
  await useStore.getState().clearLibrary();

  expect(useStore.getState().libraryNotice).toBe('Deleted every scene. The panel is off.');
  expect(useStore.getState().scenes).toEqual([]);
});

test('restore defaults counts what it restored', async () => {
  api.resetScenes.mockResolvedValue([]);
  serverHolds(12);
  await useStore.getState().resetLibrary();

  expect(useStore.getState().libraryNotice).toBe('Restored the 12 default scenes.');
});

test('a merging import gives both numbers — what came in, and the total', async () => {
  // The two differ, and which one you wanted is the question the message
  // exists to answer.
  api.importScenes.mockResolvedValue('OK');
  serverHolds(31);
  await useStore.getState().importLibrary({ version: 2, scenes: new Array(4).fill({}) });

  expect(useStore.getState().libraryNotice).toBe('Imported 4 scenes; the library now has 31.');
});

test('a replacing import reports the file, since the file is now the library', async () => {
  api.importScenes.mockResolvedValue('OK');
  serverHolds(12);
  await useStore.getState().importLibrary(
    { version: 2, scenes: new Array(12).fill({}) }, 'replace',
  );

  expect(useStore.getState().libraryNotice).toBe("Replaced the library with the file's 12 scenes.");
});

test('a single scene is not "1 scenes"', async () => {
  api.importScenes.mockResolvedValue('OK');
  serverHolds(1);
  await useStore.getState().importLibrary({ version: 2, scenes: [{}] }, 'replace');

  expect(useStore.getState().libraryNotice).toBe("Replaced the library with the file's 1 scene.");
});
