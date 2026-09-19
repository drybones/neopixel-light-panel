// @vitest-environment jsdom
/*
 * The component half of #111: the gestures and keys that went wrong when
 * something other than the happy path happened, and the render throws that
 * used to take the whole page down.
 *
 * Each of these fails silently in a real browser — a dial that goes on
 * following a bare cursor, a hide button that selects instead, a white page —
 * which is why they are pinned here rather than left to a manual pass.
 */

import React from 'react';
import {
  afterEach, beforeEach, expect, test, vi,
} from 'vitest';
import {
  cleanup, fireEvent, render, screen,
} from '@testing-library/react';
import { installCanvasStub } from '../test/canvasStub';

vi.mock('../api/lightStream', () => ({
  subscribeComposite: () => () => {},
  subscribeLayer: () => () => {},
}));

const { default: XYPad } = await import('./controls/XYPad');
const { default: AngleDial } = await import('./controls/AngleDial');
const { default: ColorControl } = await import('./controls/ColorControl');
const { default: GradientStopsEditor } = await import('./controls/GradientStopsEditor');
const { LayerRow } = await import('./editor/LayerStack');
const { default: SceneCard } = await import('./switcher/SceneCard');
const { default: ErrorBoundary } = await import('./ErrorBoundary');

let uninstall;
beforeEach(() => {
  uninstall = installCanvasStub();
  // jsdom has no pointer capture; the controls only need the call to exist.
  Element.prototype.setPointerCapture = () => {};
  window.IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
});
afterEach(() => { cleanup(); uninstall(); });

const XY_ENTRY = {
  type: 'xy', label: 'Origin', xKey: 'x', yKey: 'y',
  xRange: [-3.625, 3.625], yRange: [-0.875, 0.875], margin: 2,
};

// ---- pointer cancel ----

test.each(['pointerCancel', 'lostPointerCapture'])(
  'the XY pad stops following the pointer after %s, and commits once',
  (ending) => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<XYPad entry={XY_ENTRY} x={0} y={0} onChange={onChange} onCommit={onCommit} />);
    const pad = screen.getByRole('slider');

    fireEvent.pointerDown(pad, { pointerId: 1 });
    fireEvent[ending](pad, { pointerId: 1 });
    onChange.mockClear();
    fireEvent.pointerMove(pad, { pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledTimes(1);
  },
);

test('pointerup then lostpointercapture commits once, not twice', () => {
  // The browser sends both at the end of every ordinary drag.
  const onCommit = vi.fn();
  render(<XYPad entry={XY_ENTRY} x={0} y={0} onChange={() => {}} onCommit={onCommit} />);
  const pad = screen.getByRole('slider');

  fireEvent.pointerDown(pad, { pointerId: 1 });
  fireEvent.pointerUp(pad, { pointerId: 1 });
  fireEvent.lostPointerCapture(pad, { pointerId: 1 });
  expect(onCommit).toHaveBeenCalledTimes(1);
});

test('the XY pad reports a value range, as a slider must', () => {
  render(<XYPad entry={XY_ENTRY} x={1.5} y={0} onChange={() => {}} />);
  const pad = screen.getByRole('slider');
  expect(pad.getAttribute('aria-valuenow')).toBe('1.5');
  expect(Number(pad.getAttribute('aria-valuemax'))).toBeGreaterThan(3.625);
  expect(Number(pad.getAttribute('aria-valuemin'))).toBe(-Number(pad.getAttribute('aria-valuemax')));
});

test('the angle dial stops following the pointer after a cancel', () => {
  const onChange = vi.fn();
  render(<AngleDial entry={{ label: 'Travel' }} value={0} onChange={onChange} onCommit={() => {}} />);
  const dial = screen.getByRole('slider');

  fireEvent.pointerDown(dial, { pointerId: 1 });
  fireEvent.pointerCancel(dial, { pointerId: 1 });
  onChange.mockClear();
  fireEvent.pointerMove(dial, { pointerId: 1 });
  expect(onChange).not.toHaveBeenCalled();
});

test('a gradient pin stops following the pointer after a cancel', () => {
  const onChange = vi.fn();
  const stops = [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }];
  const { container } = render(
    <GradientStopsEditor entry={{ label: 'Stops' }} stops={stops} onChange={onChange} onCommit={() => {}} />,
  );
  const pin = container.querySelector('.gradient-pin');

  fireEvent.pointerDown(pin, { pointerId: 1, clientX: 0 });
  fireEvent.pointerCancel(pin, { pointerId: 1 });
  fireEvent.pointerMove(pin, { pointerId: 1, clientX: 100 });
  expect(onChange).not.toHaveBeenCalled();
});

// ---- nested-button keys ----

test('Enter on a layer row\'s hide button is left to the button, not taken by the row', () => {
  const onSelect = vi.fn();
  render(
    <LayerRow
      layer={{ id: 'l1', enabled: true, solo: false, blendMode: 'normal', opacity: 1 }}
      effectName="Solid"
      onSelect={onSelect}
      onToggleEnabled={() => {}}
      onToggleSolo={() => {}}
    />,
  );
  const hide = screen.getByRole('button', { name: 'Hide layer' });
  // fireEvent returns false when the default was prevented — which is what
  // stopped the browser synthesising the button's own click.
  expect(fireEvent.keyDown(hide, { key: 'Enter' })).toBe(true);
  expect(onSelect).not.toHaveBeenCalled();

  // ...while the row itself still answers.
  fireEvent.keyDown(hide.closest('.layer-row'), { key: 'Enter' });
  expect(onSelect).toHaveBeenCalledTimes(1);
});

test('Enter on a scene card\'s Edit button edits without also activating', () => {
  const onActivate = vi.fn();
  const onKeyDown = vi.fn(() => false);
  render(
    <SceneCard
      scene={{ id: 's1', name: 'Embers', layerCount: 1 }}
      frames={0}
      onActivate={onActivate}
      onEdit={() => {}}
      onPointerDown={() => {}}
      onKeyDown={onKeyDown}
    />,
  );
  const edit = screen.getByRole('button', { name: 'Edit Embers' });
  fireEvent.keyDown(edit, { key: 'Enter' });
  expect(onActivate).not.toHaveBeenCalled();
  // Nor does Shift+Arrow on the button reorder the card.
  expect(onKeyDown).not.toHaveBeenCalled();

  fireEvent.keyDown(edit.closest('.scene-card'), { key: 'Enter' });
  expect(onActivate).toHaveBeenCalledTimes(1);
});

// ---- render throws ----

test('a colour control with no value renders instead of throwing', () => {
  render(<ColorControl label="Colour" value={undefined} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Custom colour picker' })).toBeTruthy();
});

test.each([
  ['missing', undefined],
  ['empty', []],
  ['malformed', [{ position: 'x' }]],
])('a gradient editor with %s stops renders instead of throwing', (_, stops) => {
  const { container } = render(
    <GradientStopsEditor entry={{ label: 'Stops' }} stops={stops} onChange={() => {}} />,
  );
  expect(container.querySelectorAll('.gradient-pin')).toHaveLength(2);
});

function Boom() {
  throw new Error('kaboom');
}

test('a view that throws is caught, and Back to scenes recovers it', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const onHome = vi.fn();
  function Harness({ broken, route }) {
    return (
      <ErrorBoundary resetKey={route} onHome={onHome}>
        {broken ? <Boom /> : <p>scenes</p>}
      </ErrorBoundary>
    );
  }
  const { rerender } = render(<Harness broken route="editor/s1" />);
  expect(screen.getByRole('alert').textContent).toContain('kaboom');

  // Navigating home changes the route, and the switcher renders again.
  fireEvent.click(screen.getByRole('button', { name: 'Back to scenes' }));
  expect(onHome).toHaveBeenCalled();
  rerender(<Harness broken={false} route="switcher/" />);
  expect(screen.getByText('scenes')).toBeTruthy();
  spy.mockRestore();
});
