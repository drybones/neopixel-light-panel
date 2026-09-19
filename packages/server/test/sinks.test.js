const test = require('node:test');
const assert = require('node:assert');

const OPC = require('../opc');
const VirtualOPC = require('../virtual-opc');
const { HEADER_BYTES } = require('../engine/pixel-sink');

// Both sinks, driven through the real setPixel. The hardware one is only
// constructed here — nothing calls _reconnect, so no socket is opened. Both
// buffers are OPC-framed, so one reader serves both.
const read = (sink) => [...sink.pixelBuffer.subarray(HEADER_BYTES, HEADER_BYTES + 3)];
const SINKS = [
    {
        name: 'opc',
        make: (brightness) => {
            const sink = new OPC('localhost', 7890, brightness);
            sink.setPixelCount(1);
            return sink;
        },
        read,
    },
    {
        name: 'virtual-opc',
        make: (brightness) => {
            const sink = new VirtualOPC('localhost', 7890, brightness);
            sink.setPixelCount(1);
            return sink;
        },
        read,
    },
];

function write(sink, value) {
    sink.setPixel(0, value, value, value);
}

function byteFor(spec, value, brightness) {
    const sink = spec.make(brightness);
    write(sink, value);
    return spec.read(sink)[0];
}

for (const spec of SINKS) {
    test(`${spec.name}: brightness scales the clamped frame, not the headroom above it`, () => {
        // Issue #92. The composite is unbounded, so a stack of two white
        // layers on `add` leaves 510 and an emitter's particle cores ~765.
        // Multiplying before the clamp let the fader pull those back into
        // range: 510 sat pinned at full white until brightness passed 0.5,
        // then started moving, so the fader changed the scene's contrast
        // rather than its level. Clamped first, every over-range value is
        // the same white and scales with the fader from the start.
        for (const brightness of [1, 0.75, 0.5, 0.25, 0.1]) {
            const white = byteFor(spec, 255, brightness);
            assert.strictEqual(byteFor(spec, 510, brightness), white,
                `two white layers should match one at brightness ${brightness}`);
            assert.strictEqual(byteFor(spec, 765, brightness), white,
                `three white layers should match one at brightness ${brightness}`);
            assert.strictEqual(byteFor(spec, 1104, brightness), white,
                `a particle_trail peak should match one at brightness ${brightness}`);
        }
    });

    test(`${spec.name}: the fader is linear in the value it sends`, () => {
        // What the issue asks for in one line: halving the fader halves the
        // byte, for an in-range value and an over-range one alike.
        assert.strictEqual(byteFor(spec, 255, 1), 255);
        assert.strictEqual(byteFor(spec, 255, 0.5), 127);
        assert.strictEqual(byteFor(spec, 255, 0.25), 63);
        assert.strictEqual(byteFor(spec, 510, 0.5), 127);
        assert.strictEqual(byteFor(spec, 510, 0.25), 63);
        assert.strictEqual(byteFor(spec, 128, 0.5), 64);
        // and a dark region stays dark rather than being lifted
        assert.strictEqual(byteFor(spec, 0, 0.5), 0);
    });

    test(`${spec.name}: a negative composite floors at black at every fader position`, () => {
        // `subtract` can drive the accumulator below zero, which nothing did
        // before that mode existed. The floor belongs on the same side of
        // the multiply as the ceiling, or a negative would come through as a
        // negative byte scaled toward zero.
        for (const brightness of [1, 0.5, 0]) {
            assert.strictEqual(byteFor(spec, -255, brightness), 0);
            assert.strictEqual(byteFor(spec, -1, brightness), 0);
        }
    });

    test(`${spec.name}: the power estimate is summed over the bytes actually sent`, () => {
        // The meter still reads post-brightness, post-clamp bytes — it is
        // the same values the panel receives. What changes with #92 is that
        // dimming an over-range scene now buys headroom immediately instead
        // of only once the fader passed its overflow point.
        //
        // endFrame() rather than writePixels(): closing the frame is all the
        // meter needs, and the hardware sink's writePixels would open a
        // socket to a Fadecandy that isn't there.
        const draw = (brightness) => {
            const sink = spec.make(brightness);
            write(sink, 510);
            sink.power.endFrame();
            return sink.power.snapshot().milliamps;
        };
        const full = draw(1);
        const half = draw(0.5);
        assert.strictEqual(full > half, true, `dimming should lower the estimate (${full} vs ${half})`);
    });
}

test('both sinks produce identical bytes across the range', () => {
    // Dev has to predict the panel: the virtual sink exists to be swapped in
    // for the real one, and the power meter's numbers are only transferable
    // while the two agree byte for byte.
    for (const brightness of [1, 0.66, 0.5, 0.2, 0]) {
        for (const value of [-300, -1, 0, 1, 64, 127, 128, 254, 255, 256, 400, 510, 765, 1104]) {
            assert.strictEqual(
                byteFor(SINKS[0], value, brightness),
                byteFor(SINKS[1], value, brightness),
                `sinks disagree at value ${value}, brightness ${brightness}`);
        }
    }
});

test('both sinks hold the same whole frame, header and limiter pass included', () => {
    // The stronger form of the test above: every byte of the buffer, over a
    // frame the limiter rescales. The virtual sink carries the OPC header
    // precisely so that this comparison needs no offsets.
    //
    // The hardware sink's writePixels would open a socket, so its send is
    // stubbed out; everything before the send is the shared path.
    const frame = (Sink) => {
        const sink = new Sink('localhost', 7890, 0.8);
        sink._send = () => {};
        sink.setPixelCount(240);
        sink.power.setConfig({ maxMilliamps: 4000 });
        for (let i = 0; i < 240; i++) sink.setPixel(i, i * 3, 510 - i, (i * 37) % 300);
        sink.writePixels();
        assert.ok(sink.power.snapshot().limiting, 'the frame should be over budget');
        return sink.pixelBuffer;
    };
    assert.deepStrictEqual(frame(VirtualOPC), frame(OPC));
});

test('both sinks grow their buffer for a pixel past the end', () => {
    // The copies had drifted here: only the hardware one grew.
    for (const Sink of [OPC, VirtualOPC]) {
        const sink = new Sink('localhost', 7890, 1);
        sink.setPixelCount(1);
        sink.setPixel(4, 10, 20, 30);
        const at = HEADER_BYTES + 4 * 3;
        assert.deepStrictEqual([...sink.pixelBuffer.subarray(at, at + 3)], [10, 20, 30], Sink.name);
        assert.strictEqual(sink.pixelBuffer.readUInt16BE(2), 15, `${Sink.name}: OPC length header`);
    }
});
