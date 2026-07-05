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
var store = new SceneStore(compositor, storage);

const GLOBAL_BRIGHTNESS_CONFIG_KEY = 'global_brightness';
var global_brightness = 1.0;

async function initStorage() {
    try {
        // Pin storage next to the server code so behaviour doesn't depend
        // on the working directory (matches the Pi service, which runs
        // with WorkingDirectory=packages/server).
        await storage.init({ dir: path.join(__dirname, '.node-persist/storage'), interval: 1000 });

        var migrated = await migrate.migrate(storage);
        await store.load(migrated);
        await seedBuiltins();
        console.log('Loaded ' + store.scenes.length + ' scene(s); active: ' + store.activeSceneId);

        const brightnessValue = await storage.getItem(GLOBAL_BRIGHTNESS_CONFIG_KEY);
        if (brightnessValue) {
            global_brightness = parseFloat(brightnessValue);
            client.brightness = global_brightness;
        } else {
            await storage.setItem(GLOBAL_BRIGHTNESS_CONFIG_KEY, global_brightness);
        }
    } catch (err) {
        console.error('Storage initialization failed:', err);
    }
}
// Recreate the old fixed presets as ordinary editable scenes, once.
const SEEDED_BUILTINS_KEY = 'seeded_builtins_v1';
async function seedBuiltins() {
    if (await storage.getItem(SEEDED_BUILTINS_KEY)) return;
    [
        { name: 'Embers', effectType: 'embers' },
        { name: 'Particle Trail', effectType: 'particle_trail' },
        { name: 'Candy Sparkler', effectType: 'candy_sparkler' },
    ].forEach(function(b) {
        store.create({ name: b.name, layers: [{ effectType: b.effectType }] });
    });
    await storage.setItem(SEEDED_BUILTINS_KEY, true);
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
    global_brightness = req.params.brightness;
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
