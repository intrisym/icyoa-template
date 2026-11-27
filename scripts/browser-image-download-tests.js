const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { createPinnedProxy, createBrowserDownloader } = require('./browser-image-download');

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
    const downloader = createBrowserDownloader({
        direct: async () => { throw new Error(options.error || 'Cannot download source: HTTP 403.'); },
        resolve: async value => {
            const url = new URL(value);
            if (url.protocol !== 'https:' || url.hostname === 'private.test') throw new Error('Denied');
            return { url, address: '8.8.8.8' };
        },
        prompt: async () => { calls.prompts++; },
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
test('fallback reuses a visible browser and origin session, blocks unsafe routes and closes owned resources', async () => {
    const { calls, downloader } = fakeBrowser();
    assert.equal((await downloader.download('https://public.test/a.jpg')).type, 'image/jpeg');
    await downloader.download('https://public.test/b.jpg');
    assert.equal(calls.launch, 1);
    assert.equal(calls.prompts, 1);
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
    await assert.rejects(challenge.downloader.download('https://public.test/a.jpg'), /HTML challenge/);
    assert.equal(challenge.calls.pageClose, 1);
    await challenge.downloader.close();
    assert.equal(challenge.calls.browserClose, 1);
});
