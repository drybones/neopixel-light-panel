// Generates the UI's site icons (packages/ui/public) from a real panel frame,
// painted by the same bloom the live preview uses, so the icon matches the
// preview by construction instead of being drawn to resemble it (#131).
//
//   node scripts/icon/generate.js
//
// Needs Playwright's Chromium, which is deliberately not a dependency: this
// runs once per design change, and the Pi builds with `npm install` on
// aarch64. It is resolved from the working directory or the global
// node_modules; `npm i -g playwright && npx playwright install chromium` is
// enough on a dev machine.
//
// The pipeline: frames.js renders the scene in scene.json through the server
// engine; page.html crops a window of that frame, lays it out as LEDs on a
// square and blooms it with lib/ledPaint in Chromium (canvas `filter`, which
// is why this needs a real browser and not jsdom); the result is written as
// PNGs plus a PNG-in-ICO favicon. The Safari mask icon is monochrome by
// definition, so it gets the same LED grid as plain discs.

const { execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { renderFrames } = require('./frames');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'packages', 'ui', 'public');

// The design: every other LED of a 7x8 window of scene.json, i.e. a 4x4 grid
// at twice the panel's pitch. 4x4 because it is the most LEDs that still
// read as separate points at 32px; the window and frame are the ones where
// ember and teal sit either side of the white crossover.
const DESIGN = {
    scene: 'icon-ember-teal',
    frame: 22,
    crop: { col: 4, row: 0, cols: 4, rows: 4 },
    stride: 2,
    pad: 0.1,
    bg: '#0d0d0f',
};

// Tab sizes get fatter cores and a tighter glow. At the preview's own ratios
// a core is under a pixel at 16px, and the whole icon averages to a smudge.
const SMALL_BLOOM = { sourceRadius: 0.4, coreRadius: 0.34, coreBlur: 0.08, coreGain: 1.1, fieldGain: 0.4, washGain: 0.8 };

const LARGE = { 'apple-touch-icon.png': 180, 'android-chrome-192x192.png': 192, 'android-chrome-512x512.png': 512 };
const SMALL = { 'favicon-16x16.png': 16, 'favicon-32x32.png': 32 };
const ICO_SIZES = [16, 32, 48];

function loadPlaywright() {
    const paths = [process.cwd()];
    try {
        paths.push(execSync('npm root -g', { encoding: 'utf8' }).trim());
    } catch {
        // no npm on PATH; the working directory is all there is
    }
    try {
        return require(require.resolve('playwright', { paths }));
    } catch {
        console.error('Playwright not found. Install it with: npm i -g playwright && npx playwright install chromium');
        process.exit(1);
    }
}

// page.html imports lib/ledPaint as an ES module, which a file:// page cannot
// do, so serve the repo over an ephemeral port for the length of the run.
function serveRepo() {
    const types = { '.js': 'text/javascript', '.html': 'text/html' };
    const server = http.createServer((req, res) => {
        const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
        if (!file.startsWith(ROOT)) {
            res.writeHead(403);
            res.end();
            return;
        }
        fs.readFile(file, (err, body) => {
            if (err) {
                res.writeHead(404);
                res.end();
                return;
            }
            res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
            res.end(body);
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

const decode = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');

// An ICO whose entries are whole PNGs, which every browser that still asks
// for /favicon.ico accepts. Width/height 0 would mean 256.
function ico(pngs) {
    const header = Buffer.alloc(6 + pngs.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(pngs.length, 4);
    let offset = header.length;
    pngs.forEach(({ size, data }, i) => {
        const e = 6 + i * 16;
        header.writeUInt8(size % 256, e);
        header.writeUInt8(size % 256, e + 1);
        header.writeUInt16LE(1, e + 4);
        header.writeUInt16LE(32, e + 6);
        header.writeUInt32LE(data.length, e + 8);
        header.writeUInt32LE(offset, e + 12);
        offset += data.length;
    });
    return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

// Safari's pinned-tab icon is a single-colour mask, so glow cannot survive
// there; the same grid as solid discs, on the same layout as the bitmap.
function maskSvg({ cols, rows }, pad) {
    const S = 16;
    const pitch = (S * (1 - 2 * pad)) / Math.max(cols, rows);
    const x0 = (S - pitch * cols) / 2 + pitch / 2;
    const y0 = (S - pitch * rows) / 2 + pitch / 2;
    const r = (pitch * 0.32).toFixed(3);
    const dots = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            dots.push(`<circle cx="${(x0 + col * pitch).toFixed(3)}" cy="${(y0 + row * pitch).toFixed(3)}" r="${r}"/>`);
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">\n${dots.join('\n')}\n</svg>\n`;
}

async function main() {
    const frame = renderFrames(JSON.parse(fs.readFileSync(path.join(__dirname, 'scene.json'))))[DESIGN.scene][DESIGN.frame];
    const { chromium } = loadPlaywright();
    const server = await serveRepo();
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        page.on('pageerror', (e) => {
            console.error(e);
            process.exitCode = 1;
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/scripts/icon/page.html`);
        await page.waitForFunction(() => globalThis.ready);

        const spec = { frame, crop: DESIGN.crop, stride: DESIGN.stride, pad: DESIGN.pad, bg: DESIGN.bg };
        const large = await page.evaluate((s) => globalThis.renderIcon(s), { ...spec, sizes: Object.values(LARGE) });
        const small = await page.evaluate((s) => globalThis.renderIcon(s),
            { ...spec, bloom: SMALL_BLOOM, sizes: [...new Set([...Object.values(SMALL), ...ICO_SIZES])] });

        const write = (name, data) => {
            fs.writeFileSync(path.join(OUT, name), data);
            console.log(`wrote ${path.relative(ROOT, path.join(OUT, name))}`);
        };
        for (const [name, size] of Object.entries(LARGE)) write(name, decode(large[size]));
        for (const [name, size] of Object.entries(SMALL)) write(name, decode(small[size]));
        write('favicon.ico', ico(ICO_SIZES.map((size) => ({ size, data: decode(small[size]) }))));
        write('safari-pinned-tab.svg', maskSvg(DESIGN.crop, DESIGN.pad));
    } finally {
        await browser.close();
        server.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
