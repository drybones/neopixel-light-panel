// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ReadoutPill from './ReadoutPill';

afterEach(cleanup);

function pill(title) {
  return <ReadoutPill kind="frame-rate" state="ok" label="91.0 fps" title={title} onClick={() => {}} />;
}

// #127: a native title re-shown on every poll is unreadable, so the text is
// our own element and a new reading must update it in place.
test('draws the title as a described-by tooltip, not a title attribute', () => {
  const { getByRole } = render(pill('Render loop: 91.0 fps'));
  const button = getByRole('button');
  const tip = getByRole('tooltip', { hidden: true });
  expect(button.hasAttribute('title')).toBe(false);
  expect(button.getAttribute('aria-describedby')).toBe(tip.id);
  expect(tip.textContent).toBe('Render loop: 91.0 fps');
});

test('a new reading updates the same tooltip node', () => {
  const { getByRole, rerender } = render(pill('Render loop: 91.0 fps'));
  const tip = getByRole('tooltip', { hidden: true });
  rerender(pill('Render loop: 90.8 fps'));
  expect(getByRole('tooltip', { hidden: true })).toBe(tip);
  expect(tip.textContent).toBe('Render loop: 90.8 fps');
});

test('no title, no tooltip', () => {
  const { queryByRole, getByRole } = render(pill(''));
  expect(queryByRole('tooltip', { hidden: true })).toBeNull();
  expect(getByRole('button').hasAttribute('aria-describedby')).toBe(false);
});
