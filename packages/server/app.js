#!/usr/bin/env node

var path = require('path');
var OPC = process.env.VIRTUAL ? require('./virtual-opc') : require('./opc');
var client = new OPC(process.env.FADECANDY_SERVER || 'localhost', 7890);
var model = OPC.loadModel(__dirname + '/layout.json');

var { Compositor } = require('./engine/compositor');
var { SceneStore } = require('./engine/scene-store');
var { SettingsStore } = require('./engine/settings-store');
var { Broadcaster } = require('./engine/broadcast');
var { PreviewCache, EffectPreviewCache } = require('./engine/preview-cache');
var { FrameStats } = require('./engine/frame-stats');
var effects = require('./effects');
var createScenesRouter = require('./routes/scenes');
var createSystemRouter = require('./routes/system');

var compositor = new Compositor(client, model);

// Size the sink up front. setPixel would grow the buffer one pixel at a time
// on the first frame anyway; doing it here also means the power meter knows
// the LED count before anything has rendered, so /api/power answers correctly
// on a panel that is switched off.
client.setPixelCount(model.length);

// Scene-card filmstrips. Rendered off the hot loop into a throwaway
// compositor, so this never touches the panel or the live layer instances.
var previewCache = new PreviewCache(model);
var effectPreviewCache = new EffectPreviewCache(model);

// Previews stream the compositor's pre-brightness composite, so they stay
// legible (pre-fader meter) while only the panel dims.
var broadcaster = new Broadcaster(compositor, model.length);

var express = require('express');
var cors = require('cors');
var app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '../ui/dist')));
app.use(express.json());

// Scenes live in their own crash-safe file (atomic writes + .bak).
var SCENES_FILE = path.join(__dirname, 'data', 'scenes-v2.json');
var store = new SceneStore(compositor, SCENES_FILE);

var SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');
var settings = new SettingsStore(SETTINGS_FILE);

// Render-loop instrumentation. Off by default and costed for the hot loop;
// the toggle persists alongside brightness so a soak survives a restart of
// lightpanel.service.
var TICK_MS = 10;
var frameStats = new FrameStats({ targetMs: TICK_MS });

async function initStorage() {
    settings.load();
    client.brightness = settings.brightness;
    client.power.setConfig(settings.power);
    frameStats.setEnabled(settings.frameStatsEnabled);

    try {
        await store.load();
        console.log('Loaded ' + store.scenes.length + ' scene(s); active: ' + store.activeSceneId);
    } catch (err) {
        console.error('Scene store load failed:', err);
    }

    // Warm the filmstrips in the background so the first load of the switcher
    // doesn't pay the render burst. all() yields between scenes, so the render
    // loop keeps its tick throughout.
    previewCache.all(store.scenes)
        .then(function(previews) { console.log('Rendered ' + previews.length + ' scene preview(s).'); })
        .then(function() { return effectPreviewCache.all(effects.list()); })
        .then(function(previews) { console.log('Rendered ' + previews.length + ' effect preview(s).'); })
        .catch(function(err) { console.error('Preview warm-up failed:', err); });
}

initStorage();

async function shutdown() {
    await store.flush();
    await settings.flush();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.use('/api', createSystemRouter({
    settings: settings,
    client: client,
    frameStats: frameStats,
    isVirtual: !!process.env.VIRTUAL,
}));

app.use('/api', createScenesRouter(store, previewCache, effectPreviewCache));

app.listen(3000, function () {
    console.log('Lightpanel API server listening on port 3000');
});

// Render loop. When no scene is active ("off"), render one black frame,
// push it to WS clients, then idle.
var offRendered = false;
var statsSceneId = null;

function tick() {
    var scene = store.activeScene();
    if (scene) {
        // Frame stats are per scene: cost varies by what is being rendered,
        // and a switch is continuous, so without this a heavy scene's late
        // frames would be read as the light one you moved to. Checked here
        // rather than in the route because every path that changes what
        // renders — activation, an import, deleting the active scene — comes
        // through this one comparison. Going "off" deliberately does not
        // clear it: coming back to the same scene resumes the same soak.
        if (scene.id !== statsSceneId) {
            statsSceneId = scene.id;
            frameStats.restart();
        }
        // begin() returns 0 while the tracker is off, which makes every
        // other call here an early return — the instrumentation costs a
        // boolean test on the path that matters.
        var t0 = frameStats.begin();
        compositor.renderFrame(scene, Date.now());
        frameStats.endRender(t0);
        broadcaster.tick();
        broadcaster.tickLayers(scene);
        frameStats.end(t0);
        offRendered = false;
    } else if (!offRendered) {
        // "Off" is one black frame and then an idle loop. Deliberately not
        // sampled: it is not a stalled render, and counting those ticks
        // would report 0 FPS for a panel that is behaving correctly.
        compositor.renderBlack();
        broadcaster.tick(true);
        offRendered = true;
    }
}

setInterval(tick, TICK_MS);
