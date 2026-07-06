# NeoPixel Light Panel

A web-controlled LED light panel built from NeoPixel strips and a Fadecandy controller. A Node.js server drives the animations at 100 FPS while a React UI works as a visual mixer: each scene is a stack of effect layers (waves, gradients, particles, noise) composited with blend modes and opacity, edited live with direct-manipulation controls and switched from any browser on the network.

Video demo: https://youtu.be/4FmCFS33W90

## Hardware

The panel is eight half-metre lengths of 60 pixel/m NeoPixel strip (240 LEDs total, arranged as a 30x8 grid). Each strip connects to its own channel on a [Fadecandy](https://github.com/scanlime/fadecandy) board, which is USB-connected to a Raspberry Pi running the server.

You will need:

- 8x 0.5m NeoPixel strips (60 LED/m, WS2812B or compatible)
- 1x Fadecandy board
- A Raspberry Pi (or any Linux/macOS/Windows machine with Node.js)
- 5V power supply rated for the strip current draw
- The Fadecandy server binary (`fcserver`) running on the same host, listening on port 7890

If you don't have the hardware, the server can run in **virtual mode** (`VIRTUAL=1`), which replaces the Fadecandy connection with a WebSocket that streams pixel data to the UI's built-in LED visualiser.

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

Effects live in `effects/` as self-contained modules — each declares a parameter schema (which drives the UI), precomputes expensive work on the API write path, and keeps per-layer animation state in an instance, so two ember layers flicker independently. Current effects: wavelet, solid colour, gradient, embers, particle trail, candy sparkler, noise field, twinkle.

`opc.js` is the OPC client that talks to Fadecandy over TCP; `virtual-opc.js` is a drop-in replacement used when `VIRTUAL=1` is set. In both modes `engine/broadcast.js` streams pixel state over a WebSocket on port 3001 for the UI's live previews (composite at ~30 FPS, plus optional per-layer frames for the editor).

Scenes are persisted to a crash-safe JSON file (atomic tmp+rename writes with a `.bak` fallback, debounced to be SD-card friendly) so a power cut can't lose them; brightness and legacy keys stay in `node-persist`. On first boot after upgrading from the old preset model, wavelet presets are migrated to scenes automatically.

### `packages/ui/` -- React control interface

A React 18 app built with Vite (zustand for state). The default view is a scene switcher — a responsive card grid with a live preview on the active scene, designed to work well on a phone. Opening a scene switches to the editor: a large live preview you can drag effects around on directly, a layer stack with animated per-layer thumbnails, and a parameter panel rendered from each effect's schema (colour swatches, XY pads, gradient-stop strips, perceptual sliders). Edits stream to the server as you drag — the panel itself is the ultimate preview.

## API

See [API.md](API.md) for full HTTP API documentation, suitable for building your own integrations.
