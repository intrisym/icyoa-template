// Shared local image-export helpers. Authenticated CI rehosting has been removed.
const dns = require('node:dns/promises');
const net = require('node:net');
const https = require('node:https');
const { imageSlots } = require('../imageMaintenance');
const { productionURL } = require('../imageVerification');

const ENVIRONMENT = 'image-rehosting';
const OWNER = 'intrisym';
const MAX_BYTES = 20 * 1024 * 1024;
const REQUEST_INTERVAL_MS = 61000;
const MAX_REQUESTS = 60;
const BATCH_SIZE = 20;

function rateLimitError(message) {
    const error = new Error(message);
    error.stopUploads = true;
    return error;
}

function createImgChestRequest({ request = fetch, now = () => performance.now(),
    timeoutSignal = milliseconds => AbortSignal.timeout(milliseconds),
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
    // Initial cooldown plus workflow-wide concurrency also spaces separate runs.
    let nextRequest = now() + REQUEST_INTERVAL_MS;
    let requests = 0;
    let stopped;
    return async (url, options = {}) => {
        if (stopped) throw rateLimitError(stopped);
        if (requests >= MAX_REQUESTS) throw rateLimitError('ImgChest request budget (60 per approved run) exhausted. Start a new approved run after the hourly window resets.');
        while (nextRequest > now()) await sleep(nextRequest - now());
        nextRequest = now() + REQUEST_INTERVAL_MS;
        requests++;
        const response = await request(url, { ...options, signal: timeoutSignal(60000) });
        const remaining = response.headers?.get('x-ratelimit-remaining');
        const retryAfter = response.headers?.get('retry-after');
        if (response.status === 429) {
            stopped = `ImgChest rate limit reached (HTTP 429). No uploads will be retried.${retryAfter ? ` Retry-After: ${retryAfter}.` : ' Wait for the hourly window to reset before approving another run.'}`;
            await response.body?.cancel();
            throw rateLimitError(stopped);
        }
        if (remaining !== null && remaining !== undefined && /^0+$/.test(remaining.trim())) {
            stopped = 'ImgChest reports zero requests remaining. Remaining uploads were stopped; approve a new run after the hourly window resets.';
        }
        return response;
    };
}

function requireApproval(reviews, login = OWNER, attempt = 1) {
    if (Number(attempt) !== 1) throw new Error('Start a new repair run for fresh approval; privileged reruns are disabled.');
    const relevant = reviews.filter(review => review.environments?.some(env => env.name === ENVIRONMENT));
    const latest = relevant.at(-1);
    if (latest?.state !== 'approved' || latest.user?.login?.toLowerCase() !== login.toLowerCase()) {
        throw new Error(`This run needs explicit ${login} approval of ${ENVIRONMENT}; no uploads or repository writes are permitted.`);
    }
}

function replaceImages(documents, replacements) {
    const changes = [];
    for (const document of documents) {
        let changed = false;
        for (const slot of imageSlots(document)) {
            let canonical;
            try { canonical = new URL(slot.url).href; } catch {}
            const replacement = replacements.get(slot.url) || replacements.get(canonical);
            if (!replacement) continue;
            slot.node[slot.field] = replacement;
            changes.push({ file: slot.file, id: slot.id, label: slot.label, before: slot.url, after: replacement });
            changed = true;
        }
        document.changed = changed;
    }
    return changes;
}

function imageType(bytes) {
    if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
    if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
    throw new Error('Source is not a supported image file (possibly an HTML challenge).');
}

const blocked = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['224.0.0.0', 3]]) blocked.addSubnet(address, prefix, 'ipv4');
async function publicURL(value, lookup = dns.lookup) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Only public HTTPS sources are eligible.');
    const addresses = await lookup(url.hostname, { all: true });
    const address = addresses.find(entry => entry.family === 4 && !blocked.check(entry.address, 'ipv4'));
    if (!address) throw new Error('Source needs a public IPv4 address.');
    return { url, address: address.address };
}

async function downloadImage(value) {
    for (let redirects = 0; redirects <= 5; redirects++) {
        const { url, address } = await publicURL(value);
        // Pin the approved address; redirects get a fresh public-address check.
        const response = await new Promise((resolve, reject) => {
            const request = https.get(url, { signal: AbortSignal.timeout(30000),
                lookup: (_hostname, options, callback) => options.all
                    ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4)
            }, resolve);
            request.on('error', reject);
        });
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            response.destroy();
            value = new URL(response.headers.location, url).href;
            continue;
        }
        if (response.statusCode !== 200) { response.destroy(); throw new Error(`Cannot download source: HTTP ${response.statusCode}.`); }
        const chunks = [];
        let size = 0;
        for await (const chunk of response) {
            size += chunk.length;
            if (size > MAX_BYTES) throw new Error('Source exceeds ImgChest 20 MB limit.');
            chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        return { bytes, type: imageType(bytes) };
    }
    throw new Error('Too many source redirects.');
}

async function uploadBatch(images, token, request) {
    if (!images.length || images.length > BATCH_SIZE) throw new Error('ImgChest batches must contain 1–20 images.');
    const form = new FormData();
    form.set('title', 'CYOA image repair');
    form.set('privacy', 'hidden');
    for (const [index, { bytes, type }] of images.entries()) {
        form.append('images[]', new Blob([bytes], { type }), `image-${index + 1}.${type.split('/')[1]}`);
    }
    // Do not retry non-idempotent uploads automatically.
    const response = await request('https://api.imgchest.com/v1/post', { method: 'POST', body: form,
        headers: { Authorization: `Bearer ${token}` }, redirect: 'error' });
    if (!response.ok) throw new Error(`ImgChest upload failed: HTTP ${response.status}.`);
    const post = (await response.json()).data;
    if (!Array.isArray(post?.images) || post.images.length !== images.length) throw new Error('ImgChest returned an unexpected image count.');
    const ordered = [...post.images].sort((left, right) => left.position - right.position);
    return images.map((image, index) => {
        const uploaded = ordered[index];
        if (uploaded.position !== index + 1 || !/^https:\/\/cdn\.imgchest\.com\/files\/[a-zA-Z0-9_.-]+$/.test(uploaded.link || '')) throw new Error('ImgChest returned an unexpected image URL or position.');
        return { source: image.source, url: uploaded.link, postId: post.id };
    });
}

function checkoutAssetPath(value) {
    for (const base of ['http://localhost:8000/', productionURL()]) {
        const url = new URL(value, base);
        const directory = new URL(base);
        if (url.origin !== directory.origin || !url.pathname.startsWith(directory.pathname)) continue;
        const relative = decodeURIComponent(url.pathname.slice(directory.pathname.length));
        if (relative && !relative.includes('\\') && !relative.split('/').some(part => part === '.' || part === '..') && !relative.includes('\0')) return relative;
    }
    return null;
}

if (require.main === module) {
    console.error('Automatic CI rehosting was removed. Run npm run images:export locally.');
    process.exitCode = 1;
}

module.exports = { requireApproval, replaceImages, imageType, publicURL, uploadBatch, createImgChestRequest, checkoutAssetPath, downloadImage };
