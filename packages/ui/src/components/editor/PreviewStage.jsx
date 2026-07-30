import React from 'react';
import LedCanvas from '../preview/LedCanvas';
import { subscribeComposite } from '../../api/lightStream';

// Live composite of the whole scene, at the top of the editor.
//
// Deliberately read-only. It used to carry draggable handles for `xy` schema
// entries, which meant position was the one parameter you could change from
// out here while every other control lived in the layer's panel below —
// inconsistent, and easy to nudge by accident. Position is edited on the
// XYPad in ParamPanel like everything else.
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
