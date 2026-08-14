/*
 * Settings store — brightness, the frame-stats toggle and the power config.
 * Same crash-safe file (engine/json-store) and debounced-write shape as
 * SceneStore, at a longer interval: brightness drags reach here at the UI's
 * 80ms throttle, and writing through at that rate would be many fsync+rename
 * pairs a second onto the SD card.
 */

var jsonStore = require('./json-store');
var power = require('./power');

var SAVE_DEBOUNCE_MS = 1000;

class SettingsStore {
    constructor(persistFile) {
        this.persistFile = persistFile || null;
        this.brightness = 1;
        this.frameStatsEnabled = false;
        this.power = power.normaliseConfig(null);
        this._saveTimer = null;
        this._dirty = false;
    }

    // A hand-edited or corrupt file must not put NaN into client.brightness
    // (opc.js multiplies by it and the panel goes black with no error), so
    // each field is validated on its own rather than trusting the document
    // shape. A missing/unreadable file leaves the constructor defaults in
    // place and writes nothing.
    load() {
        var doc = this.persistFile ? jsonStore.load(this.persistFile) : null;
        if (!doc) return;
        if (typeof doc.brightness === 'number' && isFinite(doc.brightness)) {
            this.brightness = Math.min(1, Math.max(0, doc.brightness));
        }
        this.frameStatsEnabled = !!doc.frameStatsEnabled;
        // normaliseConfig validates every field on its own and falls back to
        // the defaults per field, so a half-written or hand-edited power
        // block degrades to the shipped numbers rather than to NaN.
        this.power = power.normaliseConfig(doc.power);
    }

    setBrightness(value) {
        this.brightness = value;
        this.markDirty();
    }

    setFrameStatsEnabled(value) {
        this.frameStatsEnabled = value;
        this.markDirty();
    }

    setPower(config) {
        this.power = power.normaliseConfig(config, this.power);
        this.markDirty();
        return this.power;
    }

    markDirty() {
        this._dirty = true;
        var self = this;
        if (this._saveTimer) return;
        this._saveTimer = setTimeout(function() {
            self._saveTimer = null;
            self.flush();
        }, SAVE_DEBOUNCE_MS);
        if (this._saveTimer.unref) this._saveTimer.unref();
    }

    async flush() {
        if (!this._dirty || !this.persistFile) return;
        this._dirty = false;
        try {
            jsonStore.save(this.persistFile, {
                version: 1,
                brightness: this.brightness,
                frameStatsEnabled: this.frameStatsEnabled,
                power: this.power,
            });
        } catch (err) {
            console.error('Failed to persist settings:', err);
            this._dirty = true;
        }
    }
}

module.exports = { SettingsStore };
