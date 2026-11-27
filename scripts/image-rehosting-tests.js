const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireApproval, sourceBranch, replaceImages, imageType, publicURL, uploadBatch, createImgChestRequest, checkoutAssetPath, repair } = require('./rehost-images');

const sha = 'a'.repeat(40);
const run = { id: 123, run_attempt: 1, name: 'CI', conclusion: 'failure', head_sha: sha,
    head_repository: { full_name: 'intrisym/icyoa-template' }, head_branch: 'feat/example', event: 'push', html_url: 'https://github.com/example/run/123' };
const approved = [{ state: 'approved', user: { login: 'intrisym' }, environments: [{ name: 'image-rehosting' }] }];
test('requires explicit owner approval for this environment; fails closed for absent protection', () => {
    assert.doesNotThrow(() => requireApproval(approved));
    assert.throws(() => requireApproval(approved, 'intrisym', 2), /fresh approval/);
    for (const reviews of [[], [{ ...approved[0], state: 'rejected' }], [{ ...approved[0], user: { login: 'other' } }],
        [{ ...approved[0], environments: [{ name: 'production' }] }], [...approved, { ...approved[0], state: 'rejected' }]]) {
        assert.throws(() => requireApproval(reviews), /explicit/);
    }
});
test('targets source branch and rejects forks, recursive repairs and mismatched PR commits', () => {
    assert.equal(sourceBranch(run, 'intrisym/icyoa-template'), 'feat/example');
    assert.equal(sourceBranch({ ...run, event: 'pull_request', pull_requests: [{ head: { ref: 'fix/example', sha } }] }, 'intrisym/icyoa-template'), 'fix/example');
    for (const bad of [{ ...run, head_repository: { full_name: 'fork/repo' } }, { ...run, head_branch: 'fix/image-repair-1' },
        { ...run, event: 'pull_request', pull_requests: [{ head: { ref: 'fix/example', sha: 'b'.repeat(40) } }] }]) {
        assert.throws(() => sourceBranch(bad, 'intrisym/icyoa-template'));
    }
});
test('changes only image fields across versions, retaining gameplay and labels', () => {
    const documents = ['v1.json', 'v1_1.json'].map(filename => ({ filename, data: [
        { type: 'headerImage', url: 'https://old/image' },
        { name: 'Weapons', options: [{ id: 'moved-id', image: 'https://old/image', cost: 3, description: 'https://old/image' }] }
    ] }));
    const changes = replaceImages(documents, new Map([['https://old/image', 'https://cdn.imgchest.com/files/new.jpg']]));
    assert.equal(changes.length, 4);
    assert.equal(documents[0].data[1].options[0].cost, 3);
    assert.equal(documents[0].data[1].options[0].description, 'https://old/image');
});
test('replacement keys account for canonical hostnames without changing URL path casing', () => {
    const documents = [{ filename: 'example.json', data: [{ options: [
        { id: 'one', image: 'https://EXAMPLE.com/Art.jpg' }, { id: 'two', image: 'https://example.com/art.jpg' }
    ] }] }];
    const changes = replaceImages(documents, new Map([['https://example.com/Art.jpg', 'https://cdn.imgchest.com/files/new.jpg']]));
    assert.equal(changes.length, 1);
    assert.equal(documents[0].data[0].options[1].image, 'https://example.com/art.jpg');
});
test('checkout assets resolve only inside the configured deployment directories', () => {
    assert.equal(checkoutAssetPath('images/banner.png'), 'images/banner.png');
    assert.equal(checkoutAssetPath('https://intrisym.github.io/icyoa-template/images/banner.png'), 'images/banner.png');
    assert.equal(checkoutAssetPath('https://intrisym.github.io/shared/banner.png'), null);
    assert.equal(checkoutAssetPath('https://external.test/image.png'), null);
    assert.equal(checkoutAssetPath('images/%2e%2e%2f%2e%2e%2fsecret'), null);
});
test('rejects challenge HTML before uploading', () => {
    assert.throws(() => imageType(Buffer.from('<html>challenge</html>')), /not a supported image/);
    assert.equal(imageType(Buffer.from([255, 216, 255, 0])), 'image/jpeg');
});
test('download destinations must be public HTTPS, with a pinnable IPv4 address', async () => {
    const lookup = async () => [{ family: 4, address: '127.0.0.1' }];
    for (const url of ['http://example.com/image', 'https://user:pass@example.com/image', 'https://example.com:8080/image', 'https://example.com/image']) {
        await assert.rejects(publicURL(url, lookup));
    }
    const publicLookup = async () => [{ family: 6, address: '::1' }, { family: 4, address: '8.8.8.8' }];
    assert.equal((await publicURL('https://example.com/image', publicLookup)).address, '8.8.8.8');
});
test('uploads hidden multipart files with bearer auth and validates response host', async () => {
    let calls = 0;
    const request = async (url, options) => {
        calls++;
        assert.equal(url, 'https://api.imgchest.com/v1/post');
        assert.equal(options.headers.Authorization, 'Bearer secret');
        assert.equal(options.body.get('privacy'), 'hidden');
        assert.ok(options.body.get('images[]') instanceof Blob);
        return { ok: true, json: async () => ({ data: { id: 'post', images: [{ position: 1, link: calls === 1 ? 'https://cdn.imgchest.com/files/new.jpg' : 'https://evil.example/new.jpg' }] } }) };
    };
    const images = [{ source: 'https://source/image', bytes: Buffer.from([255, 216, 255]), type: 'image/jpeg' }];
    assert.equal((await uploadBatch(images, 'secret', request))[0].postId, 'post');
    await assert.rejects(uploadBatch(images, 'secret', request), /unexpected/);
});

test('matches batched uploads by position even when response order differs', async () => {
    const images = ['first', 'second'].map(source => ({ source, bytes: Buffer.from([255, 216, 255]), type: 'image/jpeg' }));
    const result = await uploadBatch(images, 'secret', async (_url, options) => {
        assert.equal(options.body.getAll('images[]').length, 2);
        return { ok: true, json: async () => ({ data: { id: 'post', images: [
            { position: 2, link: 'https://cdn.imgchest.com/files/second.jpg' },
            { position: 1, link: 'https://cdn.imgchest.com/files/first.jpg' }
        ] } }) };
    });
    assert.deepEqual(result.map(image => [image.source, image.url]), [
        ['first', 'https://cdn.imgchest.com/files/first.jpg'], ['second', 'https://cdn.imgchest.com/files/second.jpg']
    ]);
    await assert.rejects(uploadBatch(Array(21).fill(images[0]), 'secret', () => assert.fail('must not call API')), /1–20/);
});

function clockedRequest(response) {
    let time = 0;
    const calls = [];
    return { calls, send: createImgChestRequest({ now: () => time, sleep: async milliseconds => { time += milliseconds; },
        request: async () => { calls.push(time); return response; } }) };
}
test('enforces 61-second spacing including initial cooldown, and a 60-request budget', async () => {
    const fake = clockedRequest({ status: 200, headers: new Headers() });
    for (let i = 0; i < 60; i++) await fake.send();
    assert.equal(fake.calls[0], 61000);
    assert.equal(fake.calls[59], 60 * 61000);
    await assert.rejects(fake.send(), error => error.stopUploads && /budget/.test(error.message));
    assert.equal(fake.calls.length, 60);
});
test('upload timeout starts after throttling, preserving the full network timeout for every batch', async () => {
    let time = 0;
    let calls = 0;
    const send = createImgChestRequest({ now: () => time, sleep: async milliseconds => { time += milliseconds; },
        timeoutSignal: duration => ({ createdAt: time, duration }),
        request: async (_url, options) => {
            calls++;
            assert.equal(time, calls * 61000);
            assert.deepEqual(options.signal, { createdAt: time, duration: 60000 });
            return { status: 200, headers: new Headers() };
        }
    });
    await send('https://api.imgchest.com/v1/post', { signal: { createdAt: 0 } });
    await send('https://api.imgchest.com/v1/post', { signal: { createdAt: 0 } });
});
test('HTTP 429 stops all further API calls without retrying and preserves Retry-After', async () => {
    const fake = clockedRequest({ status: 429, headers: new Headers({ 'Retry-After': '3600' }) });
    await assert.rejects(fake.send(), error => error.stopUploads && /Retry-After: 3600/.test(error.message));
    await assert.rejects(fake.send(), /429/);
    assert.equal(fake.calls.length, 1);
});
test('zero remaining in response headers permits saving the successful upload but blocks subsequent requests', async () => {
    const fake = clockedRequest({ status: 200, headers: new Headers({ 'X-RateLimit-Remaining': '0' }) });
    assert.equal((await fake.send()).status, 200);
    await assert.rejects(fake.send(), error => error.stopUploads && /zero requests/.test(error.message));
    assert.equal(fake.calls.length, 1);
});

function fixture(t, { replacementWorks = true, finalFailures = [], advanced = false, uploadFails = false, sourceCount = 1, rateLimited = false, localAsset = false } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rehosting-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const repository = process.env.GITHUB_REPOSITORY;
    process.env.GITHUB_REPOSITORY = 'intrisym/icyoa-template';
    t.after(() => { if (repository === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = repository; });
    const sources = Array.from({ length: sourceCount }, (_, index) => `https://source/image${index || ''}.jpg`);
    const original = [{ type: 'category', options: sources.map((image, index) => ({ id: index ? `option-${index}` : 'option-id', image, cost: 4 })) }];
    if (localAsset) original.unshift({ type: 'headerImage', url: 'images/banner.png' });
    const imageBytes = Buffer.from([255, 216, 255]);
    const writes = [];
    let scans = 0;
    let uploads = 0;
    const api = async (endpoint, method = 'GET', body) => {
        if (method === 'POST') { writes.push({ endpoint, body }); return { sha: 'new-sha', html_url: 'https://github.com/example/pull/1' }; }
        if (endpoint.includes('/jobs?')) return { jobs: [{ name: 'Image loading', conclusion: 'failure' }] };
        if (endpoint.startsWith('git/ref/heads/')) return { object: { sha: advanced ? 'b'.repeat(40) : sha } };
        if (endpoint.startsWith('pulls?')) return [];
        if (endpoint.startsWith('git/commits/')) return { tree: { sha: 'tree' } };
        if (endpoint.startsWith('git/trees/')) return { tree: [{ path: 'CYOAs/example.json', mode: '100644', type: 'blob', size: 100, sha: 'blob' },
            ...(localAsset ? [{ path: 'images/banner.png', mode: '100644', type: 'blob', size: imageBytes.length, sha: 'image-blob' }] : [])] };
        if (endpoint === 'git/blobs/image-blob') return { content: imageBytes.toString('base64') };
        if (endpoint.startsWith('git/blobs/')) return { content: Buffer.from(JSON.stringify(original)).toString('base64') };
        throw new Error(`Unexpected endpoint ${endpoint}`);
    };
    const options = {
        reportPath: path.join(directory, 'report.json'), summaryPath: path.join(directory, 'summary.md'),
        scan: async ({ root }) => {
            if (localAsset) assert.deepEqual(fs.readFileSync(path.join(root, 'images/banner.png')), imageBytes);
            return { failures: ++scans === 1 ? sources.flatMap((url, index) => Array(2).fill({ url,
                references: [{ file: 'CYOAs/example.json', id: index ? `option-${index}` : 'option-id', label: 'Test option' }] })) : finalFailures };
        },
        download: async () => ({ bytes: Buffer.from([255, 216, 255]), type: 'image/jpeg' }),
        upload: async images => {
            uploads++;
            assert.ok(images.length <= 20);
            if (rateLimited) { const error = new Error('ImgChest HTTP 429'); error.stopUploads = true; throw error; }
            if (uploadFails) throw new Error('Source blocked');
            return images.map(image => ({ source: image.source, url: 'https://cdn.imgchest.com/files/new.jpg', postId: 'post' }));
        },
        verify: async () => ({ status: replacementWorks ? 'working' : 'inconclusive' })
    };
    return { api, options, writes, uploads: () => uploads };
}
test('deduplicates uploads, fully checks replacements and opens a PR into the original source branch', async t => {
    const f = fixture(t);
    await repair(f.api, { workflow_run: run }, 'secret', f.options);
    assert.equal(f.uploads(), 1);
    assert.equal(f.writes.at(-1).endpoint, 'pulls');
    assert.equal(f.writes.at(-1).body.base, 'feat/example');
    assert.equal(f.writes.at(-1).body.head, 'fix/image-repair-123');
    const updated = JSON.parse(f.writes.find(write => write.endpoint === 'git/blobs').body.content);
    assert.equal(updated[0].options[0].image, 'https://cdn.imgchest.com/files/new.jpg');
    assert.equal(updated[0].options[0].cost, 4);
});
test('41 unique URLs use three upload requests and update every matching field', async t => {
    const f = fixture(t, { sourceCount: 41 });
    await repair(f.api, { workflow_run: run }, 'secret', f.options);
    assert.equal(f.uploads(), 3);
    assert.equal(JSON.parse(fs.readFileSync(f.options.reportPath)).changes.length, 41);
});
test('tracked local image bytes are available to both scans and are never uploaded or changed', async t => {
    const f = fixture(t, { localAsset: true });
    await repair(f.api, { workflow_run: run }, 'secret', f.options);
    assert.equal(f.uploads(), 1);
    const updated = JSON.parse(f.writes.find(write => write.endpoint === 'git/blobs').body.content);
    assert.equal(updated[0].url, 'images/banner.png');
});
test('429 stops remaining batches, records every unresolved ID and exposes the reason in the Actions summary', async t => {
    const f = fixture(t, { sourceCount: 41, rateLimited: true });
    await assert.rejects(repair(f.api, { workflow_run: run }, 'secret', f.options));
    assert.equal(f.uploads(), 1);
    assert.equal(f.writes.length, 0);
    const report = JSON.parse(fs.readFileSync(f.options.reportPath));
    assert.equal(report.unresolved.length, 41);
    const summary = fs.readFileSync(f.options.summaryPath, 'utf8');
    assert.match(summary, /429/);
    assert.match(summary, /CYOAs\/example.json/);
    assert.match(summary, /option-40/);
    assert.match(summary, /No repair PR created/);
});
for (const [name, settings] of [['replacement blocked', { replacementWorks: false }], ['full scan fails', { finalFailures: [{}] }],
    ['source advanced', { advanced: true }], ['source unavailable', { uploadFails: true }]]) {
    test(`no repository writes when ${name}`, async t => {
        const f = fixture(t, settings);
        await assert.rejects(repair(f.api, { workflow_run: run }, 'secret', f.options));
        assert.equal(f.writes.length, 0);
        if (settings.advanced) assert.equal(f.uploads(), 0);
    });
}
