// @vitest-environment jsdom
/*
 * The notice is the only confirmation the settings page's library actions
 * get — they navigate away from their own buttons to reach it — so its two
 * failure modes are both worth pinning: not appearing at all, and never
 * going away.
 */

import React from 'react';
import {
  afterEach, beforeEach, expect, test, vi,
} from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../api/client', () => new Proxy({}, {
  get: () => () => Promise.resolve({}),
}));

const { useStore } = await import('../../state/store');
const { default: LibraryNotice } = await import('./LibraryNotice');

beforeEach(() => { useStore.setState({ libraryNotice: null }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

test('renders nothing when there is nothing to say', () => {
  const { container } = render(<LibraryNotice />);
  expect(container.querySelector('.library-notice')).toBeNull();
});

test('shows the message the action left in the store', () => {
  useStore.setState({ libraryNotice: 'Restored the 12 default scenes.' });
  render(<LibraryNotice />);

  expect(screen.getByText('Restored the 12 default scenes.')).toBeTruthy();
  // A live region, so it is announced on arrival rather than only seen.
  expect(screen.getByRole('status')).toBeTruthy();
});

test('the dismiss button clears it from the store, not just from the DOM', () => {
  // Clearing only locally would bring it back on the next render of the grid.
  useStore.setState({ libraryNotice: 'Deleted every scene. The panel is off.' });
  const { container } = render(<LibraryNotice />);

  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(useStore.getState().libraryNotice).toBeNull();
  expect(container.querySelector('.library-notice')).toBeNull();
});

test('it clears itself, so it cannot outlive the moment it describes', () => {
  vi.useFakeTimers();
  useStore.setState({ libraryNotice: 'Imported 4 scenes; the library now has 31.' });
  const { container } = render(<LibraryNotice />);

  expect(container.querySelector('.library-notice')).toBeTruthy();
  vi.advanceTimersByTime(9000);
  expect(useStore.getState().libraryNotice).toBeNull();
});
