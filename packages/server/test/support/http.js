/*
 * Minimal HTTP harness for the route suites.
 *
 * Deliberately no supertest: node's built-in fetch against an ephemeral port
 * does the same job here, and the dependency tree is the thing this repo has
 * spent the most triage effort on (see #83). Port 0 lets the OS pick, so the
 * suites never collide with a dev server on 3000 or with each other.
 */

const express = require('express');

// `mount` receives the app, so a suite wires only the routers it is testing —
// nothing here starts a render loop or touches the panel.
function startApp(mount) {
    const app = express();
    // Express's default error handler prints the stack for anything it catches
    // — including body-parser's SyntaxError, which is a *passing* 400 case
    // here. `env: test` is express's own switch for that (application.js
    // logerror), and it changes nothing about the response.
    app.set('env', 'test');
    app.use(express.json());
    mount(app);

    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const port = server.address().port;

            async function request(method, path, options) {
                const opts = options || {};
                const init = { method, headers: Object.assign({}, opts.headers) };
                if (Object.hasOwn(opts, 'body')) {
                    init.headers['Content-Type'] = 'application/json';
                    // `raw` sends the string as-is, for the malformed-JSON case.
                    init.body = opts.raw ? opts.body : JSON.stringify(opts.body);
                }
                const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
                const text = await res.text();
                let json;
                if ((res.headers.get('content-type') || '').includes('application/json')) {
                    try { json = JSON.parse(text); } catch (err) { json = undefined; }
                }
                return { status: res.status, headers: res.headers, text, json };
            }

            resolve({
                // `origin` is 127.0.0.1:<port>, for suites that need to send a
                // same-origin Origin header.
                origin: `http://127.0.0.1:${port}`,
                request,
                get(p, o) { return request('GET', p, o); },
                post(p, o) { return request('POST', p, o); },
                put(p, o) { return request('PUT', p, o); },
                del(p, o) { return request('DELETE', p, o); },
                close() {
                    return new Promise((done) => { server.close(done); });
                },
            });
        });
    });
}

module.exports = { startApp };
