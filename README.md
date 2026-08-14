# NeoPixel Light Panel

A web-controlled LED light panel built from NeoPixel strips and a Fadecandy controller. A Node.js server drives the animations at 100 FPS while a React UI works as a visual mixer: each scene is a stack of effect layers (waves, gradients, particles, noise) composited with blend modes and opacity, edited live with direct-manipulation controls and switched from any browser on the network.

Video demo: https://youtu.be/4FmCFS33W90

<p>
  <img src="docs/screenshots/scene-picker.png" alt="Scene picker showing a grid of saved scenes" width="49%">
  <img src="docs/screenshots/scene-editor.png" alt="Scene editor with layer stack, parameter panel and live preview" width="49%">
</p>

## Hardware

The panel is eight half-metre lengths of 60 pixel/m NeoPixel strip (240 LEDs total, arranged as a 30x8 grid). Each strip connects to its own channel on a [Fadecandy](https://github.com/scanlime/fadecandy) board, which is USB-connected to a Raspberry Pi running the server.

You will need:

- 8x 0.5m NeoPixel strips (60 LED/m, WS2812B or compatible)
- 1x Fadecandy board
- A Raspberry Pi (or any Linux/macOS/Windows machine with Node.js)
- 5V power supply rated for the strip current draw
- The Fadecandy server binary (`fcserver`) running on the same host, listening on port 7890

If you don't have the hardware, the server can run in **virtual mode** (`VIRTUAL=1`), which replaces the Fadecandy connection with a WebSocket that streams pixel data to the UI's built-in LED visualiser.

### Power

240 WS2812B at full white is about **13.4 A at 5 V**, and almost nothing else comes close — Fadecandy's gamma curve means a mid-grey frame draws roughly a fifth of that, so ordinary scenes sit far below the worst case.

Sizing the supply for 13.4 A is not the whole story, though. The constraint that can bite first is **voltage, not current**: everything downstream of the supply's terminals shares a resistance (regulation droop, leads, connectors), so the rail falls under load. A very ordinary 40 mΩ costs half a volt at 14 A, which is enough to push a Pi sharing that supply below its ~4.63 V undervoltage trip — on a supply rated for 20 A, with 6 A to spare on paper. If a solid-white test scene browns out the Pi while every real scene is fine, this is why, and thicker leads or power injection help more than a bigger PSU does.

The server estimates the draw and can hold frames inside a budget (`GET|PUT /api/power`, and the "Power budget" panel in the UI). The budget is a plain cap on the PSU's rating, less what's reserved for the Pi and Fadecandy — an earlier version fit a tighter, IR-drop-aware cap from a real voltage reading, but that reading turned out to depend on a PMIC ADC (`vcgencmd pmic_read_adc` / `EXT5V_V`) that Raspberry Pi Ltd's own documentation scopes to CM4 only, not a standard Pi 4 Model B. If your board does expose that ADC, or you can measure the rail some other way, wiring a tighter cap back in is a reasonable extension — this project just isn't carrying dead code for a measurement it can't take on its own hardware.

## Prerequisites

- Node.js 16+ (14 is supported but 16+ recommended)
- npm 7+ (for workspace support)

For hardware mode only:

- `fcserver` running and accessible (defaults to `localhost:7890`)

## Getting started

```bash
git clone <this repo>
cd neopixel-light-panel
npm install
```

### Development (virtual mode, no hardware needed)

```bash
npm run dev
```

This starts the API server on port 3000 in virtual mode and the UI dev server on port 3002. Open http://localhost:3002 in a browser. The UI connects to the server automatically and shows a live LED visualiser.

### Production (with Fadecandy hardware)

Start the Fadecandy server first:

```bash
fcserver fcserver.json
```

Then start the light panel server:

```bash
npm start
```

The server listens on port 3000. It serves a production build of the UI from `packages/ui/dist/`, so build the UI first if you haven't already:

```bash
npm run build --workspace=packages/ui
```

Then open http://\<pi-hostname\>:3000 in a browser.

### Deploying to a Pi

The root `package.json` includes a deploy script that builds the UI and rsyncs it to the Pi:

```bash
npm run deploy
```

This assumes the Pi is reachable at `pi@blinky.local` and the repo is cloned to `/home/pi/github/neopixel-light-panel/`. Edit the `deploy` script in `package.json` to match your setup.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `VIRTUAL` | unset | Set to `1` to run without Fadecandy hardware |
| `FADECANDY_SERVER` | `localhost` | Hostname of the Fadecandy server (port is always 7890) |
| `REACT_APP_LIGHTPANEL_API_SERVER` | `http://localhost:3000` | Backend URL, used by the UI |
| `REACT_APP_LIGHTPANEL_WS_SERVER` | derived from API URL, port 3001 | WebSocket URL for the LED visualiser |

## How it works

The project is an npm workspaces monorepo with two packages.

### `packages/server/` -- API server and animation engine

The server is a small Express app (`app.js`) with a `setInterval` render loop running at 100 FPS. On each tick the compositor renders every layer of the active scene into its own buffer, blends them bottom→top (normal/add/multiply/screen/overlay with per-layer opacity), and writes the result out via the Open Pixel Control protocol.

Effects live in `effects/` as self-contained modules — each declares a parameter schema (which drives the UI), precomputes expensive work on the API write path, and keeps per-layer animation state in an instance, so two particle layers animate independently. Current effects: wavelet, plane wave, solid colour, linear gradient, radial gradient, emitter, particle trail, noise field, twinkle.

`opc.js` is the OPC client that talks to Fadecandy over TCP; `virtual-opc.js` is a drop-in replacement used when `VIRTUAL=1` is set. In both modes `engine/broadcast.js` streams pixel state over a WebSocket on port 3001 for the UI's live previews (composite at ~30 FPS, plus optional per-layer frames for the editor).

Scenes and settings (brightness, the frame-stats toggle) are persisted to crash-safe JSON files in `packages/server/data/` (atomic tmp+rename writes with a `.bak` fallback, debounced to be SD-card friendly) so a power cut can't lose them.

### `packages/ui/` -- React control interface

A React 18 app built with Vite (zustand for state). The default view is a scene switcher — a responsive card grid with a live preview on the active scene, designed to work well on a phone. Opening a scene switches to the editor: a large read-only live preview, a layer stack with animated per-layer thumbnails, and a parameter panel rendered from each effect's schema (colour swatches, XY pads, gradient-stop strips, perceptual sliders). Edits stream to the server as you drag — the panel itself is the ultimate preview. The cog in the header opens a settings page holding the power budget and whole-library import/export.

## API

See [API.md](API.md) for full HTTP API documentation, suitable for building your own integrations.
