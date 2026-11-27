const http = require('node:http');
const net = require('node:net');
const { publicURL, downloadImage, imageType } = require('./rehost-images');

const MAX_BYTES = 20 * 1024 * 1024;

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

function createBrowserDownloader({ direct = downloadImage, prompt, launch, proxyFactory = createPinnedProxy, resolve = publicURL } = {}) {
    let browser;
    let context;
    let proxy;
    const warmed = new Set();
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
        const page = await (await session()).newPage();
        try {
            if (!warmed.has(url.origin)) {
                await page.goto(url.origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
                // The human, rather than automation, completes any access challenge.
                await prompt(`A browser opened ${url.origin}. Complete any access check, then press Enter here (or Ctrl+C to stop).`);
            }
            const result = await page.evaluate(async ({ href, maxBytes }) => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 30000);
                try {
                    const response = await fetch(href, { signal: controller.signal });
                    if (!response.ok) throw new Error(`Browser download HTTP ${response.status}`);
                    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Image exceeds 20 MB');
                    const reader = response.body.getReader();
                    const chunks = [];
                    let size = 0;
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        size += value.length;
                        if (size > maxBytes) { await reader.cancel(); throw new Error('Image exceeds 20 MB'); }
                        chunks.push(value);
                    }
                    const bytes = new Uint8Array(size);
                    let offset = 0;
                    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
                    let binary = '';
                    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
                    return { base64: btoa(binary) };
                } catch (error) { return { error: error.message }; }
                finally { controller.abort(); clearTimeout(timer); }
            }, { href: url.href, maxBytes: MAX_BYTES });
            if (result.error) throw new Error(result.error);
            const bytes = Buffer.from(result.base64, 'base64');
            if (bytes.length > MAX_BYTES) throw new Error('Image exceeds 20 MB');
            const type = imageType(bytes);
            warmed.add(url.origin);
            return { bytes, type };
        } catch (error) { warmed.delete(url.origin); throw error; }
        finally { await page.close(); }
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
        browser = context = proxy = null; warmed.clear();
        try { await currentBrowser?.close(); }
        finally { await currentProxy?.close(); }
    }
    return { download, close };
}

module.exports = { createPinnedProxy, createBrowserDownloader };
