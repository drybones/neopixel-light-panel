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
var migrate = require('./engine/migrate');
var createScenesRouter = require('./routes/scenes');

var compositor = new Compositor(client, model);

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

var storage = require('node-persist');

// Scenes live in their own crash-safe file (atomic writes + .bak) —
// node-persist remains only for the legacy keys, with forgiveParseErrors so
// one bad file can't sink boot.
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
    frameStats.setEnabled(settings.frameStatsEnabled);

    // Collect legacy/auxiliary state from node-persist first; any failure
    // here must not stop the scene file from loading.
    var legacy = {};
    try {
        // Storage dir pinned next to the server code so behaviour doesn't
        // depend on the working directory (matches the Pi service, which
        // runs with WorkingDirectory=packages/server).
        await storage.init({
            dir: path.join(__dirname, '.node-persist/storage'),
            interval: 1000,
            forgiveParseErrors: true,
        });

        legacy.scenes = await storage.getItem('scenes_v2');
        legacy.activeSceneId = await storage.getItem('active_scene_id');
        legacy.seeded = await storage.getItem('seeded_builtins_v1');
        legacy.migrated = await migrate.migrate(storage);
    } catch (err) {
        console.error('node-persist initialization failed (continuing with scene file only):', err);
    }

    try {
        await store.load(legacy);
        await seedBuiltins();
        console.log('Loaded ' + store.scenes.length + ' scene(s); active: ' + store.activeSceneId);
    } catch (err) {
        console.error('Scene store load failed:', err);
    }

    // Warm the filmstrips in the background so the first load of the switcher
    // doesn't pay the render burst. all() yields between scenes, so the render
    // loop keeps its tick throughout.
    previewCache.all(store.scenes)
        .then(function(previews) { console.log('Rendered ' + previews.length + ' scene preview(s).'); })
        .then(function() { return effectPreviewCache.all(effects.visible()); })
        .then(function(previews) { console.log('Rendered ' + previews.length + ' effect preview(s).'); })
        .catch(function(err) { console.error('Preview warm-up failed:', err); });
}
// Recreate the old fixed presets as ordinary editable scenes, once. The
// flag lives inside the scene document so it can't get out of sync with
// the scene list.
async function seedBuiltins() {
    if (store.seededBuiltins) return;
    // Embers and Candy Sparkler are emitter presets now, not effect types of
    // their own. Seeding the old types here would hand a *fresh* install two
    // hidden-effect layers that no migration will ever reach — the emitter
    // migration marks itself done on a first boot, before this runs — and that
    // the picker cannot recreate.
    var emitter = effects.get('emitter');
    function preset(id) {
        var match = emitter.presets.filter(function(p) { return p.id === id; })[0];
        return Object.assign({}, emitter.defaults, match.params);
    }
    [
        { name: 'Embers', effectType: 'emitter', params: preset('embers') },
        { name: 'Particle Trail', effectType: 'particle_trail' },
        { name: 'Candy Sparkler', effectType: 'emitter', params: preset('sparkler') },
    ].forEach(function(b) {
        store.create({ name: b.name, layers: [{ effectType: b.effectType, params: b.params }] });
    });
    store.seededBuiltins = true;
    store.markDirty();
    await store.flush();
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

app.use('/api', createScenesRouter(store, previewCache, effectPreviewCache));

app.listen(3000, function () {
    console.log('Lightpanel API server listening on port 3000');
});

// Render loop. When no scene is active ("off"), render one black frame,
// push it to WS clients, then idle — same behaviour as the old f:off preset.
var offRendered = false;

function tick() {
    var scene = store.activeScene();
    if (scene) {
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
