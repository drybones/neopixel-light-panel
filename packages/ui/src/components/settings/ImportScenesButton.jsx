import React, { useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { readJsonFile } from '../../lib/readJsonFile';
import ArmedButton from './ArmedButton';

/*
 * "Pick a scene file and import it" — button, hidden file input, and the
 * failure message, in one place.
 *
 * It lives under settings/ because that is where import belongs, but the
 * switcher's empty state imports it too: an empty library is exactly when the
 * button is most wanted, and answering "there is nothing here" with a trip to
 * the settings page to find it would be the wrong answer.
 *
 * `mode` goes straight through to the API; `armedLabel` (see ArmedButton) is
 * what makes the replacing import ask twice. Arming is about the *decision*,
 * so it sits on the button rather than anywhere near the file reading — a
 * disarmed replace never opens a picker at all.
 *
 * A failure renders **in the page, under the button** — never `window.alert`,
 * for the reason Editor.jsx gives for never using `window.confirm`: a browser
 * is free to refuse the dialog, and a suppressed alert() returns having shown
 * nothing at all. The one thing a failed import must not do is look like
 * nothing happened, which is exactly what a swallowed dialog would leave.
 * Success is reported by the caller instead — this component cannot know
 * whether it is about to navigate somewhere that says so.
 */
export default function ImportScenesButton({
  mode, label = 'Import', armedLabel, className, onDone,
}) {
  const importLibrary = useStore((s) => s.importLibrary);
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    // Cleared before the await, so picking the *same* file twice still fires
    // a change event the second time.
    event.target.value = '';
    setBusy(true);
    setError(null);
    try {
      const parsed = await readJsonFile(file);
      try {
        await importLibrary(parsed, mode);
      } catch {
        setError('Import failed: the server rejected the file (expected {version: 2, scenes: [...]}).');
        return;
      }
      if (onDone) onDone();
    } catch (err) {
      setError(`Import failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="control-stack">
      <ArmedButton
        label={busy ? 'Importing…' : label}
        armedLabel={armedLabel}
        className={className}
        disabled={busy}
        onConfirm={() => inputRef.current.click()}
      />
      {error && <span className="row-status row-status--error" role="status">{error}</span>}
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
    </span>
  );
}
