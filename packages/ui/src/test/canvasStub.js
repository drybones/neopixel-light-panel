/*
 * A recording 2D context for the render smoke tests.
 *
 * jsdom's getContext('2d') returns null, and the usual remedy is the `canvas`
 * npm package — a native module, which the Pi would then have to compile on
 * aarch64 during `npm install`. That is exactly the class of risk #81 and #83
 * are about, so it is not worth paying for tests that never inspect a pixel.
 *
 * A stub is also the better instrument here. What these tests ask is "did the
 * component acquire a context and draw", and a recorder answers that directly
 * — a real canvas would only let us infer it from pixels.
 *
 * The Proxy records every call and property write, and its `has` trap answers
 * true for everything, which is what lib/ledPaint's `'filter' in ctx` feature
 * detect needs to take the blur path rather than the iOS fallback.
 */

export function installCanvasStub() {
  const original = window.HTMLCanvasElement.prototype.getContext;

  window.HTMLCanvasElement.prototype.getContext = function getContext(type) {
    if (type !== '2d') return null;
    if (!this.__stubCtx) this.__stubCtx = makeContext(this);
    return this.__stubCtx;
  };

  return () => { window.HTMLCanvasElement.prototype.getContext = original; };
}

function makeContext(canvas) {
  const calls = [];
  const props = {};
  const methods = new Map();

  const base = {
    canvas,
    calls,
    // Every recorded call of one name, as arrays of arguments.
    callsTo(name) {
      return calls.filter((c) => c.name === name).map((c) => c.args);
    },
    // Canvas state is a mutable machine: a draw call means nothing without the
    // fillStyle standing at the time, so each record snapshots the properties.
    stateAt(name) {
      return calls.filter((c) => c.name === name).map((c) => c.state);
    },
    reset() { calls.length = 0; },
  };

  return new Proxy(base, {
    // `'filter' in ctx` decides whether ledPaint blurs or falls back
    has() { return true; },

    get(target, key) {
      if (key in target) return target[key];
      if (key in props) return props[key];
      if (!methods.has(key)) {
        methods.set(key, (...args) => {
          calls.push({ name: key, args, state: { ...props } });
          // createImageData/getImageData would need real pixels; nothing in
          // the components under test reads one back.
          return undefined;
        });
      }
      return methods.get(key);
    },

    set(target, key, value) {
      props[key] = value;
      calls.push({ name: `set:${key}`, args: [value], state: { ...props } });
      return true;
    },
  });
}
