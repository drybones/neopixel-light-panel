// @vitest-environment jsdom
/*
 * Every schema entry in the server's real effect catalog gets a control.
 *
 * ParamPanel's switch ends in `default: return null`, so an entry type it has
 * no `case` for renders nothing at all — no error, no warning, just a param
 * you cannot reach. ParamPanel.test.jsx pins the switch against a demo schema;
 * this pins it against the schemas that actually ship, by reading them from
 * packages/server rather than restating them here, so a new entry type added
 * on the server fails this until the UI can draw it.
 *
 * Also a render of every effect at its defaults, which is the one place the
 * real schemas meet the real controls short of a browser.
 */

import React from 'react';
import { createRequire } from 'node:module';
import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { installCanvasStub } from '../../test/canvasStub';

vi.mock('../../api/lightStream', () => ({
  subscribeComposite: () => () => {},
  subscribeLayer: () => () => {},
}));

const { default: ParamPanel } = await import('./ParamPanel');

const require = createRequire(import.meta.url);
const CATALOG = require('../../../../server/effects').catalog();

let uninstall;
beforeEach(() => { uninstall = installCanvasStub(); });
afterEach(() => { cleanup(); uninstall(); });

function layerFor(effect) {
  return {
    id: `layer-${effect.type}`,
    effectType: effect.type,
    params: { ...effect.defaults },
    blendMode: 'normal',
    opacity: 1,
    enabled: true,
    solo: false,
  };
}

test('the catalog is the real one, not an empty stand-in', () => {
  expect(CATALOG.length).toBeGreaterThan(5);
});

describe.each(CATALOG.map((e) => [e.type, e]))('%s', (_, effect) => {
  test('renders at its defaults without a React error', () => {
    const errors = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a));
    render(
      <ParamPanel layer={layerFor(effect)} effect={effect}
        onUpdate={() => {}} onCommit={() => {}} onDelete={() => {}} onDuplicate={() => {}} />,
    );
    spy.mockRestore();
    expect(errors.map((a) => String(a[0]))).toEqual([]);
  });

  test.each(effect.schema.map((entry, i) => [`${entry.type} "${entry.label}"`, entry, i]))(
    'draws %s',
    (__, entry) => {
      const { container } = render(
        <ParamPanel layer={layerFor(effect)} effect={effect}
          onUpdate={() => {}} onCommit={() => {}} onDelete={() => {}} onDuplicate={() => {}} />,
      );
      // Each control labels itself with the entry's label; a type with no
      // case renders no element carrying it.
      const labels = [...container.querySelectorAll('.control-label, .param-group')]
        .map((n) => n.textContent.trim());
      expect(labels).toContain(entry.label);
    },
  );
});
