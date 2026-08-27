// @vitest-environment jsdom
/*
 * Render smoke tests for the shared LED renderer — gap 2 of #83.
 *
 * Everything else in the UI suite is a pure function in src/lib; nothing
 * mounted a component, which is why a renderer or plugin swap (#81, #82)
 * could not be judged from a green run. These assert the thing those changes
 * would break: that the canvas acquires a context and repaints when a frame
 * arrives over the stream.
 */

import React from 'react';
import {
  afterEach, beforeEach, expect, test,
} from 'vitest';
import { cleanup, render } from '@testing-library/react';
import LedCanvas from './LedCanvas';
import { installCanvasStub } from '../../test/canvasStub';
import { NUM_PIXELS } from '../../lib/panelGrid';

let uninstall;
beforeEach(() => { uninstall = installCanvasStub(); });
afterEach(() => { cleanup(); uninstall(); });

// Frames arrive as [[r,g,b], ...] in strip order.
function frame(fill = [255, 128, 0]) {
  return Array.from({ length: NUM_PIXELS }, () => fill.slice());
}

// Stands in for lightStream.subscribeComposite: hands back an unsubscribe, and
// lets a test push a frame the way the socket would.
function fakeStream() {
  let cb = null;
  let unsubscribed = false;
  return {
    subscribe(fn) { cb = fn; return () => { unsubscribed = true; }; },
    push(f) { cb(f); },
    get subscribed() { return cb !== null; },
    get unsubscribed() { return unsubscribed; },
  };
}

function ctxOf(container) {
  return container.querySelector('canvas').getContext('2d');
}

test('mounts, acquires a 2d context and subscribes to the stream', () => {
  const stream = fakeStream();
  const { container } = render(<LedCanvas subscribe={stream.subscribe} />);

  const canvas = container.querySelector('canvas');
  expect(canvas).toBeTruthy();
  expect(canvas.width).toBe(600);
  expect(canvas.height).toBe(160);
  expect(ctxOf(container)).toBeTruthy();
  expect(stream.subscribed).toBe(true);
});

test('a pushed frame repaints the canvas', () => {
  const stream = fakeStream();
  const { container } = render(<LedCanvas subscribe={stream.subscribe} />);
  const ctx = ctxOf(container);

  ctx.reset();
  stream.push(frame());

  // The bloom path: background fill, then additive octaves composited in.
  expect(ctx.callsTo('fillRect').length).toBeGreaterThan(0);
  expect(ctx.callsTo('drawImage').length).toBeGreaterThan(0);
  expect(ctx.stateAt('drawImage').some((s) => s.globalCompositeOperation === 'lighter')).toBe(true);
});

test('every pushed frame paints again, not just the first', () => {
  const stream = fakeStream();
  const { container } = render(<LedCanvas subscribe={stream.subscribe} />);
  const ctx = ctxOf(container);

  stream.push(frame());
  ctx.reset();
  stream.push(frame([0, 0, 255]));

  expect(ctx.calls.length).toBeGreaterThan(0);
});

test('the frame the component last held is repainted when the size changes', () => {
  const stream = fakeStream();
  const { container, rerender } = render(<LedCanvas subscribe={stream.subscribe} />);
  stream.push(frame());

  rerender(<LedCanvas subscribe={stream.subscribe} width={300} height={80} />);

  // A fresh canvas of the new size, painted without waiting for a frame
  const canvas = container.querySelector('canvas');
  expect(canvas.width).toBe(300);
  expect(canvas.getContext('2d').calls.length).toBeGreaterThan(0);
});

test('flat modes take the non-bloom path', () => {
  const stream = fakeStream();
  const { container } = render(<LedCanvas subscribe={stream.subscribe} mode="fill" />);
  const ctx = ctxOf(container);

  ctx.reset();
  stream.push(frame());

  // Cell rectangles, and no offscreen blur stack
  expect(ctx.callsTo('fillRect').length).toBeGreaterThan(NUM_PIXELS);
  expect(ctx.callsTo('drawImage').length).toBe(0);
});

test('unmounting unsubscribes, so a dead canvas is never painted', () => {
  const stream = fakeStream();
  const { unmount } = render(<LedCanvas subscribe={stream.subscribe} />);

  expect(stream.unsubscribed).toBe(false);
  unmount();
  expect(stream.unsubscribed).toBe(true);
});

test('a canvas with no subscription still renders rather than throwing', () => {
  const { container } = render(<LedCanvas />);
  expect(container.querySelector('canvas')).toBeTruthy();
});
