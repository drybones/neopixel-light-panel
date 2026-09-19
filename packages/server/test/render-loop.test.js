const test = require('node:test');
const assert = require('node:assert');

const { createTick, TICK_ERROR_LOG_MS } = require('../engine/render-loop');

// The render loop's tick, with every collaborator faked as a call log. What
// it renders is the compositor's business and tested there; what is pinned
// here is the loop's own state: when "off" renders, when the frame-rate soak
// restarts, and that a throwing frame costs a frame rather than the service.

function harness() {
    var calls = [];
    var state = { scene: null, now: 1000, throwOnRender: false, errors: [] };
    var tick = createTick({
        store: { activeScene: function() { return state.scene; } },
        compositor: {
            renderFrame: function(scene, t) {
                if (state.throwOnRender) throw new Error('bad frame');
                calls.push('render ' + scene.id + ' @' + t);
            },
            renderBlack: function() { calls.push('black'); },
        },
        broadcaster: {
            tick: function(scene, force) {
                calls.push('broadcast ' + (scene ? scene.id : 'off') + (force ? ' forced' : ''));
            },
        },
        frameStats: {
            restart: function() { calls.push('stats restart'); },
            begin: function() { return 0; },
            endRender: function() {},
            end: function() {},
        },
        now: function() { return state.now; },
        logError: function(msg) { state.errors.push(msg); },
    });
    return { tick: tick, calls: calls, state: state };
}

test('an active scene renders and broadcasts its frame every tick', () => {
    // The broadcaster is handed the scene, not just told to send: one frame
    // shape carries the composite to everyone and that scene's layers to
    // whoever asked for them (#121).
    var h = harness();
    h.state.scene = { id: 's1', layers: [] };
    h.tick();
    assert.deepStrictEqual(h.calls, ['stats restart', 'render s1 @1000', 'broadcast s1']);
});

test('off is one black frame, forced out to clients, and then nothing', () => {
    // Forced because an ordinary tick is throttled and skipped with no
    // clients — and the off frame is what a client connecting later replays.
    var h = harness();
    h.tick();
    h.tick();
    h.tick();
    assert.deepStrictEqual(h.calls, ['black', 'broadcast off forced']);
});

test('going off again after a scene renders a fresh black frame', () => {
    var h = harness();
    h.tick();                              // off
    h.state.scene = { id: 's1', layers: [] };
    h.tick();                              // on
    h.state.scene = null;
    h.tick();                              // off again: the latch was reset
    h.tick();
    assert.deepStrictEqual(h.calls.filter((c) => c === 'black'), ['black', 'black']);
});

test('the frame-rate soak restarts on a scene change, not on a return from off', () => {
    // Cost is per scene, so a switch restarts; off-and-back to the same scene
    // resumes the soak that was running.
    var h = harness();
    var s1 = { id: 's1', layers: [] };
    var s2 = { id: 's2', layers: [] };
    h.state.scene = s1; h.tick(); h.tick();
    h.state.scene = null; h.tick();
    h.state.scene = s1; h.tick();
    h.state.scene = s2; h.tick();
    assert.strictEqual(h.calls.filter((c) => c === 'stats restart').length, 2);
});

test('a throwing frame is caught, and the next tick still renders', () => {
    var h = harness();
    h.state.scene = { id: 's1', layers: [] };
    h.state.throwOnRender = true;
    assert.doesNotThrow(() => h.tick());
    h.state.throwOnRender = false;
    h.tick();
    assert.ok(h.calls.includes('render s1 @1000'));
    assert.strictEqual(h.state.errors.length, 1);
    assert.match(h.state.errors[0], /scene s1/);
});

test('a persistent fault logs once per interval, not once per tick', () => {
    var h = harness();
    h.state.scene = { id: 's1', layers: [] };
    h.state.throwOnRender = true;
    for (var i = 0; i < 100; i++) { h.tick(); h.state.now += 10; } // 1s of ticks
    assert.strictEqual(h.state.errors.length, 1);

    h.state.now += TICK_ERROR_LOG_MS;
    h.tick();
    assert.strictEqual(h.state.errors.length, 2);
});
