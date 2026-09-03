// @vitest-environment jsdom
/*
 * The failure path, which is the whole reason this component has state.
 *
 * A browser may refuse a native dialog silently (Editor.jsx has the account),
 * and a suppressed alert() returns having shown nothing — so an import that
 * failed would look exactly like an import that did nothing. The message has
 * to be in the page. That is what these assert, alongside the invariant that
 * a failure must not fire `onDone`, since in the settings page onDone
 * navigates away from the message it would need to show.
 */

import React from 'react';
import {
  afterEach, expect, test, vi,
} from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../api/client', () => new Proxy({}, {
  get: () => () => Promise.resolve({}),
}));

const { useStore } = await import('../../state/store');
const { default: ImportScenesButton } = await import('./ImportScenesButton');

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// Drives the hidden <input type="file"> the way the picker would.
function pick(container, text) {
  const input = container.querySelector('input[type="file"]');
  const file = new File([text], 'scenes.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

test('a file that is not JSON reports in the page, never through window.alert', async () => {
  const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const onDone = vi.fn();
  const { container } = render(<ImportScenesButton onDone={onDone} />);

  pick(container, '<html>nope</html>');

  await waitFor(() => {
    expect(screen.getByText(/Import failed: the file is not valid JSON/)).toBeTruthy();
  });
  expect(alertSpy).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
});

test('a rejected import reports the server’s refusal and leaves the page alone', async () => {
  const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const onDone = vi.fn();
  useStore.setState({ importLibrary: () => Promise.reject(new Error('400')) });
  const { container } = render(<ImportScenesButton onDone={onDone} />);

  pick(container, JSON.stringify({ version: 1, scenes: [] }));

  await waitFor(() => {
    expect(screen.getByText(/the server rejected the file/)).toBeTruthy();
  });
  expect(alertSpy).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
});

test('a successful import reports nothing here and hands over to onDone', async () => {
  // Success is the caller's to announce: it may be about to navigate to a
  // switcher that already says so.
  const onDone = vi.fn();
  useStore.setState({ importLibrary: () => Promise.resolve() });
  const { container } = render(<ImportScenesButton onDone={onDone} />);

  pick(container, JSON.stringify({ version: 2, scenes: [] }));

  await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
  expect(container.querySelector('.row-status')).toBeNull();
});
