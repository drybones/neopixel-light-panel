// Order maths for dragging a card to a new place in a wrapping grid.
//
// Kept apart from the pointer plumbing (components/switcher/useSceneDrag) so
// the index shuffling — the part that is easy to get subtly wrong, and the
// part that has nothing to do with the DOM — can be tested on its own.
//
// The grid is 2D and its column count changes with the viewport, so none of
// this reasons about rows or columns: a slot is wherever a card actually is,
// measured, and "one slot along" can be a row wrap. The only thing that is
// ordered is the flat index.

// Where the card currently at `i` sits while the card from `from` is held over
// slot `to`. Everything between the two ends shifts one slot along, closing
// the gap the dragged card left and opening one where it will land.
export function visualIndex(i, from, to) {
  if (i === from) return to;
  if (from < to) return (i > from && i <= to) ? i - 1 : i;
  if (from > to) return (i >= to && i < from) ? i + 1 : i;
  return i;
}

// The list as it will be once the drag is committed.
export function moveItem(list, from, to) {
  if (from === to) return list.slice();
  const out = list.slice();
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
}

// How fast to scroll the page while a card is held near the top or bottom of
// the viewport, in px per frame. With 20-odd scenes the library is taller than
// a phone screen, and a drag has taken the finger's scrolling away — so
// without this, a card simply cannot be moved to a row that is off screen.
// Ramps from nothing at `edge` px in to `speed` hard against the edge, and
// stays at `speed` beyond it (a finger can leave the viewport).
export function edgeScrollVelocity(y, height, edge, speed) {
  if (y < edge) return -speed * Math.min(1, (edge - y) / edge);
  if (y > height - edge) return speed * Math.min(1, (y - (height - edge)) / edge);
  return 0;
}

// Which slot a dragged card is over. Measured against the *card's* centre
// rather than the pointer's: a card is much bigger than a fingertip, and
// picking the slot the card looks like it is covering is what makes the gap
// open where the user expects. Nearest centre (rather than containment) means
// there is always an answer, including in the ragged last row and in the gaps
// between cards.
export function nearestSlot(centres, x, y) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < centres.length; i++) {
    const dx = centres[i].x - x;
    const dy = centres[i].y - y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}
