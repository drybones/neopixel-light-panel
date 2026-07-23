#!/usr/bin/env node

var path = require('path');
var OPC = process.env.VIRTUAL ? require('./virtual-opc') : require('./opc');
var client = new OPC(process.env.FADECANDY_SERVER || 'localhost', 7890);
var model = OPC.loadModel(__dirname + '/layout.json');

var { Compositor } = require('./engine/compositor');
var { SceneStore } = require('./engine/scene-store');
var { Broadcaster } = require('./engine/broadcast');
var migrate = require('./engine/migrate');
var createScenesRouter = require('./routes/scenes');

var compositor = new Compositor(client, model);

// The hardware OPC buffer carries a 4-byte protocol header; virtual doesn't.
var broadcaster = new Broadcaster(client, model.length, {
    headerOffset: process.env.VIRTUAL ? 0 : 4,
});

var express = require('express');
var cors = require('cors');
var app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '../ui/dist')));
app.use(express.json());

var storage = require('node-persist');

// Scenes live in their own crash-safe file (atomic writes + .bak) — a
// power cut once corrupted a node-persist file, which made init() reject
// and every scene "vanish". node-persist remains for brightness and the
// legacy keys, with forgiveParseErrors so one bad file can't sink boot.
var SCENES_FILE = path.join(__dirname, '.node-persist', 'scenes-v2.json');
var store = new SceneStore(compositor, SCENES_FILE);

const GLOBAL_BRIGHTNESS_CONFIG_KEY = 'global_brightness';
var global_brightness = 1.0;

async function initStorage() {
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

        const brightnessValue = await storage.getItem(GLOBAL_BRIGHTNESS_CONFIG_KEY);
        if (brightnessValue) {
            global_brightness = parseFloat(brightnessValue);
            client.brightness = global_brightness;
        }
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
}
// Recreate the old fixed presets as ordinary editable scenes, once. The
// flag lives inside the scene document so it can't get out of sync with
// the scene list.
async function seedBuiltins() {
    if (store.seededBuiltins) return;
    [
        { name: 'Embers', effectType: 'embers' },
        { name: 'Particle Trail', effectType: 'particle_trail' },
        { name: 'Candy Sparkler', effectType: 'candy_sparkler' },
    ].forEach(function(b) {
        store.create({ name: b.name, layers: [{ effectType: b.effectType }] });
    });
    store.seededBuiltins = true;
    store.markDirty();
    await store.flush();
}

initStorage();

async function shutdown() {
    await store.flush();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.get('/api/virtual', function(req, res) {
    res.json({ virtual: !!process.env.VIRTUAL });
});

app.get('/api/brightness/', function(req, res) {
    res.send(global_brightness.toString()); // Cast to string; a number implies an http status code
});
app.put('/api/brightness/:brightness', function(req, res) {
    global_brightness = Math.min(1, Math.max(0, parseFloat(req.params.brightness)));
    client.brightness = global_brightness;
    storage.setItem(GLOBAL_BRIGHTNESS_CONFIG_KEY, global_brightness).catch(err => console.error('Failed to save brightness:', err));
    res.sendStatus(200);
});

app.use('/api', createScenesRouter(store));

app.listen(3000, function () {
    console.log('Lightpanel API server listening on port 3000');
});

// Render loop. When no scene is active ("off"), render one black frame,
// push it to WS clients, then idle — same behaviour as the old f:off preset.
var offRendered = false;

function tick() {
    var scene = store.activeScene();
    if (scene) {
        compositor.renderFrame(scene, Date.now());
        broadcaster.tick();
        broadcaster.tickLayers(scene, compositor);
        offRendered = false;
    } else if (!offRendered) {
        compositor.renderBlack();
        broadcaster.tick(true);
        offRendered = true;
    }
}

setInterval(tick, 10);
