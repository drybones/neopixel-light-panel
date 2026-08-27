// @vitest-environment jsdom
/*
 * Boots the whole app under the real renderer.
 *
 * Added for the React 19 upgrade (#82). Its acceptance is a browser pass over
 * the mixer, and this is the part of that a test can hold permanently: the
 * root actually mounts, the store's init resolves into it, and both routes
 * render. What it deliberately does not cover is anything pointer-driven —
 * XY pad drags, scene-card reordering, the gradient pin popover — which need
 * real hit-testing and a real browser.
 */

import React from 'react';
import {
  afterEach, beforeEach, expect, test, vi,
} from 'vitest';
import {
  cleanup, render, screen, waitFor,
} from '@testing-library/react';
import { installCanvasStub } from './test/canvasStub';

const SCENES = [
  { id: 's1', name: 'Embers', layerCount: 1 },
  { id: 's2', name: 'Sparkler', layerCount: 2 },
];

const EFFECTS = [{
  type: 'solid',
  name: 'Solid',
  defaults: { color: '#ff0000' },
  schema: [{ key: 'color', type: 'color', label: 'Colour' }],
}];

const DETAIL = {
  id: 's1',
  name: 'Embers',
  layers: [{
    id: 'l1', effectType: 'solid', params: { color: '#ff0000' },
    blendMode: 'normal', opacity: 1, enabled: true, solo: false,
  }],
};

vi.mock('./api/lightStream', () => ({
  subscribeComposite: () => () => {},
  subscribeLayer: () => () => {},
  subscribeStatus: (cb) => { cb(true); return () => {}; },
  setLayerScene: () => {},
  send: () => {},
}));

// The client exports one `api` object rather than loose functions.
vi.mock('./api/client', () => ({
  baseUrl: 'http://localhost:3000',
  wsUrl: 'ws://localhost:3001',
  api: {
    scenes: async () => SCENES,
    activeScene: async () => ({ id: 's1' }),
    brightness: async () => '1',
    effects: async () => EFFECTS,
    virtual: async () => ({ virtual: true }),
    fps: async () => ({ enabled: false, idle: true, virtual: true, targetFps: 100 }),
    power: async () => ({ idle: true, numLeds: 240, milliamps: null, budgetMilliamps: 18000 }),
    exportScenes: async () => ({ version: 2, scenes: [DETAIL] }),
    scenePreviews: async () => ({ version: 1, frames: 0, intervalMs: 100, previews: [] }),
    effectPreviews: async () => ({ version: 1, frames: 0, intervalMs: 100, previews: [] }),
    scenePreview: async () => ({ version: 1, frames: 0, intervalMs: 100, previews: [] }),
    scene: async () => DETAIL,
    setActiveScene: async () => ({}),
    setBrightness: async () => ({}),
  },
}));

const { default: App } = await import('./App');

class FakeIntersectionObserver {
  constructor(cb) { this.cb = cb; }

  observe(el) { this.cb([{ isIntersecting: true, target: el }]); }

  unobserve() {}

  disconnect() {}
}

let uninstall;
beforeEach(() => {
  uninstall = installCanvasStub();
  window.IntersectionObserver = FakeIntersectionObserver;
  window.location.hash = '';
});
afterEach(() => { cleanup(); uninstall(); vi.clearAllMocks(); });

test('the app mounts and renders the switcher once the store has loaded', async () => {
  render(<App />);

  await waitFor(() => expect(screen.getByText('Embers')).toBeTruthy());
  expect(screen.getByText('Sparkler')).toBeTruthy();
  expect(screen.getByText('Off')).toBeTruthy();
});

test('the editor route mounts against a scene', async () => {
  window.location.hash = '#/edit/s1';
  const { container } = render(<App />);

  await waitFor(() => expect(container.querySelector('.layer-row')).toBeTruthy());
  // the layer thumbnail and the read-only stage both got a context
  const canvases = [...container.querySelectorAll('canvas')];
  expect(canvases.length).toBeGreaterThan(0);
  for (const c of canvases) expect(c.getContext('2d')).toBeTruthy();
});

test('the settings route mounts', async () => {
  window.location.hash = '#/settings';
  render(<App />);

  await waitFor(() => expect(screen.getByText('Settings')).toBeTruthy());
  expect(document.querySelector('.settings')).toBeTruthy();
});

test('mounting produces no React error or warning', async () => {
  // React 19 moved several removals from warnings to hard errors; anything
  // that still only warns (a bad ref, a key problem) would otherwise pass
  // silently here.
  const errors = [];
  const spyError = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a));
  const spyWarn = vi.spyOn(console, 'warn').mockImplementation((...a) => errors.push(a));

  render(<App />);
  await waitFor(() => expect(screen.getByText('Embers')).toBeTruthy());

  spyError.mockRestore();
  spyWarn.mockRestore();
  expect(errors.map((a) => String(a[0]))).toEqual([]);
});
