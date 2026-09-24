/*
 * Settings store — brightness, the frame-stats toggle and the power config.
 * Same crash-safe file (engine/json-store) and debounced-write shape as
 * SceneStore, at a longer interval: brightness drags reach here at the UI's
 * 80ms throttle, and writing through at that rate would be many fsync+rename
 * pairs a second onto the SD card.
 */

const jsonStore = require('./json-store');
const { DebouncedDoc } = require('./debounced-doc');
const power = require('./power');

const SAVE_DEBOUNCE_MS = 1000;

class SettingsStore extends DebouncedDoc {
    constructor(persistFile) {
        super(persistFile, { debounceMs: SAVE_DEBOUNCE_MS, label: 'settings' });
        this.brightness = 1;
        this.frameStatsEnabled = false;
        this.power = power.normaliseConfig(null);
    }

    // A hand-edited or corrupt file must not put NaN into client.brightness
    // (opc.js multiplies by it and the panel goes black with no error), so
    // each field is validated on its own rather than trusting the document
    // shape. A missing/unreadable file leaves the constructor defaults in
    // place and writes nothing.
    load() {
        const doc = this.persistFile ? jsonStore.load(this.persistFile) : null;
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

    toDocument() {
        return {
            version: 1,
            brightness: this.brightness,
            frameStatsEnabled: this.frameStatsEnabled,
            power: this.power,
        };
    }
}

module.exports = { SettingsStore };
