import React from 'react';
import { useStore } from '../../state/store';
import { sliderToValue, valueToSlider } from '../../lib/perceptual';

export default function BrightnessSlider() {
  const brightness = useStore((s) => s.brightness);
  const setBrightness = useStore((s) => s.setBrightness);

  return (
    <div className="brightness">
      <span className="brightness-label">Brightness</span>
      <input
        type="range"
        min="0"
        max="10"
        step="0.01"
        value={valueToSlider(brightness)}
        onChange={(e) => setBrightness(sliderToValue(Number(e.target.value)))}
        aria-label="Global brightness"
      />
      <span className="brightness-value">{Number(brightness).toFixed(2)}</span>
    </div>
  );
}
