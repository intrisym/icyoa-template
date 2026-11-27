const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { createPinnedProxy, createBrowserDownloader, readBrowserStream, captureImageNavigation } = require('./browser-image-download');

async function tunnel(proxy, authority, ping = false) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host: '127.0.0.1', port: Number(new URL(proxy.server).port) });
        let result = '';
        let sent = false;
        socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Proxy test timed out')); });
        socket.on('error', reject);
        socket.on('connect', () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
        socket.on('data', chunk => {
            result += chunk;
            if (!result.includes('\r\n\r\n')) return;
            if (ping && !sent && result.startsWith('HTTP/1.1 200')) { sent = true; socket.write('ping'); return; }
            if (ping && sent && !result.endsWith('ping')) return;
            socket.destroy(); resolve(result);
        });
    });
}
test('CONNECT transport dials the checked IP directly and rejects private targets and alternate ports', async t => {
    const echo = net.createServer(socket => socket.pipe(socket));
    await new Promise(resolve => echo.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => echo.close(resolve)));
    const dials = [];
    const proxy = await createPinnedProxy({ resolve: async value => {
        assert.equal(value, 'https://public.test:443/');
        return { address: '8.8.8.8' };
    }, connect: options => { dials.push(options); return net.connect({ host: '127.0.0.1', port: echo.address().port }); } });
    t.after(() => proxy.close());
    assert.match(await tunnel(proxy, 'public.test:443', true), /200 Connection Established/);
    assert.deepEqual(dials, [{ host: '8.8.8.8', port: 443 }]);
    assert.match(await tunnel(proxy, 'public.test:444'), /403 Forbidden/);
    const denied = await createPinnedProxy({ resolve: async () => { throw new Error('private IP'); }, connect: () => assert.fail('must not dial') });
    t.after(() => denied.close());
    assert.match(await tunnel(denied, '127.0.0.1:443'), /403 Forbidden/);
});

function fakeBrowser(options = {}) {
    const calls = { launch: 0, browserClose: 0, proxyClose: 0, pageClose: 0, prompts: 0, visits: [] };
    let challengePending = true;
    const downloader = createBrowserDownloader({
        direct: async () => { throw new Error(options.error || 'Cannot download source: HTTP 403.'); },
        resolve: async value => {
            const url = new URL(value);
            if (url.protocol !== 'https:' || url.hostname === 'private.test') throw new Error('Denied');
            return { url, address: '8.8.8.8' };
        },
        prompt: async () => { calls.prompts++; },
        capture: async (_context, _page, value) => {
            calls.visits.push(value);
            if (options.html || challengePending) { challengePending = false; throw new Error('Browser returned HTML instead of an image'); }
            return { bytes: Buffer.from([255, 216, 255, 0]), type: 'image/jpeg' };
        },
        proxyFactory: async () => ({ server: 'http://127.0.0.1:9999', close: async () => { calls.proxyClose++; } }),
        launch: async config => {
            calls.launch++;
            assert.equal(config.headless, false);
            assert.equal(config.proxy.bypass, '<-loopback>');
            assert.equal(config.env.IMGCHEST_API_TOKEN, undefined);
            return { close: async () => { calls.browserClose++; }, newContext: async config => {
                assert.equal(config.serviceWorkers, 'block');
                return { route: async (_pattern, handler) => { calls.route = handler; },
                    newPage: async () => ({ goto: async url => calls.visits.push(url),
                        evaluate: async () => ({ base64: Buffer.from(options.html ? '<html>challenge</html>' : [255, 216, 255, 0]).toString('base64') }),
                        close: async () => { calls.pageClose++; } }) };
            } };
        }
    });
    return { calls, downloader };
}
test('fallback navigates to the actual image, reuses its browser session and prompts in that session only when challenged', async () => {
    const { calls, downloader } = fakeBrowser();
    assert.equal((await downloader.download('https://public.test/a.jpg')).type, 'image/jpeg');
    await downloader.download('https://public.test/b.jpg');
    assert.equal(calls.launch, 1);
    assert.equal(calls.prompts, 1);
    assert.deepEqual(calls.visits, ['https://public.test/a.jpg', 'https://public.test/a.jpg', 'https://public.test/b.jpg']);
    assert.equal(calls.pageClose, 2);
    let aborted = false;
    await calls.route({ request: () => ({ url: () => 'https://private.test/' }), abort: async () => { aborted = true; }, continue: () => assert.fail('must not continue') });
    assert.ok(aborted);
    await downloader.close(); await downloader.close();
    assert.equal(calls.browserClose, 1);
    assert.equal(calls.proxyClose, 1);
});
test('fallback does not retry permanent HTTP errors or upload challenge HTML', async () => {
    const permanent = fakeBrowser({ error: 'Cannot download source: HTTP 404.' });
    await assert.rejects(permanent.downloader.download('https://public.test/a.jpg'), /404/);
    assert.equal(permanent.calls.launch, 0);
    const challenge = fakeBrowser({ html: true });
    await assert.rejects(challenge.downloader.download('https://public.test/a.jpg'), /HTML/);
    assert.equal(challenge.calls.pageClose, 1);
    await challenge.downloader.close();
    assert.equal(challenge.calls.browserClose, 1);
});

test('bounded browser stream supports binary chunks and closes on oversized responses and timeouts', async () => {
    let closed = 0;
    let index = 0;
    const chunks = [{ data: 'AAE=', base64Encoded: true, eof: false }, { data: 'x', eof: true }];
    const session = { send: async method => method === 'IO.close' ? closed++ : chunks[index++] };
    assert.deepEqual(await readBrowserStream(session, 'stream'), Buffer.from([0, 1, 120]));
    assert.equal(closed, 1);
    index = 0;
    await assert.rejects(readBrowserStream(session, 'stream', { maxBytes: 1 }), /exceeds/);
    assert.equal(closed, 2);
    const stalled = { send: method => method === 'IO.close' ? Promise.resolve(closed++) : new Promise(() => {}) };
    await assert.rejects(readBrowserStream(stalled, 'stream', { deadline: Date.now() + 5 }), /timed out/);
    assert.equal(closed, 3);
});

test('real Chromium captures cross-origin redirects without CORS and enforces streamed size limits', async t => {
    const http = require('node:http');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    const server = http.createServer((request, response) => {
        if (request.url === '/redirect') {
            response.writeHead(302, { Location: `http://localhost:${server.address().port}/image.png` }); response.end();
        } else if (request.url === '/challenge') {
            response.writeHead(403, { 'Content-Type': 'text/html' }); response.end('<h1>Access check</h1>');
        } else {
            response.writeHead(200, { 'Content-Type': 'image/png', 'Set-Cookie': 'imageAccess=ready; Path=/' }); response.write(png); response.end();
        }
    });
    await new Promise(resolve => server.listen(0, resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await require('playwright').chromium.launch();
    t.after(() => browser.close());
    const context = await browser.newContext();
    // Exercise the same request-stage routing alongside CDP response capture.
    await context.route('**/*', route => route.continue());
    const page = await context.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    const image = await captureImageNavigation(context, page, origin + '/redirect');
    assert.equal(image.type, 'image/png');
    assert.deepEqual(image.bytes, png);
    assert.ok((await context.cookies(`http://localhost:${server.address().port}`)).some(cookie => cookie.name === 'imageAccess'));
    await assert.rejects(captureImageNavigation(context, page, origin + '/image.png', { maxBytes: 10 }), /exceeds/);
    await assert.rejects(captureImageNavigation(context, page, origin + '/challenge'), /HTTP 403/);
    assert.match(await page.locator('body').textContent(), /Access check/);
});
