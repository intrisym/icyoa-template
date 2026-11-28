const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requireApproval, replaceImages, imageType, publicURL, uploadBatch, createImgChestRequest, checkoutAssetPath } = require('./rehost-images');

const approved = [{ state: 'approved', user: { login: 'intrisym' }, environments: [{ name: 'image-rehosting' }] }];
test('requires explicit owner approval for this environment; fails closed for absent protection', () => {
    assert.doesNotThrow(() => requireApproval(approved));
    assert.throws(() => requireApproval(approved, 'intrisym', 2), /fresh approval/);
    for (const reviews of [[], [{ ...approved[0], state: 'rejected' }], [{ ...approved[0], user: { login: 'other' } }],
        [{ ...approved[0], environments: [{ name: 'production' }] }], [...approved, { ...approved[0], state: 'rejected' }]]) {
        assert.throws(() => requireApproval(reviews), /explicit/);
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
