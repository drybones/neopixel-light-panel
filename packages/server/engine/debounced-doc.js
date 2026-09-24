/*
 * The persistence half both stores share: a document written through
 * engine/json-store at most once per interval, and flushed on shutdown.
 *
 * The interval is a ceiling, not a trailing debounce: the first change arms
 * the timer and later ones ride on it, so a drag that never pauses still
 * reaches disk every `debounceMs` rather than only once it stops. That is the
 * point of it on an SD card — a slider at the UI's 80ms throttle would
 * otherwise be many fsync+rename pairs a second.
 *
 * flush() is synchronous — json-store's save is — so it is safe to call on
 * the way out of an uncaughtException handler, where nothing awaited would
 * run. A failed write leaves the document dirty for the next attempt.
 *
 * Subclasses supply toDocument(); everything else here is the same for both.
 */

const jsonStore = require('./json-store');

class DebouncedDoc {
    constructor(persistFile, opts) {
        this.persistFile = persistFile || null;
        this._debounceMs = opts.debounceMs;
        this._label = opts.label;
        this._saveTimer = null;
        this._dirty = false;
    }

    markDirty() {
        this._dirty = true;
        if (this._saveTimer) return;
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            this.flush();
        }, this._debounceMs);
        if (this._saveTimer.unref) this._saveTimer.unref();
    }

    flush() {
        if (!this._dirty || !this.persistFile) return;
        this._dirty = false;
        try {
            jsonStore.save(this.persistFile, this.toDocument());
        } catch (err) {
            console.error(`Failed to persist ${this._label}:`, err);
            this._dirty = true;
        }
    }

    toDocument() {
        throw new Error('DebouncedDoc subclass must implement toDocument()');
    }
}

module.exports = { DebouncedDoc };
