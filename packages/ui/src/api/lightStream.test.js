// @vitest-environment jsdom
/*
 * The single WebSocket: frame routing, reconnect backoff, and the layer
 * subscription surviving a drop.
 *
 * The socket is faked, and the module is re-imported per test because its
 * connection state is module-level — one socket for the whole app is the
 * point of it.
 */

import {
  afterEach, beforeEach, expect, test, vi,
} from 'vitest';

vi.mock('./client', () => ({ wsUrl: 'ws://panel:3001' }));

class FakeSocket {
  static OPEN = 1;

  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeSocket.instances.push(this);
  }

  send(data) { this.sent.push(JSON.parse(data)); }

  close() { this.readyState = 3; if (this.onclose) this.onclose(); }

  // Test side: what the server and the network do.
  open() { this.readyState = FakeSocket.OPEN; this.onopen(); }

  receive(obj) { this.onmessage({ data: JSON.stringify(obj) }); }

  drop() { this.close(); }
}

let stream;
beforeEach(async () => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.resetModules();
  stream = await import('./lightStream');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1];

test('one socket for every subscriber', () => {
  stream.subscribeComposite(() => {});
  stream.subscribeLayer('l1', () => {});
  stream.subscribeStatus(() => {});
  expect(FakeSocket.instances).toHaveLength(1);
  expect(latest().url).toBe('ws://panel:3001');
});

test('a frame goes to composite subscribers, and its layers to theirs', () => {
  const composite = vi.fn();
  const layer = vi.fn();
  const otherLayer = vi.fn();
  stream.subscribeComposite(composite);
  stream.subscribeLayer('l1', layer);
  stream.subscribeLayer('l2', otherLayer);
  latest().open();

  // A frame without layers: the shape every client gets until it subscribes.
  latest().receive({ type: 'frame', composite: [[1, 2, 3]] });
  expect(composite).toHaveBeenLastCalledWith([[1, 2, 3]]);
  expect(layer).not.toHaveBeenCalled();

  latest().receive({ type: 'frame', composite: [[4, 5, 6]], layers: { l1: [[7, 8, 9]] } });
  expect(composite).toHaveBeenLastCalledWith([[4, 5, 6]]);
  expect(layer).toHaveBeenCalledWith([[7, 8, 9]]);
  expect(otherLayer).not.toHaveBeenCalled();
});

test('a message that is not a frame is ignored rather than thrown on', () => {
  // There is one shape now, so anything else is a server that has moved on
  // without this client. Dropping it quietly is what the two-shape version
  // did to *frames* by accident (#121); doing it to non-frames is the point.
  const composite = vi.fn();
  stream.subscribeComposite(composite);
  latest().open();

  expect(() => latest().receive({ type: 'something_else' })).not.toThrow();
  expect(composite).not.toHaveBeenCalled();

  latest().receive({ type: 'frame', composite: [[1, 1, 1]] });
  expect(composite).toHaveBeenCalledTimes(1);
});

test('status follows the socket, and a new subscriber is told the current state at once', () => {
  const status = vi.fn();
  stream.subscribeStatus(status);
  expect(status).toHaveBeenLastCalledWith(false);
  latest().open();
  expect(status).toHaveBeenLastCalledWith(true);

  const late = vi.fn();
  stream.subscribeStatus(late);
  expect(late).toHaveBeenCalledWith(true);

  latest().drop();
  expect(status).toHaveBeenLastCalledWith(false);
});

test('reconnects back off 0.5s, 1s, 2s … capped at 10s', () => {
  stream.subscribeStatus(() => {});
  const waits = [];
  for (let i = 0; i < 7; i++) {
    const before = FakeSocket.instances.length;
    latest().drop();
    let waited = 0;
    while (FakeSocket.instances.length === before) { vi.advanceTimersByTime(100); waited += 100; }
    waits.push(waited);
  }
  expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000]);
});

test('a successful open resets the backoff', () => {
  stream.subscribeStatus(() => {});
  latest().drop();
  vi.advanceTimersByTime(500);
  latest().drop();
  vi.advanceTimersByTime(1000);
  latest().open();

  const before = FakeSocket.instances.length;
  latest().drop();
  vi.advanceTimersByTime(500);
  expect(FakeSocket.instances.length).toBe(before + 1);
});

test('the layer subscription is re-sent on every reconnect', () => {
  // The server's subscription lives on the socket, so a dropped connection
  // loses it; without the resend the editor's thumbnails would freeze after
  // the first blip.
  stream.subscribeStatus(() => {});
  latest().open();
  stream.setLayerScene('s1');
  expect(latest().sent).toEqual([{ type: 'subscribe_layers', sceneId: 's1' }]);

  latest().drop();
  vi.advanceTimersByTime(500);
  latest().open();
  expect(latest().sent).toEqual([{ type: 'subscribe_layers', sceneId: 's1' }]);
});

test('a layer scene set while disconnected is sent once the socket opens', () => {
  stream.subscribeStatus(() => {});
  stream.setLayerScene('s1');   // not open yet: nothing to send on
  expect(latest().sent).toEqual([]);
  latest().open();
  expect(latest().sent).toEqual([{ type: 'subscribe_layers', sceneId: 's1' }]);
});

test('clearing the layer scene unsubscribes, and a reconnect does not resubscribe', () => {
  stream.subscribeStatus(() => {});
  latest().open();
  stream.setLayerScene('s1');
  stream.setLayerScene(null);
  expect(latest().sent[1]).toEqual({ type: 'unsubscribe_layers' });

  latest().drop();
  vi.advanceTimersByTime(500);
  latest().open();
  expect(latest().sent).toEqual([]);
});

test('an unsubscribed layer callback hears nothing more', () => {
  const layer = vi.fn();
  const unsub = stream.subscribeLayer('l1', layer);
  latest().open();
  unsub();
  latest().receive({ type: 'frame', layers: { l1: [[1, 1, 1]] } });
  expect(layer).not.toHaveBeenCalled();
});
