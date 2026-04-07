# Light Panel HTTP API

Base URL: `http://<host>:3000`

All endpoints use JSON for request/response bodies unless noted. CORS is enabled.

## Presets

The panel supports two preset types:

- **Fixed** presets are built-in animations with IDs prefixed `f:` (e.g. `f:off`, `f:embers`, `f:particle_trail`, `f:candy_sparkler`, `f:pastel_spots`).
- **Wavelet** presets are user-created. Each contains an array of wavelets that combine to produce an interference-pattern animation. IDs are 8-character hex strings (e.g. `a3b7c901`).

---

## Endpoints

### List all presets

```
GET /api/all_presets/
```

Returns an array of `{ id, name, type }` objects for every preset (fixed and wavelet).

```json
[
  { "id": "f:off", "name": "Off", "type": "fixed" },
  { "id": "f:embers", "name": "Embers", "type": "fixed" },
  { "id": "a3b7c901", "name": "Sunset", "type": "wavelet" }
]
```

---

### Get active preset

```
GET /api/current_preset_id/
```

Returns the ID of the currently active preset as **plain text**.

---

### Set active preset

```
PUT /api/current_preset_id/:id
```

Activates the preset with the given ID. If the ID is not found, the panel switches off (`f:off`). Returns `200`.

Example: `PUT /api/current_preset_id/f:embers`

---

### Get brightness

```
GET /api/brightness/
```

Returns the current global brightness as a **plain text** number between `0` and `1`.

---

### Set brightness

```
PUT /api/brightness/:value
```

Sets global brightness. `value` is a number between `0` (dark) and `1` (full). Returns `200`.

Example: `PUT /api/brightness/0.5`

---

### Get a wavelet preset

```
GET /api/wave_config/:id
```

Returns the full wavelet preset object for the given ID.

```json
{
  "id": "a3b7c901",
  "name": "Sunset",
  "type": "wavelet",
  "wavelets": [
    {
      "id": "b2c3d4e5",
      "color": "#ff6633",
      "freq": 0.3,
      "lambda": 0.3,
      "delta": 0.0,
      "x": 0,
      "y": 0,
      "min": 0.2,
      "max": 0.4,
      "clip": false,
      "solo": false
    }
  ]
}
```

---

### Create or update a wavelet preset

```
PUT /api/wave_config/:id
```

Body: a full wavelet preset object (see above). If a preset with the given ID already exists it is replaced; otherwise a new one is created. The preset is also **activated immediately**. Returns `200`.

When creating a new preset, generate the preset and wavelet IDs yourself as 8-character hex strings (the first segment of a UUID v4).

---

### Delete a wavelet preset

```
DELETE /api/wave_config/:id
```

Removes the preset. If it was the active preset, the panel switches to `f:off`. Returns `200`.

---

### Export all wavelet presets

```
GET /api/all_wave_config/
```

Returns an array of all wavelet preset objects (suitable for backup/export).

---

### Replace all wavelet presets

```
PUT /api/all_wave_config/
```

Body: an array of wavelet preset objects. **Replaces** the entire wavelet preset list. Returns `200`.

---

### Import/merge wavelet presets

```
POST /api/all_wave_config/
```

Body: an array of wavelet preset objects. Presets with matching IDs are updated in place; new IDs are appended. Fixed presets in the array are ignored. Returns `200`.

---

### Check virtual mode

```
GET /api/virtual
```

Returns `{ "virtual": true }` if the server is running in virtual mode (no hardware), or `{ "virtual": false }` for hardware mode.

---

## Wavelet parameters

Each wavelet in a preset controls one wave component of the animation.

| Field    | Type    | Description |
|----------|---------|-------------|
| `id`     | string  | 8-char hex identifier |
| `color`  | string  | Hex colour, e.g. `"#ff6633"` |
| `freq`   | number  | Oscillation speed (higher = faster) |
| `lambda` | number  | Spatial wavelength (higher = wider waves) |
| `delta`  | number  | Phase offset |
| `x`      | number  | Wave origin X position on the panel (range approx -3.6 to 3.6) |
| `y`      | number  | Wave origin Y position on the panel (range approx -0.9 to 0.9) |
| `min`    | number  | Minimum intensity (uses non-linear arctan mapping) |
| `max`    | number  | Maximum intensity (uses non-linear arctan mapping) |
| `clip`   | boolean | Whether to clip values outside min/max |
| `solo`   | boolean | When true, only wavelets with `solo: true` are rendered |

## WebSocket pixel stream

A WebSocket server on port `3001` broadcasts the current pixel state at 100 FPS. Each message is a JSON array of 240 `[r, g, b]` triples (values 0-255), representing the 30x8 LED grid in layout order. This is available in both virtual and hardware modes.
