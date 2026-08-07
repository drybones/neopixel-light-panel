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
      "effectType": "gradient",
      "params": { "stops": [ { "position": 0, "color": "#241040" }, { "position": 1, "color": "#e04f1f" } ], "mode": "linear", "angle": 0, "cx": 0, "cy": 0, "animate": "scroll", "speed": 0.05 },
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

Schema entry types: `color`, `number` (with `min`/`max`/`step` and `scale: linear|atan|log`), `xy` (two params, `xKey`/`yKey`), `angle` (degrees, 0–360, rendered as a dial pointing along the direction of travel), `range` (min/max pair, `minKey`/`maxKey`), `enum` (with `options`), `gradientStops`.

`scale: log` spreads `min`/`max` over decades so equal slider travel is equal ratio — for wavelength, the speeds and the ambient glow floors, which span more range than a linear track can usefully hold. It ignores `step` (the track is integer positions). Adding `zeroable: true` reserves the bottom of the track for an exact `0`, which several params store to mean "frozen" or "no floor" and which a log scale cannot otherwise express.

**Schema `min`/`max` are slider hints, not validation.** Nothing clamps params to them — `normaliseLayer` checks only `opacity` — so stored values outside the range render fine and the slider simply pins at its end. Typed entry is deliberately unclamped, which is how a preset value no slider can reach is restored.

`xRange`/`yRange` are the panel's own extent (±3.625 × ±0.875, the outermost LED centres). Two optional fields add zoom steps to the editor's pad, each adding one ring of constant world-unit width on all four sides:

- `margin` — width of a ring, in world units, adding a **near** step for sources just off the panel. Constant width (rather than scaled to the panel's 4:1 aspect) keeps one world-units-per-pixel scale on both axes, so the direction you drag is the direction the effect gets; an aspect-matched ring would skew a corner drag by tens of degrees. Because the rings are constant width and the panel is not square, each step has its own aspect ratio, growing squarer as you zoom out.
- `farLimit` — if set, adds a **far** step whose outer ring — the same width as the near one — compresses so its edge reaches this distance, for sources far enough away that the wave reads as planar. The compression is exponential in the ring, so reach spreads across the drag rather than bunching into the last few pixels, and only the magnitude is warped so the drag direction stays exact.

The rings are measured from the panel's **cell box** — half an LED pitch beyond the outermost centres, ±3.75 × ±1.0 — rather than the centres themselves, so the edge LEDs draw as whole circles inside the outline and the pad frames the panel exactly as the editor's preview does. With the shipped values (`margin: 2`, `farLimit: 1000`) the steps are ±3.75 × ±1.0, ±5.75 × ±3.0, and ±7.75 × ±5.0, the last reaching x ±1000 / y ±645 at its edge.

Effect types: `wavelet`, `planewave`, `solid`, `gradient`, `embers`, `particle_trail`, `candy_sparkler`, `noise`, `twinkle`.

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

The strip **loops cleanly**: particle effects are warmed for 8 s of simulated time before capture so they start lit rather than empty, and the tail is cross-dissolved into the head so frame `frames` is frame `0`. Play it end to end and repeat — no seam handling is needed client-side. Playing several strips at once, though, is worth offsetting: they are all the same length, so a shared clock puts every one of them at the same point in its loop.

```
GET /api/effects/previews     →  one filmstrip per effect, at its defaults
```

Same payload, with `id` holding the effect `type` instead of a scene ID — for an editor's effect picker, which has no layer to render yet. Effect defaults are fixed in code, so these are rendered once and kept.

---

### Check virtual mode

```
GET /api/virtual
```

Returns `{ "virtual": true }` if the server is running without Fadecandy hardware.

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

An outward `wavelet` at distance `D` and a `planewave` at `angle = atan2(y, x) + 180` (waves move away from their source) render identically once `D` is large, because the `D/lambda` term the approximation drops is a constant phase offset that folds into `delta`. An inward one is the same identity with both signs flipped: the angle is the bearing *of* the source, and the dropped distance is a phase lag instead of a lead. That identity is what the conversion in `engine/planewave-migrate.js` uses.

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

## Migration from the preset API

The old preset endpoints (`/api/all_presets/`, `/api/current_preset_id/`, `/api/wave_config/`, `/api/all_wave_config/`) were removed. On first boot after upgrading, persisted wavelet presets are automatically converted to scenes (one `wavelet` layer per wavelet, `add` blend) under the same IDs; the old `wave_config` storage key is left in place for rollback. The old fixed presets exist as ordinary editable scenes seeded once ("Embers", "Particle Trail", "Candy Sparkler"); `pastel_spots` was retired.

## Migration to plane waves

Several presets faked a plane wave by putting the source a thousand units off-panel, which the position pad could not represent or recover. On first boot after upgrading, any `wavelet` layer far enough away that its residual wavefront curvature is negligible becomes a `planewave` with the equivalent `angle` and `delta`. Layers with a short `lambda` are left alone, since curvature stays visible for them however distant the source. The pre-conversion document is written to `.node-persist/scenes-v2.pre-planewave.json` for rollback, and a `planeWaveMigrated` flag in the scene document stops it running twice — so a `wavelet` you later drag out to the pad's far edge stays a `wavelet`.
