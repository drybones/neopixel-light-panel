// One animation clock for the whole scene grid.
//
// Every card plays the same fixed-length loop, so 23 cards do not need 23
// requestAnimationFrame loops — one driver advances the frame index off the
// wall clock and calls the cards only on the ticks where it actually changed
// (~10 of the ~60 rAF callbacks a second). Deriving the index from the clock
// rather than counting ticks also keeps every card in phase, and lets a card
// that scrolls into view join mid-loop instead of restarting.
//
// The loop stops itself when no card is registered, and rAF is already dormant
// in a hidden tab, so an unwatched switcher costs nothing.

let frames = 20;
let intervalMs = 100;

const painters = new Set(); // cb(frameIndex)
const buildQueue = [];      // sprite sheets waiting to be rendered

let rafId = null;
let lastIndex = -1;

export function setTiming(nextFrames, nextIntervalMs) {
  if (nextFrames > 0) frames = nextFrames;
  if (nextIntervalMs > 0) intervalMs = nextIntervalMs;
}

// Where the loop is right now. Takes the frame count so a caller that already
// has it from the payload doesn't depend on setTiming having run first.
export function currentFrame(ofFrames = frames) {
  return Math.floor(Date.now() / intervalMs) % ofFrames;
}

function tick() {
  rafId = null;
  if (painters.size === 0 && buildQueue.length === 0) return;

  // One sheet per frame at most. Six cards scrolling into view at once would
  // otherwise stack their whole bloom render into a single frame, which is a
  // visible stall right when the user is scrolling.
  const build = buildQueue.shift();
  if (build) build();

  const index = currentFrame();
  if (index !== lastIndex) {
    lastIndex = index;
    painters.forEach((cb) => cb(index));
  }
  schedule();
}

function schedule() {
  if (rafId === null) rafId = requestAnimationFrame(tick);
}

// Register a painter. It is called with the current frame index right away, so
// a card appears filled rather than blank until the next index change.
export function subscribeFrames(cb) {
  painters.add(cb);
  cb(currentFrame());
  schedule();
  return () => painters.delete(cb);
}

// Queue work to run on a future frame, one item per frame.
export function queueBuild(fn) {
  buildQueue.push(fn);
  schedule();
  return () => {
    const i = buildQueue.indexOf(fn);
    if (i !== -1) buildQueue.splice(i, 1);
  };
}
