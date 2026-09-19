/*
 * One tick of the render loop, as a factory so it can be tested.
 *
 * app.js binds port 3000 and starts the loop on require, so nothing in it can
 * be imported by a test; this is the part of it worth testing, lifted out with
 * its dependencies passed in. app.js keeps only the setInterval.
 *
 * When no scene is active ("off"), the tick renders one black frame, pushes it
 * to WebSocket clients, and then idles until a scene is active again.
 */

// One bad frame drops a frame, not the service. The log is rate-limited
// because a persistent fault would otherwise write ~90 lines a second; the
// scene id is the datum you want, since cost and faults are per scene.
var TICK_ERROR_LOG_MS = 5000;

// A gap this long between two renders of the same thing means it was not
// being rendered in between, not that a frame was slow: the loop renders
// only the active scene and fast-exits when none is. 50 ticks at 10ms.
// Shared, not restated, because two readers act on it — frame-stats stops
// sampling across the gap, and emitter restarts a dead field's ramp — and
// they have to agree on where a discontinuity is.
var RESUME_MS = 500;

function createTick(deps) {
    var store = deps.store;
    var compositor = deps.compositor;
    var broadcaster = deps.broadcaster;
    var frameStats = deps.frameStats;
    var now = deps.now || Date.now;
    var logError = deps.logError || console.error;

    var offRendered = false;
    var statsSceneId = null;
    var lastTickErrorAt = -Infinity;

    function renderTick() {
        var scene = store.activeScene();
        if (scene) {
            // Frame stats are per scene: cost varies by what is being
            // rendered, and a switch is continuous, so without this a heavy
            // scene's late frames would be read as the light one you moved
            // to. Checked here rather than in the route because every path
            // that changes what renders — activation, an import, deleting the
            // active scene — comes through this one comparison. Going "off"
            // deliberately does not clear it: coming back to the same scene
            // resumes the same soak.
            if (scene.id !== statsSceneId) {
                statsSceneId = scene.id;
                frameStats.restart();
            }
            // begin() returns 0 while the tracker is off, which makes every
            // other call here an early return — the instrumentation costs a
            // boolean test on the path that matters.
            var t0 = frameStats.begin();
            compositor.renderFrame(scene, now());
            frameStats.endRender(t0);
            broadcaster.tick(scene);
            frameStats.end(t0);
            offRendered = false;
        } else if (!offRendered) {
            // "Off" is one black frame and then an idle loop. Deliberately not
            // sampled: it is not a stalled render, and counting those ticks
            // would report 0 FPS for a panel that is behaving correctly.
            compositor.renderBlack();
            broadcaster.tick(null, true);
            offRendered = true;
        }
    }

    return function tick() {
        try {
            renderTick();
        } catch (err) {
            var t = now();
            if (t - lastTickErrorAt >= TICK_ERROR_LOG_MS) {
                lastTickErrorAt = t;
                logError('Render tick failed (scene ' + statsSceneId + '):', err);
            }
        }
    };
}

module.exports = { createTick, TICK_ERROR_LOG_MS, RESUME_MS };
