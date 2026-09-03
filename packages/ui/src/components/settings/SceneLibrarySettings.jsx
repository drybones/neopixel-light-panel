import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { downloadJson } from '../../lib/downloadJson';
import SettingsSection, { SettingsRow } from './SettingsSection';
import ArmedButton from './ArmedButton';
import ImportScenesButton from './ImportScenesButton';

const EXPORT_STATUS_MS = 5000;

/*
 * Everything that acts on the scene library as a whole: export, the two
 * imports, and the two ways to start over.
 *
 * Two sections out of one component, against the usual one-component-per-
 * section rule, because the split here is about *danger*, not about subject:
 * both halves are the same library and the same store actions, and the
 * warning at the top of the second one is the reason it is a second one at
 * all. Sections still own their own state and calls, which is what that rule
 * is actually protecting.
 *
 * Import **merges by scene id** unless told otherwise: a file exported from
 * this panel and re-imported updates the scenes it came from rather than
 * duplicating them, and a file from elsewhere adds to the library. Replace,
 * restore and delete-all can each destroy work, so all three ask twice — see
 * ArmedButton for why that is a two-step button and not window.confirm.
 *
 * **Everything that changes the library navigates back to the switcher on
 * success** (`onDone`, which is App's goHome), and the store leaves a notice
 * there saying what happened. The buttons are here; the thing they change is
 * a screen away, so staying put would confirm nothing — the same reason
 * Editor's delete-scene closes the editor. Export is the exception: it
 * changes nothing, so it reports where it stands.
 */
export default function SceneLibrarySettings({ onDone }) {
  const resetLibrary = useStore((s) => s.resetLibrary);
  const clearLibrary = useStore((s) => s.clearLibrary);
  // Which row last failed, and what it said. Keyed by row rather than shared,
  // so a message always sits under the button that produced it.
  const [error, setError] = useState(null);
  const [exportStatus, setExportStatus] = useState(null);
  const exportTimer = useRef(null);

  useEffect(() => () => clearTimeout(exportTimer.current), []);

  async function handleExport() {
    try {
      const data = await api.exportScenes();
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadJson(data, `lightpanel-scenes-${ts}.json`);
      const n = data.scenes.length;
      setExportStatus({ text: `Downloaded ${n} scene${n === 1 ? '' : 's'}.` });
    } catch {
      setExportStatus({ text: 'Export failed. Check the panel is reachable.', error: true });
    }
    clearTimeout(exportTimer.current);
    exportTimer.current = setTimeout(() => setExportStatus(null), EXPORT_STATUS_MS);
  }

  // Only a *successful* action leaves the page: a rejected reset that
  // navigated anyway would show the switcher unchanged and read as the button
  // having done nothing. A failure therefore has nowhere to go but here — and
  // must go somewhere, since a destructive button that silently does nothing
  // is the exact failure this whole pass exists to remove.
  function run(row, action, failure) {
    return () => {
      setError(null);
      action().then(() => onDone && onDone()).catch(() => setError({ row, text: failure }));
    };
  }

  return (
    <>
      <SettingsSection
        title="Import / export"
        description="The whole scene library as a single JSON file."
      >
        <SettingsRow
          label="Export scenes"
          hint="Downloads every scene, including the ones not currently shown."
          control={(
            <span className="control-stack">
              <button className="btn btn-ghost" onClick={handleExport}>Export</button>
              {exportStatus && (
                <span
                  className={`row-status${exportStatus.error ? ' row-status--error' : ''}`}
                  role="status"
                >
                  {exportStatus.text}
                </span>
              )}
            </span>
          )}
        />
        <SettingsRow
          label="Import scenes"
          hint="Merges by scene id: matching scenes are replaced, new ones are added, nothing is removed."
          control={<ImportScenesButton onDone={onDone} />}
        />
        <SettingsRow
          label="Replace with a file"
          hint="Imports the file instead of the library: every scene not in it is deleted."
          control={(
            <ImportScenesButton
              mode="replace"
              label="Replace…"
              armedLabel="Really replace?"
              onDone={onDone}
            />
          )}
        />
      </SettingsSection>

      <SettingsSection
        title="Reset library"
        description="Export first: neither of these can be undone."
      >
        <SettingsRow
          label="Restore default scenes"
          hint="Replaces the library with the set a new panel starts with. Scenes you have added or edited are lost."
          control={(
            <span className="control-stack">
              <ArmedButton
                label="Restore defaults"
                armedLabel="Really restore?"
                onConfirm={run('reset', resetLibrary, 'Restore failed. Check the panel is reachable.')}
              />
              {error && error.row === 'reset' && (
                <span className="row-status row-status--error" role="status">{error.text}</span>
              )}
            </span>
          )}
        />
        <SettingsRow
          label="Delete all scenes"
          hint="Empties the library completely and switches the panel off."
          control={(
            <span className="control-stack">
              <ArmedButton
                label="Delete all"
                armedLabel="Really delete everything?"
                onConfirm={run('delete', clearLibrary, 'Delete failed. Check the panel is reachable.')}
              />
              {error && error.row === 'delete' && (
                <span className="row-status row-status--error" role="status">{error.text}</span>
              )}
            </span>
          )}
        />
      </SettingsSection>
    </>
  );
}
