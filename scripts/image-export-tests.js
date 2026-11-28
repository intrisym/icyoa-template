const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, selectSources, exportImages } = require('./export-images');

const SOURCE = 'https://images.example/art.jpg';
const NEW = 'https://cdn.imgchest.com/files/replacement.jpg';
const BYTES = Buffer.from([255, 216, 255, 1]);
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'image-export-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const originalActions = process.env.GITHUB_ACTIONS;
    process.env.GITHUB_ACTIONS = 'false';
    t.after(() => { if (originalActions === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = originalActions; });
    await fs.mkdir(path.join(root, 'CYOAs'));
    const data = [{ type: 'headerImage', url: SOURCE }, { name: 'Choices', options: [
        { id: 'one', image: SOURCE, cost: { Points: 3 }, description: SOURCE },
        { id: 'other', image: 'images/local.png' }
    ] }];
    for (const name of ['v1.json', 'v2.json']) await fs.writeFile(path.join(root, 'CYOAs', name), JSON.stringify(data));
    const counters = { downloads: 0, uploads: 0 };
    const dependencies = { root, token: 'fake', log: () => {},
        download: async () => { counters.downloads++; return { bytes: BYTES, type: 'image/jpeg' }; },
        upload: async images => { counters.uploads++; return images.map(image => ({ source: image.source, url: NEW, postId: 'post' })); },
        verify: async () => ({ status: 'working' }) };
    return { root, data, counters, dependencies,
        read: name => fs.readFile(path.join(root, 'CYOAs', name), 'utf8').then(JSON.parse) };
}

test('CLI supports report, host and file selection and rejects unknown/missing flags', () => {
    assert.equal(parseArgs(['--host', 'EXAMPLE.com', '--apply']).hosts[0], 'example.com');
    assert.equal(parseArgs(['--no-browser']).browser, false);
    assert.throws(() => parseArgs(['--host']), /Missing/);
    assert.throws(() => parseArgs(['--host', 'https://example.com']), /hostname/);
    assert.throws(() => parseArgs(['--unknown']), /Unknown/);
});
test('preview performs no downloads, uploads or CYOA writes', async t => {
    const f = await fixture(t);
    const result = await exportImages(parseArgs(['--host', 'images.example']), { ...f.dependencies, token: null });
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].references.length, 4);
    assert.deepEqual(f.counters, { downloads: 0, uploads: 0 });
    assert.deepEqual(await f.read('v1.json'), f.data);
});
test('local file mappings upload saved bytes without requesting the blocked source and update all versions', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.root, 'saved.jpg'), BYTES);
    await fs.writeFile(path.join(f.root, 'files.json'), JSON.stringify({ [SOURCE]: 'saved.jpg', 'https://unrelated.test/unused.jpg': 'missing.jpg' }));
    const report = await exportImages(parseArgs(['--local-files', 'files.json', '--apply']), f.dependencies);
    assert.equal(f.counters.downloads, 0);
    assert.equal(f.counters.uploads, 1);
    assert.equal(report.changes.length, 4);
    assert.equal((await f.read('v1.json'))[0].url, NEW);
});
test('local HTML files are rejected without uploading or changing images', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.root, 'saved.jpg'), '<html>challenge</html>');
    await fs.writeFile(path.join(f.root, 'files.json'), JSON.stringify({ [SOURCE]: 'saved.jpg' }));
    const report = await exportImages(parseArgs(['--local-files', 'files.json', '--apply']), f.dependencies);
    assert.equal(f.counters.uploads, 0);
    assert.match(report.unresolved[0].error, /HTML challenge/);
    assert.deepEqual(await f.read('v1.json'), f.data);
});
test('report selection includes inconclusive and manually verified results, deduplicating both browser profiles', () => {
    const docs = [{ filename: 'v1.json', data: [{ options: [{ id: 'a', image: SOURCE }, { id: 'b', image: 'https://unselected.test/x.png' }] }] }];
    const report = { diagnostics: [{ url: SOURCE, classification: 'inconclusive', manuallyVerified: true }, { url: SOURCE, classification: 'inconclusive' }] };
    assert.equal(selectSources(docs, parseArgs(['--report', 'report.json']), report).length, 1);
    assert.equal(selectSources(docs, parseArgs(['--host', 'images.example.evil']), report).length, 0);
});
test('apply uploads once and rewrites image fields in every version, preserving gameplay', async t => {
    const f = await fixture(t);
    const result = await exportImages(parseArgs(['--file', 'CYOAs/v1.json', '--apply']), f.dependencies);
    assert.equal(result.changes.length, 4);
    assert.deepEqual(f.counters, { downloads: 1, uploads: 1 });
    for (const name of ['v1.json', 'v2.json']) {
        const value = await f.read(name);
        assert.equal(value[0].url, NEW);
        assert.equal(value[1].options[0].image, NEW);
        assert.equal(value[1].options[0].description, SOURCE);
        assert.equal(value[1].options[0].cost.Points, 3);
        assert.equal(value[1].options[1].image, 'images/local.png');
    }
});
test('fresh file reads preserve gameplay edits made during downloads', async t => {
    const f = await fixture(t);
    f.dependencies.download = async () => {
        const data = await f.read('v1.json'); data[1].options[0].cost.Points = 17;
        await fs.writeFile(path.join(f.root, 'CYOAs/v1.json'), JSON.stringify(data));
        return { bytes: BYTES };
    };
    await exportImages(parseArgs(['--host', 'images.example', '--apply']), f.dependencies);
    assert.equal((await f.read('v1.json'))[1].options[0].cost.Points, 17);
});
test('different URLs with identical image bytes upload once', async t => {
    const f = await fixture(t);
    const data = await f.read('v1.json'); data[0].url = 'https://images.example/other.jpg';
    await fs.writeFile(path.join(f.root, 'CYOAs/v1.json'), JSON.stringify(data));
    await exportImages(parseArgs(['--host', 'images.example', '--apply']), f.dependencies);
    assert.equal(f.counters.uploads, 1);
    assert.equal((await f.read('v1.json'))[0].url, NEW);
});
test('identical bytes are not uploaded again when the first replacement remains inconclusive', async t => {
    const f = await fixture(t);
    const data = await f.read('v1.json'); data[0].url = 'https://images.example/other.jpg';
    await fs.writeFile(path.join(f.root, 'CYOAs/v1.json'), JSON.stringify(data));
    const result = await exportImages(parseArgs(['--host', 'images.example', '--apply']), {
        ...f.dependencies, verify: async () => ({ status: 'inconclusive' })
    });
    assert.equal(f.counters.uploads, 1);
    assert.equal(result.changes.length, 0);
    assert.equal(result.unresolved.length, 2);
});
test('completed CI uploads are reverified and reused without downloading or uploading again', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.root, 'ci-report.json'), JSON.stringify({ uploads: [{ source: SOURCE, url: NEW, postId: 'post' }], unresolved: [] }));
    await exportImages(parseArgs(['--report', 'ci-report.json', '--apply']), f.dependencies);
    assert.deepEqual(f.counters, { downloads: 0, uploads: 0 });
    assert.equal((await f.read('v1.json'))[0].url, NEW);
});
test('a legacy root cache is migrated and reused by the default reports output', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.root, 'image-export-report.json'), JSON.stringify({ kind: 'local-image-export', uploads: [{ source: SOURCE, url: NEW }] }));
    await exportImages(parseArgs(['--all', '--apply']), f.dependencies);
    assert.equal(f.counters.uploads, 0);
    await assert.rejects(fs.stat(path.join(f.root, 'image-export-report.json')), { code: 'ENOENT' });
    assert.ok((await fs.stat(path.join(f.root, 'reports/image-export-report.json'))).isFile());
});
test('unverified uploaded URLs remain unapplied and can be resumed without reuploading', async t => {
    const f = await fixture(t);
    const options = parseArgs(['--host', 'images.example', '--apply']);
    const first = await exportImages(options, { ...f.dependencies, verify: async () => ({ status: 'inconclusive' }) });
    assert.equal(first.changes.length, 0);
    assert.equal((await f.read('v1.json'))[0].url, SOURCE);
    await exportImages(options, f.dependencies);
    assert.equal(f.counters.uploads, 1);
    assert.equal((await f.read('v1.json'))[0].url, NEW);
});
test('missing token and CI execution are rejected before uploads', async t => {
    const f = await fixture(t);
    await assert.rejects(exportImages(parseArgs(['--all', '--apply']), { ...f.dependencies, token: null }), /IMGCHEST_API_TOKEN/);
    process.env.GITHUB_ACTIONS = 'true';
    await assert.rejects(exportImages(parseArgs(['--all', '--apply']), f.dependencies), /local only/);
    assert.equal(f.counters.uploads, 0);
});
test('HTTP 429 leaves original URLs untouched and writes an actionable report', async t => {
    const f = await fixture(t);
    f.dependencies.upload = async () => { const error = new Error('HTTP 429'); error.stopUploads = true; throw error; };
    const report = await exportImages(parseArgs(['--all', '--apply']), f.dependencies);
    assert.equal(report.changes.length, 0);
    assert.match(report.unresolved[0].error, /429/);
    assert.deepEqual(await f.read('v1.json'), f.data);
    await assert.rejects(fs.stat(path.join(f.root, '.image-export.lock')), { code: 'ENOENT' });
});
test('cancellation during preparation prevents uploads and releases the exporter lock', async t => {
    const f = await fixture(t);
    const controller = new AbortController();
    f.dependencies.download = async () => { controller.abort(); return { bytes: BYTES }; };
    await assert.rejects(exportImages(parseArgs(['--all', '--apply']), { ...f.dependencies, signal: controller.signal }), /abort/i);
    assert.equal(f.counters.uploads, 0);
    assert.deepEqual(await f.read('v1.json'), f.data);
    await assert.rejects(fs.stat(path.join(f.root, '.image-export.lock')), { code: 'ENOENT' });
});
test('output cannot overwrite unrelated JSON or an active exporter report', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.root, 'package.json'), '{"name":"keep"}');
    await assert.rejects(exportImages(parseArgs(['--all', '--apply', '--output', 'package.json']), f.dependencies), /not a local export report/);
    assert.equal(await fs.readFile(path.join(f.root, 'package.json'), 'utf8'), '{"name":"keep"}');
    await fs.mkdir(path.join(f.root, '.image-export.lock'));
    await assert.rejects(exportImages(parseArgs(['--all', '--apply']), f.dependencies), /Another local image export/);
    assert.equal(f.counters.uploads, 0);
});
