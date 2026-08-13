const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { SettingsStore } = require('../engine/settings-store');

function tmpFile(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settingsstore-'));
    return path.join(dir, name || 'settings.json');
}

test('round-trips brightness and the frame-stats toggle through the file', async () => {
    const file = tmpFile();
    const a = new SettingsStore(file);
    a.load();
    a.setBrightness(0.42);
    a.setFrameStatsEnabled(true);
    await a.flush();

    const b = new SettingsStore(file);
    b.load();
    assert.strictEqual(b.brightness, 0.42);
    assert.strictEqual(b.frameStatsEnabled, true);
});

test('missing file yields defaults and writes nothing', () => {
    const file = tmpFile();
    const store = new SettingsStore(file);
    store.load();
    assert.strictEqual(store.brightness, 1);
    assert.strictEqual(store.frameStatsEnabled, false);
    assert.strictEqual(fs.existsSync(file), false);
});

test('both main and backup corrupt still yields usable defaults', () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'not json');
    fs.writeFileSync(file + '.bak', 'also not json');

    const store = new SettingsStore(file);
    store.load();
    assert.strictEqual(store.brightness, 1);
    assert.strictEqual(store.frameStatsEnabled, false);
});

test('bad hand-edited brightness values never yield NaN or out-of-range', () => {
    [
        { brightness: '0.5' },
        { brightness: null },
        { brightness: 2 },
        { brightness: -1 },
    ].forEach((doc) => {
        const file = tmpFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(doc));

        const store = new SettingsStore(file);
        store.load();
        assert.ok(!Number.isNaN(store.brightness), JSON.stringify(doc));
        assert.ok(store.brightness >= 0 && store.brightness <= 1, JSON.stringify(doc));
    });
});

test('brightness: 0 round-trips (not discarded as falsy)', async () => {
    const file = tmpFile();
    const a = new SettingsStore(file);
    a.load();
    a.setBrightness(0);
    await a.flush();

    const b = new SettingsStore(file);
    b.load();
    assert.strictEqual(b.brightness, 0);
});

test('rapid setBrightness calls produce one write', async () => {
    const file = tmpFile();
    const store = new SettingsStore(file);
    store.load();
    for (let i = 0; i < 10; i++) store.setBrightness(i / 10);

    const originalSave = require('../engine/json-store').save;
    let saves = 0;
    require('../engine/json-store').save = function(...args) {
        saves++;
        return originalSave.apply(this, args);
    };
    try {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        assert.strictEqual(saves, 1);
    } finally {
        require('../engine/json-store').save = originalSave;
    }
});

test('flush() on a clean store writes nothing', async () => {
    const file = tmpFile();
    const store = new SettingsStore(file);
    store.load();
    await store.flush();
    assert.strictEqual(fs.existsSync(file), false);
});
