import React from 'react';

// Placeholder — replaced by the full layer-stack editor in the next stage.
export default function Editor({ sceneId, onClose }) {
  return (
    <div className="editor">
      <p className="editor-placeholder">
        Editing scene <code>{sceneId}</code> — the layer editor lands in the next stage.
      </p>
      <button className="btn" onClick={onClose}>Back to scenes</button>
    </div>
  );
}
