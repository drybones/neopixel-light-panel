// @vitest-environment jsdom
/*
 * Render smoke tests for the remaining canvas-bearing and thumbnail controls.
 *
 * Added for the React 19 upgrade (#82), whose acceptance is a pass over the
 * mixer confirming no canvas has gone stale. These cover the surfaces that
 * check names — the angle dials, the gradient editor and the per-layer
 * thumbnails — as tests rather than as a look, so the guarantee survives the
 * next renderer change too.
 *
 * AngleDial is the useful contrast with XYPad: it repaints from its own props
 * with no frame subscription, so a changing prop belongs in its effect's
 * dependency list and nothing needs a ref. Pinning that here keeps the two
 * patterns distinguishable.
 */

import React from 'react';
import {
  afterEach, beforeEach, expect, test, vi,
} from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { installCanvasStub } from '../../test/canvasStub';
import { NUM_PIXELS } from '../../lib/panelGrid';

const stream = vi.hoisted(() => {
  const subs = new Map();
  return {
    subscribeLayer(id, fn) { subs.set(id, fn); return () => subs.delete(id); },
    push(id, frame) { const fn = subs.get(id); if (fn) fn(frame); },
    get ids() { return [...subs.keys()]; },
  };
});
vi.mock('../../api/lightStream', () => ({
  subscribeComposite: () => () => {},
  subscribeLayer: stream.subscribeLayer,
  setLayerScene: () => {},
  subscribeStatus: () => () => {},
}));

const { default: AngleDial } = await import('./AngleDial');
const { default: GradientStopsEditor } = await import('./GradientStopsEditor');
const { LayerRow } = await import('../editor/LayerStack');

let uninstall;
beforeEach(() => { uninstall = installCanvasStub(); });
afterEach(() => { cleanup(); uninstall(); vi.clearAllMocks(); });

function dialCanvas(container) {
  return container.querySelector('canvas').getContext('2d');
}

test.each([
  ['wavefronts', {}],
  ['arrow', {}],
  ['cone', { spread: 90 }],
  ['bands', { stops: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }] }],
])('the %s dial variant mounts and paints', (variant, extra) => {
  const { container } = render(
    <AngleDial
      entry={{ key: 'angle', label: 'Direction', render: variant, min: 0, max: 360 }}
      value={45}
      color="#ff8800"
      onChange={() => {}}
      onCommit={() => {}}
      {...extra}
    />,
  );

  expect(container.querySelector('canvas')).toBeTruthy();
  expect(dialCanvas(container).calls.length).toBeGreaterThan(0);
  expect(screen.getByText('Direction')).toBeTruthy();
});

test('the dial repaints when its value changes', () => {
  // No frame subscription here, so the repaint comes from the effect's
  // dependency list rather than a ref — the opposite arrangement to XYPad's,
  // and correct for a control that reads only its own props.
  const props = {
    entry: { key: 'angle', label: 'Direction', min: 0, max: 360 },
    color: '#ff8800',
    onChange: () => {},
    onCommit: () => {},
  };
  const { container, rerender } = render(<AngleDial {...props} value={0} />);
  const ctx = dialCanvas(container);

  ctx.reset();
  rerender(<AngleDial {...props} value={180} />);

  expect(ctx.calls.length).toBeGreaterThan(0);
});

test('the gradient editor mounts with its stops and end fields', () => {
  const stops = [
    { position: 0, color: '#ff0000' },
    { position: 0.5, color: '#00ff00' },
    { position: 1, color: '#0000ff' },
  ];
  const { container } = render(
    <GradientStopsEditor
      entry={{ key: 'stops', label: 'Colours' }}
      stops={stops}
      onChange={() => {}}
      onCommit={() => {}}
    />,
  );

  expect(screen.getByText('Colours')).toBeTruthy();
  // one draggable pin per stop
  expect(container.querySelectorAll('.gradient-pin').length).toBe(stops.length);
});

test('a layer row renders a thumbnail subscribed to that layer', () => {
  const layer = {
    id: 'layer-7', effectType: 'solid', blendMode: 'add', opacity: 0.5, enabled: true, solo: false,
  };
  const { container } = render(
    <LayerRow
      layer={layer}
      effectName="Solid"
      selected={false}
      soloActive={false}
      onSelect={() => {}}
      onToggleEnabled={() => {}}
      onToggleSolo={() => {}}
    />,
  );

  // The thumbnail subscribes per layer id — the v2 layer stream, not the
  // composite, which is what makes each row show its own layer.
  expect(stream.ids).toEqual(['layer-7']);

  const ctx = container.querySelector('canvas').getContext('2d');
  ctx.reset();
  stream.push('layer-7', Array.from({ length: NUM_PIXELS }, () => [10, 200, 30]));

  // Flat fill at thumbnail size, so cell rects rather than a bloom stack
  expect(ctx.callsTo('fillRect').length).toBeGreaterThan(0);
  expect(ctx.callsTo('drawImage').length).toBe(0);
  expect(screen.getByText('Solid')).toBeTruthy();
});

test('unmounting a layer row drops its stream subscription', () => {
  const layer = {
    id: 'layer-9', effectType: 'solid', blendMode: 'normal', opacity: 1, enabled: true, solo: false,
  };
  const { unmount } = render(
    <LayerRow
      layer={layer} effectName="Solid" selected={false} soloActive={false}
      onSelect={() => {}} onToggleEnabled={() => {}} onToggleSolo={() => {}}
    />,
  );
  expect(stream.ids).toEqual(['layer-9']);
  unmount();
  expect(stream.ids).toEqual([]);
});
