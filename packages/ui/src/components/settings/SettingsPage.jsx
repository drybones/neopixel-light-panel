import React from 'react';
import PowerSettings from './PowerSettings';
import SceneLibrarySettings from './SceneLibrarySettings';

/*
 * Settings, as one scrolling page of sections rather than tabs or a sidebar.
 *
 * There are three sections and no prospect of dozens; a nav for three items
 * costs a click and a layout and buys nothing. Sections are self-contained, so
 * growing this list is a matter of writing a component and adding it here —
 * see SettingsSection for the row shell they share. SceneLibrarySettings is
 * two of the three: import/export and the destructive resets are the same
 * subject split by danger, and it says why in its own header.
 *
 * Nothing here has a save button, matching the rest of the app: every control
 * writes through on change.
 */
export default function SettingsPage({ onClose }) {
  return (
    <div className="settings">
      <div className="settings-toolbar">
        <button className="btn btn-ghost" onClick={onClose} aria-label="Back to scenes">‹ Scenes</button>
        <h1 className="settings-title">Settings</h1>
      </div>

      <PowerSettings />
      <SceneLibrarySettings />
    </div>
  );
}
