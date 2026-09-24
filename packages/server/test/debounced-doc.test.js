const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { DebouncedDoc } = require('../engine/debounced-doc');

// The shared persistence behind SceneStore and SettingsStore. The stores'
// own tests cover what they write; this is only about when.

class Counter extends DebouncedDoc {
    constructor(file) {
        super(file, { debounceMs: 1000, label: 'counter' });
        this.value = 0;
    }
    bump() {
        this.value++;
        this.markDirty();
    }
    toDocument() {
        return { value: this.value };
    }
}

function tmpFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debounceddoc-'));
    return path.join(dir, 'doc.json');
}

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('the interval is a ceiling: a change stream that never pauses still reaches disk', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const file = tmpFile();
    const doc = new Counter(file);

    // One change every 100ms, never a 1s pause. A trailing debounce would
    // re-arm on each and write nothing until the stream stopped.
    for (let i = 0; i < 9; i++) { doc.bump(); t.mock.timers.tick(100); }
    assert.strictEqual(fs.existsSync(file), false, 'nothing written inside the interval');

    doc.bump();
    t.mock.timers.tick(100);
    assert.deepStrictEqual(read(file), { value: 10 }, 'written once the first change is 1s old');

    doc.bump();
    t.mock.timers.tick(999);
    assert.deepStrictEqual(read(file), { value: 10 });
    t.mock.timers.tick(1);
    assert.deepStrictEqual(read(file), { value: 11 }, 'the next change arms a fresh interval');
});

test('flush() writes synchronously, so it works from an exit handler', () => {
    const file = tmpFile();
    const doc = new Counter(file);
    doc.bump();
    // Not awaited: uncaughtException calls it on the way to process.exit.
    doc.flush();
    assert.deepStrictEqual(read(file), { value: 1 });
});

test('a failed write stays dirty and is retried on the next flush', (t) => {
    const file = tmpFile();
    // A path under a regular file: mkdir cannot make that a directory.
    fs.writeFileSync(`${file}.blocker`, '');
    const doc = new Counter(path.join(`${file}.blocker`, 'doc.json'));
    t.mock.method(console, 'error', () => {});
    doc.bump();
    doc.flush();
    assert.strictEqual(doc._dirty, true);

    doc.persistFile = file;
    doc.flush();
    assert.strictEqual(doc._dirty, false);
    assert.deepStrictEqual(read(file), { value: 1 });
});

test('no persist file means nothing is written and nothing throws', () => {
    const doc = new Counter(null);
    doc.bump();
    assert.doesNotThrow(() => doc.flush());
});
