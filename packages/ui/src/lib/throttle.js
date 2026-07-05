// Trailing throttle keyed by an id — at most one call per interval per
// key, always ending with the latest arguments. flush(key) fires any
// pending call immediately (used on pointer-up so the final value of a
// drag is never lost).

export function createKeyedThrottle(intervalMs) {
  const pending = new Map(); // key → { fn, timer }

  function schedule(key, fn) {
    const entry = pending.get(key);
    if (entry) {
      entry.fn = fn;
      return;
    }
    const timer = setTimeout(() => {
      const current = pending.get(key);
      pending.delete(key);
      if (current) current.fn();
    }, intervalMs);
    pending.set(key, { fn, timer });
  }

  function flush(key) {
    const entry = pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(key);
    entry.fn();
  }

  function flushAll() {
    for (const key of [...pending.keys()]) flush(key);
  }

  return { schedule, flush, flushAll };
}
