// @vitest-environment jsdom
/*
 * The two-step confirm is a safety mechanism, not a decoration: three
 * controls in the scene library can destroy work behind it. So it gets a
 * mounted test rather than a look — one click must not fire, and a mis-click
 * must not sit armed waiting for whatever gets pressed next.
 */

import React from 'react';
import {
  afterEach, expect, test, vi,
} from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import ArmedButton from './ArmedButton';

afterEach(cleanup);

test('the first click arms, the second confirms', () => {
  const onConfirm = vi.fn();
  render(<ArmedButton label="Delete all" armedLabel="Really?" onConfirm={onConfirm} />);

  const button = screen.getByRole('button');
  fireEvent.click(button);
  expect(onConfirm).not.toHaveBeenCalled();
  expect(button.textContent).toBe('Really?');
  expect(button.className).toContain('btn-danger-armed');

  fireEvent.click(button);
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(button.textContent).toBe('Delete all');
});

test('blur and Escape disarm', () => {
  const onConfirm = vi.fn();
  render(<ArmedButton label="Delete all" armedLabel="Really?" onConfirm={onConfirm} />);
  const button = screen.getByRole('button');

  fireEvent.click(button);
  fireEvent.blur(button);
  expect(button.textContent).toBe('Delete all');

  fireEvent.click(button);
  fireEvent.keyDown(button, { key: 'Escape' });
  expect(button.textContent).toBe('Delete all');
  expect(onConfirm).not.toHaveBeenCalled();
});

test('without armedLabel it is an ordinary button, danger styling included', () => {
  // The merging import renders this too; only the mode prop separates it from
  // the replacing one.
  const onConfirm = vi.fn();
  render(<ArmedButton label="Import" onConfirm={onConfirm} />);
  const button = screen.getByRole('button');

  expect(button.className).not.toContain('btn-danger');
  fireEvent.click(button);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
