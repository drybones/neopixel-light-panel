/*
 * System REST API — the panel-wide settings that are not scene state:
 * virtual-mode flag, global brightness, the frame-rate tracker and the power
 * meter/limiter.
 *
 * A factory taking its dependencies, like routes/scenes.js, so the routes can
 * be mounted on a bare express app in tests. app.js used to define these
 * inline, which meant requiring it started a render loop, bound port 3000 and
 * built a real OPC client — so none of them were reachable from a test.
 */

var express = require('express');

function createRouter(deps) {
    var settings = deps.settings;
    var client = deps.client;
    var frameStats = deps.frameStats;
    var isVirtual = !!deps.isVirtual;

    var router = express.Router();

    router.get('/virtual', function(req, res) {
        res.json({ virtual: isVirtual });
    });

    router.get('/brightness/', function(req, res) {
        res.send(settings.brightness.toString()); // Cast to string; a number implies an http status code
    });
    router.put('/brightness/:brightness', function(req, res) {
        // parseFloat returns NaN for junk, and NaN survives both clamps —
        // Math.min(1, Math.max(0, NaN)) is NaN. opc.js multiplies every byte
        // by this, so an unguarded value blacks the panel out with no error
        // and no failed request. SettingsStore.load guards the same hazard on
        // the file path; this is the other way in.
        var value = parseFloat(req.params.brightness);
        if (!isFinite(value)) {
            return res.status(400).json({ error: 'brightness must be a number between 0 and 1' });
        }
        settings.setBrightness(Math.min(1, Math.max(0, value)));
        client.brightness = settings.brightness;
        res.sendStatus(200);
    });

    // Frame-rate tracker. The snapshot carries `virtual` because the numbers
    // mean different things per mode: the loop and the compositor are identical,
    // but virtual-opc does no hardware write, so a dev-machine rate is not
    // comparable to the Pi's and the UI has to label it as such.
    function frameStatsSnapshot() {
        var snap = frameStats.snapshot();
        snap.virtual = isVirtual;
        return snap;
    }
    router.get('/fps', function(req, res) {
        res.json(frameStatsSnapshot());
    });
    router.put('/fps', function(req, res) {
        if (!req.body || typeof req.body.enabled !== 'boolean') {
            return res.status(400).json({ error: 'expected {enabled: boolean}' });
        }
        frameStats.setEnabled(req.body.enabled);
        settings.setFrameStatsEnabled(frameStats.enabled);
        res.json(frameStatsSnapshot());
    });

    /*
     * Power meter and limiter. The estimate lives in the pixel sink alongside
     * global brightness — the one place values are post-brightness, clamped, and
     * about to become the bytes Fadecandy receives — so, like brightness, it is
     * configured on the client rather than plumbed through the compositor.
     *
     * The measurement runs unconditionally; `limit` only decides whether it acts.
     * Reading the headroom is the point of having it at all.
     */
    router.get('/power', function(req, res) {
        res.json(client.power.snapshot());
    });
    router.put('/power', function(req, res) {
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'expected a power config object' });
        }
        // The store normalises field by field against the current config, so a
        // partial PUT (the UI edits one control at a time) is a merge, not a
        // reset to defaults.
        client.power.setConfig(settings.setPower(req.body));
        res.json(client.power.snapshot());
    });

    return router;
}

module.exports = createRouter;
