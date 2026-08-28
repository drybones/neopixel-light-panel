// @vitest-environment jsdom
/*
 * Render smoke tests for XYPad — gap 2 of #83, and the one component where a
 * mounting test earns its keep twice over.
 *
 * The pad repaints from the frame stream, and its subscription is created per
 * *geometry*, so the callback holds whatever draw() closed over at the time.
 * Anything the chrome reads that a param edit changes therefore has to come
 * through a ref (`decorRef`) — otherwise the ~30 FPS stream repaints with
 * mount-time values and silently wipes the correct frame.
 *
 * That regression looks like an unwired feature rather than an error: no
 * throw, no warning, just a box that stops following its controls. No pure
 * function can catch it, which is why it needs a mounted component and a
 * frame pushed through a real subscription.
 */

import React from 'react';
import {
  afterEach, beforeEach, expect, test,
} from 'vitest';
import { cleanup, render } from '@testing-library/react';
import XYPad from './XYPad';
import { installCanvasStub } from '../../test/canvasStub';
import { NUM_PIXELS } from '../../lib/panelGrid';

let uninstall;
beforeEach(() => { uninstall = installCanvasStub(); });
afterEach(() => { cleanup(); uninstall(); });

// The emitter's Origin entry, the schema shape that drives a pad with decor.
const ENTRY = {
  type: 'xy',
  label: 'Origin',
  xKey: 'x',
  yKey: 'y',
  xRange: [-3.625, 3.625],
  yRange: [-0.875, 0.875],
  margin: 2,
  extXKey: 'extX',
  extYKey: 'extY',
};

function frame() {
  return Array.from({ length: NUM_PIXELS }, () => [255, 128, 0]);
}

function fakeStream() {
  let cb = null;
  return {
    subscribe(fn) { cb = fn; return () => {}; },
    push(f) { cb(f); },
  };
}

function ctxOf(container) {
  return container.querySelector('canvas').getContext('2d');
}

// The emission box is the only stroke drawn at 0.6 white — the panel outline
// is 0.25 and the far-ring boundary is 0.14 — so its width is recoverable
// from the recorded calls without reaching into the component.
function boxWidth(ctx) {
  const boxes = ctx.calls.filter(
    (c) => c.name === 'strokeRect' && c.state.strokeStyle === 'rgba(255,255,255,0.6)',
  );
  return boxes.length ? boxes[boxes.length - 1].args[2] : null;
}

test('mounts, draws the panel chrome and exposes the handle', () => {
  const { container } = render(
    <XYPad entry={ENTRY} x={0} y={0} color="#ff8800" onChange={() => {}} />,
  );

  expect(container.querySelector('canvas')).toBeTruthy();
  expect(container.querySelector('.xy-pad-handle')).toBeTruthy();
  expect(container.querySelector('[role="slider"]')).toBeTruthy();
  // Unlit grid before the first frame: one dot per LED, plus the outline.
  // An unsubscribed pad draws from both effects on mount, so this is a whole
  // multiple of the LED count rather than exactly one pass.
  const ctx = ctxOf(container);
  const arcs = ctx.callsTo('arc').length;
  expect(arcs).toBeGreaterThanOrEqual(NUM_PIXELS);
  expect(arcs % NUM_PIXELS).toBe(0);
  expect(ctx.callsTo('strokeRect').length).toBeGreaterThan(0);
});

test('a streamed frame repaints the pad with the layer render', () => {
  const stream = fakeStream();
  const { container } = render(
    <XYPad entry={ENTRY} x={0} y={0} subscribe={stream.subscribe} onChange={() => {}} />,
  );
  const ctx = ctxOf(container);

  ctx.reset();
  stream.push(frame());

  // The bloom path replaces the unlit grid
  expect(ctx.callsTo('drawImage').length).toBeGreaterThan(0);
});

test('the emission box follows a param edit through a stream repaint', () => {
  // The regression guard. Change extX, then push a frame through the
  // subscription created at mount: if the chrome reads props from that stale
  // closure instead of decorRef, the repaint draws the mount-time width and
  // the box stops tracking its own Width control.
  const stream = fakeStream();
  const props = {
    entry: ENTRY, x: 0, y: 0, subscribe: stream.subscribe, onChange: () => {},
  };
  const { container, rerender } = render(
    <XYPad {...props} decor={{ extX: 1, extY: 1 }} />,
  );
  const ctx = ctxOf(container);

  stream.push(frame());
  const narrow = boxWidth(ctx);
  expect(narrow).toBeGreaterThan(0);

  rerender(<XYPad {...props} decor={{ extX: 4, extY: 1 }} />);
  ctx.reset();
  stream.push(frame());
  const wide = boxWidth(ctx);

  expect(wide).toBeGreaterThan(narrow * 2);
});

test('the handle follows a position edit through a stream repaint', () => {
  const stream = fakeStream();
  const props = { entry: ENTRY, y: 0, subscribe: stream.subscribe, onChange: () => {} };
  const { container, rerender } = render(<XYPad {...props} x={0} decor={{ extX: 1, extY: 1 }} />);
  const ctx = ctxOf(container);

  stream.push(frame());
  const left = container.querySelector('.xy-pad-handle').style.left;

  rerender(<XYPad {...props} x={2} decor={{ extX: 1, extY: 1 }} />);
  stream.push(frame());

  // The handle is a DOM element rather than canvas, so it cannot go stale the
  // way the chrome can — pinned here so the two stay distinguishable.
  expect(container.querySelector('.xy-pad-handle').style.left).not.toBe(left);
  expect(ctx.calls.length).toBeGreaterThan(0);
});

test('a pad with no decor draws no emission box', () => {
  const stream = fakeStream();
  const { container } = render(
    <XYPad entry={ENTRY} x={0} y={0} subscribe={stream.subscribe} onChange={() => {}} />,
  );
  const ctx = ctxOf(container);
  ctx.reset();
  stream.push(frame());

  expect(boxWidth(ctx)).toBe(null);
});

test('an unsubscribed pad still repaints when its params change', () => {
  const { container, rerender } = render(
    <XYPad entry={ENTRY} x={0} y={0} decor={{ extX: 1, extY: 1 }} onChange={() => {}} />,
  );
  const ctx = ctxOf(container);
  const before = boxWidth(ctx);

  ctx.reset();
  rerender(<XYPad entry={ENTRY} x={0} y={0} decor={{ extX: 4, extY: 1 }} onChange={() => {}} />);

  expect(boxWidth(ctx)).toBeGreaterThan(before * 2);
});
