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

`entry.render` picks what fills the dial, because not every angle is a wave. `cone` draws the arc named by `spreadKey` instead of stripes — an emitter has no wavefronts, and the spread is the thing you are judging; at 360° it fills the disc, which is what omnidirectional should look like. `arrow` draws a bare arrow with a head rather than the usual dot. That variant exists for one reason: the emitter puts **two** dials on one panel — where particles are launched, and which way a force pulls — and rendered identically they read as the same control twice. `bands` fills the disc with the stop list named by `stopsKey`, ramped along the direction, for the linear gradient: its angle is not a wave direction, so the stripes would say the wrong thing, and the ramp's own colours say the right one while showing what the layer is made of. Deliberately **one** ramp, not `repeats` of them — the dial answers which way and out of what, and how many times it tiles is the slider below it. The stops are sorted and clamped before `addColorStop`, which throws on an out-of-order or out-of-range offset and gets both from the editor.

None of the variants closes over the frame stream, unlike `XYPad` — the dial repaints from its own props, so a changing one belongs in the effect's dependency list and nothing needs a ref.

## `XYPad.jsx`

`decor` is read-only chrome for effects whose position means more than a point: the emitter passes its emission box, drawn as a dashed rect around the handle, so the pad shows where particles are actually born. It is edited by its own Width/Height controls. The box is stroked **white, not the layer colour** — it sits on top of that layer's own render, so taking its colour makes it invisible on exactly the layers that have one.

There is deliberately **no resize handle on the box.** `handlePointerDown` calls `apply()` unconditionally — pressing anywhere places the handle, with no hit-testing anywhere in the component — so a second grab target means fingertip-sized slop that breaks tap-to-place near the corner, a second `role="slider"` aria contract, `fitZoom` accounting for the box, and special-casing the drag out of `padToWorld`, whose far-ring compression is a mapping for *positions* and makes nonsense of a size. That is a new gesture model to duplicate two sliders that already exist.

The chrome reads `decorRef`, not props. The frame subscription is created per geometry and its callback holds whatever `draw()` closed over then, so a prop the chrome reads is frozen at mount and the stream repaints over every correct frame — see the root [CLAUDE.md](../../../../../CLAUDE.md).
