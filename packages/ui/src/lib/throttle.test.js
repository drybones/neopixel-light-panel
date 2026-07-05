import { describe, it, expect, vi } from 'vitest';
import { createKeyedThrottle } from './throttle';

describe('createKeyedThrottle', () => {
  it('coalesces rapid calls and fires the latest', async () => {
    vi.useFakeTimers();
    const throttle = createKeyedThrottle(80);
    const calls = [];
    throttle.schedule('k', () => calls.push(1));
    throttle.schedule('k', () => calls.push(2));
    throttle.schedule('k', () => calls.push(3));
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(calls).toEqual([3]);
    vi.useRealTimers();
  });

  it('flush fires the pending call immediately', () => {
    vi.useFakeTimers();
    const throttle = createKeyedThrottle(80);
    const calls = [];
    throttle.schedule('k', () => calls.push('a'));
    throttle.flush('k');
    expect(calls).toEqual(['a']);
    vi.advanceTimersByTime(200);
    expect(calls).toEqual(['a']);
    vi.useRealTimers();
  });

  it('keys are independent', () => {
    vi.useFakeTimers();
    const throttle = createKeyedThrottle(80);
    const calls = [];
    throttle.schedule('a', () => calls.push('a'));
    throttle.schedule('b', () => calls.push('b'));
    vi.advanceTimersByTime(100);
    expect(calls.sort()).toEqual(['a', 'b']);
    vi.useRealTimers();
  });

  it('flush of an empty key is a no-op', () => {
    const throttle = createKeyedThrottle(80);
    expect(() => throttle.flush('missing')).not.toThrow();
  });
});
