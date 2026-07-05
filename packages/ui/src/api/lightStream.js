// Single WebSocket connection to the pixel broadcaster. Frames never
// enter React state — canvases subscribe and paint imperatively.
//
// v1 messages are bare [[r,g,b], ...] composite frames. Stage 5 adds
// {type:"frame", composite, layers} objects; the first character
// distinguishes them.

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
  if (data[0] === '[') {
    const frame = JSON.parse(data);
    compositeSubs.forEach((cb) => cb(frame));
    return;
  }
  const msg = JSON.parse(data);
  if (msg.type === 'frame') {
    if (msg.composite) compositeSubs.forEach((cb) => cb(msg.composite));
    if (msg.layers) {
      for (const [layerId, frame] of Object.entries(msg.layers)) {
        const subs = layerSubs.get(layerId);
        if (subs) subs.forEach((cb) => cb(frame));
      }
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
