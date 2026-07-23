import React from 'react';
import { useStore } from '../../state/store';

export default function BrightnessSlider() {
  const brightness = useStore((s) => s.brightness);
  const setBrightness = useStore((s) => s.setBrightness);

  return (
    <div className="brightness">
      <span className="brightness-label">Brightness</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={brightness}
        onChange={(e) => setBrightness(Number(e.target.value))}
        aria-label="Brightness"
      />
      <span className="brightness-value">{Number(brightness).toFixed(2)}</span>
    </div>
  );
}
