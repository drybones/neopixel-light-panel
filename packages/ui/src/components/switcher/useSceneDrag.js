import { useCallback, useEffect, useRef, useState } from 'react';
import { edgeScrollVelocity, moveItem, nearestSlot, visualIndex } from '../../lib/gridReorder';

// Pointer-events drag-to-reorder for the scene grid.
//
// Not HTML5 drag-and-drop: it has no touch support at all, and the drag image
// of a card containing a live <canvas> is unreliable. Not a dnd library
// either — there is none in this package and one gesture does not justify one.
//
// Three things this has to get right, none of which is the maths (that lives
// in lib/gridReorder):
//
//  1. **A drag must not activate the scene.** The whole card is a click
//     target, so a gesture that ends over its own card would otherwise switch
//     the panel on release. A mouse press becomes a drag past a movement
//     threshold; a touch becomes one only after a hold. Either way the click
//     that follows is swallowed.
//  2. **Touch scrolling.** A finger on a card has to scroll the page — the
//     library is taller than a phone screen — so the cards cannot simply be
//     `touch-action: none`. Instead the hold is what commits to a drag, and
//     from that point a non-passive touchmove listener preventDefaults the
//     scroll. It works because the finger was still while the timer ran, so
//     the browser has not started scrolling yet and can still be stopped.
//  3. **The previews must not churn.** Nothing reorders the DOM until the
//     drop: the cards are moved with transforms over their measured
//     positions, so no FilmstripCanvas is unmounted or re-observed, and no
//     sprite sheet (~15.8ms, ~3.7MB) is rebuilt mid-gesture.
//
// Slot positions are measured once, at the moment the drag starts, in client
// coordinates. Everything after that is a *difference* between two of those
// measurements, so the frame they were taken in cancels out — including the
// page scroll, which auto-scroll changes underneath the gesture.

const MOVE_THRESHOLD = 6;   // px of mouse travel that means "drag", not "click"
const LONG_PRESS_MS = 320;  // hold before a touch becomes a drag
const TOUCH_SLOP = 10;      // px of finger travel during the hold that means "scroll"
const EDGE = 80;            // px from the viewport edge that auto-scrolls
const EDGE_SPEED = 18;      // px per frame, hard against the edge

function measureCentres(grid) {
  return Array.from(grid.querySelectorAll('[data-scene-id]')).map((node) => {
    const r = node.getBoundingClientRect();
    return { node, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

// How many cards fit across, for the keyboard path. Read off the live layout
// rather than the media query, since the grid is auto-fill and the two do not
// have to agree.
function columnCount(grid) {
  const tops = Array.from(grid.children).map((n) => n.getBoundingClientRect().top);
  if (tops.length === 0) return 1;
  return Math.max(1, tops.filter((t) => Math.abs(t - tops[0]) < 1).length);
}

export default function useSceneDrag(sceneIds, gridRef, onCommit) {
  // Re-renders happen only when the *target slot* changes, not per pointer
  // move — the dragged card's own transform is written straight to its node.
  const [drag, setDrag] = useState(null);      // { from, to, centres }
  const [settling, setSettling] = useState(false);
  const ref = useRef({});
  const clickGuard = useRef(false);

  // Read at drop time, so a gesture in flight commits against the current
  // list rather than the one from the render that started it.
  const latest = useRef({ sceneIds, onCommit });
  latest.current = { sceneIds, onCommit };

  const finish = useCallback(() => {
    const s = ref.current;
    if (s.cleanup) s.cleanup();
    ref.current = {};
  }, []);

  useEffect(() => finish, [finish]);

  // The drop, and the cancel, both land here. `commit` is false for
  // pointercancel — the OS took the gesture away, which is not a decision.
  const release = useCallback((commit) => {
    const s = ref.current;
    if (s.dragging) {
      // Cleared in the same batch as the reorder below, so the frame that
      // paints the new DOM order is the first frame without the transforms —
      // there is no in-between state to see.
      if (s.node) s.node.style.transform = '';
      clickGuard.current = true;
      setTimeout(() => { clickGuard.current = false; }, 0);
      setDrag(null);
      // Transitions off for one frame: every card's transform drops to none
      // at the instant its layout position becomes what the transform was
      // showing. Left animating, they would all slide back the way they came.
      setSettling(true);
      requestAnimationFrame(() => setSettling(false));
      if (commit && s.to !== s.from) {
        const { sceneIds: ids, onCommit: commitOrder } = latest.current;
        commitOrder(moveItem(ids, s.from, s.to), ids[s.from], s.to);
      }
    }
    finish();
  }, [finish]);

  const onPointerDown = useCallback((e, sceneId) => {
    if (e.button !== 0 || ref.current.pointerId !== undefined) return;
    // The Edit button is inside the card and has its own job.
    if (e.target.closest('button')) return;
    const grid = gridRef.current;
    if (!grid) return;
    const from = latest.current.sceneIds.indexOf(sceneId);
    if (from === -1) return;

    const node = e.currentTarget;
    const s = {
      pointerId: e.pointerId,
      touch: e.pointerType !== 'mouse',
      from,
      to: from,
      node,
      startX: e.clientX + window.scrollX,
      startY: e.clientY + window.scrollY,
      clientX: e.clientX,
      clientY: e.clientY,
      dragging: false,
      centres: null,
      timer: null,
      raf: null,
    };

    function apply() {
      const dx = s.clientX + window.scrollX - s.startX;
      const dy = s.clientY + window.scrollY - s.startY;
      s.node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      const own = s.centres[s.from];
      const to = nearestSlot(s.centres, own.x + dx, own.y + dy);
      if (to !== s.to) {
        s.to = to;
        setDrag({ from: s.from, to, centres: s.centres });
      }
    }

    function autoScroll() {
      s.raf = requestAnimationFrame(autoScroll);
      const v = edgeScrollVelocity(s.clientY, window.innerHeight, EDGE, EDGE_SPEED);
      if (v === 0) return;
      const before = window.scrollY;
      window.scrollBy(0, v);
      // At the top or bottom of the page nothing moved, so nothing to redo.
      if (window.scrollY !== before) apply();
    }

    function begin() {
      s.timer = null;
      const centres = measureCentres(grid);
      // The library changed under the gesture — another tab, an import. The
      // slots just measured no longer describe the list that would commit, so
      // abandon rather than reorder against a stale picture.
      if (centres.length !== latest.current.sceneIds.length) { release(false); return; }
      s.dragging = true;
      s.centres = centres;
      setDrag({ from: s.from, to: s.to, centres });
      apply();
      s.raf = requestAnimationFrame(autoScroll);
    }

    function onMove(ev) {
      if (ev.pointerId !== s.pointerId) return;
      s.clientX = ev.clientX;
      s.clientY = ev.clientY;
      if (s.dragging) { apply(); return; }
      const dx = ev.clientX + window.scrollX - s.startX;
      const dy = ev.clientY + window.scrollY - s.startY;
      const moved = Math.sqrt(dx * dx + dy * dy);
      if (s.touch) {
        // The finger set off before the hold completed — that is a scroll,
        // and the page is already following it. Get out of its way.
        if (moved > TOUCH_SLOP) release(false);
        return;
      }
      if (moved > MOVE_THRESHOLD) begin();   // which paints the first frame
    }

    function onUp(ev) {
      if (ev.pointerId !== s.pointerId) return;
      release(ev.type === 'pointerup');
    }

    // Escape puts the card back — the one way out of a drag that is neither
    // a drop nor letting go somewhere you didn't mean to.
    function onKey(ev) {
      if (ev.key === 'Escape') release(false);
    }

    // React's touch handlers are passive, so this one is native: it is the
    // only thing stopping the page scrolling out from under a live drag.
    function onTouchMove(ev) {
      if (s.dragging) ev.preventDefault();
    }

    s.cleanup = () => {
      if (s.timer) clearTimeout(s.timer);
      if (s.raf) cancelAnimationFrame(s.raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('keydown', onKey);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('keydown', onKey);
    ref.current = s;

    if (s.touch) s.timer = setTimeout(begin, LONG_PRESS_MS);
  }, [gridRef, release]);

  // A drag has no keyboard equivalent, and the cards are focusable buttons —
  // so Shift+arrow moves the focused scene one slot (or one row). Shift, not
  // Alt or Ctrl: Alt+Left is Back on Windows and Ctrl+arrow switches Spaces
  // on macOS, and both would be taken before this saw them.
  const onKeyDown = useCallback((e, sceneId) => {
    if (!e.shiftKey || !e.key.startsWith('Arrow')) return false;
    const grid = gridRef.current;
    const { sceneIds: ids, onCommit: commitOrder } = latest.current;
    const from = ids.indexOf(sceneId);
    if (!grid || from === -1) return false;
    const step = (e.key === 'ArrowUp' || e.key === 'ArrowDown') ? columnCount(grid) : 1;
    const dir = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1;
    const to = Math.max(0, Math.min(ids.length - 1, from + dir * step));
    e.preventDefault();
    if (to === from) return true;
    commitOrder(moveItem(ids, from, to), sceneId, to);
    return true;
  }, [gridRef]);

  // Where card `i` should sit right now, relative to where it is laid out.
  const offsetFor = useCallback((i) => {
    if (!drag) return null;
    const j = visualIndex(i, drag.from, drag.to);
    if (j === i || i === drag.from) return null;   // the dragged card follows the pointer
    return { x: drag.centres[j].x - drag.centres[i].x, y: drag.centres[j].y - drag.centres[i].y };
  }, [drag]);

  return {
    dragFrom: drag ? drag.from : -1,
    dragTo: drag ? drag.to : -1,
    settling,
    offsetFor,
    onPointerDown,
    onKeyDown,
    // The click that follows a drag would otherwise activate the scene.
    swallowClick: () => clickGuard.current,
  };
}
