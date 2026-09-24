# `packages/server/engine/` — how the pieces meet

**Where rationale lives on the server:** each file's header comment is the canonical account of *that* module: what it does, why it is shaped that way, and what was tried and dropped. Read a module's header before editing it. This file holds only what no single header can: the rules that span several engine modules, and which file to read for what. The root [CLAUDE.md](../../../CLAUDE.md) keeps what bites from outside `engine/`. If you learn something about one module, put it in that module's header, not here.

## Module map

| File | Owns | Read its header for |
|---|---|---|
| `compositor.js` | per-layer buffers, the eleven blend modes, `BLEND_MODES` | the clamp-the-source-never-the-accumulator rule, per-mode reasoning |
| `scene-store.js` | the library, `preprocess`/`prepareScene`, `adoptLayers`, bulk mutations | build-before-commit, `releaseAllLayers` ordering, the empty-library state, why `default-scenes.json` is outside `data/` |
| `params.js` | `coerceParams`, the one place params meet their schema | shape refused vs value coerced |
| `debounced-doc.js`, `json-store.js`, `settings-store.js` | persistence | the 2s/1s write ceiling (not a trailing debounce), atomic rename, synchronous `flush()` |
| `render-loop.js` | `createTick`, `RESUME_MS` | the "off" fast-exit, throw handling |
| `pixel-sink.js` | the whole byte path both sinks share | clamp → brightness → power → limiter pass (#92) |
| `power.js` | current estimate and limiter | gamma-aware duty, `s^(1/gamma)` rescale, why the rail model was dropped |
| `frame-stats.js` | `/api/fps` instrumentation | the ~91 FPS clamp, the windowed late rate, scene scoping |
| `broadcast.js` | the WebSocket on 3001 | pre-brightness frames, socket error listener (#108), 4 KB cap |
| `filmstrip.js`, `preview-cache.js` | card and picker loops | warm-up, the crossfade, yielding, cache keys |
| `gradient-lut.js` | stop LUT and `tiling` | why only `mirror` scrolls without a seam |
| `text-font.js`, `text-raster.js` | bitmap faces and the tent sampler | binary glyphs, tent normalisation, the derived lattice |
| `panel.js` | panel extent | the one source for `xy` ranges; don't re-hardcode |
| `particles.js`, `wave.js`, `color.js` | shared maths for effects | `hsvInto` vs `hsv` (only the first is safe per frame) |

## Rules that span modules

- **The sink is the only place values are clamped.** The composite is unbounded linear light (`compositor.js`), so everything that depends on the final byte lives in `pixel-sink.js`: the clamp, brightness, the power estimate and the limiter. Never apply brightness or estimate power in the compositor. `broadcast.js` reads `compositor.composite`, i.e. *before* the sink, which is why every UI preview is a pre-fader meter and never dims.
- **One render instance per layer id, across every scene.** The compositor keeps instances for all scenes while the loop renders only the active one. Four things follow, each in a different file: layer ids must be unique across the whole library (`scene-store.js` `adoptLayers`); the bulk mutations must `releaseAllLayers()` *before* syncing the replacement, or they leak one instance per layer; the filmstrip must use a throwaway `Compositor` so it doesn't disturb live particles; and a scene switched back to resumes the same instance after a gap, which `effects/emitter.js` handles via `RESUME_MS`.
- **`RESUME_MS` (500ms) is one line drawn in three places.** `render-loop.js` exports it; `frame-stats.js` treats a longer gap as a discontinuity rather than dropped frames; `emitter` treats one as "this layer was not being rendered". It has to stay well clear of the filmstrip's 200ms warm-up step, which is a real render gap that must *not* read as a discontinuity.
- **Every effect is a pure function of absolute `millis`.** None integrate a fixed `dt`, which is what makes a 4s filmstrip 40 renders rather than 400, and lets `text` resolve a clock with no warm-up. A particle effect that needs time to settle declares `warmupMs(prepared)` and `filmstrip.js` takes the slowest layer's. Breaking this makes the preview cache wrong without anything failing.
- **The gamma curve has one source.** `power.js` reads `gamma`/`whitepoint` from `../fcserver.json`, the same file `fcserver.service` runs, so the meter's curve is the panel's. Don't copy those numbers into settings or code.
- **Both stores share one write discipline** (`debounced-doc.js`). The interval is a ceiling, so a drag that never pauses still reaches disk. `flush()` is synchronous so the `uncaughtException` and signal handlers in `app.js` can write on the way out. A new persisted document should extend it and supply only `toDocument()`.
