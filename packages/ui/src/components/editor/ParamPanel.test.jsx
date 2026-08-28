// @vitest-environment jsdom
/*
 * Render smoke tests for the schema-driven editor — gap 2 of #83.
 *
 * ParamPanel is what makes "a new server effect needs nothing in the UI"
 * true, so the thing worth pinning is that it walks a schema and produces a
 * control per entry type. It also carries a quiet failure mode: an entry type
 * it has no `case` for hits `default: return null`, so an older UI against a
 * newer server renders no control at all rather than erroring.
 */

import React from 'react';
import {
  afterEach, beforeEach, expect, test, vi,
} from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { installCanvasStub } from '../../test/canvasStub';

// The panel subscribes the XY pad to the layer stream; the real module opens
// a WebSocket on import.
vi.mock('../../api/lightStream', () => ({
  subscribeComposite: () => () => {},
  subscribeLayer: () => () => {},
}));

const { default: ParamPanel } = await import('./ParamPanel');

let uninstall;
beforeEach(() => { uninstall = installCanvasStub(); });
afterEach(() => { cleanup(); uninstall(); vi.clearAllMocks(); });

const EFFECT = {
  type: 'demo',
  name: 'Demo Effect',
  defaults: { color: '#ff0000', freq: 1, mode: 'a', x: 0, y: 0, min: 0, max: 1, label: 'hi' },
  schema: [
    { type: 'group', label: 'Shape' },
    { key: 'color', type: 'color', label: 'Colour' },
    { key: 'freq', type: 'number', label: 'Frequency', min: 0, max: 10, step: 0.1, scale: 'linear' },
    { key: 'mode', type: 'enum', label: 'Mode', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    { key: 'label', type: 'text', label: 'Text' },
    { type: 'range', label: 'Level', minKey: 'min', maxKey: 'max', min: 0, max: 1, step: 0.01 },
    {
      type: 'xy', label: 'Origin', xKey: 'x', yKey: 'y',
      xRange: [-3.625, 3.625], yRange: [-0.875, 0.875], margin: 2,
    },
  ],
};

const LAYER = {
  id: 'l1',
  effectType: 'demo',
  params: { ...EFFECT.defaults },
  blendMode: 'add',
  opacity: 0.5,
  enabled: true,
  solo: false,
};

function renderPanel(overrides = {}) {
  const props = {
    layer: LAYER,
    effect: EFFECT,
    onUpdate: () => {},
    onCommit: () => {},
    onDelete: () => {},
    onDuplicate: () => {},
    ...overrides,
  };
  return render(<ParamPanel {...props} />);
}

test('with no layer selected it renders the empty state rather than crashing', () => {
  const { container } = renderPanel({ layer: null });
  expect(container.querySelector('.param-panel--empty')).toBeTruthy();
});

test('walks the schema and renders a control for every entry type', () => {
  const { container } = renderPanel();

  expect(screen.getByText('Demo Effect')).toBeTruthy();
  // group heading
  expect(screen.getByText('Shape')).toBeTruthy();
  // colour, number, enum, text, range, xy — plus the blend/opacity pair every
  // effect gets regardless of its schema
  expect(screen.getByText('Colour')).toBeTruthy();
  expect(screen.getByText('Frequency')).toBeTruthy();
  expect(screen.getByText('Mode')).toBeTruthy();
  expect(screen.getByText('Text')).toBeTruthy();
  expect(screen.getByText('Level')).toBeTruthy();
  expect(screen.getByText('Blend')).toBeTruthy();
  expect(screen.getByText('Opacity')).toBeTruthy();
  expect(container.querySelector('.xy-pad')).toBeTruthy();
});

test('the pad inside the panel acquires a context', () => {
  // The pad is the one control that paints, and it is wired to the stream
  // through the panel rather than directly — so mounting it this way is what
  // proves the panel's subscribe callback is usable.
  const { container } = renderPanel();
  const canvas = container.querySelector('.xy-pad-canvas');
  expect(canvas).toBeTruthy();
  expect(canvas.getContext('2d').calls.length).toBeGreaterThan(0);
});

test('an unknown schema entry type renders nothing and does not throw', () => {
  // The documented consequence of `default: return null` — an older UI
  // against a newer server silently drops the control instead of failing.
  const effect = {
    ...EFFECT,
    schema: [...EFFECT.schema, { key: 'future', type: 'somethingNew', label: 'From The Future' }],
  };
  renderPanel({ effect });

  expect(screen.queryByText('From The Future')).toBe(null);
  expect(screen.getByText('Frequency')).toBeTruthy();
});

test('presets render one button each and replace the whole param set', () => {
  const updates = [];
  let commits = 0;
  const effect = {
    ...EFFECT,
    presets: [
      { id: 'p1', name: 'Embers', params: { freq: 9 } },
      { id: 'p2', name: 'Sparkler', params: { freq: 3 } },
    ],
  };
  renderPanel({
    effect,
    layer: { ...LAYER, params: { ...LAYER.params, freq: 0.5, color: '#00ff00' } },
    onUpdate: (l) => updates.push(l),
    onCommit: () => { commits += 1; },
  });

  expect(screen.getByText('Start from')).toBeTruthy();
  const button = screen.getByText('Embers');
  button.click();

  expect(updates.length).toBe(1);
  expect(updates[0].params.freq).toBe(9);
  // over the effect's defaults, not over the current params — so picking the
  // same preset from two starting points gives the same layer
  expect(updates[0].params.color).toBe('#ff0000');
  expect(commits).toBe(1);
});

test('an effect with no schema still renders the blend and opacity controls', () => {
  renderPanel({ effect: { type: 'bare', name: 'Bare', defaults: {}, schema: [] } });
  expect(screen.getByText('Blend')).toBeTruthy();
  expect(screen.getByText('Opacity')).toBeTruthy();
});
