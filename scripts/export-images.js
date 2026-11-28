const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { randomUUID } = require('node:crypto');
const { createInterface } = require('node:readline/promises');
const { withCyoaWriteLock } = require('../cyoaWriteLock');
const { readDocuments, commitFiles, imageSlots } = require('../imageMaintenance');
const { replaceImages, uploadBatch, createImgChestRequest, checkoutAssetPath, imageType } = require('./rehost-images');
const { testImageUrl } = require('./test-image-url');
const { createBrowserDownloader } = require('./browser-image-download');
const { reportPath, resolveReportInput, migrateLegacyReports } = require('./report-files');

const HELP = `Local image export and URL replacement

  npm run images:export -- --report reports/image-check-report.json
  npm run images:export -- --host raregallery.art --host wallpapercrafter.com
  npm run images:export -- --file CYOAs/necromancer.json

Add --apply to upload and update JSON files; the default only previews URLs.
--report accepts checker diagnostics or a previous repair/export report.
--output <path> selects the resumable report (default reports/image-export-report.json).
--local-files <json> maps original URLs to downloaded image file paths.
--all explicitly selects all external image URLs. --no-browser disables fallback.
--apply requires IMGCHEST_API_TOKEN in the environment. Nothing commits or pushes.
`;

function parseArgs(args) {
    const options = { hosts: [], files: [], browser: true };
    for (let index = 0; index < args.length; index++) {
        const flag = args[index];
        if (flag === '--apply') options.apply = true;
        else if (flag === '--all') options.all = true;
        else if (flag === '--no-browser') options.browser = false;
        else if (flag === '--help') options.help = true;
        else if (['--host', '--file', '--report', '--output', '--local-files'].includes(flag)) {
            const value = args[++index];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
            if (flag === '--host') {
                if (!/^[a-zA-Z0-9.-]+$/.test(value)) throw new Error('--host requires a hostname, such as raregallery.art');
                options.hosts.push(value.toLowerCase());
            } else if (flag === '--file') options.files.push(value);
            else if (flag === '--local-files') options.localFiles = value;
            else options[flag.slice(2)] = value;
        } else throw new Error(`Unknown argument: ${flag}`);
    }
    return options;
}

function canonical(value) { try { return new URL(value).href; } catch { return value; } }
const isUploadedURL = value => /^https:\/\/cdn\.imgchest\.com\/files\/[a-zA-Z0-9_.-]+$/.test(value || '');

function reportSources(report) {
    return new Set([
        ...(report.diagnostics || []).map(item => item.url),
        ...(report.failures || []).map(item => item.url),
        ...(report.unresolved || []).map(item => item.source),
        ...(report.uploads || []).map(item => item.source)
    ].filter(Boolean).map(canonical));
}

function selectSources(documents, options, report) {
    const requested = report ? reportSources(report) : null;
    const result = new Map();
    for (const slot of documents.flatMap(imageSlots)) {
        if (options.files.length && !options.files.some(file => path.basename(file) === slot.filename)) continue;
        let url;
        try { url = new URL(slot.url); } catch { continue; }
        if (url.protocol !== 'https:' || url.username || url.password || checkoutAssetPath(url.href)) continue;
        if (requested && !requested.has(url.href)) continue;
        if (options.hosts.length && !options.hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) continue;
        if (!result.has(url.href)) result.set(url.href, { source: url.href, references: [] });
        result.get(url.href).references.push({ file: slot.file, id: slot.id, label: slot.label });
    }
    return [...result.values()];
}

async function readReport(filename) {
    try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function applyReplacements(root, replacements) {
    const directory = path.join(root, 'CYOAs');
    return withCyoaWriteLock(directory, async () => {
        // Re-read now: never save stale gameplay data collected before downloads.
        const documents = await readDocuments(directory);
        const changes = replaceImages(documents, replacements);
        await commitFiles(documents.filter(document => document.changed).map(document => ({
            file: path.join(directory, document.filename), original: document.original,
            body: JSON.stringify(document.data, null, 2) + '\n'
        })));
        return changes;
    });
}

async function exportImages(options, { root = path.resolve(__dirname, '..'), token = process.env.IMGCHEST_API_TOKEN,
    download, upload = uploadBatch, verify = testImageUrl, request = createImgChestRequest(), signal, log = console.log } = {}) {
    if (process.env.GITHUB_ACTIONS === 'true') throw new Error('This command is local only. Authenticated image uploads are disabled in GitHub Actions.');
    if (!options.all && !options.hosts.length && !options.files.length && !options.report && !options.localFiles) throw new Error('Select --report, --host, --file, --local-files or --all. Use --help for examples.');
    const localFilesPath = options.localFiles && resolveReportInput(root, options.localFiles);
    const localFiles = new Map();
    if (localFilesPath) {
        const supplied = await readReport(localFilesPath);
        if (!supplied || Array.isArray(supplied) || typeof supplied !== 'object') throw new Error('--local-files needs a JSON object mapping source URLs to image file paths.');
        for (const [url, filename] of Object.entries(supplied)) {
            if (typeof filename !== 'string' || !filename.trim()) throw new Error('Each local image path must be a nonempty string.');
            localFiles.set(canonical(url), path.resolve(path.dirname(localFilesPath), filename));
        }
    }
    const input = options.report ? await readReport(resolveReportInput(root, options.report))
        : localFilesPath && !options.all && !options.hosts.length && !options.files.length
            ? { unresolved: [...localFiles.keys()].map(source => ({ source })) } : null;
    if (options.report && !input) throw new Error('Input report not found.');
    const documents = await readDocuments(path.join(root, 'CYOAs'));
    const sources = selectSources(documents, options, input);
    log(`${sources.length} unique source URL(s) selected. Matching URLs across all CYOAs/versions will be updated.`);
    for (const item of sources) log(`${item.source}\n  ${item.references.map(ref => `${ref.file} / ${ref.id}`).join('\n  ')}`);
    if (!options.apply || !sources.length) return { preview: true, sources };
    if (!token) throw new Error('Set IMGCHEST_API_TOKEN in your local environment before using --apply. Do not put it in a tracked file.');
    if (!options.output) migrateLegacyReports(root);
    const output = options.output ? path.resolve(root, options.output) : reportPath(root, 'image-export-report.json');
    if (output.startsWith(path.join(root, 'CYOAs') + path.sep)) throw new Error('--output must be outside CYOAs.');
    const previous = await readReport(output);
    const completed = [...(previous?.uploads || []), ...(input?.uploads || [])];
    if (previous && previous.kind !== 'local-image-export') throw new Error('--output already exists and is not a local export report. Use --report to read a CI report.');
    await fs.mkdir(path.dirname(output), { recursive: true });
    const report = { kind: 'local-image-export', schemaVersion: 1, uploads: [...(previous?.uploads || [])], unresolved: [], changes: [] };
    const save = async () => {
        const temporary = output + '.' + randomUUID() + '.tmp';
        try {
            await fs.writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
            await fs.rename(temporary, output);
        } finally { await fs.rm(temporary, { force: true }); }
    };
    const replacements = new Map();
    const digests = new Map();
    const checked = new Map();
    const working = async url => {
        if (!checked.has(url)) checked.set(url, (await verify(url)).status === 'working');
        return checked.get(url);
    };
    let stopped;
    let batch = [];
    const fail = (item, error) => {
        report.unresolved.push({ ...item, references: sources.find(source => source.source === item.source)?.references || [], error: error.message });
        log(`UNRESOLVED ${item.source}: ${error.message}`);
    };
    async function flush() {
        signal?.throwIfAborted();
        if (!batch.length) return;
        const current = batch; batch = [];
        let uploaded;
        log(`Uploading ${current.length} unique image(s). The API limiter may wait up to 61 seconds before sending.`);
        try { uploaded = await upload(current, token, request); }
        catch (error) { current.forEach(item => fail({ source: item.source }, error)); stopped = error; await save(); return; }
        for (const item of uploaded) {
            const digest = current.find(image => image.source === item.source).digest;
            report.uploads.push({ ...item, digest });
            digests.set(digest, item.url);
        }
        // Save before verification/applying, so interrupted runs can reuse uploads.
        await save();
        for (const item of uploaded) {
            try {
                log(`Checking replacement: ${item.url}`);
                if (!await working(item.url)) throw new Error('ImgChest URL did not pass both browser-origin checks.');
                replacements.set(item.source, item.url);
            } catch (error) { fail({ source: item.source }, error); }
        }
    }
    // Separate from the short CYOA write lock: the editor may keep working while
    // the download/browser session runs, but two local exporters cannot overlap.
    const lock = path.join(root, '.image-export.lock');
    try { await fs.mkdir(lock); }
    catch (error) { if (error.code !== 'EEXIST') throw error; throw new Error('Another local image export is running. If it crashed, stop all exporters before removing .image-export.lock.'); }
    try {
        await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
        await save();
        for (const item of sources) {
            signal?.throwIfAborted();
            try {
                const cached = completed.find(entry => canonical(entry.source) === item.source && isUploadedURL(entry.url));
                if (cached && await working(cached.url)) {
                    log(`Reusing completed upload: ${item.source} -> ${cached.url}`);
                    replacements.set(item.source, cached.url);
                    if (cached.digest) digests.set(cached.digest, cached.url);
                    if (!report.uploads.some(entry => entry.source === item.source && entry.url === cached.url)) report.uploads.push(cached);
                    await save(); continue;
                }
                if (stopped) throw stopped;
                log(`Downloading: ${item.source}`);
                let image;
                if (localFiles.has(item.source)) {
                    const filename = localFiles.get(item.source);
                    const stat = await fs.stat(filename);
                    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('Local image must be a regular file up to 20 MB.');
                    image = { bytes: await fs.readFile(filename) };
                } else image = await download(item.source);
                if (image.bytes.length > 20 * 1024 * 1024) throw new Error('Image exceeds 20 MB');
                image.type = imageType(image.bytes);
                const digest = createHash('sha256').update(image.bytes).digest('hex');
                if (batch.some(pending => pending.digest === digest)) await flush();
                if (!digests.has(digest)) {
                    const sameBytes = completed.find(entry => entry.digest === digest && isUploadedURL(entry.url));
                    if (sameBytes && await working(sameBytes.url)) digests.set(digest, sameBytes.url);
                }
                if (digests.has(digest)) {
                    const url = digests.get(digest);
                    report.uploads.push({ source: item.source, url, digest }); await save();
                    if (!await working(url)) throw new Error('ImgChest URL did not pass both browser-origin checks.');
                    replacements.set(item.source, url); continue;
                }
                if (stopped) throw stopped;
                batch.push({ source: item.source, digest, ...image });
                if (batch.length === 20) await flush();
            } catch (error) { fail(item, error); await save(); }
        }
        await flush();
        signal?.throwIfAborted();
        report.changes = await applyReplacements(root, replacements);
        await save();
        log(`Updated ${report.changes.length} image reference(s); ${report.unresolved.length} unresolved. Report: ${output}`);
        return report;
    } finally { try { await save(); } finally { await fs.rm(lock, { recursive: true, force: true }); } }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help || process.argv.length === 2) return console.log(HELP);
    let terminal;
    const controller = new AbortController();
    const downloader = createBrowserDownloader({ prompt: options.browser && process.stdin.isTTY ? async message => {
        if (!terminal) {
            terminal = createInterface({ input: process.stdin, output: process.stdout });
            terminal.on('SIGINT', () => void interrupt());
        }
        await terminal.question(message + '\n');
    } : null });
    const root = path.resolve(__dirname, '..');
    const close = async () => { terminal?.close(); await downloader.close(); };
    let stopping = false;
    const interrupt = async () => {
        if (stopping) return;
        stopping = true;
        controller.abort();
        try { await close(); }
        finally {
            const lock = path.join(root, '.image-export.lock');
            const owner = await readReport(path.join(lock, 'owner.json')).catch(() => null);
            if (owner?.pid === process.pid) await fs.rm(lock, { recursive: true, force: true });
            process.exit(130);
        }
    };
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try {
        const result = await exportImages(options, { download: downloader.download, signal: controller.signal });
        if (result.unresolved?.length) process.exitCode = 1;
    } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); await close(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseArgs, selectSources, reportSources, applyReplacements, exportImages };
