# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Outstanding work is tracked as **GitHub issues** — run `gh issue list`. Deeper rationale for individual UI modules lives in nested `CLAUDE.md` files beside the code (see [UI Architecture](#ui-architecture-packagesui)).

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
- `engine/planewave-migrate.js` — one-time conversion of far-away wavelets to `planewave`. Gated on *phase* error, not distance alone (a short `lambda` keeps curvature visible however far the source). Snapshots `scenes-v2.pre-planewave.json` first; the `planeWaveMigrated` flag in the scene document stops it re-running, so a wavelet later dragged to the pad's far edge stays a wavelet.
- `engine/panel.js` — panel extent (`HALF_X` 3.625, `HALF_Z` 0.875, `RADIUS`). The single source for `xy` schema ranges and gradient's radial normalisation; don't re-hardcode these.
- **Layer ids must be unique across the whole document, not just within a scene** — the compositor caches one render instance per layer id, so a shared id makes two scenes fight over it and, once their effect types differ, render each other's params as NaN. `SceneStore.setScenes` reassigns duplicates on load (the legacy preset data contains one).
- `engine/broadcast.js` — the only WebSocket server (port 3001), both modes. Serialises from `compositor.composite`, i.e. **pre-brightness** — UI previews are a pre-fader meter and never dim; only the panel does. v1: bare `[[r,g,b],…]` composite frames ~30 FPS, last frame replayed to new connections. v2: `subscribe_layers` → `{type:"frame", composite, layers}` at ~15 FPS, only serialised while subscribers exist.
- `effects/*.js` — one module per effect: `{type, name, schema, defaults, prepare(params), createInstance(ctx)}`. `prepare()` runs on the API write path (hex→rgb, LUTs); `createInstance()` holds per-layer animation state and is recreated **only** on effectType change (param edits must not reset particles). Hot loops are allocation-free.
- `opc.js` / `virtual-opc.js` — pixel sinks; swapped on `VIRTUAL` env var. Hardware buffer has a 4-byte OPC header; broadcast doesn't care, it reads the compositor instead.
- `layout.json` — 240 LED positions; x ∈ ±3.625, z ∈ ±0.875, 0.25 spacing. Effect `y` params negate z (`dz = pz + y`).

## UI Architecture (`packages/ui/`)

React 18 + Vite + zustand. Entry `src/index.jsx`; hash routing in `App.jsx` (`#/edit/:sceneId`), no router dependency.

- `api/client.js` — REST wrappers. `api/lightStream.js` — the single WebSocket; frames go to imperative canvas subscribers, **never React state**. `setLayerScene(id)` manages the v2 layer-preview subscription across reconnects.
- `state/store.js` — zustand store. Param drags: optimistic update + 80ms trailing throttle per layer to `PUT /api/scenes/:id/layers/:layerId`, flushed on pointer-up (`flushLayer`). Structural edits PUT the whole scene immediately. No save button anywhere.
- `components/preview/LedCanvas.jsx` — shared 30×8 renderer; all drawing lives in `lib/ledPaint`. `mode` picks `bloom` (default), `dots` (the pre-bloom flat discs) or `fill` (cell rectangles). Positions and bloom params are memoised per size and the 2D context is cached, because this repaints at the stream rate for every layer thumbnail as well as the composite — but the context is re-acquired in the same effect that creates the scratch, since a cached context on a swapped-out canvas node paints into a detached buffer.
- `components/switcher/` — scene-card grid (mobile-friendly), live preview on active card, brightness, export/import.
- `components/editor/` — PreviewStage (**read-only** live composite; it carried draggable xy handles once, which made position the only parameter editable outside the layer's panel — keep editing in ParamPanel), LayerStack (topmost first, live per-layer thumbnails via WS v2), ParamPanel (walks the effect schema from `/api/effects` — new server effects get UI for free), EffectPicker.
- `components/controls/` — schema-driven controls: ColorControl (react-colorful), NumberControl (`linear`, `atan` perceptual or `log` scale — `lib/perceptual.js`), RangeControl, EnumSelect, XYPad (live layer render as pad background), AngleDial, NumField, GradientStopsEditor, DraftField (the typed value beside every drag control).

**Module-level rationale lives beside the code**, and loads when you open those directories: [`src/lib/CLAUDE.md`](packages/ui/src/lib/CLAUDE.md) for the slider scales, value formatting, grid mapping, LED painting, colours and pad geometry; [`src/components/controls/CLAUDE.md`](packages/ui/src/components/controls/CLAUDE.md) for the gradient editor, the typed-value field, the angle dial and the control-row layout. Read those before editing anything in them. What stays here is only what bites from *outside* those directories:

- Frames arrive in **strip order**, not grid order — anything drawing a frame goes through `lib/panelGrid.js`. Reversing a row-major index is a 180° rotation, so a reimplemented mapping renders upside-down.
- **A new effect needs a `layerSwatches` case** in `lib/colors.js` — a hardcoded per-effect switch, because a representative colour is a judgement, not derivable from the schema. Without one its scenes show blank cards until opened.
- Schema `min`/`max` are **slider hints, not validation**. Values outside them render fine, the slider just pins, and typed entry is deliberately unclamped — that is what keeps a `lambda` of 10000 restorable after a stray drag.
- Numeric params declare a `scale`: `linear`, `atan` (brightness only), or **`log`** for anything spanning decades — plus **`zeroable: true`** wherever an exact `0` is a real setting (`freq: 0` frozen, `glow: 0` no floor), since a log scale cannot otherwise express zero.
- Anything drawn **after** the LEDs must sit outside `lib/ledPaint`'s additive pass — overlays blow out under `lighter`.

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
