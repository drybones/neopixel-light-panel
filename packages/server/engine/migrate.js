/*
 * One-time migration from the old preset model to scenes.
 *
 * Old shape (node-persist key "wave_config"):
 *   [{ id, name, type: "wavelet", wavelets: [{id, color, freq, lambda,
 *      delta, x, y, min, max, clip, solo}] }]
 *
 * Each preset becomes a scene with one wavelet layer per wavelet, additive
 * blend at full opacity — which reproduces the old per-pixel sum exactly.
 * The old "wave_config" key is left untouched for rollback.
 */

var WAVE_CONFIG_KEY = 'wave_config';
var CURRENT_PRESET_KEY = 'current_preset_id';

// Fixed preset ids that get mapped to seeded built-in scenes in Stage 2;
// anything unmapped (including f:off and f:pastel_spots) becomes "off".
var FIXED_SCENE_NAMES = {
    'f:embers': 'Embers',
    'f:particle_trail': 'Particle Trail',
    'f:candy_sparkler': 'Candy Sparkler',
};

function waveletToLayer(w) {
    return {
        id: w.id,
        effectType: 'wavelet',
        params: {
            color: w.color,
            freq: w.freq,
            lambda: w.lambda,
            delta: w.delta,
            x: w.x,
            y: w.y,
            min: w.min,
            max: w.max,
        },
        blendMode: 'add',
        opacity: 1,
        enabled: true,
        solo: !!w.solo,
    };
}

function presetToScene(preset) {
    return {
        id: preset.id,
        name: preset.name,
        layers: (preset.wavelets || []).map(waveletToLayer),
    };
}

function convert(waveConfig) {
    return (waveConfig || [])
        .filter(function(p) { return p && p.type === 'wavelet'; })
        .map(presetToScene);
}

async function migrate(storage) {
    var waveConfig = await storage.getItem(WAVE_CONFIG_KEY);
    if (!waveConfig) return null;

    var scenes = convert(waveConfig);
    var activeSceneId = null;
    var oldActive = await storage.getItem(CURRENT_PRESET_KEY);
    if (oldActive && scenes.some(function(s) { return s.id === oldActive; })) {
        activeSceneId = oldActive;
    }
    return { scenes: scenes, activeSceneId: activeSceneId };
}

module.exports = { migrate, convert, presetToScene, waveletToLayer, FIXED_SCENE_NAMES };
