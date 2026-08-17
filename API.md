# Light Panel HTTP API

Base URL: `http://<host>:3000`

All endpoints use JSON for request/response bodies unless noted. CORS is enabled.

## Concepts

The panel plays one **scene** at a time. A scene is an ordered stack of **layers**; each layer is an instance of an **effect** with its own parameters, blend mode and opacity. Layers composite bottom→top (`layers[0]` is the bottom of the stack), like image-editor layers.

- Scene and layer IDs are 8-character hex strings (the first segment of a UUID v4). Generate them yourself when creating layers client-side.
- Blend modes: `normal`, `add`, `multiply`, `screen`, `overlay`. Opacity is `0..1`, applied after the blend.
- `enabled: false` removes a layer from compositing; if any layer has `solo: true`, only solo layers render.
- "Off" is not a scene: set the active scene to `null`.

### Scene shape

```json
{
  "id": "a3b7c901",
  "name": "Sunset drift",
  "layers": [
    {
      "id": "9f31ab02",
      "effectType": "gradient_linear",
      "params": { "stops": [ { "position": 0, "color": "#241040" }, { "position": 1, "color": "#e04f1f" } ], "angle": 0, "repeats": 1, "tiling": "mirror", "phase": 0, "scroll": 0.05, "spin": 0 },
      "blendMode": "normal",
      "opacity": 1,
      "enabled": true,
      "solo": false
    },
    {
      "id": "c22e10fa",
      "effectType": "wavelet",
      "params": { "color": "#2ee6a8", "freq": 0.3, "lambda": 0.5, "delta": 0, "x": -1.2, "y": 0, "min": 0, "max": 0.8 },
      "blendMode": "add",
      "opacity": 0.9,
      "enabled": true,
      "solo": false
    }
  ]
}
```

---

## Endpoints

### Effect catalog

```
GET /api/effects
```

Returns every available effect with its parameter schema and defaults — enough to render an editor UI generically:

```json
[
  {
    "type": "wavelet",
    "name": "Wavelet",
    "schema": [
      { "key": "color", "type": "color", "label": "Colour" },
      { "key": "freq", "type": "number", "label": "Speed", "min": 0, "max": 2, "step": 0.01, "scale": "linear", "modulatable": true },
      { "type": "xy", "label": "Position", "xKey": "x", "yKey": "y", "xRange": [-3.625, 3.625], "yRange": [-0.875, 0.875], "margin": 2, "farLimit": 1000 }
    ],
    "defaults": { "color": "#ffffff", "freq": 0.2 }
  }
]
```

Schema entry types: `color`, `number` (with `min`/`max`/`step` and `scale: linear|atan|log`), `text` (a string, with `maxLength` and an optional `hint`), `xy` (two params, `xKey`/`yKey`), `angle` (degrees, 0–360, rendered as a dial pointing along the direction of travel), `range` (min/max pair, `minKey`/`maxKey`), `enum` (with `options`), `gradientStops`, and `group`.

`text` is the only entry whose value is a string, and the only entry type added since the UI's editor was written — which makes it the exception to "a new effect needs nothing in the UI". A new *effect* is free; a new *entry type* needs a control, and an older UI against a newer server renders an unrecognised entry as nothing at all rather than erroring, so the layer is editable except for that one param.

A `group` entry carries only a `label` and no `key`: it is a **flat separator**, not a container, so the schema stays a list and an effect opts into sections simply by dropping one between its params. Only `emitter` uses them so far — sixteen params in one panel is where a flat list stops scanning. Params before the first `group` render in an unnamed section at the top of the panel, alongside blend and opacity.

An `angle` entry may set `render` to pick what the dial draws inside itself: `wavefronts` (the default — parallel lines perpendicular to the direction, for waves), `cone` (an arrow plus the arc named by `spreadKey`, for an emitter's launch direction), `arrow` (an arrow alone, for a force), or `bands` (the stop list named by `stopsKey`, ramped along the direction, for a linear gradient). An effect with two angle dials needs them to look different, or they read as the same control twice.

`scale: log` spreads `min`/`max` over decades so equal slider travel is equal ratio — for wavelength, the speeds and the ambient glow floors, which span more range than a linear track can usefully hold. It ignores `step` (the track is integer positions). Adding `zeroable: true` reserves the bottom of the track for an exact `0`, which several params store to mean "frozen" or "no floor" and which a log scale cannot otherwise express.

**Schema `min`/`max` are slider hints, not validation.** Nothing clamps params to them — `normaliseLayer` checks only `opacity` — so stored values outside the range render fine and the slider simply pins at its end. Typed entry is deliberately unclamped, which is how a preset value no slider can reach is restored.

`xRange`/`yRange` are the panel's own extent (±3.625 × ±0.875, the outermost LED centres). Two optional fields add zoom steps to the editor's pad, each adding one ring of constant world-unit width on all four sides:

- `margin` — width of a ring, in world units, adding a **near** step for sources just off the panel. Constant width (rather than scaled to the panel's 4:1 aspect) keeps one world-units-per-pixel scale on both axes, so the direction you drag is the direction the effect gets; an aspect-matched ring would skew a corner drag by tens of degrees. Because the rings are constant width and the panel is not square, each step has its own aspect ratio, growing squarer as you zoom out.
- `farLimit` — if set, adds a **far** step whose outer ring — the same width as the near one — compresses so its edge reaches this distance, for sources far enough away that the wave reads as planar. The compression is exponential in the ring, so reach spreads across the drag rather than bunching into the last few pixels, and only the magnitude is warped so the drag direction stays exact.

The rings are measured from the panel's **cell box** — half an LED pitch beyond the outermost centres, ±3.75 × ±1.0 — rather than the centres themselves, so the edge LEDs draw as whole circles inside the outline and the pad frames the panel exactly as the editor's preview does. With the shipped values (`margin: 2`, `farLimit: 1000`) the steps are ±3.75 × ±1.0, ±5.75 × ±3.0, and ±7.75 × ±5.0, the last reaching x ±1000 / y ±645 at its edge.

An effect may also carry `presets`: an array of `{ id, name, params }`. These are **starting points, not catalog entries** — the editor renders one button per preset at the top of that layer's panel, and clicking it lays the preset's `params` over the effect's `defaults` to replace the whole look. They deliberately do not appear in the picker, which stays one tile per effect. `emitter` ships four, which is how the two effects it absorbed stay one click away.

An `xy` entry may name `extXKey`/`extYKey`, which the pad draws as **read-only** chrome — a dashed box around the handle, for an emitter whose particles are born over an area rather than at a point. It is edited by its own Width/Height controls; the pad only shows it, because pressing anywhere on the pad places the handle and a second grab target would break that.

Effect types: `wavelet`, `planewave`, `solid`, `gradient_linear`, `gradient_radial`, `emitter`, `particle_trail`, `noise`, `twinkle`, `text`. `emitter`'s presets are where the look of the old `embers`/`candy_sparkler` effects live now; a stored or imported layer using either of those types, or the old combined `gradient`, renders nothing — they are not resolvable effect types.

---

### List scenes

```
GET /api/scenes
```

Returns `[{ "id", "name", "layerCount" }]`, in the library's own order — see *Reorder scenes*.

### Create a scene

```
POST /api/scenes
```

Body: `{ "name"?, "layers"? }` — the server assigns the scene ID, fills missing layer fields from effect defaults, and returns the full scene with `201`.

### Get / replace / delete a scene

```
GET    /api/scenes/:id
PUT    /api/scenes/:id
DELETE /api/scenes/:id
```

`PUT` replaces the whole scene (rename, add/remove/reorder layers). It does **not** activate the scene. `DELETE` of the active scene switches the panel off. Unknown IDs return `404`.

### Reorder scenes

```
PUT /api/scenes/order
```

Body: `{ "ids": [...] }` — every scene ID exactly once, in the order the library should be listed in. Returns the reordered `GET /api/scenes` payload.

Scene order *is* the array order in the stored document, and nothing else can rewrite it (create appends, `PUT /api/scenes/:id` replaces in place, import replaces by ID or appends). The whole list is sent rather than a move so a stale client cannot drop or duplicate a scene: anything that is not a permutation of the IDs the server holds is rejected whole with `400`, and nothing is applied.

### Update a single layer

```
PUT /api/scenes/:sceneId/layers/:layerId
```

Body: a full layer object. This is the high-frequency path for parameter edits (drags) — small payload, applied immediately to the running animation. Returns the normalised layer.

---

### Active scene

```
GET /api/active_scene        →  { "id": "a3b7c901" }  or  { "id": null }
PUT /api/active_scene        body { "id": "a3b7c901" }  or  { "id": null }
```

`{ "id": null }` switches the panel off (renders one black frame, then idles). Activating an unknown ID returns `404`.

---

### Brightness

```
GET /api/brightness/          →  plain-text number 0..1
PUT /api/brightness/:value
```

Global brightness, applied on top of all scenes. The UI maps sliders through an arctangent curve for perceptual uniformity, but the API value is linear.

---

### Export / import

```
GET  /api/scenes/export       →  { "version": 2, "scenes": [ ... ] }
POST /api/scenes/import       body: same shape
```

Import merges by scene ID: matching IDs are replaced, new IDs appended. Anything other than `version: 2` is rejected with `400`.

---

### Scene previews

```
GET /api/scenes/previews      →  every scene's filmstrip
GET /api/scenes/:id/preview   →  one scene's filmstrip, same shape
```

```json
{
  "version": 1,
  "frames": 40,
  "intervalMs": 100,
  "previews": [{ "id": "a1b2c3d4", "hash": "…", "data": "<base64>" }]
}
```

A **filmstrip** is a short loop of a scene rendered off the hot loop, so the scene selector can show every scene and not just the active one. `data` decodes to `frames × 240 × 3` bytes, frame-major, each frame being one composite in the same **strip order** as the WebSocket frames — the grid mapping is the client's (`ui/src/lib/panelGrid.js`) and is deliberately not repeated in the payload.

Values are pre-brightness, like the WebSocket stream. `hash` covers the scene's content, and the server caches by it: an unedited scene costs nothing to re-request, and an edited one is re-rendered on the next call.

The strip **loops cleanly**: particle effects are warmed before capture so they start settled rather than empty — 8 s of simulated time by default, and as long as the scene's slowest layer asks for where an effect knows better (an emitter ramps up from empty over about one and a half of its lifetimes, so it asks for two of the longest life it can produce) — and the tail is cross-dissolved into the head so frame `frames` is frame `0`. Play it end to end and repeat — no seam handling is needed client-side. Playing several strips at once, though, is worth offsetting: they are all the same length, so a shared clock puts every one of them at the same point in its loop.

```
GET /api/effects/previews     →  one filmstrip per effect, at its defaults
```

Same payload, with `id` holding the effect `type` instead of a scene ID — for an editor's effect picker, which has no layer to render yet. Effect defaults are fixed in code, so these are rendered once and kept.

One strip per effect, never one per preset: an effect's `presets` are starting points offered inside its layer editor, not separate things to add. Hidden effects get no strip.

---

### Check virtual mode

```
GET /api/virtual
```

Returns `{ "virtual": true }` if the server is running without Fadecandy hardware.

---

### Frame-rate tracker

```
GET /api/fps
PUT /api/fps                  body: { "enabled": true }
```

Instrumentation for the render loop, **off by default**. Both verbs return the same snapshot; the toggle persists across restarts.

```json
{
  "enabled": true,
  "targetFps": 100,
  "idle": false,
  "fps": 91.6,
  "frameMs": 10.92,
  "renderMs": 0.02,
  "tickMs": 0.08,
  "worstFrameMs": 11.53,
  "worstRenderMs": 0.05,
  "overruns": 0,
  "frames": 1841,
  "latePercent": 0,
  "lateFrames": 0,
  "windowFrames": 910,
  "lateWindowMs": 10000,
  "uptimeMs": 20114.7,
  "virtual": false
}
```

`fps`, `frameMs`, `renderMs` and `tickMs` are averages over a rolling ~1 s window; `latePercent` is over a longer one (`lateWindowMs`); `worst*`, `overruns` and `frames` are cumulative since the tracker last restarted. `renderMs` is the compositor plus the write to the pixel sink, `tickMs` the whole tick including the WebSocket broadcast — the pair says whether a shortfall is our own work or the timer.

Five things the numbers do *not* mean:

- **`targetFps` is nominal, not a goal that gets hit.** The loop is a 10 ms `setInterval`, which clamps: a perfectly healthy loop reports around 91 FPS. Judge it on `frameMs` against the 10 ms target and on `latePercent`, not on equality with `targetFps`.
- **`overruns` counts tick gaps of ≥2× the target** — `setInterval` coalescing, or something blocking past the interval. A gap over 500 ms is treated as the loop having been idle instead, and is neither sampled nor counted. It is a running total, so it answers "has this ever stumbled", not "is it stumbling"; **`latePercent` is the live figure** — the same overruns as a share of `windowFrames`, the frames actually rendered in the last `lateWindowMs`, so a stall ages out and the number falls back to zero on its own. Seconds in which nothing rendered contribute no frames, and so never dilute it.
- **Everything is scoped to the active scene.** Render cost is largely a property of the scene, so changing it restarts the tracker — cumulative counters back to zero, window cleared, `uptimeMs` re-based. Switching *off* does not: coming back to the same scene resumes the same soak.
- **`idle: true` means nothing is rendering**, normally because no scene is active — the loop renders one black frame and then fast-exits, which is correct behaviour, not 0 FPS. The other fields hold the last figures taken.
- **This is the panel's frame rate, not the preview stream's**, which is separately throttled to ~30 FPS (~15 for layer frames).

`virtual` is echoed because the reading means different things per mode: the loop and the compositor are identical under `VIRTUAL=1`, so the render figures are real, but there is no hardware write and a dev machine is not a Pi. Clients should label it.

---

### Power meter and limiter

```
GET /api/power
PUT /api/power                body: any subset of the config fields
```

Estimated panel current, and the limiter that keeps frames inside a budget. Both verbs return the same snapshot; the config persists across restarts. A `PUT` **merges** — send one field without resending the rest.

```json
{
  "limit": true,
  "maxMilliamps": 20000,
  "overheadMilliamps": 1200,
  "ledMilliamps": 55,
  "standbyMilliamps": 1,
  "gamma": 2.5,
  "whitepoint": [0.98, 1, 1],

  "numLeds": 240,
  "budgetMilliamps": 18800,
  "maxMilliampsFullWhite": 13352,

  "idle": false,
  "milliamps": 8800,
  "requestedMilliamps": 8800,
  "peakMilliamps": 8800,
  "limiting": false,
  "scale": 1,
  "floored": false
}
```

The estimate is summed on the write path, over the post-brightness bytes the sink is about to send, and averaged over a rolling ~1 s window. `requestedMilliamps` is what the scene asked for and `milliamps` what was actually sent; they differ only while `limiting`.

Three things worth knowing before trusting the numbers:

- **The model is gamma-aware, and has to be.** `fcserver.json` applies `gamma: 2.5` and a whitepoint, so an LED's duty cycle is `whitepoint × (value/255)^gamma`, not `value/255`. A mid-grey frame draws about 18% of full white, not 50%. **`gamma` and `whitepoint` here must match `fcserver.json`** — change one without the other and every reading is wrong.
- **`budgetMilliamps` is `maxMilliamps − overheadMilliamps`.** A tighter, IR-drop-aware cap was tried (a modelled supply rail sagging under load, `rail: {openCircuitVolts, ohms, floorVolts}`) and dropped: fitting it needs a real voltage reading, and the Pi's route to one — `vcgencmd pmic_read_adc` / `EXT5V_V` — is undocumented and unavailable on a standard Pi 4 Model B (Raspberry Pi Ltd's "Extra PMIC features" whitepaper scopes that ADC to CM4 only). The PSU cap alone held up fine against manual full-white testing.
- **`scale` multiplies channel values, and is not the current ratio.** Current goes as `value^gamma`, so a frame cut to 65% of its current is scaled by `0.65^(1/2.5) = 0.843` — white at byte 215. It is continuous at the threshold, so nothing flickers as a scene animates across it.

`floored: true` means the budget is below the panel's standby draw (`numLeds × standbyMilliamps`), which no amount of dimming can reach. The panel is driven at a minimum rather than blacked out, but this is a misconfiguration, not a load.

Previews are unaffected: the WebSocket stream serialises the compositor's composite, which is pre-brightness and pre-limiter, so the UI stays a pre-fader meter and only the panel dims.

---

## Wavelet parameters

The `wavelet` effect renders one sinusoidal wave radiating from a point — or converging on it; stack several with the `add` blend for interference patterns.

| Field       | Type    | Description |
|-------------|---------|-------------|
| `color`     | string  | Hex colour, e.g. `"#ff6633"` |
| `freq`      | number  | Oscillation speed (higher = faster) |
| `lambda`    | number  | Spatial wavelength (higher = wider waves) |
| `delta`     | number  | Phase offset |
| `x`         | number  | Wave origin X. The panel spans ±3.625; the editor pad reaches ±1000 at full zoom |
| `y`         | number  | Wave origin Y. The panel spans ±0.875; the editor pad reaches ±639 at full zoom |
| `direction` | string  | `"outward"` (default) or `"inward"` — whether crests run from the origin or converge on it |
| `min`       | number  | Minimum intensity (UI uses non-linear arctan slider mapping) |
| `max`       | number  | Maximum intensity |

`direction` is a toggle rather than a negative `freq` or `lambda` because both of those are log sliders, which cannot express a negative. A layer stored without it renders outward, as it always did.

Nothing clamps `x`/`y` server-side, and the editor's numeric fields accept values beyond the pad's reach — only the drag handle is bounded.

## Plane wave parameters

The `planewave` effect is the far-field limit of `wavelet`: parallel wavefronts crossing the panel at a chosen direction, with no origin to place. Use it when you want straight stripes at a specific angle, or at short wavelengths where even a very distant `wavelet` source stays measurably curved.

| Field    | Type    | Description |
|----------|---------|-------------|
| `color`  | string  | Hex colour |
| `freq`   | number  | Oscillation speed |
| `lambda` | number  | Spatial wavelength |
| `delta`  | number  | Phase offset |
| `angle`  | number  | Direction the wave travels, in degrees. 0 = rightwards, 90 = upwards |
| `min`    | number  | Minimum intensity |
| `max`    | number  | Maximum intensity |

An outward `wavelet` at distance `D` and a `planewave` at `angle = atan2(y, x) + 180` (waves move away from their source) render identically once `D` is large, because the `D/lambda` term the approximation drops is a constant phase offset that folds into `delta`. An inward one is the same identity with both signs flipped: the angle is the bearing *of* the source, and the dropped distance is a phase lag instead of a lead.

## Text parameters

The `text` effect renders one line of type on the panel — static or scrolling, with clock tokens resolved inside the string.

| Field        | Type   | Description |
|--------------|--------|-------------|
| `text`       | string | The line, up to 256 characters. Clock tokens are resolved in place (see below) |
| `font`       | string | `"regular"`, `"bold"`, `"heavy"` or `"round"` |
| `color`      | string | Hex colour of the type |
| `background` | string | Hex colour behind it. `"#000000"` means "type only" |
| `level`      | number | Scales the whole layer, ink and ground alike |
| `softness`   | number | Extra blur in glyph cells, 0–1.5. 0 is plain interpolation, which is already sub-pixel |
| `tracking`   | number | Blank columns between glyphs, 0–4 |
| `scroll`     | number | Columns per second, signed. Positive reads right-to-left; 0 is static and centred |
| `gap`        | number | Blank columns between the end of the line and its next repeat while scrolling |

**There are no position params.** The line is centred: the case that wants placing is one narrower than the panel, and there is exactly one sensible place for it. A line wider than 30 columns shows its middle standing still, and a scroll is how you read the rest of it.

### Clock tokens

Tokens live *in the text* rather than behind a mode, so `{HH}:{mm}` and `It is {h}:{mm}{a}` are the same effect doing the same thing and no control changes meaning when a scene happens to be telling the time.

`{HH}` `{H}` `{hh}` `{h}` hours (24h then 12h) · `{mm}` `{m}` minutes · `{ss}` `{s}` seconds · `{a}` `{A}` am/pm · `{DD}` `{D}` day · `{MM}` `{M}` month · `{YYYY}` `{YY}` year. Case-sensitive, as everywhere else that spells dates: `MM` is the month and `mm` the minutes. An unrecognised brace is ordinary text, so nothing is stolen from a line that happens to contain one.

Tokens resolve against the millis the render loop passes, never the wall clock, which is what lets a filmstrip render a 4-second loop in 40 renders. It also means **a clock's scene card is frozen**: previews are rendered at a fixed time base, so an inactive card shows one arbitrary time until the scene is made active.

### Fonts

Four faces, all in an 8-row cell. `regular` covers printable ASCII including lowercase; the other three are caps-only and fold lowercase up rather than boxing it.

| Face | Cell | Notes |
|---|---|---|
| `regular` | 5×7 caps, descenders on row 8 | The face to read as type. ~5 characters on the panel |
| `bold` | 6×7 caps, two-column stems | For a layer feeding a blend — a one-LED stroke all but vanishes under a multiply |
| `heavy` | 6×8, two-column stems **and two-row arms** | Fills the cell, so it is the one face centred by construction |
| `round` | `heavy` with its curves in partial cells | Glyph cells carry coverage, not a bit, so a corner can be ¾ and ¼ |

A character with no glyph in the chosen face renders as a hollow box — visible, rather than silently missing. Every digit within a face is the same width, so a clock does not reflow when the minute rolls 19 → 20.

### Using it as a negative mask

`background` is what lets the layer *remove* something rather than only add to it. The layer renders `background + coverage × (colour − background)` — a lerp, not a scale — so:

- black background (the default) draws nothing but the letters, exactly as scaling the ink alone would;
- white background with black ink makes the layer a **negative**, and a `multiply` blend punches the letters out of everything below it.

The lerp is the point: a partial coverage cell lands between the two colours, so the punch-out inherits the same antialiased edge the type has.

**The punch is only as deep as the coverage is complete**, which ties it to `softness` and to the face. At softness 0 every stroke reaches full coverage; above it, a stroke reaches full coverage only if it is wide enough to have a neighbour on both sides. The share of the layer below that survives inside the letters:

| face | softness 0 | 0.1 | 0.2 | 0.35 | 0.5 |
|---|---|---|---|---|---|
| `heavy` / `round` | 0.0% | 0.6% | 1.6% | 2.9% | 4.0% |
| `regular` | 0.0% | 8.9% | 15.6% | 22.9% | 28.0% |

So: **for a negative mask, use a bold face and keep softness low** — which is the same argument the bold faces exist for, arriving from the other direction. The `punchout` preset ships that pairing; set the layer's blend to Multiply to see it.

An unparseable `background` falls back to **black**, not white as `color` does: a typo in a colour should degrade to ordinary type, never light the whole panel.

## WebSocket pixel stream

A WebSocket server on port `3001` streams pixel state in both virtual and hardware modes.

**v1 (default):** on connect, each message is a JSON array of 240 `[r, g, b]` triples (0–255) — the composite output **before** global brightness — at ~30 FPS. The most recent frame is replayed to new connections. Streamed frames are deliberately pre-fader: previews always show the scene at full brightness, and only the panel dims with `/api/brightness`.

**v2 (layer previews):** send

```json
{ "type": "subscribe_layers", "sceneId": "a3b7c901" }
```

and while that scene is active you receive, at ~15 FPS:

```json
{ "type": "frame", "composite": [[r,g,b], ...], "layers": { "<layerId>": [[r,g,b], ...] } }
```

instead of v1 frames. `composite` is pre-brightness like v1; layer frames are additionally pre-opacity (thumbnails of faint layers stay legible). Send `{ "type": "unsubscribe_layers" }` to revert to v1.
