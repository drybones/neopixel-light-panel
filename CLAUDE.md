# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Outstanding work is tracked as **GitHub issues** — run `gh issue list`. This file keeps only what bites across directories; module rationale lives beside the code, in file headers on the server and nested `CLAUDE.md` files in both packages (see [Server Architecture](#server-architecture-packagesserver) for the rule).

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
npm test             # both suites, server then UI
npm run lint         # eslint over both packages (eslint.config.mjs), also run in CI
```

From **`packages/ui/`**:
```bash
npm start            # Vite dev server on port 3002
npm run build        # production build into dist/
npm test             # vitest run (npm run test:watch for watch mode)
```

From **`packages/server/`**:
```bash
node app.js            # start with real Fadecandy hardware (port 3000)
VIRTUAL=1 node app.js  # virtual mode — no hardware, WebSocket visualiser only
npm run dev            # alias for VIRTUAL=1 node app.js
npm test               # node:test suite (node --test)
```

The deployed Raspberry Pi runs **Node 24** on Raspberry Pi OS (Debian 13/Trixie, 64-bit) via `lightpanel.service`, reprovisioned from the old Node 14/Buster setup in 2026-08 — server runtime code is no longer restricted to ES2019.

## Working on this repo

Conventions for anyone changing this code, human or Claude:

- **Work on a feature branch, never `main`.** `main` stays clean, and work is reviewed as branch commits and a PR.
- **Local dev scene data is scratch.** `packages/server/data/` on your machine changes whenever someone tests in a browser. Don't restore it after testing, and don't report drift as damage. The Pi's `data/` is real; the shipped defaults are `default-scenes.json`, not anyone's `data/`.
- **Snapshot scenes before driving the UI to verify something.** There is no save button: every slider move is an 80ms-throttled PUT, so verification writes to real scene data. Dump every scene first (`GET /api/scenes/export`), diff afterwards on `effectType`/`blendMode`/`opacity`/`enabled`/`solo` as well as params, and restore with a full-document `PUT /api/scenes/:id` or an import. Structural damage looks like a render bug in the UI, not like lost data. A tab left open across someone else's edits will write its stale copy of a layer back on the next change, so reload first.
- **Browser automation quirks that look like app bugs.** Setting an input's DOM `value` directly (e.g. a `form_input`-style tool) does not fire React's `onChange`, so the field shows the number and nothing is stored. Use real click/type/Enter events, or PUT through the API. A hidden browser pane reports `innerWidth: 0` and runs no `requestAnimationFrame`, so canvases measure zero and animations freeze; measure layout through the DOM and keep screenshots for the final visual. `document.hidden` is permanently true there too, which pauses the header pills' polling.
- **CI passing does not mean the Pi build will.** CI runs `npm ci` on linux-x64; the Pi runs `npm install` on aarch64. Deploy with `npm run deploy` (or the `/deploy` skill) and check the service came up.

## Server Architecture (`packages/server/`)

Drives a 240-LED panel (30×8 grid) via Fadecandy using the Open Pixel Control protocol, rendering at 100 FPS (10ms `setInterval`). One **scene** is active at a time; a scene is an ordered stack of **layers**, each an effect instance with `{effectType, params, blendMode, opacity, enabled, solo}`. `layers[0]` is the bottom of the stack.

**Where rationale lives:** on the server, a file's **header comment** is the canonical account of that module (engine files run 30–45% comment on purpose). [`engine/CLAUDE.md`](packages/server/engine/CLAUDE.md) maps the engine and holds the rules that span its modules; [`effects/CLAUDE.md`](packages/server/effects/CLAUDE.md) holds the effect contract and the traps every effect shares. Both load when you open those directories. This section keeps only what bites across directories. In the UI, components are lightly commented and the reasoning lives in the nested CLAUDE.md beside them (see below). Either way, a new fact about one module goes next to that module, not here.

- `app.js` — Express wiring, scene + settings storage init, and the `setInterval` that drives the render loop. It **binds port 3000 and starts the loop on require**, so nothing in it is importable from a test. Everything worth testing is a factory taking its dependencies: the tick (`engine/render-loop.js`'s `createTick`) and both routers (`routes/scenes.js`, `routes/system.js`). app.js only composes them, with `routes/origin.js` first and `routes/errors.js` last. The origin guard (#110) is two halves that each fail without the other. CORS is granted only to the Vite dev origin under `VIRTUAL` (the production UI is same-origin). A non-GET whose `Origin` is foreign is refused with a 403 before any route runs, because a bodiless form POST such as `/api/scenes/reset` needs no preflight, so CORS alone would hide the answer only after the library was gone. `routes/errors.js` goes last so every failure answers `{error}` rather than express's HTML page. Route tests mount those routers on a bare express app over an ephemeral port (`test/support/http.js`), using node's `fetch` rather than supertest.
- **The composite is unbounded linear light, and the sink is the only clamp.** Brightness, the power estimate and the limiter all live in `engine/pixel-sink.js`, shared by `opc.js` (hardware) and `virtual-opc.js` (swapped in by `VIRTUAL`). **Never apply brightness or estimate power in the compositor.** Clamp comes before brightness (#92), so the panel is exactly the pre-fader preview dimmed. The two sinks must stay byte-identical or dev stops predicting the panel; `test/sinks.test.js` compares whole buffers. `engine/broadcast.js` (the WebSocket on 3001, both modes) serialises from the compositor, *before* the sink, so every UI preview is pre-fader and never dims.
- **Blend modes are one table, `BLEND_MODES`** in `engine/compositor.js`: name, label, display order and the int id `blendInto` switches on. The UI renders what `GET /api/blend-modes` serves, so a new mode needs nothing in the UI. The order is free; the ids are fixed per mode.
- **Layer ids are unique across the whole library, not per scene.** The compositor caches one render instance per layer id across every scene, so a shared id makes two scenes fight over it. Every write path goes through `SceneStore.adoptLayers`, and the *incoming* layer is the one given a fresh id.
- **Every scene write builds and prepares its whole result before committing any of it** (`prepareScene` is `preprocess` minus the compositor sync), so a throw leaves the library and compositor untouched. The layer PUT merges over the stored layer and refuses an `effectType` change with a 400. Whole-library mutations (`removeAll`, `resetToDefaults`, `importReplace`) owe `releaseAllLayers()` *before* syncing the replacement. An **empty library is a real state** that survives a restart.
- **A request whose shape is wrong is refused (400); a bad value inside a good shape is coerced** (`engine/params.js`). `load()` runs the same normalisation on the document from disk, and a rejection there would cost the whole library. Schema `min`/`max` are not enforced.
- **The default scenes are data**: `default-scenes.json` at the server root, in the export envelope, with fixed ids so a reset is idempotent. It is outside `data/` because `data/` is gitignored and owned by whatever runs there. Scenes persist to `data/scenes-v2.json`, settings to `data/settings.json`.
- **Effect `y` params negate `modelZ`** (`layout.json`: x ∈ ±3.625, z ∈ ±0.875, +z is the *bottom* row), and a symmetric effect hides a sign error. `effects/CLAUDE.md` has the detail; `engine/panel.js` is the one source for the extent.
- **Every effect is a pure function of absolute `millis`**, which is what the filmstrip previews (`engine/filmstrip.js`, served by `/api/scenes/previews` and `/api/effects/previews`) depend on. The UI keys a card's sprite-sheet rebuild on the hash the server serves, so a refresh that changes nothing rebuilds nothing.
- **`fcserver.json` is read by two things**: `fcserver.service` runs it, and `engine/power.js` reads its gamma and whitepoint. Change the curve there and only there.
- **The render loop stops when no scene is active** (one black frame, then fast-exit), and `setInterval(10)` measures ~91 FPS on a healthy machine. Both `/api/fps` and `/api/power` report `idle` rather than zero in that state; compare against neither 100 nor 0.

## UI Architecture (`packages/ui/`)

React 19 + Vite + zustand. Entry `src/index.jsx`; hash routing in `App.jsx` (`#/edit/:sceneId`), no router dependency.

- `api/client.js` — REST wrappers. `api/lightStream.js` — the single WebSocket; frames go to imperative canvas subscribers, **never React state**. `setLayerScene(id)` manages the layer-preview subscription across reconnects.
- `state/store.js` — zustand store. Param drags: optimistic update + 80ms trailing throttle per layer to `PUT /api/scenes/:id/layers/:layerId`, flushed on pointer-up (`flushLayer`). Structural edits PUT the whole scene immediately. No save button anywhere.
- `components/preview/LedCanvas.jsx` — shared 30×8 renderer; all drawing lives in `lib/ledPaint`. `mode` picks `bloom` (default), `dots` (the pre-bloom flat discs) or `fill` (cell rectangles). Positions and bloom params are memoised per size and the 2D context is cached, because this repaints at the stream rate for every layer thumbnail as well as the composite — but the context is re-acquired in the same effect that creates the scratch, since a cached context on a swapped-out canvas node paints into a detached buffer.
- `components/preview/FilmstripCanvas.jsx` — plays a cached filmstrip, on an inactive scene card and on an effect-picker tile. Blooms the frames **once into a sprite sheet** and then blits, gated on an `IntersectionObserver`; painting ~23 cards live would be 200+ blooms a second on a phone, and a sheet is ~3.7MB. `lib/filmstripClock.js` drives every canvas from one rAF, and the first visible frame is painted **synchronously** — rAF does not run at all in a background tab, so waiting for it would leave a card on its background colour indefinitely. Each canvas offsets its band by `phaseFor(id)`: one clock means every card would otherwise reach the seam on the same tick, and the whole page glitching at once reads as a fault rather than an animation.
- `components/switcher/` — the scene-card grid (mobile-friendly), its drag-reorder hook and the library notice. The shared header's controls live in `components/header/` and everything configurable in `components/settings/`. **An empty library is reachable** (delete-all, a replacing import), and an empty grid is indistinguishable from one that failed to load, so the grid carries an empty state offering Restore defaults and Import — in the switcher, not behind a trip to settings. `LibraryNotice` sits above the grid and says what the last whole-library action did: the settings page's actions navigate here, so the confirmation has to be *waiting on arrival* rather than beside the button that is now a screen away. The message is composed in the store, not by either caller, because the same actions fire from both places and must not word it differently; it carries a count, clears on `×`, and clears itself after 8s so it can't outlive the moment it describes. The **active** card streams the live composite (it is the only scene the server renders); every other card plays its filmstrip. Cards are drag-reorderable (`useSceneDrag` + `lib/gridReorder`): pointer events, not HTML5 DnD (no touch support, and a card holding a live `<canvas>` makes an unreliable drag image). **Nothing moves in the DOM until the drop** — the cards are slid over their measured positions by transform, so no `FilmstripCanvas` is remounted and no sprite sheet is rebuilt mid-gesture. A mouse press becomes a drag past a movement threshold, a touch only after a hold — the hold is what lets a finger still scroll the page off a card, and what lets the non-passive `touchmove` preventDefault land before the browser has committed to scrolling. Order persists via `PUT /api/scenes/order`.
- `components/editor/` — PreviewStage (**read-only** live composite — position is edited in ParamPanel like every other param, not by dragging directly on the preview), LayerStack (topmost first, live per-layer thumbnails from the stream's `layers`), ParamPanel (walks the effect schema from `/api/effects` — new server effects get UI for free — and renders a "Start from" button per entry in the effect's optional `presets`, each replacing the whole param set), EffectPicker (a filmstrip per effect, rendered from its defaults; presets are not tiles).
- `components/settings/` — the settings page at `#/settings`, reached by the header cog. One scrolling page of sections (`SettingsSection` + its `SettingsRow`), not tabs: there are three sections and a nav for three items costs a click and buys nothing. Sections are **self-contained** — each owns its own state and server calls — so adding one is writing a component and dropping it into `SettingsPage`, with nothing central to register it with. No save button, like everywhere else. `SettingsRow` renders a `<label>` only when it wraps a control (association by containment, no ids to keep unique) and a `<div>` for read-only values, because labelling a value that can't be edited hands a screen reader a control that isn't there. The cog is an inline SVG rather than U+2699: the gear codepoint renders as a colour emoji on iOS and macOS, which this runs on from the Home Screen. `SceneLibrarySettings` is the one component that renders *two* sections, because the split there is danger and not subject — everything that can destroy the library sits under its own warning. The three controls that can (`Replace…`, `Restore defaults`, `Delete all`) go through `ArmedButton`, a two-step confirm rather than `window.confirm` — **a browser is free to refuse a native dialog silently**, and the control would then do nothing while everything around it kept working (`Editor.handleDeleteScene` carries the full account: iOS from the Home Screen, Chrome's "prevent additional dialogs"). The same hazard is why `ImportScenesButton` renders a failure **in the page** rather than through `window.alert`: a suppressed alert returns having shown nothing, so a failed import would look exactly like one that did nothing. That button is shared with the switcher's empty state — `mode` and `armedLabel` are the only difference between the merging and replacing rows. **Everything that changes the library navigates back to the switcher on success** and leaves a notice there; the buttons are here and what they change is a screen away, so staying put would confirm nothing. Only export stays, because it changes nothing — it reports inline (`.row-status`, the same class a failure uses).
- `components/header/` — `BrightnessSlider` and the two readout pills. Both pills are a `ReadoutPill` (one `.readout` CSS base, state colours shared) polled through `useVisiblePoll`; what differs between them is only the describe function in `lib` and what the toggle does. The two pills sit in their own `.app-header-readouts` group rather than in `.app-header-brand`, so they read as a pair — 10px to each other against the header's 20px to the title and the brightness slider. A **collapsed pill carries a negative margin equal to its own padding plus border**: folded, it draws neither, so that inset stops being part of a pill and starts reading as gap, and the two words drift apart exactly when the header is tightest. Pulling the box back by the inset means the *ink* lands where the box edge would have, so the spacing is identical in both states and a wrapped group still aligns with the page margin.
- `components/header/PowerMeter.jsx` + `lib/power.js` + `components/settings/PowerSettings.jsx` — the header's power pill and the budget settings. Same shape as the frame-rate pill (pure display logic in `lib`, 1s poll, `document.hidden` care) including the click-to-collapse, with one difference: **that toggle is display only** — it stops the client poll and nothing else, since the server measures unconditionally and the limiter runs either way, so it must never reach `PUT /api/power`. Its persistence is `localStorage` rather than server state for the same reason (per-device display choice, nothing to ride on). **Collapse is absolute**: the pill stays folded while `limiting` and even while `floored`, which knowingly hides the one place the limiter is visible at all — the previews are pre-fader by design and never dim. Letting those states push it back open was the alternative, and it would have meant polling on while collapsed, i.e. the whole cost the collapse saves, for a misconfiguration that is a one-off. The headline is current draw against the PSU-cap budget; there is no rail voltage to lead with — see `engine/power.js` for why that was tried and dropped.
- `components/header/FrameRate.jsx` + `lib/frameRate.js` — the header's frame-rate pill (shared header, so it shows on both views), polling `/api/fps` once a second while enabled. The display logic is a pure function in `lib` so idle/near/slow/ok are testable without mounting. The state bands are graded like the power pill's and each has a **softer twin** of the `slow` test beside it; the late-frame band is the one not to tighten — `setInterval(10)` clamps to ~91 FPS, so one late frame a second is already 1.1% and an amber at 1% would sit lit on a healthy loop. The state class must only ever reach `.readout-value`, and the base white must stay a single class or `:not(.readout--off)` outranks every colour (it did, for a while, and no state colour appeared at all). **`document.hidden` is the other thing to be careful with** — polling pauses on a hidden tab and resumes on `visibilitychange`, and the Browser pane reports `hidden: true` permanently, so a live readout looks frozen there when it is fine in a real browser.
- `components/controls/` — schema-driven controls: TextControl (the one string param), ColorControl (react-colorful), NumberControl (`linear`, `atan` perceptual or `log` scale — `lib/perceptual.js`), RangeControl, EnumSelect, XYPad (live layer render as pad background), AngleDial, NumField, GradientStopsEditor, DraftField (the typed value beside every drag control).
- **The site icons in `public/` are generated, not drawn**: `node scripts/icon/generate.js` renders a frame of `scripts/icon/scene.json` through the server engine and blooms it with `lib/ledPaint` in Playwright's Chromium (not a dependency; the script's header says how to get it). Change the design there and regenerate, then bump the `?v=` on the links in `index.html` and `site.webmanifest`, or browsers keep showing the cached icon.
- **Tests** are mostly pure functions in `src/lib`, plus a thin **render smoke layer** beside the components (`LedCanvas`, `XYPad`, `ParamPanel`, `SceneGrid`) that mounts them under jsdom via `@testing-library/react` — chosen because it supports React 18 *and* 19, so it survives the upgrade it exists to guard. Canvas is a recording stub (`src/test/canvasStub.js`), never the native `canvas` package: that is a compiled module, and the Pi builds with `npm install` on aarch64. The stub's Proxy answers `has` for everything so `ledPaint`'s `'filter' in ctx` detect takes the blur path. The load-bearing test is `XYPad`'s — it changes a param, pushes a frame through the *mount-time* subscription and asserts the chrome moved, which is the one way to catch the stale-closure repaint described above; verified by reintroducing the bug, where it fails and every other test still passes.

**Module-level rationale lives beside the code**, and loads when you open those directories: [`src/lib/CLAUDE.md`](packages/ui/src/lib/CLAUDE.md) for the slider scales, value formatting, grid mapping, LED painting, colours, pad geometry and the two header pills' display logic; [`src/components/controls/CLAUDE.md`](packages/ui/src/components/controls/CLAUDE.md) for the gradient editor, the typed-value field, the angle dial and the control-row layout. Read those before editing anything in them. What stays here is only what bites from *outside* those directories:

- Frames arrive in **strip order**, not grid order — anything drawing a frame goes through `lib/panelGrid.js`. Reversing a row-major index is a 180° rotation, so a reimplemented mapping renders upside-down.
- **A new effect needs nothing in the UI** — ParamPanel already walks the schema, and scene cards and the effect picker both render filmstrips. A new **schema entry type** is the exception, and `text` is the one that has been added since: it needed `TextControl` and a `case` in ParamPanel. Note the failure mode when they are out of step — `default: return null`, so an older UI against a newer server silently renders no control for that param rather than erroring.
- Schema `min`/`max` are **slider hints, not validation**. Values outside them render fine, the slider just pins, and typed entry is deliberately unclamped — that is what keeps a `lambda` of 10000 restorable after a stray drag.
- **Schema design rules are the server's** — no enum that decides what the other controls mean, a declared `scale` on every number, `zeroable` where `0` is a real setting — and live in [`effects/CLAUDE.md`](packages/server/effects/CLAUDE.md). The UI's side of them is `lib/perceptual.js`.
- Anything drawn **after** the LEDs must sit outside `lib/ledPaint`'s additive pass — overlays blow out under `lighter`.
- **A canvas that repaints from the frame stream must not close over changing props.** `XYPad`'s subscription is created per *geometry*, so its callback holds whatever `draw()` captured then; anything the chrome reads that a param edit changes has to come through a ref, or the ~30 FPS stream repaints with mount-time values and silently wipes the correct frame. This is why the emitter's box reads `decorRef`, not props — and it looks exactly like "the feature isn't wired up", not like a stale frame.

## Backend API

Server on port 3000; see [API.md](API.md) for full docs.

- `GET /api/effects` — effect catalog with param schemas (drives the UI)
- `GET /api/blend-modes` — `[{value, label}]` in display order (drives the blend row)
- `GET|POST /api/scenes`, `GET|PUT|DELETE /api/scenes/:id` — scene CRUD (PUT does not activate)
- `DELETE /api/scenes` — empty the library; `POST /api/scenes/reset` — restore the default set
- `PUT /api/scenes/order` — `{ids: [...]}`, the whole list; rejects anything that isn't a permutation
- `PUT /api/scenes/:sceneId/layers/:layerId` — high-frequency single-layer edit path
- `GET|PUT /api/active_scene` — `{id}` or `{id: null}` for off
- `GET|POST /api/scenes/export|import` — `{version: 2, scenes}` bulk; import merges by id unless the body carries `mode: "replace"`, which swaps the library and keeps the active id only if the incoming set still has it
- `GET /api/scenes/previews`, `GET /api/scenes/:id/preview` — cached scene filmstrips for the switcher's cards
- `GET /api/effects/previews` — the same, one per effect at its defaults, for the picker
- `GET|PUT /api/brightness/[value]` — global brightness 0–1; plain-text value
- `GET|PUT /api/fps` — render-loop frame-rate tracker; `{enabled}` toggle, persisted, off by default
- `GET|PUT /api/power` — current estimate, budget and limiter; `PUT` merges a partial config, persisted
- `GET /api/virtual` — `{virtual: bool}`

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `REACT_APP_LIGHTPANEL_API_SERVER` | `http://localhost:3000` | Backend URL for the UI |
| `REACT_APP_LIGHTPANEL_WS_SERVER` | derived from above, port 3001 | WebSocket URL for previews |
| `FADECANDY_SERVER` | `localhost` | Fadecandy hostname (server only) |
| `VIRTUAL` | unset | Set to `1` to run without hardware |

UI dev port is `3002` (`packages/ui/vite.config.js`; port 5000 is avoided because AirPlay occupies it on macOS). The `REACT_APP_*` prefix is preserved via `envPrefix: 'REACT_APP_'`; referenced as `import.meta.env.REACT_APP_*`.
