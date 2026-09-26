// Real panel frames for the icon generator, rendered by the server's own
// engine: a scene goes through SceneStore (normalised and prepared exactly as
// on the Pi) and then through the filmstrip renderer over the real
// layout.json. Every effect is a pure function of absolute millis, so a given
// frame index is the same frame on every run.
//
// As a CLI: node scripts/icon/frames.js <scenes.json> prints
//   { "<scene id>": [frame, ...] }, each frame 240 [r,g,b] in strip order.

const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, '..', '..', 'packages', 'server');
const { Compositor } = require(path.join(SERVER, 'engine', 'compositor'));
const { SceneStore } = require(path.join(SERVER, 'engine', 'scene-store'));
const { renderFilmstrip, FRAMES } = require(path.join(SERVER, 'engine', 'filmstrip'));

// doc is an export envelope, {version: 2, scenes: [...]}.
function renderFrames(doc) {
    const model = JSON.parse(fs.readFileSync(path.join(SERVER, 'layout.json')));
    const sink = { setPixel() {}, writePixels() {} };
    const store = new SceneStore(new Compositor(sink, model), null);
    store.setScenes(doc.scenes);

    const n = model.length;
    const out = {};
    for (const scene of store.scenes) {
        const strip = renderFilmstrip(scene, model);
        const frames = [];
        for (let f = 0; f < FRAMES; f++) {
            const px = [];
            for (let i = 0; i < n; i++) {
                const o = (f * n + i) * 3;
                px.push([strip[o], strip[o + 1], strip[o + 2]]);
            }
            frames.push(px);
        }
        out[scene.id] = frames;
    }
    return out;
}

module.exports = { renderFrames };

if (require.main === module) {
    const doc = JSON.parse(fs.readFileSync(process.argv[2]));
    process.stdout.write(JSON.stringify(renderFrames(doc)));
}
