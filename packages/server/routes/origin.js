/*
 * Which web pages may drive the API (#110).
 *
 * The panel is an unauthenticated appliance on the household LAN, so the
 * threat is not a person on the network but any web page someone in the house
 * happens to visit: a browser will send requests to `blinky.local:3000` on its
 * behalf. Two separate things are needed to stop that, and each is useless
 * without the other.
 *
 * CORS decides which foreign pages may *read* a response, and — because a
 * DELETE, a PUT or a JSON POST needs a preflight — which may send those at
 * all. The production UI is served by this same express app, so it is
 * same-origin and needs none; the only foreign page that legitimately calls
 * the API is the Vite dev server, which is what `allowedOrigins` carries.
 *
 * CORS does not stop a *simple* request, though. A form POST, or a
 * `fetch(..., {mode: 'no-cors'})`, is sent without a preflight; CORS only
 * hides the answer from the page, after the handler has already run.
 * `POST /api/scenes/reset` needs no body, so a hidden auto-submitting form on
 * any page would wipe the library with CORS locked down completely. Hence the
 * guard: a state-changing request whose `Origin` is neither this server nor an
 * allowed page is refused before any route sees it.
 *
 * A request with no `Origin` is let through. Browsers send one on every
 * cross-origin request and on every same-origin one that isn't a GET or HEAD;
 * its absence means curl, a script like tools/power-sweep.js, or an old
 * same-origin browser, none of which is the threat here.
 *
 * Out of scope, and why: DNS rebinding makes an attacker's page same-origin
 * with the panel, which no origin check can see — a Host allowlist would, but
 * the panel is reached as `blinky.local`, by bare IP and through whatever
 * name a router hands out, so a list would break real use. The WebSocket on
 * 3001 is not covered by CORS either; it carries only frames out and two
 * subscribe messages in, so there is nothing there to change.
 */

var cors = require('cors');

var SAFE_METHODS = { GET: true, HEAD: true, OPTIONS: true };

// Same-origin means the Origin names the host the request was sent to. The
// port is part of `host`, so the dev server on 3002 is not same-origin with
// the API on 3000 even on the same machine.
function isSameOrigin(origin, req) {
    try {
        return new URL(origin).host === req.headers.host;
    } catch (err) {
        // `Origin: null` (a sandboxed iframe, a file:// page) and anything
        // malformed land here.
        return false;
    }
}

function createOriginGuard(options) {
    var allowed = (options && options.allowedOrigins) || [];
    var corsMiddleware = allowed.length ? cors({ origin: allowed }) : null;

    return function originGuard(req, res, next) {
        var origin = req.headers.origin;
        if (origin && !SAFE_METHODS[req.method]
            && allowed.indexOf(origin) === -1 && !isSameOrigin(origin, req)) {
            return res.status(403).json({ error: 'Cross-origin request refused' });
        }
        if (corsMiddleware) return corsMiddleware(req, res, next);
        next();
    };
}

module.exports = { createOriginGuard };
