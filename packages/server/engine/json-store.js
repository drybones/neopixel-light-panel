/*
 * Tiny crash-safe JSON file store for the scene data.
 *
 * node-persist (2.1) writes files with a bare fs.writeFile, which a power
 * cut can truncate mid-write — and the panel lives on a Raspberry Pi that
 * gets its power yanked. Scenes are the data that matters, so they get
 * their own file with atomic replacement:
 *
 *   write <file>.tmp  →  fsync  →  rename <file> to <file>.bak  →
 *   rename <file>.tmp to <file>
 *
 * rename() is atomic on ext4, so at every instant there is a complete
 * good copy on disk: worst case after a crash is falling back to .bak.
 */

var fs = require('fs');

function readJson(file) {
    var raw;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
        return { missing: true };
    }
    try {
        return { data: JSON.parse(raw) };
    } catch (err) {
        return { corrupt: true };
    }
}

// Returns the parsed object, or null if neither file nor backup is
// readable. Distinguishes "never existed" from "corrupt" via the second
// argument to onWarn so callers can log appropriately.
function load(file, onWarn) {
    var main = readJson(file);
    if (main.data !== undefined) return main.data;
    if (main.corrupt && onWarn) onWarn(file + ' is corrupt; trying backup');

    var backup = readJson(file + '.bak');
    if (backup.data !== undefined) {
        if (onWarn) onWarn('recovered from ' + file + '.bak');
        return backup.data;
    }
    if (backup.corrupt && onWarn) onWarn(file + '.bak is also corrupt');
    return null;
}

function save(file, data) {
    var tmp = file + '.tmp';
    var json = JSON.stringify(data);
    var fd = fs.openSync(tmp, 'w');
    try {
        fs.writeSync(fd, json);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    if (fs.existsSync(file)) {
        fs.renameSync(file, file + '.bak');
    }
    fs.renameSync(tmp, file);
}

module.exports = { load, save };
