# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

```
packages/
  server/   — Node.js/Express API + animation engine (was NeoPixelLightPanel)
  ui/       — React control UI (was neopixel-light-panel-ui)
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
node app.js          # start with real Fadecandy hardware (port 3000)
VIRTUAL=1 node app.js  # start in virtual mode — WebSocket broadcaster instead of Fadecandy
npm run dev          # alias for VIRTUAL=1 node app.js
```

## Server Architecture (`packages/server/`)

Node.js/Express server that drives a 240-LED panel (30×8 grid) via a Fadecandy device using the Open Pixel Control (OPC) protocol. Renders at 100 FPS (10ms `setInterval`).

Key files:
- `app.js` — Express REST API + render loop. Swaps OPC client based on `VIRTUAL` env var.
- `opc.js` — OPC TCP client (real hardware). `OPC` class is passed into `Shader` constructor.
- `virtual-opc.js` — Drop-in replacement for `opc.js` in virtual mode. Same API, broadcasts pixel state via WebSocket on port 3001 instead of TCP to Fadecandy.
- `shader.js` — All animation algorithms. `new Shader(OPC, client, model)` — takes the OPC *class* (for static methods like `OPC.hsv`) plus the client instance and the layout model.
- `layout.json` — 240 LED positions as `{point: [x, y, z]}` array.

`Shader` methods called via dynamic dispatch from the render loop: `off`, `embers`, `particle_trail`, `candy_sparkler`, `pastel_spots`, `interactive_wave(config)`.

## UI Architecture (`packages/ui/`)

Single-page React app (Vite + React 18). All component logic lives in `src/App.jsx` — no component directory structure.

**Component hierarchy:**
- `App` — root function component
- `PresetConfig` — main stateful function component (hooks); owns all state and API calls
  - `BrightnessControl` — global brightness slider
  - `PresetList` — sidebar preset list
  - `PresetItem` — right-side detail panel for selected preset
    - `WaveletItem` — per-wavelet editor with `react-colorful` colour picker
  - `LEDPanel` — canvas visualiser; connects to WebSocket (port 3001); hidden when not available

State is managed entirely in `PresetConfig`. Changes are sent to the backend on every input event — no debounce, no save button.

## Backend API

Server runs on port 3000. UI defaults to `http://localhost:3000` via `REACT_APP_LIGHTPANEL_API_SERVER`.

- `GET /api/all_presets/` — `{id, name, type}` array (fixed + user-created wavelet presets)
- `GET|PUT /api/current_preset_id/[id]` — active preset; returns plain-text ID
- `GET|PUT|DELETE /api/wave_config/[id]` — full wavelet preset; PUT also activates it
- `GET|PUT /api/brightness/[value]` — global brightness 0–1; returns plain-text value
- `GET|PUT /api/all_wave_config/` — bulk export/import of all wavelet presets

## Data Model

**Preset types:**
- `"fixed"` — hardcoded server animations. IDs: `f:off`, `f:embers`, `f:particle_trail`, `f:candy_sparkler`, `f:pastel_spots`
- `"wavelet"` — user-created, persisted via node-persist. IDs are `crypto.randomUUID()` values.

**Wavelet:**
```js
{ id, color: "#rrggbb", freq, lambda, delta, x, y, min, max, clip, solo }
```
- `freq` — oscillation speed; `lambda` — spatial wavelength; `delta` — phase offset
- `x`/`y` — panel position (`y` maps to Z axis in the physical 30×8 grid, ±3.6 X, ±0.9 Z, 0.25-unit spacing)
- `min`/`max` use a non-linear arctangent mapping (`sliderScalingParam = 6.7975`) for perceptual uniformity

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `REACT_APP_LIGHTPANEL_API_SERVER` | `http://localhost:3000` | Backend URL for the UI |
| `REACT_APP_LIGHTPANEL_WS_SERVER` | derived from above, port 3001 | WebSocket URL for LED visualiser |
| `FADECANDY_SERVER` | `localhost` | Fadecandy hostname (server only) |
| `VIRTUAL` | unset | Set to `1` to use virtual OPC (WebSocket) instead of Fadecandy |

UI dev port is `3002`, set in `packages/ui/vite.config.js`. Port 5000 is avoided because AirPlay occupies it on macOS.

The `REACT_APP_*` env var prefix is preserved in Vite via `envPrefix: 'REACT_APP_'` in `vite.config.js`; referenced in code as `import.meta.env.REACT_APP_*`.
