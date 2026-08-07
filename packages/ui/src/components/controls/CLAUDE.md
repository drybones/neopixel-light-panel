# `packages/ui/src/components/controls/` — control rationale

Why these controls are the way they are. The root [CLAUDE.md](../../../../../CLAUDE.md) lists what each control is and keeps the rules that bite from outside this directory; the reasoning lives here.

## Row layout

Every control row ends with a value column (`.control-num` + the row gap = `--value-col`), so the controls that would otherwise fill the row — the pad and the gradient strip — reserve it as `margin-right` and share the sliders' right-hand edge. Range inputs carry `margin: 0` to cancel the UA's 2px, which is what makes that arithmetic exact.

## `DraftField.jsx`

The typed escape hatch beside every drag control, wrapped by `NumField` (NumberControl, RangeControl, XYPad, AngleDial) and used directly with `formatHex`/`parseHex` for the colour hex (ColorControl, GradientStopsEditor). It commits through a **ref, not state**: Escape clears the draft and blurs on the same tick, and a `setState` isn't visible to the blur handler that runs next. It also calls `onCommit` itself — a typed edit has no pointer-up, so nothing else would flush the store's 80ms throttle. `parse` returning `null` abandons the edit, which is how an unreadable hex reverts. Numbers are **not clamped to the schema's min/max**: presets carry values no slider can reach (`lambda` runs 0.001–10000 against a 0.05–2 slider), so typing is the only way to restore one after a stray drag.

## `GradientStopsEditor.jsx`

The two **end** colours (first/last by position, so a stop dragged past an end swaps them) sit under the strip as hex fields anchored left and right; they never follow the pins, so a value stays where you last read it. A pin opens react-colorful under itself, dismissed by clicking away like ColorControl's — `left` is clamped inline against `POPOVER_WIDTH` to keep it inside the strip, and the **pins** sit above the backdrop (`z-index`) so pin-to-pin is one click while the strip stays under it, where a click away dismisses rather than adding a stop. A bare-strip click adds a stop; since a drag ends in a click on the pin it started from, `PIN_RADIUS` is the slop that separates the two (below it the stop doesn't move and the click opens the picker), and it doubles as the "too close to an existing stop" test that keeps an out-of-habit double-click from dropping two.

## `AngleDial.jsx`

Draws the wavefronts, not just a knob. Its arrow points the way the wave **travels**, so the control agrees with the motion — note that is the opposite of where an equivalent *outward* wavelet's source sits. Wavelet's own inward/outward toggle carries the same `Travel` label for that reason: both effects label the direction the wave goes, not where it comes from.
