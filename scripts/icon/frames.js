// Renders real panel frames for the icon generator, through the server's own
// engine: a scene goes through SceneStore (so it is normalised and prepared
// exactly as on the Pi) and then through the filmstrip renderer over the real
// layout.json. Prints JSON to stdout:
//   { "<name>": [[r,g,b] x 240 in strip order, ...frames], ... }
//
// Usage: node scripts/icon/frames.js <scenes.json>
// where scenes.json is {version: 2, scenes: [...]} (an export envelope, so
// default-scenes.json itself works).

const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, '..', '..', 'packages', 'server');
const { Compositor } = require(path.join(SERVER, 'engine', 'compositor'));
const { SceneStore } = require(path.join(SERVER, 'engine', 'scene-store'));
const { renderFilmstrip, FRAMES } = require(path.join(SERVER, 'engine', 'filmstrip'));

const model = JSON.parse(fs.readFileSync(path.join(SERVER, 'layout.json')));
const doc = JSON.parse(fs.readFileSync(process.argv[2]));

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
process.stdout.write(JSON.stringify(out));
