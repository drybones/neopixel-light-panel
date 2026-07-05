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
      { "type": "xy", "label": "Position", "xKey": "x", "yKey": "y", "xRange": [-3.6, 3.6], "yRange": [-0.9, 0.9], "draggable": true }
    ],
    "defaults": { "color": "#ffffff", "freq": 0.2 }
  }
]
```

Schema entry types: `color`, `number` (with `min`/`max`/`step` and `scale: linear|atan`), `xy` (two params, `xKey`/`yKey`), `range` (min/max pair, `minKey`/`maxKey`), `enum` (with `options`), `gradientStops`.

Effect types: `wavelet`, `solid`, `gradient`, `embers`, `particle_trail`, `candy_sparkler`, `noise`, `twinkle`.

---

### List scenes

```
GET /api/scenes
```

Returns `[{ "id", "name", "layerCount" }]`.

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

### Check virtual mode

```
GET /api/virtual
```

Returns `{ "virtual": true }` if the server is running without Fadecandy hardware.

---

## Wavelet parameters

The `wavelet` effect renders one sinusoidal wave radiating from a point; stack several with the `add` blend for interference patterns.

| Field    | Type    | Description |
|----------|---------|-------------|
| `color`  | string  | Hex colour, e.g. `"#ff6633"` |
| `freq`   | number  | Oscillation speed (higher = faster) |
| `lambda` | number  | Spatial wavelength (higher = wider waves) |
| `delta`  | number  | Phase offset |
| `x`      | number  | Wave origin X on the panel (approx -3.6 to 3.6) |
| `y`      | number  | Wave origin Y on the panel (approx -0.9 to 0.9) |
| `min`    | number  | Minimum intensity (UI uses non-linear arctan slider mapping) |
| `max`    | number  | Maximum intensity |

## WebSocket pixel stream

A WebSocket server on port `3001` streams pixel state in both virtual and hardware modes.

**v1 (default):** on connect, each message is a JSON array of 240 `[r, g, b]` triples (0–255) — the composite output after brightness — at ~30 FPS. The most recent frame is replayed to new connections.

**v2 (layer previews):** send

```json
{ "type": "subscribe_layers", "sceneId": "a3b7c901" }
```

and while that scene is active you receive, at ~15 FPS:

```json
{ "type": "frame", "composite": [[r,g,b], ...], "layers": { "<layerId>": [[r,g,b], ...] } }
```

instead of v1 frames. Layer frames are pre-opacity and pre-brightness (thumbnails of faint layers stay legible). Send `{ "type": "unsubscribe_layers" }` to revert to v1.

## Migration from the preset API

The old preset endpoints (`/api/all_presets/`, `/api/current_preset_id/`, `/api/wave_config/`, `/api/all_wave_config/`) were removed. On first boot after upgrading, persisted wavelet presets are automatically converted to scenes (one `wavelet` layer per wavelet, `add` blend) under the same IDs; the old `wave_config` storage key is left in place for rollback. The old fixed presets exist as ordinary editable scenes seeded once ("Embers", "Particle Trail", "Candy Sparkler"); `pastel_spots` was retired.
