const http = require('node:http');
const net = require('node:net');
const { publicURL, downloadImage, imageType } = require('./rehost-images');

const MAX_BYTES = 20 * 1024 * 1024;

async function readBrowserStream(session, handle, { maxBytes = MAX_BYTES, deadline = Date.now() + 30000 } = {}) {
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            if (Date.now() >= deadline) throw new Error('Browser image download timed out');
            let timer;
            let chunk;
            try {
                chunk = await Promise.race([
                    session.send('IO.read', { handle, size: 65536 }),
                    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Browser image download timed out')), Math.max(0, deadline - Date.now())); })
                ]);
            } finally { clearTimeout(timer); }
            const bytes = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
            size += bytes.length;
            if (size > maxBytes) throw new Error('Image exceeds 20 MB');
            chunks.push(bytes);
            if (chunk.eof) return Buffer.concat(chunks);
        }
    } finally { await session.send('IO.close', { handle }).catch(() => {}); }
}

// Navigate normally (including cross-origin redirects) rather than asking page
// JavaScript to fetch the URL. Stream the navigation response with a byte cap.
async function captureImageNavigation(context, page, value, { maxBytes = MAX_BYTES } = {}) {
    const session = await context.newCDPSession(page);
    const pending = new Set();
    let result;
    let failure;
    let lastResponse;
    const deadline = Date.now() + 30000;
    const { frameTree } = await session.send('Page.getFrameTree');
    const paused = async event => {
        const requestId = event.requestId;
        if (event.frameId !== frameTree.frame.id || (event.responseStatusCode >= 300 && event.responseStatusCode < 400)) {
            await session.send('Fetch.continueRequest', { requestId }); return;
        }
        const headers = event.responseHeaders || [];
        const header = name => headers.find(item => item.name.toLowerCase() === name)?.value || '';
        lastResponse = { status: event.responseStatusCode, type: header('content-type') };
        if (event.responseStatusCode !== 200 || /text\/html/i.test(lastResponse.type)) {
            // Leave the real access-check page visible for the user to handle.
            await session.send('Fetch.continueRequest', { requestId }); return;
        }
        try {
            if (Number(header('content-length')) > maxBytes) throw new Error('Image exceeds 20 MB');
            const { stream } = await session.send('Fetch.takeResponseBodyAsStream', { requestId });
            const bytes = await readBrowserStream(session, stream, { maxBytes, deadline });
            const type = imageType(bytes);
            await session.send('Fetch.fulfillRequest', { requestId, responseCode: 200,
                responseHeaders: [...headers.filter(item => !['content-type', 'content-length', 'content-encoding', 'transfer-encoding', 'content-disposition'].includes(item.name.toLowerCase())),
                    { name: 'Content-Type', value: type }, { name: 'Content-Length', value: String(bytes.length) }],
                body: bytes.toString('base64') });
            result = { bytes, type };
        } catch (error) {
            failure = error;
            await session.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }).catch(() => {});
        }
    };
    const listener = event => {
        const task = paused(event).catch(error => { failure = error; });
        pending.add(task); task.finally(() => pending.delete(task));
    };
    session.on('Fetch.requestPaused', listener);
    try {
        await session.send('Fetch.enable', { patterns: [{ resourceType: 'Document', requestStage: 'Response' }] });
        let navigationError;
        try { await page.goto(value, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
        catch (error) { navigationError = error; }
        await Promise.all([...pending]);
        if (failure) throw failure;
        if (result) return result;
        if (lastResponse && lastResponse.status !== 200) throw new Error(`Browser download HTTP ${lastResponse.status}`);
        if (lastResponse && /text\/html/i.test(lastResponse.type)) throw new Error('Browser returned HTML instead of an image; an access check may still be active');
        throw navigationError || new Error('Browser navigation did not return an image');
    } finally {
        session.off('Fetch.requestPaused', listener);
        await session.send('Fetch.disable').catch(() => {});
        await session.detach().catch(() => {});
    }
}

// Chromium keeps its own TLS connection, while this CONNECT proxy resolves and
// pins every destination to a checked public IPv4 address. A route check alone
// would leave a DNS-rebinding window when Chromium resolves the name again.
async function createPinnedProxy({ resolve = publicURL, connect = options => net.connect(options) } = {}) {
    const sockets = new Set();
    const track = socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); return socket; };
    const server = http.createServer((_request, response) => { response.writeHead(403); response.end('HTTPS only'); });
    server.on('connection', socket => { track(socket); socket.on('error', () => {}); });
    server.on('connect', async (request, client, head) => {
        try {
            if (!/^[a-zA-Z0-9.-]+:443$/.test(request.url)) throw new Error('HTTPS port 443 required');
            const { address } = await resolve(`https://${request.url}/`);
            if (client.destroyed) return;
            const upstream = track(connect({ host: address, port: 443 }));
            upstream.setTimeout(30000, () => upstream.destroy());
            client.on('close', () => upstream.destroy());
            upstream.on('error', () => client.destroy());
            upstream.on('close', () => client.destroy());
            upstream.once('connect', () => {
                client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                if (head.length) upstream.write(head);
                client.pipe(upstream); upstream.pipe(client);
            });
        } catch { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { server: `http://127.0.0.1:${server.address().port}`,
        close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}

function createBrowserDownloader({ direct = downloadImage, prompt, launch, proxyFactory = createPinnedProxy, resolve = publicURL,
    capture = captureImageNavigation } = {}) {
    let browser;
    let context;
    let proxy;
    async function session() {
        if (context) return context;
        proxy = await proxyFactory();
        try {
            browser = await (launch || require('playwright').chromium.launch.bind(require('playwright').chromium))({
                headless: false, proxy: { server: proxy.server, bypass: '<-loopback>' },
                env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !['IMGCHEST_API_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'IMAGE_REPAIR_GITHUB_TOKEN'].includes(key))),
                args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp']
            });
            context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
            await context.route('**/*', async route => {
                try { await resolve(route.request().url()); await route.continue(); }
                catch { await route.abort(); }
            });
            return context;
        } catch (error) { await close(); throw error; }
    }
    async function browserDownload(value) {
        const { url } = await resolve(value);
        const browserContext = await session();
        const page = await browserContext.newPage();
        try {
            try { return await capture(browserContext, page, url.href); }
            catch (error) {
                if (!/Browser returned HTML|Browser download HTTP (403|503)/.test(error.message)) throw error;
                // Cookies in the user's ordinary browser are not this session's.
                await prompt(`Use the browser window opened by this command to open ${url.href} and complete any access check. When the image is visible, press Enter HERE in the terminal (or Ctrl+C to stop).`);
                return await capture(browserContext, page, url.href);
            }
        } finally { await page.close(); }
    }
    async function download(value) {
        try { return await direct(value); }
        catch (error) {
            if (!/HTTP (403|503)|HTML challenge/.test(error.message)) throw error;
            if (!prompt) throw new Error('Browser fallback requires an interactive terminal.');
            return browserDownload(value);
        }
    }
    async function close() {
        const currentBrowser = browser;
        const currentProxy = proxy;
        browser = context = proxy = null;
        try { await currentBrowser?.close(); }
        finally { await currentProxy?.close(); }
    }
    return { download, close };
}

module.exports = { createPinnedProxy, createBrowserDownloader, readBrowserStream, captureImageNavigation };
