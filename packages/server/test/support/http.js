/*
 * Minimal HTTP harness for the route suites.
 *
 * Deliberately no supertest: node's built-in fetch against an ephemeral port
 * does the same job here, and the dependency tree is the thing this repo has
 * spent the most triage effort on (see #83). Port 0 lets the OS pick, so the
 * suites never collide with a dev server on 3000 or with each other.
 */

var express = require('express');

// `mount` receives the app, so a suite wires only the routers it is testing —
// nothing here starts a render loop or touches the panel.
function startApp(mount) {
    var app = express();
    // Express's default error handler prints the stack for anything it catches
    // — including body-parser's SyntaxError, which is a *passing* 400 case
    // here. `env: test` is express's own switch for that (application.js
    // logerror), and it changes nothing about the response.
    app.set('env', 'test');
    app.use(express.json());
    mount(app);

    return new Promise(function(resolve) {
        var server = app.listen(0, '127.0.0.1', function() {
            var port = server.address().port;

            async function request(method, path, options) {
                var opts = options || {};
                var init = { method: method };
                if (Object.prototype.hasOwnProperty.call(opts, 'body')) {
                    init.headers = { 'Content-Type': 'application/json' };
                    // `raw` sends the string as-is, for the malformed-JSON case.
                    init.body = opts.raw ? opts.body : JSON.stringify(opts.body);
                }
                var res = await fetch('http://127.0.0.1:' + port + path, init);
                var text = await res.text();
                var json;
                if ((res.headers.get('content-type') || '').includes('application/json')) {
                    try { json = JSON.parse(text); } catch (err) { json = undefined; }
                }
                return { status: res.status, text: text, json: json };
            }

            resolve({
                get: function(p) { return request('GET', p); },
                post: function(p, o) { return request('POST', p, o); },
                put: function(p, o) { return request('PUT', p, o); },
                del: function(p, o) { return request('DELETE', p, o); },
                close: function() {
                    return new Promise(function(done) { server.close(done); });
                },
            });
        });
    });
}

module.exports = { startApp };
