#!/usr/bin/env node

const path = require('path');
const OPC = process.env.VIRTUAL ? require('./virtual-opc') : require('./opc');
const client = new OPC(process.env.FADECANDY_SERVER || 'localhost', 7890);
const model = OPC.loadModel(path.join(__dirname, 'layout.json'));

const { Compositor } = require('./engine/compositor');
const { SceneStore } = require('./engine/scene-store');
const { SettingsStore } = require('./engine/settings-store');
const { Broadcaster } = require('./engine/broadcast');
const { PreviewCache, EffectPreviewCache } = require('./engine/preview-cache');
const { FrameStats } = require('./engine/frame-stats');
const { createTick } = require('./engine/render-loop');
const effects = require('./effects');
const createScenesRouter = require('./routes/scenes');
const createSystemRouter = require('./routes/system');
const { errorHandler } = require('./routes/errors');
const { createOriginGuard } = require('./routes/origin');

const compositor = new Compositor(client, model);

// Size the sink up front. setPixel would grow the buffer one pixel at a time
// on the first frame anyway; doing it here also means the power meter knows
// the LED count before anything has rendered, so /api/power answers correctly
// on a panel that is switched off.
client.setPixelCount(model.length);

// Scene-card filmstrips. Rendered off the hot loop into a throwaway
// compositor, so this never touches the panel or the live layer instances.
const previewCache = new PreviewCache(model);
const effectPreviewCache = new EffectPreviewCache(model);

// Previews stream the compositor's pre-brightness composite, so they stay
// legible (pre-fader meter) while only the panel dims.
const broadcaster = new Broadcaster(compositor, model.length);

const express = require('express');
const app = express();
// The production UI is served below, same-origin; the Vite dev server is the
// only foreign page that should reach the API, and only in dev. See
// routes/origin.js for why CORS alone would not be enough.
app.use(createOriginGuard({
    allowedOrigins: process.env.VIRTUAL ? ['http://localhost:3002'] : [],
}));
app.use(express.static(path.join(__dirname, '../ui/dist')));
app.use(express.json());

// Scenes live in their own crash-safe file (atomic writes + .bak).
const SCENES_FILE = path.join(__dirname, 'data', 'scenes-v2.json');
const store = new SceneStore(compositor, SCENES_FILE);

const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');
const settings = new SettingsStore(SETTINGS_FILE);

// Render-loop instrumentation. Off by default and costed for the hot loop;
// the toggle persists alongside brightness so a soak survives a restart of
// lightpanel.service.
const TICK_MS = 10;
const frameStats = new FrameStats({ targetMs: TICK_MS });

async function initStorage() {
    settings.load();
    client.brightness = settings.brightness;
    client.power.setConfig(settings.power);
    frameStats.setEnabled(settings.frameStatsEnabled);

    try {
        store.load();
        console.log(`Loaded ${store.scenes.length} scene(s); active: ${store.activeSceneId}`);
    } catch (err) {
        console.error('Scene store load failed:', err);
    }

    // Warm the filmstrips in the background so the first load of the switcher
    // doesn't pay the render burst. all() yields between scenes, so the render
    // loop keeps its tick throughout.
    previewCache.all(store.scenes)
        .then((previews) => { console.log(`Rendered ${previews.length} scene preview(s).`); })
        .then(() => effectPreviewCache.all(effects.list()))
        .then((previews) => { console.log(`Rendered ${previews.length} effect preview(s).`); })
        .catch((err) => { console.error('Preview warm-up failed:', err); });
}

initStorage();

function shutdown() {
    store.flush();
    settings.flush();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Anything that escapes still exits and lets systemd restart the service, but
// with the stores written first — their flush is synchronous, so this is
// safe to call on the way out — and with the reason on the first line of
// the journal entry. Without this a crash cost the last 2s of edits (#108).
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception, exiting:', err);
    try { store.flush(); settings.flush(); } catch (e) { /* already exiting */ }
    process.exit(1);
});

app.use('/api', createSystemRouter({
    settings,
    client,
    frameStats,
    isVirtual: !!process.env.VIRTUAL,
}));

app.use('/api', createScenesRouter(store, previewCache, effectPreviewCache));

// Last, so it sees every route's throw and body-parser's rejections alike.
app.use(errorHandler);

const server = app.listen(3000, () => {
    console.log('Lightpanel API server listening on port 3000');
});
server.on('error', (err) => {
    console.error(`Lightpanel API server: ${err.message}`);
    process.exit(1);
});

// Render loop. The tick itself lives in engine/render-loop.js, where it can
// be tested; this file only drives it.
setInterval(createTick({
    store,
    compositor,
    broadcaster,
    frameStats,
}), TICK_MS);
