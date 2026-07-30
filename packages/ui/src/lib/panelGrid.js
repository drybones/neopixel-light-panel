// Where each streamed pixel lands on the 30x8 grid.
//
// Frames arrive in LED strip order, which is not grid order: the physical
// mount runs the strip right-to-left starting at the far row, so frame index i
// is grid cell N-1-i. Reversing a row-major index is exactly a 180 degree
// rotation, so anything that draws a frame without this comes out upside-down.
//
// It lives here because two places draw frames — the panel previews and the
// position pad's backdrop — and when the pad reimplemented the mapping without
// the reversal, its render sat 180 degrees from its own handle.

export const COLS = 30;
export const ROWS = 8;
export const NUM_PIXELS = COLS * ROWS;

export function cellForFrameIndex(i, numPixels = NUM_PIXELS) {
  const di = numPixels - 1 - i;
  return { col: di % COLS, row: Math.floor(di / COLS) };
}
