# `packages/server/effects/` — writing an effect

Same rule as [`engine/CLAUDE.md`](../engine/CLAUDE.md): each effect's header comment is canonical for that effect, and this file holds only the contract and the traps every effect shares. Read `emitter.js`'s header before touching particles and `text.js`'s before touching type.

## The contract

A module exports `{type, name, schema, defaults, prepare(params), createInstance(ctx)}`, plus optional `presets` and `warmupMs(prepared)`. Register it in `index.js`. After that the UI is free: ParamPanel walks the schema, and the picker and scene cards render filmstrips.

- **`prepare()` runs on the API write path**, never per frame: hex → rgb, LUTs, anything derived. If it throws, the store falls back to `prepare(defaults)` with a warning. That is a backstop for bad values, not a defence you should design for.
- **`createInstance()` holds animation state and is recreated only when `effectType` changes.** A param edit must never reset particles, so read params fresh in `render(out, millis, p)`, don't capture them at creation.
- **`render` must not allocate.** Allocate pools and scratch arrays in `createInstance`, and use `color.hsvInto`, not `color.hsv`. The one standing exception is `text`, whose per-frame cache key is a short string (see `engine/compositor.js`'s header).
- **Be a pure function of absolute `millis`.** Never integrate a fixed `dt` and never read `Date.now()`, so the filmstrip can jump to any time. `text` resolves its clock tokens against `millis` for this reason. If the effect needs time to settle, declare `warmupMs(prepared)`; undeclared effects get 8s.
- **A new schema entry *type*** (not a new effect) needs a `case` in `engine/params.js`'s `coerceValue`, or its values pass through unchecked, and a control plus a `case` in the UI's ParamPanel, or an older UI renders nothing for it. `text` is the one type added so far.
- **`presets` are starting points inside the layer editor**, each replacing the whole param set. They do not get picker tiles or filmstrips: one tile per effect.

## Traps every effect shares

- **The `y` param negates `modelZ`.** `modelZ` +0.875 is the panel's *bottom* row, while the xy pad and angle dials draw +y as up (`dz = pz + y`). Each effect owes that negation exactly once: wavelet and the gradients fold it into their distance term, `emitter` works in param space and negates once when writing `point[2]`. Get it wrong and the whole vertical axis inverts together. **A symmetric effect will not show it**, and two sign errors can cancel into a plausible render whose controls all read backwards. `test/effects.test.js` pins it per axis. Check with an asymmetric preset, never a centred burst.
- **Never test a time with a falsy check.** The filmstrip's time base can be 0, so "has this slot been born?" must be an explicit `alive` flag (as in `emitter`), not `if (!q.born)`.
- **A particle field fills at a rate, from every kind of start.** A fresh instance, a scene switched back to after `RESUME_MS`, and a `Density` increase all start from unborn slots. `emitter` gates *every* birth to `count/life` per second while any slot is unborn, and arms that gate on the *transition* into filling. Its header has the numbers (an ungated fill peaks 1.2–1.33× steady state; a lockstep resume 2.06×). A new particle effect inherits all of this.
- **Use `engine/panel.js` for extents** and derive grid sizes from the model, never a literal 30×8.

## Design rules

- **An enum must not decide what the other controls mean.** If two modes can be joined by a continuous parameter, join them. That is how the emitter absorbed `candy_sparkler` and `embers` (point/panel/edge became `extX`/`extY`). If they can't, split the effect. `gradient_linear` and `gradient_radial` differ by a *control type* (a dial against a pad), and nothing interpolates one into the other. A degenerate *combination of values* is fine: `hold` tiling plus a scroll parks the panel on one colour, and you can watch it happen.
- **Numeric params declare a `scale`**: `linear`, `atan` (brightness ranges only) or `log` for anything spanning decades, plus **`zeroable: true`** wherever an exact `0` is a real setting (`freq: 0` frozen, `glow: 0` no floor). `min`/`max` are slider hints, not validation.
- **`emitter` has no backglow of its own.** Put a `solid` layer underneath it on **`add`** blend. `normal` at opacity 1 replaces what is beneath it, dark pixels included.
