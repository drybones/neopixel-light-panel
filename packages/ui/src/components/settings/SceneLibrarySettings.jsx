import React, { useRef } from 'react';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { downloadJson } from '../../lib/downloadJson';
import SettingsSection, { SettingsRow } from './SettingsSection';

/*
 * Whole-library import and export.
 *
 * Import **merges by scene id**, which is the part worth saying out loud: a
 * file exported from this panel and re-imported updates the scenes it came
 * from rather than duplicating them, and a file from elsewhere adds to the
 * library rather than replacing it. Nothing here can empty the library, so
 * neither button needs arming.
 */
export default function SceneLibrarySettings() {
  const loadAllDetails = useStore((s) => s.loadAllDetails);
  const loadPreviews = useStore((s) => s.loadPreviews);
  const importInputRef = useRef(null);

  function handleExport() {
    api.exportScenes().then((data) => {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadJson(data, `lightpanel-scenes-${ts}.json`);
    });
  }

  function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';
    const reader = new FileReader();
    reader.onload = async (e) => {
      let parsed;
      try {
        parsed = JSON.parse(e.target.result);
      } catch {
        alert('Import failed: file is not valid JSON.');
        return;
      }
      try {
        await api.importScenes(parsed);
      } catch {
        alert('Import failed: server rejected the file (expected {version: 2, scenes: [...]}).');
        return;
      }
      const list = await api.scenes();
      useStore.setState({ scenes: list });
      loadAllDetails();
      loadPreviews();
    };
    reader.readAsText(file);
  }

  return (
    <SettingsSection
      title="Import / export"
      description="The whole scene library as a single JSON file."
    >
      <SettingsRow
        label="Export scenes"
        hint="Downloads every scene, including the ones not currently shown."
        control={<button className="btn btn-ghost" onClick={handleExport}>Export</button>}
      />
      <SettingsRow
        label="Import scenes"
        hint="Merges by scene id: matching scenes are replaced, new ones are added, nothing is removed."
        control={(
          <>
            <button className="btn btn-ghost" onClick={() => importInputRef.current.click()}>
              Import
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
          </>
        )}
      />
    </SettingsSection>
  );
}
