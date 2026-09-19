/*
 * The API's error shape, for everything a route does not answer itself.
 *
 * Routes that reject a request return `{error}` directly; this catches the
 * rest — a store method refusing a write, body-parser's malformed-JSON and
 * too-large errors, and anything that simply throws — so every failure a
 * client sees is the same JSON shape instead of express's default HTML page. Express 5 forwards a synchronous throw and a rejected
 * async handler here alike.
 *
 * Status comes from `err.status`, the http-errors convention body-parser
 * already uses. A 4xx carries its message, which is written for the client; a
 * 5xx is a bug, so the message stays in the journal and the client gets a
 * generic one.
 */

// Four arguments is how express recognises an error handler, so `next` stays
// in the signature even where it is not called.
function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    var status = err.status || err.statusCode;
    if (!(status >= 400 && status < 600)) status = 500;
    if (status >= 500) {
        console.error('API ' + req.method + ' ' + req.originalUrl + ' failed:', err);
        return res.status(status).json({ error: 'Internal server error' });
    }
    res.status(status).json({ error: err.message });
}

module.exports = { errorHandler };
