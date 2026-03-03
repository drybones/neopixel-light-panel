#!/usr/bin/env node

var OPC = process.env.VIRTUAL ? require('./virtual-opc') : require('./opc');
var client = new OPC(process.env.FADECANDY_SERVER || 'localhost', 7890);
var model = OPC.loadModel(__dirname + '/layout.json');

var Shader = require('./shader');
var shader = new Shader(OPC, client, model);

var express = require('express');
var cors = require('cors');
var app = express();
app.use(cors());

var storage = require('node-persist');

const WAVE_CONFIG_KEY = 'wave_config';
const GLOBAL_BRIGHTNESS_CONFIG_KEY = 'global_brightness';

// Fixed modes that can be changed. These don't get put in the storage,
// just appended / returned alongside the dynamic things.
// The ids _must_ be of the form f:method_name because we're going to 
// call it directly on the shader object.
// The fixed ids include ":" to avoid accidental collision with shortid
// generated values.
const offPreset = {id: "f:off", name: "Off", type: "fixed"};
const fixedConfig = [
    offPreset,
    {id: "f:embers", name: "Embers", type: "fixed"},
    {id: "f:particle_trail", name: "Particle Trail", type: "fixed"},
    {id: "f:candy_sparkler", name: "Candy Sparkler", type: "fixed"},
    {id: "f:pastel_spots", name: "Pastel Spots", type: "fixed"},
];

// Current state of all dynamic config. Default to something sane. 
var waveConfig = [
    {
        id: crypto.randomUUID().split('-')[0],
        name: "default",
        type: "wavelet",
        wavelets: [
            {
                id: crypto.randomUUID().split('-')[0],
                color: '#ffffff',
                freq: 0.3,
                lambda: 0.3,
                delta: 0.0,
                x: 0,
                y: 0,
                min: 0.2,
                max: 0.4,
            }      
        ]
    }
];

var global_brightness = 1.0;

var currentPreset = offPreset;

app.use(express.static(__dirname + '/site'));
app.use(express.json());

async function initStorage() {
    try {
        await storage.init({interval: 1000});
        const waveValue = await storage.getItem(WAVE_CONFIG_KEY);
        if (waveValue) {
            waveConfig = waveValue;
        } else {
            await storage.setItem(WAVE_CONFIG_KEY, waveConfig);
        }
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
initStorage();

app.get('/api/brightness/', function(req,res) {
    res.send(global_brightness.toString()); // Cast to string; a number implies an http status code
})
app.put('/api/brightness/:brightness', function(req,res) {
    global_brightness = req.params.brightness;
    client.brightness = global_brightness;
    storage.setItem(GLOBAL_BRIGHTNESS_CONFIG_KEY, global_brightness).catch(err => console.error('Failed to save brightness:', err));
    res.sendStatus(200);
})

app.get('/api/all_presets/', function(req,res) {
    res.json(allPresets().map(o => {
        return { id: o.id, name: o.name, type: o.type };
    }));
})

app.get('/api/current_preset_id/', function(req,res) {
    if(currentPreset) {
        res.send(currentPreset.id);
    } else {
        res.send(offPreset.id);
    }
})
app.put('/api/current_preset_id/:id', function (req, res) {
    var preset = allPresets().find(o => o.id === req.params.id);

    if(preset) {
        currentPreset = preset;
    } else {
        console.log("Can't find preset id '" + req.params.id + "' so turning off.");
        currentPreset = offPreset;
    }
    console.log("Current preset set to " + currentPreset.id + " with type " + currentPreset.type);

    res.sendStatus(200);
})

app.get('/api/wave_config/:config_id', function(req, res) {
    res.json(waveConfig.find(o => o.id === req.params.config_id));
})
app.put('/api/wave_config/:config_id', function(req, res) {
    let index = waveConfig.findIndex(o => o.id === req.params.config_id);
    let newConfig = req.body;
    if(index != -1) {
        waveConfig[index] = newConfig;
    }
    else
    {
        waveConfig.push(newConfig);
    }
    storage.setItem(WAVE_CONFIG_KEY, waveConfig).catch(err => console.error('Failed to save wave config:', err));

    currentPreset = newConfig;

    res.sendStatus(200);
})
app.delete('/api/wave_config/:config_id', function(req, res) {
    let index = waveConfig.findIndex(o => o.id === req.params.config_id);
    if(index != -1) {
        waveConfig.splice(index, 1);
    }
    storage.setItem(WAVE_CONFIG_KEY, waveConfig).catch(err => console.error('Failed to save wave config:', err));

    if(currentPreset.id === req.params.config_id) {
        currentPreset = offPreset;
    }
    res.sendStatus(200);
})

app.get('/api/all_wave_config/', function(req, res) {
    res.json(waveConfig);
})
app.put('/api/all_wave_config/', function(req, res) {
    waveConfig = req.body;
    storage.setItem(WAVE_CONFIG_KEY, waveConfig).catch(err => console.error('Failed to save wave config:', err));
    res.sendStatus(200);
})

app.listen(3000, function () {
  console.log('Lightpanel API server listening on port 3000')
})

function allPresets() {
    return fixedConfig.concat(waveConfig);
}

function draw() {
    if(!currentPreset) {
        return; // fast exit for when the panel is turned off
    }

    switch(currentPreset.type) {
        case "fixed":
            shader[currentPreset.id.substring(2)](); // Knock the "f:" off the mode name
            if (currentPreset === offPreset) {
                currentPreset = null;
                console.log("Lights off. Stopping updates.");
            }
            break;

        case "wavelet":
            shader.interactive_wave(currentPreset);
            break;

        default:
            console.log("Unrecognised type '" + currentPreset.type + "'. Switching off.");
            currentPreset = offPreset;
    }
}

setInterval(draw, 10);
