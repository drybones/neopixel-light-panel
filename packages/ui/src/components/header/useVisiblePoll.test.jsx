// @vitest-environment jsdom
import React from 'react';
import {
  afterEach, beforeEach, expect, test, vi,
} from 'vitest';
import { cleanup, render } from '@testing-library/react';
import useVisiblePoll from './useVisiblePoll';

function Poller({ poll, enabled }) {
  useVisiblePoll(poll, enabled, 1000);
  return null;
}

let hidden;
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('polls at once and then every interval while enabled', () => {
  const poll = vi.fn();
  render(<Poller poll={poll} enabled />);
  expect(poll).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(3000);
  expect(poll).toHaveBeenCalledTimes(4);
});

test('a disabled pill does not poll, and disabling stops it', () => {
  const poll = vi.fn();
  const { rerender } = render(<Poller poll={poll} enabled={false} />);
  vi.advanceTimersByTime(3000);
  expect(poll).not.toHaveBeenCalled();

  rerender(<Poller poll={poll} enabled />);
  expect(poll).toHaveBeenCalledTimes(1);
  rerender(<Poller poll={poll} enabled={false} />);
  vi.advanceTimersByTime(3000);
  expect(poll).toHaveBeenCalledTimes(1);
});

test('pauses while the tab is hidden and polls the moment it comes back', () => {
  const poll = vi.fn();
  render(<Poller poll={poll} enabled />);
  hidden = true;
  vi.advanceTimersByTime(3000);
  expect(poll).toHaveBeenCalledTimes(1);

  // Without the visibilitychange poll the first thing shown on return would
  // be a number from whenever the tab was last looked at, for up to a second.
  hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  expect(poll).toHaveBeenCalledTimes(2);
});
