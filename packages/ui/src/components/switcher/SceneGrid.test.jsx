// @vitest-environment jsdom
/*
 * Render smoke tests for the switcher grid — gap 2 of #83.
 *
 * The grid is where the two preview paths meet: the active card streams the
 * live composite, since that is the only scene the server renders, and every
 * other card plays a cached filmstrip. Mounting it is what proves both survive
 * a renderer swap (#82) — nothing in src/lib can tell you which canvas a card
 * chose, or whether either acquired a context.
 */

import React from 'react';
import {
  afterEach, beforeEach, expect, test, vi,
} from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { installCanvasStub } from '../../test/canvasStub';
import { NUM_PIXELS } from '../../lib/panelGrid';

// Holds the composite callback so a test can push a frame the way the socket
// would — the active card is the only one fed that way.
const stream = vi.hoisted(() => {
  let cb = null;
  return {
    subscribeComposite(fn) { cb = fn; return () => { cb = null; }; },
    push(frame) { if (cb) cb(frame); },
    get subscribed() { return cb !== null; },
  };
});

vi.mock('../../api/lightStream', () => ({
  subscribeComposite: stream.subscribeComposite,
  subscribeLayer: () => () => {},
  setLayerScene: () => {},
  subscribeStatus: () => () => {},
}));
vi.mock('../../api/client', () => new Proxy({}, {
  get: () => () => Promise.resolve({}),
}));

const { useStore } = await import('../../state/store');
const { default: SceneGrid } = await import('./SceneGrid');

// jsdom has no IntersectionObserver, and FilmstripCanvas gates its sprite
// sheet on one. Reporting "visible" immediately is the interesting path.
class FakeIntersectionObserver {
  constructor(cb) { this.cb = cb; }

  observe(el) { this.cb([{ isIntersecting: true, target: el }]); }

  unobserve() {}

  disconnect() {}
}

const FRAMES = 40;

function strip() {
  // One filmstrip: FRAMES frames of NUM_PIXELS RGB triples, flat.
  return { pixels: new Uint8Array(FRAMES * NUM_PIXELS * 3).fill(120) };
}

let uninstall;
beforeEach(() => {
  uninstall = installCanvasStub();
  window.IntersectionObserver = FakeIntersectionObserver;
  useStore.setState({
    scenes: [
      { id: 's1', name: 'Embers', layerCount: 2 },
      { id: 's2', name: 'Sparkler', layerCount: 1 },
    ],
    scenePreviews: { s1: strip(), s2: strip() },
    previewFrames: FRAMES,
    activeSceneId: 's1',
    libraryNotice: null,
  });
});
afterEach(() => { cleanup(); uninstall(); vi.clearAllMocks(); });

test('renders a card per scene, plus Off and New scene', () => {
  render(<SceneGrid onEdit={() => {}} />);

  expect(screen.getByText('Embers')).toBeTruthy();
  expect(screen.getByText('Sparkler')).toBeTruthy();
  expect(screen.getByText('Off')).toBeTruthy();
});

test('the active card streams the composite; the rest play filmstrips', () => {
  const { container } = render(<SceneGrid onEdit={() => {}} />);

  const cards = container.querySelectorAll('[data-scene-id]');
  expect(cards.length).toBe(2);

  const active = container.querySelector('[data-scene-id="s1"]');
  const inactive = container.querySelector('[data-scene-id="s2"]');
  expect(active.className).toContain('scene-card--active');
  expect(inactive.className).not.toContain('scene-card--active');

  // The inactive card paints from its cached strip straight away.
  const inactiveCtx = inactive.querySelector('canvas').getContext('2d');
  expect(inactiveCtx.calls.length).toBeGreaterThan(0);

  // The active one has a context but nothing to draw until a frame lands —
  // so pushing one is what proves it is really wired to the composite.
  const activeCtx = active.querySelector('canvas').getContext('2d');
  expect(stream.subscribed).toBe(true);
  activeCtx.reset();
  stream.push(Array.from({ length: NUM_PIXELS }, () => [255, 128, 0]));
  expect(activeCtx.calls.length).toBeGreaterThan(0);
});

test('the Off card is marked active when no scene is', () => {
  useStore.setState({ activeSceneId: null });
  const { container } = render(<SceneGrid onEdit={() => {}} />);

  const off = container.querySelector('.scene-card--off');
  expect(off.className).toContain('scene-card--active');
  // and no scene card claims it
  expect(container.querySelectorAll('[data-scene-id].scene-card--active').length).toBe(0);
});

test('a card whose filmstrip has not arrived yet still mounts', () => {
  // Previews are fetched after the scene list, so this is the ordinary first
  // paint rather than an edge case.
  useStore.setState({ scenePreviews: {} });
  const { container } = render(<SceneGrid onEdit={() => {}} />);

  expect(screen.getByText('Sparkler')).toBeTruthy();
  expect(container.querySelector('[data-scene-id="s2"] canvas')).toBeTruthy();
});

test('an empty library renders the grid without any scene cards', () => {
  useStore.setState({ scenes: [], scenePreviews: {}, activeSceneId: null });
  const { container } = render(<SceneGrid onEdit={() => {}} />);

  expect(container.querySelectorAll('[data-scene-id]').length).toBe(0);
  expect(screen.getByText('Off')).toBeTruthy();
});

test('an empty library offers both ways back rather than just a gap', () => {
  // Reachable from settings now (delete all, replacing import), and an empty
  // grid on its own is indistinguishable from one that failed to load.
  useStore.setState({ scenes: [], scenePreviews: {}, activeSceneId: null });
  render(<SceneGrid onEdit={() => {}} />);

  expect(screen.getByRole('button', { name: 'Restore defaults' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Import scenes' })).toBeTruthy();
  // New scene is still a card, so the third way back is where it always was.
  expect(screen.getByText('New scene')).toBeTruthy();
});

test('a library notice appears above the grid, where a settings action lands', () => {
  // The settings page's library actions navigate here on success, so this is
  // the only confirmation they get — see LibraryNotice.
  useStore.setState({ libraryNotice: 'Restored the 12 default scenes.' });
  const { container } = render(<SceneGrid onEdit={() => {}} />);

  const notice = container.querySelector('.library-notice');
  expect(notice).toBeTruthy();
  expect(notice.textContent).toContain('Restored the 12 default scenes.');
  // Above the grid, not buried under it.
  expect(notice.compareDocumentPosition(container.querySelector('.scene-grid')))
    .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

test('a populated library shows no empty state', () => {
  render(<SceneGrid onEdit={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Restore defaults' })).toBeNull();
});
