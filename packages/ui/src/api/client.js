// REST client for the scene/mixer API.

export const baseUrl = import.meta.env.REACT_APP_LIGHTPANEL_API_SERVER || window.location.origin;
export const wsUrl = import.meta.env.REACT_APP_LIGHTPANEL_WS_SERVER
  || baseUrl.replace(/^http(s?)/, 'ws$1').replace(/:\d+$/, ':3001');

async function request(method, path, body) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    mode: 'cors',
    cache: 'no-cache',
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  const type = res.headers.get('content-type') || '';
  return type.includes('application/json') ? res.json() : res.text();
}

export const api = {
  effects: () => request('GET', '/api/effects'),
  scenes: () => request('GET', '/api/scenes'),
  scene: (id) => request('GET', `/api/scenes/${id}`),
  createScene: (scene) => request('POST', '/api/scenes', scene),
  updateScene: (id, scene) => request('PUT', `/api/scenes/${id}`, scene),
  deleteScene: (id) => request('DELETE', `/api/scenes/${id}`),
  updateLayer: (sceneId, layerId, layer) => request('PUT', `/api/scenes/${sceneId}/layers/${layerId}`, layer),
  activeScene: () => request('GET', '/api/active_scene'),
  setActiveScene: (id) => request('PUT', '/api/active_scene', { id }),
  brightness: () => request('GET', '/api/brightness/'),
  setBrightness: (value) => request('PUT', `/api/brightness/${value}`),
  virtual: () => request('GET', '/api/virtual'),
  exportScenes: () => request('GET', '/api/scenes/export'),
  importScenes: (payload) => request('POST', '/api/scenes/import', payload),
};
