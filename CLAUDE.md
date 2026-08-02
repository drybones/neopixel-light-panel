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
- `components/controls/` — schema-driven controls: ColorControl (react-colorful), NumberControl (`linear`, `atan` perceptual or `log` scale — `lib/perceptual.js`), RangeControl, EnumSelect, XYPad (live layer render as pad background), AngleDial (draws the wavefronts, not just a knob; its arrow points the way the wave **travels**, so the control agrees with the motion — note that is the opposite of where an equivalent wavelet's source sits), NumField, GradientStopsEditor.
- Every control row ends with a value column (`.control-num` + the row gap = `--value-col`), so the controls that would otherwise fill the row — the pad and the gradient strip — reserve it as `margin-right` and share the sliders' right-hand edge. Range inputs carry `margin: 0` to cancel the UA's 2px, which is what makes that arithmetic exact.
- `lib/perceptual.js` — the two non-linear slider scales. `atan` (`sliderScalingParam = 6.7975`, which is `10/atan(10)` — it exists solely to make the hardcoded ±10 track span values ±10) backs the brightness `range` pair. `log` backs everything spanning decades — wavelength, the speeds, noise scale/contrast, the glow floors — on an **integer 0…`LOG_STEPS` track**, so equal travel is equal ratio and there are no float-step artefacts; `step` in the schema does not apply to it. **`zeroable` reserves position 0 for an exact `0`** and spreads the range over 1…`LOG_STEPS`, because a log scale cannot express zero and real scenes store `freq: 0` and `glow: 0` to mean frozen / no floor. The inverse **clamps to position 1, not 0**, for a value between 0 and `min` — otherwise "nearly off" reads on the track as "off". Schema `min`/`max` are hints, not validation: values outside them render fine and the slider just pins, which is what keeps a `lambda` of 10000 intact until deliberately dragged.
- `lib/numberFormat.js` — how a value reads in the column beside every drag control. 2dp at and above 1, but **three significant figures below it**, because the log sliders reach 0.001 and a flat 2dp renders that as `"0"` and 0.005 as `"0.01"` — a reading that looks real and isn't.
- `lib/panelGrid.js` — frame index → grid cell. Frames arrive in **strip order**, not grid order (`di = N-1-i`), and reversing a row-major index is a 180° rotation — so anything drawing a frame must go through this. The position pad reimplemented the mapping without the reversal once and rendered upside-down under a correctly-placed handle.
- `lib/ledPaint.js` — how a frame becomes pixels, for both the previews and the pad's backdrop (they were deliberately matched in relative dot size, so the look has to change in one place). An LED is drawn as a bright core plus **three octaves of glow** — halo 0.35, wash 1.2, field 4.0 × cell — summed with `lighter`. Three, because the panel photographs as two scales at once (a tight halo and a broad regional wash) and one gaussian cannot be both: it dies superexponentially, and its peak falls as 1/σ², so a wide blur is also a faint one. Summing gaussians of geometrically increasing width approximates the heavy-tailed falloff of real diffused light. The widest octave is nearly invisible per LED but every LED contributes to every point, so it is what makes a lit *region* glow.
  - **`gain` is a stack count, not a brightness.** A blur puts its falloff in the alpha channel and `brightness()` only touches RGB, which is already clipped for anything near white — it measures as a complete no-op. Drawing the blurred layer additively n times scales linearly with no ceiling. Each octave is blurred **once** into a temp canvas and then stacked as plain blits, so extra gain is nearly free; re-running the filter per draw would pay for the blur every time.
  - Callers pass their own **positions array** (flat `[x0,y0,…]`, frame-index order) rather than a grid, because the pad's LEDs run through `worldToPad` and are not evenly spaced once zoomed. Every length is a factor of one LED cell, so one constant set holds at 30px cells (stage), 20 (pad), 10 (card) and 4 (thumbnails).
  - Two guards that must not be dropped: below `minCellPx` it falls back to flat (a sub-pixel core is just a dimmer dot — the layer thumbnails rely on this and render pixel-identically to the old path), and `ctx.filter` is feature-detected, since Safari only shipped it in 17 and an engine without it would silently render doubled-brightness hard discs.
  - Anything drawn **after** the LEDs must sit outside the additive pass — the pad's zone labels and panel outline blow out under `lighter`.
- `lib/colors.js` — `parseHex`/`formatHex` back the hex fields (tolerates a missing `#` and the 3-digit shorthand, normalises to lowercase `#rrggbb`, returns `null` for anything else). `layerSwatches` — scene-card colours. A hardcoded per-effect switch (a representative colour is a judgement, not derivable from the schema), so **a new effect needs a case here** or its scenes show blank cards until opened. The `default` falls back to a plain `color` param as a safety net.
- `lib/xyPad.js` — pad geometry, with a zoom step per zone: `panel`, `near` (one ring), `far` (a second, compressed ring). Each ring is a **fixed world-unit width on all four sides**, which keeps one scale on both axes so the drag direction is the value's direction — an aspect-matched ring skews corner drags by tens of degrees. Constant width means **each level has its own aspect ratio** (3.75 / 1.92 / 1.55), so the pad's height changes with zoom; `aspectRatio` is set inline from `padGeometry`. The panel is framed on its **cell box** (`boxX`/`boxY` — half an LED pitch beyond the centres in `xRange`/`yRange`), matching how the stage frames it, so edge LEDs are whole circles and `panel` zoom is exactly the stage's 30/8; `panelX`/`panelY` stay the centres, for placing pixels and for the far-field threshold. Distance is a rectangular offset `max(|u|-boxX, |v|-boxY)` so its contours *are* the rings. Across the far ring the whole vector is scaled by `L^(τ²)`, `L = farLimit/halfX`: exponential so reach spreads across the drag instead of bunching in the last pixels, `τ²` so `m'(0)=0` and the seam is C¹, and `m(1)=L` exactly so the edge lands on `farLimit` with nothing to clamp. `padScale` inverts by bisection — the mapping is defined on the screen offset, and only the handle ever needs the inverse.
- `GradientStopsEditor` — the two **end** colours (first/last by position, so a stop dragged past an end swaps them) sit under the strip as hex fields anchored left and right; they never follow the pins, so a value stays where you last read it. A pin opens react-colorful under itself, dismissed by clicking away like ColorControl's — `left` is clamped inline against `POPOVER_WIDTH` to keep it inside the strip, and the **pins** sit above the backdrop (`z-index`) so pin-to-pin is one click while the strip stays under it, where a click away dismisses rather than adding a stop. A bare-strip click adds a stop; since a drag ends in a click on the pin it started from, `PIN_RADIUS` is the slop that separates the two (below it the stop doesn't move and the click opens the picker), and it doubles as the "too close to an existing stop" test that keeps an out-of-habit double-click from dropping two.
- `DraftField` — the typed escape hatch beside every drag control, wrapped by `NumField` (NumberControl, RangeControl, XYPad, AngleDial) and used directly with `formatHex`/`parseHex` for the colour hex (ColorControl, GradientStopsEditor). It commits through a **ref, not state**: Escape clears the draft and blurs on the same tick, and a `setState` isn't visible to the blur handler that runs next. It also calls `onCommit` itself — a typed edit has no pointer-up, so nothing else would flush the store's 80ms throttle. `parse` returning `null` abandons the edit, which is how an unreadable hex reverts. Numbers are **not clamped to the schema's min/max**: presets carry values no slider can reach (`lambda` runs 0.001–10000 against a 0.05–2 slider), so typing is the only way to restore one after a stray drag.

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
