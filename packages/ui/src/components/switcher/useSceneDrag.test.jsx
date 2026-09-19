// @vitest-environment jsdom
/*
 * The scene grid's drag, at the level of the hook — the parts of it that go
 * wrong silently rather than visibly:
 *
 *  - a drag must not activate the scene it ends on (the whole card is a
 *    click target, so the click that follows a drop would switch the panel);
 *  - the drop commits against the list as it is *then*, not as it was when
 *    the gesture started;
 *  - a drop that isn't a decision — Escape, the OS taking the pointer back —
 *    commits nothing.
 *
 * Layout is faked: jsdom has none, so each card reports a 100px-wide box at
 * its index along one row, which is all measureCentres reads.
 */

import React, { useRef } from 'react';
import {
  afterEach, beforeEach, expect, test, vi,
} from 'vitest';
import {
  act, cleanup, fireEvent, render,
} from '@testing-library/react';
import useSceneDrag from './useSceneDrag';

let restoreRect;
beforeEach(() => {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function rect() {
    const i = this.parentNode ? Array.from(this.parentNode.children).indexOf(this) : 0;
    return {
      left: i * 100, top: 0, width: 100, height: 50, right: i * 100 + 100, bottom: 50,
    };
  };
  restoreRect = () => { Element.prototype.getBoundingClientRect = original; };
  window.scrollBy = () => {};
});
afterEach(() => { cleanup(); restoreRect(); });

// `domIds` is what is laid out; `ids` is what the hook is told the list is.
// They differ only in the test that has the library change mid-gesture.
function Harness({ ids, domIds = ids, onCommit, hook }) {
  const gridRef = useRef(null);
  const drag = useSceneDrag(ids, gridRef, onCommit);
  hook.current = drag;
  return (
    <div ref={gridRef}>
      {domIds.map((id) => (
        <div key={id} data-scene-id={id} data-testid={id} onPointerDown={(e) => drag.onPointerDown(e, id)} />
      ))}
    </div>
  );
}

function mount(props) {
  const hook = { current: null };
  const onCommit = vi.fn();
  const utils = render(<Harness ids={['a', 'b', 'c']} onCommit={onCommit} hook={hook} {...props} />);
  return { ...utils, hook, onCommit };
}

// A mouse press on card `id` at x, mid-height and well clear of the
// auto-scroll edges.
const Y = 300;
function press(getByTestId, id, x) {
  fireEvent.pointerDown(getByTestId(id), {
    button: 0, pointerId: 1, pointerType: 'mouse', clientX: x, clientY: Y,
  });
}
function move(x) {
  fireEvent.pointerMove(window, { pointerId: 1, clientX: x, clientY: Y });
}
function up() {
  fireEvent.pointerUp(window, { pointerId: 1 });
}

test('a drop in another slot commits the moved list', () => {
  const { getByTestId, onCommit } = mount();
  press(getByTestId, 'a', 50);
  move(60);        // past the threshold: a drag now
  move(250);       // over c's slot
  act(() => up());

  expect(onCommit).toHaveBeenCalledWith(['b', 'c', 'a'], 'a', 2);
});

test('the click after a drag is swallowed, even when it ends on its own card', () => {
  // Dragged away and back: nothing to commit, but the release still lands a
  // click on the card that was held, and that click must not activate it.
  const { getByTestId, onCommit, hook } = mount();
  press(getByTestId, 'b', 150);
  move(170);
  move(150);
  act(() => up());

  expect(onCommit).not.toHaveBeenCalled();
  expect(hook.current.swallowClick()).toBe(true);
});

test('the guard clears on the next task, so the next ordinary click activates', async () => {
  const { getByTestId, hook } = mount();
  press(getByTestId, 'b', 150);
  move(170);
  act(() => up());
  await new Promise((r) => { setTimeout(r, 0); });
  expect(hook.current.swallowClick()).toBe(false);
});

test('a press that never moves is a click, not a drag', () => {
  const { getByTestId, onCommit, hook } = mount();
  press(getByTestId, 'a', 50);
  move(52);        // under the threshold
  act(() => up());

  expect(onCommit).not.toHaveBeenCalled();
  expect(hook.current.swallowClick()).toBe(false);
});

test('the drop commits against the list as it is now, not when the drag began', () => {
  // Another client reordered the library mid-gesture. Same length, so the
  // measured slots still hold; the commit must use the list it has now.
  const { getByTestId, onCommit, hook, rerender } = mount();
  press(getByTestId, 'a', 50);
  move(60);
  rerender(<Harness ids={['c', 'a', 'b']} domIds={['a', 'b', 'c']} onCommit={onCommit} hook={hook} />);
  move(250);
  act(() => up());

  expect(onCommit).toHaveBeenCalledWith(['a', 'b', 'c'], 'c', 2);
});

test('a library that changed length under the press abandons the drag', () => {
  // The measured slots no longer describe the list that would commit.
  const { getByTestId, onCommit, hook, rerender } = mount();
  press(getByTestId, 'a', 50);
  rerender(<Harness ids={['a', 'b', 'c', 'd']} domIds={['a', 'b', 'c']} onCommit={onCommit} hook={hook} />);
  move(60);
  move(250);
  act(() => up());

  expect(onCommit).not.toHaveBeenCalled();
});

test.each([
  ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
  ['pointercancel', () => fireEvent.pointerCancel(window, { pointerId: 1 })],
])('%s puts the card back without committing', (_, end) => {
  const { getByTestId, onCommit } = mount();
  press(getByTestId, 'a', 50);
  move(60);
  move(250);
  act(() => end());
  act(() => up());

  expect(onCommit).not.toHaveBeenCalled();
});
