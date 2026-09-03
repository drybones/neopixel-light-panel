import React, { useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { readJsonFile } from '../../lib/readJsonFile';
import ArmedButton from './ArmedButton';

/*
 * "Pick a scene file and import it" — button, hidden file input, and the one
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
 */
export default function ImportScenesButton({
  mode, label = 'Import', armedLabel, className, onDone,
}) {
  const importLibrary = useStore((s) => s.importLibrary);
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    // Cleared before the await, so picking the *same* file twice still fires
    // a change event the second time.
    event.target.value = '';
    setBusy(true);
    try {
      const parsed = await readJsonFile(file);
      try {
        await importLibrary(parsed, mode);
      } catch {
        alert('Import failed: the server rejected the file (expected {version: 2, scenes: [...]}).');
        return;
      }
      if (onDone) onDone();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ArmedButton
        label={busy ? 'Importing…' : label}
        armedLabel={armedLabel}
        className={className}
        disabled={busy}
        onConfirm={() => inputRef.current.click()}
      />
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
    </>
  );
}
