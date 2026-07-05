# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

```
packages/
  server/   — Node.js/Express API + animation engine (runs on a Raspberry Pi)
  ui/       — React control UI (visual mixer)
```

## Commands

From the **repo root**:
```bash
npm install          # install all workspace deps
npm run dev          # start server (VIRTUAL=1) + UI together via concurrently
npm start            # start server with real Fadecandy hardware
```

From **`packages/ui/`**:
```bash
npm start            # Vite dev server on port 3002
npm run build        # production build into dist/
npm test             # vitest tests
```

From **`packages/server/`**:
```bash
node app.js            # start with real Fadecandy hardware (port 3000)
VIRTUAL=1 node app.js  # virtual mode — no hardware, WebSocket visualiser only
npm run dev            # alias for VIRTUAL=1 node app.js
npm test               # node:test suite (node --test)
```

The deployed Raspberry Pi runs **Node 14** (`lightpanel.service`) — keep server runtime code to ES2019 (no `?.`/`??` in `packages/server/` outside tests).

## Server Architecture (`packages/server/`)

Drives a 240-LED panel (30×8 grid) via Fadecandy using the Open Pixel Control protocol, rendering at 100 FPS (10ms `setInterval`). One **scene** is active at a time; a scene is an ordered stack of **layers**, each an effect instance with `{effectType, params, blendMode, opacity, enabled, solo}`. `layers[0]` is the bottom of the stack.

Key modules:
- `app.js` — Express wiring, render-loop tick, storage init + migration + built-in seeding. "Off" = `activeSceneId null`: one black frame, then the loop fast-exits.
- `engine/compositor.js` — per-layer `Float32Array` buffers (0–255 float range), blend math (`normal/add/multiply/screen/overlay` resolved to ints on the write path), composite written through `client.setPixel()` **which applies global brightness — never apply brightness in the compositor**.
- `engine/scene-store.js` — scene list + active id, `preprocess()` on every write (attaches `_prepared`, `_blend`, `_displayLayers` so the hot loop never parses/filters), debounced writes (2s trailing; flushed on SIGINT/SIGTERM).
- `engine/json-store.js` — **scenes persist to `packages/server/.node-persist/scenes-v2.json` via atomic tmp+fsync+rename with a `.bak` fallback**, NOT node-persist: node-persist's plain `fs.writeFile` lost scene data to a power cut once. node-persist (with `forgiveParseErrors: true`) remains only for brightness and legacy keys (`wave_config`, old `scenes_v2`), which the store falls back to when the scene file is absent.
- `engine/migrate.js` — one-time `wave_config` → scenes conversion (one wavelet layer per wavelet, `add` blend). Old key kept for rollback.
- `engine/broadcast.js` — the only WebSocket server (port 3001), both modes. v1: bare `[[r,g,b],…]` composite frames ~30 FPS, last frame replayed to new connections. v2: `subscribe_layers` → `{type:"frame", composite, layers}` at ~15 FPS, only serialised while subscribers exist.
- `effects/*.js` — one module per effect: `{type, name, schema, defaults, prepare(params), createInstance(ctx)}`. `prepare()` runs on the API write path (hex→rgb, LUTs); `createInstance()` holds per-layer animation state and is recreated **only** on effectType change (param edits must not reset particles). Hot loops are allocation-free.
- `opc.js` / `virtual-opc.js` — pixel sinks; swapped on `VIRTUAL` env var. Hardware buffer has a 4-byte OPC header (broadcast uses `headerOffset`).
- `layout.json` — 240 LED positions; x ∈ ±3.625, z ∈ ±0.875, 0.25 spacing. Effect `y` params negate z (`dz = pz + y`).

## UI Architecture (`packages/ui/`)

React 18 + Vite + zustand. Entry `src/index.jsx`; hash routing in `App.jsx` (`#/edit/:sceneId`), no router dependency.

- `api/client.js` — REST wrappers. `api/lightStream.js` — the single WebSocket; frames go to imperative canvas subscribers, **never React state**. `setLayerScene(id)` manages the v2 layer-preview subscription across reconnects.
- `state/store.js` — zustand store. Param drags: optimistic update + 80ms trailing throttle per layer to `PUT /api/scenes/:id/layers/:layerId`, flushed on pointer-up (`flushLayer`). Structural edits PUT the whole scene immediately. No save button anywhere.
- `components/preview/LedCanvas.jsx` — shared 30×8 dot renderer, including the `di = N-1-i` serpentine reversal that matches the physical mount.
- `components/switcher/` — scene-card grid (mobile-friendly), live preview on active card, brightness, export/import.
- `components/editor/` — PreviewStage (draggable xy handles overlaid on the live composite), LayerStack (topmost first, live per-layer thumbnails via WS v2), ParamPanel (walks the effect schema from `/api/effects` — new server effects get UI for free), EffectPicker.
- `components/controls/` — schema-driven controls: ColorControl (react-colorful), NumberControl (linear or `atan` perceptual scale — `lib/perceptual.js`, `sliderScalingParam = 6.7975`), RangeControl, EnumSelect, XYPad (live layer render as pad background), GradientStopsEditor.

## Backend API

Server on port 3000; see [API.md](API.md) for full docs.

- `GET /api/effects` — effect catalog with param schemas (drives the UI)
- `GET|POST /api/scenes`, `GET|PUT|DELETE /api/scenes/:id` — scene CRUD (PUT does not activate)
- `PUT /api/scenes/:sceneId/layers/:layerId` — high-frequency single-layer edit path
- `GET|PUT /api/active_scene` — `{id}` or `{id: null}` for off
- `GET|POST /api/scenes/export|import` — `{version: 2, scenes}` bulk, import merges by id
- `GET|PUT /api/brightness/[value]` — global brightness 0–1; plain-text value
- `GET /api/virtual` — `{virtual: bool}`

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `REACT_APP_LIGHTPANEL_API_SERVER` | `http://localhost:3000` | Backend URL for the UI |
| `REACT_APP_LIGHTPANEL_WS_SERVER` | derived from above, port 3001 | WebSocket URL for previews |
| `FADECANDY_SERVER` | `localhost` | Fadecandy hostname (server only) |
| `VIRTUAL` | unset | Set to `1` to run without hardware |

UI dev port is `3002` (`packages/ui/vite.config.js`; port 5000 is avoided because AirPlay occupies it on macOS). The `REACT_APP_*` prefix is preserved via `envPrefix: 'REACT_APP_'`; referenced as `import.meta.env.REACT_APP_*`.
