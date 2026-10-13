import { expect, test } from 'vitest';
import { isBlendOverridden, soloBaseId } from './solo';

function layer(id, extra = {}) {
  return { id, blendMode: 'multiply', enabled: true, solo: false, ...extra };
}

test('nothing soloed has no base', () => {
  expect(soloBaseId([layer('a'), layer('b')])).toBe(null);
  expect(soloBaseId([])).toBe(null);
  expect(soloBaseId(undefined)).toBe(null);
});

test('one soloed layer is the base', () => {
  expect(soloBaseId([layer('a'), layer('b', { solo: true }), layer('c')])).toBe('b');
});

test('the bottommost soloed layer is the base (layers are bottom-first)', () => {
  expect(soloBaseId([layer('a'), layer('b', { solo: true }), layer('c', { solo: true })])).toBe('b');
});

test('a hidden soloed layer is skipped, as the server skips it', () => {
  const layers = [layer('a', { solo: true, enabled: false }), layer('b', { solo: true })];
  expect(soloBaseId(layers)).toBe('b');
});

test('the override only matters when the base is not already normal', () => {
  const layers = [layer('a', { solo: true }), layer('b', { solo: true })];
  expect(isBlendOverridden(layers, layers[0])).toBe(true);
  expect(isBlendOverridden(layers, layers[1])).toBe(false);

  const normal = [layer('a', { solo: true, blendMode: 'normal' })];
  expect(isBlendOverridden(normal, normal[0])).toBe(false);
  expect(isBlendOverridden(layers, null)).toBe(false);
});
