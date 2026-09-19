// Single WebSocket connection to the pixel broadcaster. Frames never
// enter React state — canvases subscribe and paint imperatively.
//
// Every message is {type:"frame", composite, layers?}: the composite for
// every client, layers only for one that asked (setLayerScene). There were
// two shapes until #121, told apart by the message's first character, and an
// unrecognised one was dropped silently — the previews simply froze.

import { wsUrl } from './client';

const compositeSubs = new Set();
const layerSubs = new Map(); // layerId → Set<cb>

let ws = null;
let reconnectDelay = 500;
let connected = false;
let layerSceneId = null; // scene whose layer previews we want
const statusSubs = new Set();

function notifyStatus() {
  statusSubs.forEach((cb) => cb(connected));
}

function handleMessage(data) {
  const msg = JSON.parse(data);
  if (msg.type !== 'frame') return;
  if (msg.composite) compositeSubs.forEach((cb) => cb(msg.composite));
  if (msg.layers) {
    for (const [layerId, frame] of Object.entries(msg.layers)) {
      const subs = layerSubs.get(layerId);
      if (subs) subs.forEach((cb) => cb(frame));
    }
  }
}

function connect() {
  if (ws) return;
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    connected = true;
    reconnectDelay = 500;
    if (layerSceneId) ws.send(JSON.stringify({ type: 'subscribe_layers', sceneId: layerSceneId }));
    notifyStatus();
  };
  ws.onmessage = (e) => handleMessage(e.data);
  ws.onclose = () => {
    ws = null;
    connected = false;
    notifyStatus();
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
  };
  ws.onerror = () => {
    if (ws) ws.close();
  };
}

export function subscribeComposite(cb) {
  connect();
  compositeSubs.add(cb);
  return () => compositeSubs.delete(cb);
}

export function subscribeLayer(layerId, cb) {
  connect();
  let subs = layerSubs.get(layerId);
  if (!subs) {
    subs = new Set();
    layerSubs.set(layerId, subs);
  }
  subs.add(cb);
  return () => {
    subs.delete(cb);
    if (subs.size === 0) layerSubs.delete(layerId);
  };
}

export function subscribeStatus(cb) {
  connect();
  statusSubs.add(cb);
  cb(connected);
  return () => statusSubs.delete(cb);
}

export function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// Ask the server for per-layer preview frames of one scene (or null to
// stop). Survives reconnects; the editor sets this on mount/unmount.
export function setLayerScene(sceneId) {
  layerSceneId = sceneId;
  send(sceneId
    ? { type: 'subscribe_layers', sceneId }
    : { type: 'unsubscribe_layers' });
}
