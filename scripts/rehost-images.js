// This privileged entry point must always come from the default branch.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dns = require('node:dns/promises');
const net = require('node:net');
const https = require('node:https');
const { imageSlots } = require('../imageMaintenance');
const { runImageChecks } = require('./check-images');
const { testImageUrl } = require('./test-image-url');
const { collectImages } = require('./check-images');
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

function renderRehostingSummary(report) {
    const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\|/g, '&#124;').replace(/`/g, '&#96;').replace(/[\r\n]/g, ' ');
    const lines = ['## ImgChest repair', '', `${report.uploads.length} images uploaded; ${report.changes.length} image references updated; ${report.unresolved.length} unresolved URLs.`, '',
        report.pullRequest ? `Repair PR: ${report.pullRequest}` : '**No repair PR created.**', ''];
    if (report.unresolved.length) {
        lines.push('| CYOA | Option | ID | Problem | Source URL |', '| --- | --- | --- | --- | --- |');
        for (const issue of report.unresolved) {
            const refs = new Map((issue.references || []).map(ref => [`${ref.file}\0${ref.id}`, ref]));
            if (!refs.size) refs.set('', {});
            for (const ref of refs.values()) lines.push(`| ${escape(ref.file)} | ${escape(ref.label)} | ${escape(ref.id)} | ${escape(issue.error)} | ${escape(issue.source)} |`);
        }
        lines.push('', 'Uploaded post IDs and replacement URLs are saved in the **image-rehosting-report** artifact. Uploads were not retried.');
    }
    return lines.join('\n') + '\n';
}

function requireApproval(reviews, login = OWNER, attempt = 1) {
    if (Number(attempt) !== 1) throw new Error('Start a new repair run for fresh approval; privileged reruns are disabled.');
    const relevant = reviews.filter(review => review.environments?.some(env => env.name === ENVIRONMENT));
    const latest = relevant.at(-1);
    if (latest?.state !== 'approved' || latest.user?.login?.toLowerCase() !== login.toLowerCase()) {
        throw new Error(`This run needs explicit ${login} approval of ${ENVIRONMENT}; no uploads or repository writes are permitted.`);
    }
}

function sourceBranch(run, repository) {
    if (run.name !== 'CI' || run.conclusion !== 'failure' || run.head_repository?.full_name !== repository ||
        !['push', 'pull_request'].includes(run.event) || !/^[a-f0-9]{40}$/.test(run.head_sha)) throw new Error('Unsupported source run.');
    const pr = run.pull_requests?.[0];
    const branch = run.event === 'pull_request' ? pr?.head?.ref : run.head_branch;
    if (!branch || branch.startsWith('fix/image-repair-') || (pr && pr.head.sha !== run.head_sha)) throw new Error('Unsafe or recursive repair source.');
    return branch;
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

function githubClient(repository, token) {
    return async (endpoint, method = 'GET', body) => {
        const response = await fetch(`https://api.github.com/repos/${repository}/${endpoint}`, {
            method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000), redirect: 'error'
        });
        if (!response.ok) throw new Error(`GitHub ${method} ${endpoint}: HTTP ${response.status}.`);
        return response.json();
    };
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

async function repair(api, event, token, { scan = runImageChecks, download = downloadImage, upload = uploadBatch,
    request = createImgChestRequest(), verify = testImageUrl,
    reportPath = 'image-rehosting-report.json', summaryPath = process.env.GITHUB_STEP_SUMMARY } = {}) {
    const run = event.workflow_run;
    const repository = process.env.GITHUB_REPOSITORY;
    const branch = sourceBranch(run, repository);
    const jobs = await api(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
    if (!jobs.jobs.some(job => job.name === 'Image loading' && job.conclusion === 'failure')) return;
    const head = () => api(`git/ref/heads/${encodeURIComponent(branch)}`);
    const assertCurrent = async () => { if ((await head()).object.sha !== run.head_sha) throw new Error('Source branch advanced; wait for its newest CI run.'); };
    await assertCurrent();
    const repairBranch = `fix/image-repair-${run.id}`;
    const existing = await api(`pulls?state=all&head=${encodeURIComponent(repository.split('/')[0] + ':' + repairBranch)}`);
    if (existing.length) throw new Error(`Repair already proposed: ${existing[0].html_url}`);
    const pending = await api(`pulls?state=open&base=${encodeURIComponent(branch)}&per_page=100`);
    if (pending.some(pr => pr.head.ref.startsWith('fix/image-repair-'))) throw new Error('An image repair PR is already open for this source branch.');
    const commit = await api(`git/commits/${run.head_sha}`);
    const tree = await api(`git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('Repository tree is truncated.');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-rehosting-'));
    const report = { sourceRun: run.html_url, sourceBranch: branch, uploads: [], unresolved: [], changes: [] };
    const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    try {
        fs.mkdirSync(path.join(root, 'CYOAs'));
        const documents = [];
        for (const entry of tree.tree.filter(entry => /^CYOAs\/[^/]+\.json$/.test(entry.path) || ['image-links.json', 'image-verifications.json'].includes(entry.path))) {
            if (entry.mode !== '100644' || entry.type !== 'blob' || entry.size > 10 * MAX_BYTES) throw new Error('Unexpected source data file.');
            const blob = await api(`git/blobs/${entry.sha}`);
            const text = Buffer.from(blob.content, 'base64').toString('utf8');
            const data = JSON.parse(text);
            fs.writeFileSync(path.join(root, entry.path), text);
            if (entry.path.startsWith('CYOAs/') && entry.path !== 'CYOAs/manifest.json') documents.push({ filename: path.basename(entry.path), data });
        }
        const assets = new Set(documents.flatMap(document => collectImages(document.data, document.filename))
            .map(image => checkoutAssetPath(image.url)).filter(Boolean));
        for (const entry of tree.tree.filter(entry => assets.has(entry.path))) {
            if (entry.type !== 'blob' || entry.mode !== '100644' || entry.size > MAX_BYTES) throw new Error('Unexpected local image asset.');
            const destination = path.resolve(root, entry.path);
            if (!destination.startsWith(root + path.sep)) throw new Error('Local image asset is outside checkout.');
            const blob = await api(`git/blobs/${entry.sha}`);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.writeFileSync(destination, Buffer.from(blob.content, 'base64'));
        }
        // Reproduce with trusted checker code, rather than trusting a CI artifact.
        const initial = await scan({ root, reportPath: path.join(root, 'report.json') });
        if (!initial.failures.length) { save(); return; }
        const replacements = new Map();
        const sources = [...new Set(initial.failures.map(failure => failure.url))];
        const unresolved = (source, error) => {
            report.unresolved.push({ source, error: error.message,
                references: initial.failures.filter(failure => failure.url === source).flatMap(failure => failure.references || []) });
            save();
        };
        let stop;
        for (let offset = 0; offset < sources.length; offset += BATCH_SIZE) {
            const batch = [];
            for (const source of sources.slice(offset, offset + BATCH_SIZE)) {
                if (stop) { unresolved(source, stop); continue; }
                if (checkoutAssetPath(source)) { unresolved(source, new Error('Repair this repository image asset in the source branch; local assets are not uploaded.')); continue; }
                try { batch.push({ source, ...await download(source) }); }
                catch (error) { unresolved(source, error); }
            }
            if (!batch.length) continue;
            let uploaded;
            try { uploaded = await upload(batch, token, request); }
            catch (error) {
                for (const image of batch) unresolved(image.source, error);
                if (error.stopUploads) stop = error;
                continue;
            }
            report.uploads.push(...uploaded);
            save();
            for (const image of uploaded) {
                try {
                    const check = await verify(image.url);
                    if (check.status !== 'working') throw new Error('Replacement did not load and decode in both browser profiles.');
                    replacements.set(image.source, image.url);
                } catch (error) { unresolved(image.source, error); }
            }
        }
        report.changes = replaceImages(documents, replacements);
        save();
        if (!report.changes.length) throw new Error('No verified replacements; see image-rehosting-report artifact.');
        for (const document of documents.filter(document => document.changed)) fs.writeFileSync(path.join(root, 'CYOAs', document.filename), JSON.stringify(document.data, null, 2) + '\n');
        const final = await scan({ root, reportPath: path.join(root, 'final.json') });
        if (final.failures.length) throw new Error('Full image check still fails; no repair PR created. See report for uploads and unresolved URLs.');
        await assertCurrent();
        const entries = [];
        for (const document of documents.filter(document => document.changed)) {
            const blob = await api('git/blobs', 'POST', { content: JSON.stringify(document.data, null, 2) + '\n', encoding: 'utf-8' });
            entries.push({ path: `CYOAs/${document.filename}`, mode: '100644', type: 'blob', sha: blob.sha });
        }
        const nextTree = await api('git/trees', 'POST', { base_tree: commit.tree.sha, tree: entries });
        const next = await api('git/commits', 'POST', { message: 'fix(images): replace failed images with verified ImgChest URLs', tree: nextTree.sha, parents: [run.head_sha] });
        await assertCurrent();
        await api('git/refs', 'POST', { ref: `refs/heads/${repairBranch}`, sha: next.sha });
        const pr = await api('pulls', 'POST', { head: repairBranch, base: branch, title: 'fix(images): rehost failed images on ImgChest',
            body: `Replaces ${report.changes.length} image references after owner approval. Both browser profiles and the full image scan passed before creating this PR.\n\nSource CI: ${run.html_url}\n\nNormal PR checks must also pass before merging. No automatic merge.` });
        report.pullRequest = pr.html_url;
        save();
    } finally {
        save();
        if (summaryPath) fs.appendFileSync(summaryPath, renderRehostingSummary(report));
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function main() {
    const api = githubClient(process.env.GITHUB_REPOSITORY, process.env.GH_TOKEN);
    requireApproval(await api(`actions/runs/${process.env.GITHUB_RUN_ID}/approvals`), OWNER, process.env.GITHUB_RUN_ATTEMPT);
    if (process.argv[2] === 'approval') return;
    if (process.argv[2] !== 'repair' || !process.env.IMGCHEST_API_TOKEN || !process.env.GH_TOKEN) throw new Error('Repair requires environment-scoped ImgChest and GitHub tokens.');
    await repair(api, JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')), process.env.IMGCHEST_API_TOKEN);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { requireApproval, sourceBranch, replaceImages, imageType, publicURL, uploadBatch, createImgChestRequest, renderRehostingSummary, checkoutAssetPath, downloadImage, repair };
