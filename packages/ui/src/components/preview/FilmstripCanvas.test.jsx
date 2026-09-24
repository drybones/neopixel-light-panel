// @vitest-environment jsdom
/*
 * A previews refresh decodes a fresh strip object for every scene. The card
 * must rebuild only when the strip's content hash changes — keyed on the
 * object, every refresh re-blooms every card on screen for nothing.
 */

import React from 'react';
import {
  afterEach, beforeEach, expect, test,
} from 'vitest';
import { cleanup, render } from '@testing-library/react';
import FilmstripCanvas from './FilmstripCanvas';
import { installCanvasStub } from '../../test/canvasStub';
import { NUM_PIXELS } from '../../lib/panelGrid';

const FRAMES = 4;

// Counts observers: the effect creates one per run, so this is the number of
// times the card has (re)built.
let observers = 0;
class FakeIntersectionObserver {
  constructor() { observers++; }
  observe() {}
  disconnect() {}
}

let uninstall;
beforeEach(() => {
  uninstall = installCanvasStub();
  observers = 0;
  window.IntersectionObserver = FakeIntersectionObserver;
});
afterEach(() => { cleanup(); uninstall(); delete window.IntersectionObserver; });

function strip(hash) {
  return { hash, pixels: new Uint8Array(FRAMES * NUM_PIXELS * 3).fill(100) };
}

test('a refreshed strip with the same hash does not rebuild the card', () => {
  const { rerender } = render(<FilmstripCanvas strip={strip('h1')} frames={FRAMES} id="a" />);
  expect(observers).toBe(1);

  rerender(<FilmstripCanvas strip={strip('h1')} frames={FRAMES} id="a" />);
  expect(observers).toBe(1);

  rerender(<FilmstripCanvas strip={strip('h2')} frames={FRAMES} id="a" />);
  expect(observers).toBe(2);
});
