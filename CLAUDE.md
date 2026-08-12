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
- `engine/gradient-migrate.js` — one-time split of `gradient` into `gradient_linear` and `gradient_radial` (own snapshot `scenes-v2.pre-gradient.json`, own `gradientMigrated` flag; all three migrations run in sequence and any one can be the one already done). Three of its four sign relations are exact and none is visible in a still frame. The old linear projection was missing the **`modelZ` negation** every other effect applies, so its ramp ran downward at 90° — invisible while the control was a bare slider, wrong the moment it became a dial; `gradient_linear` fixes it and the migration mirrors the stored angle (`proj_new(-a) === proj_old(a)`) to cancel the fix exactly. Old rotation was applied to that un-negated projection, hence `spin = -speed` — which is why `spin` is a **signed linear** track and not a log speed plus a direction enum. Old radial scroll converged, so it converts to `travel: 'inward'`; outward is new. The one inexactness: old linear scroll ran *against* the ramp direction and `gradient_linear` runs along it (planewave's convention, so the dial's arrow agrees with the motion), so **a migrated scrolling linear gradient drifts the other way**. The exact alternative — `angle + 180` with `phase: 1`, identical under the mirror tiling — was rejected for leaving the layer reading "180°, phase 1" where its author set 0.
- `engine/emitter-migrate.js` — one-time conversion of `candy_sparkler` and `embers` layers to `emitter`. Same shape as the plane-wave one (own snapshot `scenes-v2.pre-emitter.json`, own `emitterMigrated` flag) because both run in sequence on the same load and either can be the one already done. Deliberately **not** bit-exact — the old per-particle velocity distributions do not map onto a direction/spread pair term for term. Two numbers it does have to carry: embers' envelope peaked at **0.7** where the sparkler's peaked at 1.0, folded into the layer's `opacity` (the one thing a preset cannot carry but a migration can); and embers' hue jitter was **asymmetric** (`random() - 0.15`, biased up by `0.35 × hueSpread`), so the converted swatch is shifted to keep the mean hue. Both old effects lose their ambient backglow, which the emitter does not have — restoring it is a `solid` layer underneath **on `add` blend**, since `normal` at opacity 1 replaces what is beneath it, dark pixels included.
- `engine/panel.js` — panel extent (`HALF_X` 3.625, `HALF_Z` 0.875, `RADIUS`). The single source for `xy` schema ranges and gradient's radial normalisation; don't re-hardcode these.
- `engine/gradient-lut.js` — the stop LUT and the `tiling` rule shared by both gradient effects, which differ only in the geometry that produces `u`. **`mirror` is the only tiling that scrolls without a seam** and the only one stored layers were ever rendered with; `repeat` is a sawtooth (the seam sweeps across the panel, reading as a wipe), and `hold` clamps, which is the one way to get a radial that fades into a flat surround instead of brightening again at the corners. `hold` + a scroll eventually parks the whole panel on one end colour — a degenerate combination of *values* you can watch happen, not a mode switching another control off, which is the distinction the gradient split turns on.
- `engine/filmstrip.js` + `engine/preview-cache.js` — a 4s loop per scene for the switcher's cards, since the render loop only ever renders the *active* scene. Renders into a **throwaway `Compositor` over a no-op sink**: the live one writes its composite out through `client.setPixel`, i.e. to the panel, and sharing its layer instances would jump a scene's particles the next time it went active. Cheap because every effect is a pure function of *absolute* `millis` — none integrate a fixed `dt` — so a 4s loop is 40 renders, not 400; the loop length is set by payload and the UI's sprite sheet, not by render cost. Three traps: **the time base must not be 0** (the old embers tested `if (!q.born)`, so a born time of 0 re-seeded every particle every frame and the layer rendered black — `emitter` carries an explicit `alive` flag for exactly this reason, but the hazard is one falsy test away in any new particle effect); particle effects need the warm-up or they capture an empty field — and the warm-up is **derived per scene**, not fixed, since `emitter` ramps up from empty and a budget that suits a 1.5s lifetime captures a half-filled field at 10s (an effect declares `warmupMs(prepared)`, the scene's slowest layer sets the length, non-declaring effects get the 8s that used to be the constant, and `MAX_WARMUP_MS` caps what an unclamped typed lifetime can cost); and **the loop is not naturally cyclic** — embers and the sparkler are not periodic at all, and a multi-layer scene's period is an unusable LCM — so `FADE_FRAMES` extra frames are rendered past the end and dissolved into the head. Uncrossfaded, the wrap is a 23× step for noise and 9× for embers against the median frame step, which reads as a glitch, not a loop; the test measures exactly that ratio. The cache keys on a hash of `stripRuntime(scene)` and `all()` yields between scenes so a cold library doesn't stall the 10ms tick. `EffectPreviewCache` does the same for the picker, one strip per effect at its defaults — those are code, not data, so there is nothing to invalidate against and it is kept in a separate map from the scene cache, whose `prune()` would drop them as unknown scene ids. `effects.visible()` is the list it and the picker both work from. An effect's `presets` deliberately do **not** multiply this: they are starting points inside the layer editor, so the picker stays one tile per effect.
- **Layer ids must be unique across the whole document, not just within a scene** — the compositor caches one render instance per layer id, so a shared id makes two scenes fight over it and, once their effect types differ, render each other's params as NaN. `SceneStore.setScenes` reassigns duplicates on load (the legacy preset data contains one).
- `engine/frame-stats.js` — render-loop instrumentation behind `/api/fps`, off by default. Sits in the 10ms tick, so `begin()` returns 0 while disabled and every other call early-returns on that; enabled, it writes into fixed-size `Float64Array` ring buffers and allocates nothing per frame (`performance.now()`, because `hrtime()` allocates an array and `hrtime.bigint()` a BigInt, every tick — a test pins the no-allocation property). Two things it must not mistake for faults: **`setInterval(…, 10)` clamps**, so a healthy loop measures ~91 FPS and anything comparing against 100 sits permanently red; and **the loop stops when no scene is active** (one black frame, then fast-exit), so a gap over `RESUME_MS` is a discontinuity — not sampled, not counted as a dropped frame — and a snapshot taken then reports `idle` rather than 0 FPS.
- `engine/broadcast.js` — the only WebSocket server (port 3001), both modes. Serialises from `compositor.composite`, i.e. **pre-brightness** — UI previews are a pre-fader meter and never dim; only the panel does. v1: bare `[[r,g,b],…]` composite frames ~30 FPS, last frame replayed to new connections. v2: `subscribe_layers` → `{type:"frame", composite, layers}` at ~15 FPS, only serialised while subscribers exist.
- `effects/*.js` — one module per effect: `{type, name, schema, defaults, prepare(params), createInstance(ctx)}`, plus an optional `warmupMs(prepared)` for anything that needs time to settle (see the filmstrip above). `prepare()` runs on the API write path (hex→rgb, LUTs); `createInstance()` holds per-layer animation state and is recreated **only** on effectType change (param edits must not reset particles). Hot loops are allocation-free.
- **A particle effect fills from empty at a rate, not all at once.** `emitter` gates *every* birth to `count/life` per second while any slot is still unborn — first births and replacements alike, which is the part that is easy to get wrong: let a replacement through ungated and the field fills at `count/life` plus the death rate, so it reaches full while it is still young, and since the intensity envelope peaks early in a particle's life, "full but young" is brighter than steady state. That was the old start-up surge (1.2–1.33× the settled level, peaking one lifetime in). The gate is armed on the *transition* into filling, not on a first render: `Density` adds unborn slots to an emitter that settled long ago, and a gate still holding a stale clock grants the whole new cohort on one tick.
- **A fresh instance is not the only start-up.** The compositor holds an instance per layer id for *every* scene while the loop renders only the active one, so a scene switched away from and back is the same instance resumed with a dead field — the commonest way to watch an emitter start, and the worst burst of the lot (2.06×, every particle reborn on one tick in lockstep). A render gap over `RESUME_MS` sends every slot with nothing alive in it back to virgin, so it ramps in again; slots that *did* survive the gap are left alone, which is what makes a partial gap fill its holes instead of culling what is on screen. `RESUME_MS` (500ms, the same line `frame-stats` draws) has to stay well clear of the filmstrip's 200ms warm-up step — a real gap between renders that must not read as a discontinuity.
- `opc.js` / `virtual-opc.js` — pixel sinks; swapped on `VIRTUAL` env var. Hardware buffer has a 4-byte OPC header; broadcast doesn't care, it reads the compositor instead.
- `layout.json` — 240 LED positions; x ∈ ±3.625, z ∈ ±0.875, 0.25 spacing. **Effect `y` params negate z** (`dz = pz + y`): `modelZ` +0.875 is the panel's *bottom* row, while the xy pad and the angle dials draw +y as up. x is not flipped. Every effect owes the pad that negation somewhere — wavelet and gradient fold it into their distance term, `emitter` works in param space and negates once when writing `point[2]`. Get it wrong and the whole vertical axis inverts together (position, launch direction, gravity), which **a symmetric effect will not show you** — an omnidirectional burst looks identical either way, and two sign errors can cancel into a plausible-looking render whose controls all read backwards. `test/effects.test.js` pins it per axis for exactly that reason.

## UI Architecture (`packages/ui/`)

React 18 + Vite + zustand. Entry `src/index.jsx`; hash routing in `App.jsx` (`#/edit/:sceneId`), no router dependency.

- `api/client.js` — REST wrappers. `api/lightStream.js` — the single WebSocket; frames go to imperative canvas subscribers, **never React state**. `setLayerScene(id)` manages the v2 layer-preview subscription across reconnects.
- `state/store.js` — zustand store. Param drags: optimistic update + 80ms trailing throttle per layer to `PUT /api/scenes/:id/layers/:layerId`, flushed on pointer-up (`flushLayer`). Structural edits PUT the whole scene immediately. No save button anywhere.
- `components/preview/LedCanvas.jsx` — shared 30×8 renderer; all drawing lives in `lib/ledPaint`. `mode` picks `bloom` (default), `dots` (the pre-bloom flat discs) or `fill` (cell rectangles). Positions and bloom params are memoised per size and the 2D context is cached, because this repaints at the stream rate for every layer thumbnail as well as the composite — but the context is re-acquired in the same effect that creates the scratch, since a cached context on a swapped-out canvas node paints into a detached buffer.
- `components/preview/FilmstripCanvas.jsx` — plays a cached filmstrip, on an inactive scene card and on an effect-picker tile. Blooms the frames **once into a sprite sheet** and then blits, gated on an `IntersectionObserver`; painting ~23 cards live would be 200+ blooms a second on a phone, and a sheet is ~3.7MB. `lib/filmstripClock.js` drives every canvas from one rAF, and the first visible frame is painted **synchronously** — rAF does not run at all in a background tab, so waiting for it would leave a card on its background colour indefinitely. Each canvas offsets its band by `phaseFor(id)`: one clock means every card would otherwise reach the seam on the same tick, and the whole page glitching at once reads as a fault rather than an animation.
- `components/switcher/` — scene-card grid (mobile-friendly), brightness, export/import. The **active** card streams the live composite (it is the only scene the server renders); every other card plays its filmstrip. Cards are drag-reorderable (`useSceneDrag` + `lib/gridReorder`): pointer events, not HTML5 DnD (no touch support, and a card holding a live `<canvas>` makes an unreliable drag image). **Nothing moves in the DOM until the drop** — the cards are slid over their measured positions by transform, so no `FilmstripCanvas` is remounted and no sprite sheet is rebuilt mid-gesture. A mouse press becomes a drag past a movement threshold, a touch only after a hold — the hold is what lets a finger still scroll the page off a card, and what lets the non-passive `touchmove` preventDefault land before the browser has committed to scrolling. Order persists via `PUT /api/scenes/order`.
- `components/editor/` — PreviewStage (**read-only** live composite; it carried draggable xy handles once, which made position the only parameter editable outside the layer's panel — keep editing in ParamPanel), LayerStack (topmost first, live per-layer thumbnails via WS v2), ParamPanel (walks the effect schema from `/api/effects` — new server effects get UI for free — and renders a "Start from" button per entry in the effect's optional `presets`, each replacing the whole param set), EffectPicker (a filmstrip per effect, rendered from its defaults; presets are not tiles).
- `components/switcher/FrameRate.jsx` + `lib/frameRate.js` — the header's frame-rate pill (shared header, so it shows on both views), polling `/api/fps` once a second while enabled. The display logic is a pure function in `lib` so idle/slow/ok are testable without mounting: **`document.hidden` is the thing to be careful with** — polling pauses on a hidden tab and resumes on `visibilitychange`, and the Browser pane reports `hidden: true` permanently, so a live readout looks frozen there when it is fine in a real browser.
- `components/controls/` — schema-driven controls: ColorControl (react-colorful), NumberControl (`linear`, `atan` perceptual or `log` scale — `lib/perceptual.js`), RangeControl, EnumSelect, XYPad (live layer render as pad background), AngleDial, NumField, GradientStopsEditor, DraftField (the typed value beside every drag control).

**Module-level rationale lives beside the code**, and loads when you open those directories: [`src/lib/CLAUDE.md`](packages/ui/src/lib/CLAUDE.md) for the slider scales, value formatting, grid mapping, LED painting, colours and pad geometry; [`src/components/controls/CLAUDE.md`](packages/ui/src/components/controls/CLAUDE.md) for the gradient editor, the typed-value field, the angle dial and the control-row layout. Read those before editing anything in them. What stays here is only what bites from *outside* those directories:

- Frames arrive in **strip order**, not grid order — anything drawing a frame goes through `lib/panelGrid.js`. Reversing a row-major index is a 180° rotation, so a reimplemented mapping renders upside-down.
- **A new effect needs nothing in the UI.** It used to need a `layerSwatches` case in `lib/colors.js` — a hand-picked colour per effect — or its scenes showed blank cards until opened. Scene cards and the effect picker both render filmstrips now, so that switch is gone; ParamPanel already walks the schema.
- Schema `min`/`max` are **slider hints, not validation**. Values outside them render fine, the slider just pins, and typed entry is deliberately unclamped — that is what keeps a `lambda` of 10000 restorable after a stray drag.
- **An enum must not decide what the other controls mean.** That is the rule behind both the wavelet/planewave split and the emitter's absorption of `candy_sparkler`/`embers`, and it is what `gradient` violated — its `mode` left the centre pad inert for linear, the angle inert for radial, and `Motion: rotate` inert outright. Which repair applies turns on one test: *can the modes be joined by a continuous parameter?* The emitter's could (point/panel/edge became `extX`/`extY`), so it was unified; gradient's could not, because the shapes are told apart by a **control type** — a pad against a dial — and nothing interpolates one into the other, so it was split. The one continuous bridge that exists there (a radial centre pushed to infinity is a linear gradient) is exactly the anti-pattern `planewave-migrate` was written to undo.
- Numeric params declare a `scale`: `linear`, `atan` (brightness only), or **`log`** for anything spanning decades — plus **`zeroable: true`** wherever an exact `0` is a real setting (`freq: 0` frozen, `glow: 0` no floor), since a log scale cannot otherwise express zero.
- Anything drawn **after** the LEDs must sit outside `lib/ledPaint`'s additive pass — overlays blow out under `lighter`.
- **A canvas that repaints from the frame stream must not close over changing props.** `XYPad`'s subscription is created per *geometry*, so its callback holds whatever `draw()` captured then; anything the chrome reads that a param edit changes has to come through a ref, or the ~30 FPS stream repaints with mount-time values and silently wipes the correct frame. This is why the emitter's box and gravity arrow read `decorRef`, not props — and it looks exactly like "the feature isn't wired up", not like a stale frame.

## Backend API

Server on port 3000; see [API.md](API.md) for full docs.

- `GET /api/effects` — effect catalog with param schemas (drives the UI)
- `GET|POST /api/scenes`, `GET|PUT|DELETE /api/scenes/:id` — scene CRUD (PUT does not activate)
- `PUT /api/scenes/order` — `{ids: [...]}`, the whole list; rejects anything that isn't a permutation
- `PUT /api/scenes/:sceneId/layers/:layerId` — high-frequency single-layer edit path
- `GET|PUT /api/active_scene` — `{id}` or `{id: null}` for off
- `GET|POST /api/scenes/export|import` — `{version: 2, scenes}` bulk, import merges by id
- `GET /api/scenes/previews`, `GET /api/scenes/:id/preview` — cached scene filmstrips for the switcher's cards
- `GET /api/effects/previews` — the same, one per effect at its defaults, for the picker
- `GET|PUT /api/brightness/[value]` — global brightness 0–1; plain-text value
- `GET|PUT /api/fps` — render-loop frame-rate tracker; `{enabled}` toggle, persisted, off by default
- `GET /api/virtual` — `{virtual: bool}`

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `REACT_APP_LIGHTPANEL_API_SERVER` | `http://localhost:3000` | Backend URL for the UI |
| `REACT_APP_LIGHTPANEL_WS_SERVER` | derived from above, port 3001 | WebSocket URL for previews |
| `FADECANDY_SERVER` | `localhost` | Fadecandy hostname (server only) |
| `VIRTUAL` | unset | Set to `1` to run without hardware |

UI dev port is `3002` (`packages/ui/vite.config.js`; port 5000 is avoided because AirPlay occupies it on macOS). The `REACT_APP_*` prefix is preserved via `envPrefix: 'REACT_APP_'`; referenced as `import.meta.env.REACT_APP_*`.
