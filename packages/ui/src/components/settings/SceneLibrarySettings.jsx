import React from 'react';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { downloadJson } from '../../lib/downloadJson';
import SettingsSection, { SettingsRow } from './SettingsSection';
import ArmedButton from './ArmedButton';
import ImportScenesButton from './ImportScenesButton';

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
 */
export default function SceneLibrarySettings() {
  const resetLibrary = useStore((s) => s.resetLibrary);
  const clearLibrary = useStore((s) => s.clearLibrary);

  function handleExport() {
    api.exportScenes().then((data) => {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadJson(data, `lightpanel-scenes-${ts}.json`);
    });
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
          control={<button className="btn btn-ghost" onClick={handleExport}>Export</button>}
        />
        <SettingsRow
          label="Import scenes"
          hint="Merges by scene id: matching scenes are replaced, new ones are added, nothing is removed."
          control={<ImportScenesButton />}
        />
        <SettingsRow
          label="Replace with a file"
          hint="Imports the file instead of the library: every scene not in it is deleted. The panel keeps playing its current scene if the file still contains it."
          control={(
            <ImportScenesButton
              mode="replace"
              label="Replace…"
              armedLabel="Really replace?"
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
            <ArmedButton
              label="Restore defaults"
              armedLabel="Really restore?"
              onConfirm={() => resetLibrary()}
            />
          )}
        />
        <SettingsRow
          label="Delete all scenes"
          hint="Empties the library completely and switches the panel off."
          control={(
            <ArmedButton
              label="Delete all"
              armedLabel="Really delete everything?"
              onConfirm={() => clearLibrary()}
            />
          )}
        />
      </SettingsSection>
    </>
  );
}
