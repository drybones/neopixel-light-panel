import React from 'react';
import LedCanvas from '../preview/LedCanvas';
import { subscribeComposite } from '../../api/lightStream';

// Live composite of the whole scene, at the top of the editor.
//
// Deliberately read-only — position is edited on the XYPad in ParamPanel
// like every other parameter, not by dragging directly on the preview.
export default function PreviewStage() {
  return (
    <div className="preview-stage">
      <LedCanvas
        subscribe={subscribeComposite}
        width={900}
        height={240}
        style={{ width: '100%', height: '100%', borderRadius: 8 }}
      />
    </div>
  );
}
