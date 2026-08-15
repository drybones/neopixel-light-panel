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

app.get('/api/virtual', function(req, res) {
    res.json({ virtual: !!process.env.VIRTUAL });
});

app.get('/api/brightness/', function(req, res) {
    res.send(settings.brightness.toString()); // Cast to string; a number implies an http status code
});
app.put('/api/brightness/:brightness', function(req, res) {
    settings.setBrightness(Math.min(1, Math.max(0, parseFloat(req.params.brightness))));
    client.brightness = settings.brightness;
    res.sendStatus(200);
});

// Frame-rate tracker. The snapshot carries `virtual` because the numbers
// mean different things per mode: the loop and the compositor are identical,
// but virtual-opc does no hardware write, so a dev-machine rate is not
// comparable to the Pi's and the UI has to label it as such.
function frameStatsSnapshot() {
    var snap = frameStats.snapshot();
    snap.virtual = !!process.env.VIRTUAL;
    return snap;
}
app.get('/api/fps', function(req, res) {
    res.json(frameStatsSnapshot());
});
app.put('/api/fps', function(req, res) {
    if (!req.body || typeof req.body.enabled !== 'boolean') {
        return res.status(400).json({ error: 'expected {enabled: boolean}' });
    }
    frameStats.setEnabled(req.body.enabled);
    settings.setFrameStatsEnabled(frameStats.enabled);
    res.json(frameStatsSnapshot());
});

/*
 * Power meter and limiter. The estimate lives in the pixel sink alongside
 * global brightness — the one place values are post-brightness, clamped, and
 * about to become the bytes Fadecandy receives — so, like brightness, it is
 * configured on the client rather than plumbed through the compositor.
 *
 * The measurement runs unconditionally; `limit` only decides whether it acts.
 * Reading the headroom is the point of having it at all.
 */
app.get('/api/power', function(req, res) {
    res.json(client.power.snapshot());
});
app.put('/api/power', function(req, res) {
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'expected a power config object' });
    }
    // The store normalises field by field against the current config, so a
    // partial PUT (the UI edits one control at a time) is a merge, not a
    // reset to defaults.
    client.power.setConfig(settings.setPower(req.body));
    res.json(client.power.snapshot());
});

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
