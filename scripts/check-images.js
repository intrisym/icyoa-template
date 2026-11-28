const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { validationMessage } = require("../imageUrlPolicy");
const { classifyFailure, readVerifications, evaluateResults } = require("../imageVerification");
const { renderImageSummary } = require("./image-check-report");
const { reportPath: defaultReportPath } = require("./report-files");

const ROOT = path.resolve(__dirname, "..");
const PRODUCTION_URL = "https://intrisym.github.io/icyoa-template/";
const CHECK_SETTINGS = { timeout: 10000, concurrency: 8, perHost: 2, networkRetryDelays: [1000, 2000, 4000], confirmationDelays: [2000, 5000] };

function imageBatches(urls, concurrency, perHost) {
    if (![concurrency, perHost].every(value => Number.isInteger(value) && value > 0)) throw new Error("Image concurrency limits must be positive integers.");
    const pending = [...urls].sort();
    const batches = [];
    while (pending.length) {
        const hosts = new Map();
        const batch = [];
        for (let index = 0; index < pending.length && batch.length < concurrency;) {
            const host = new URL(pending[index]).host;
            if ((hosts.get(host) || 0) >= perHost) { index++; continue; }
            hosts.set(host, (hosts.get(host) || 0) + 1);
            batch.push(pending.splice(index, 1)[0]);
        }
        batches.push(batch);
    }
    return batches;
}

function imageSetHash(images) {
    const entries = images.map(({ file, id, url }) => JSON.stringify([file, id || "", url])).sort();
    return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

function collectImages(data, file) {
    const images = [];
    const cyoaTitle = data.find(entry => entry.type === "title")?.text || path.basename(file, ".json");
    const add = (url, location, id, label) => {
        if (typeof url === "string" && url.trim()) images.push({ file, location, id, label, cyoaTitle, url: url.trim() });
    };
    const options = (category, location) => {
        for (const [index, option] of (category.options || []).entries()) {
            add(option.image || option.img, `${location}.options[${index}] (${option.id || option.name || "unnamed"})`,
                option.id, option.label || option.name || option.id || "Unnamed option");
        }
        for (const [index, subcategory] of (category.subcategories || []).entries()) {
            options(subcategory, `${location}.subcategories[${index}]`);
        }
    };
    for (const [index, entry] of data.entries()) {
        if (entry.type === "headerImage") {
            add(entry.url, `[${index}] headerImage`, "@header", "Header image");
        }
        options(entry, `[${index}] ${entry.name || entry.type || "category"}`);
    }
    return images;
}

function readImages(files, root = ROOT) {
    const selected = files.length ? files.map(file => path.resolve(root, file))
        : fs.readdirSync(path.join(root, "CYOAs"))
            .filter(file => file.endsWith(".json") && file !== "manifest.json")
            .sort().map(file => path.join(root, "CYOAs", file));
    return selected.flatMap(file => collectImages(JSON.parse(fs.readFileSync(file, "utf8")), path.relative(root, file)));
}

// Serve a test document at the real origin without deploying or changing DNS.
// Only the document is intercepted: external image requests go to their real hosts.
async function checkProfile(browser, images, { baseURL, timeout = CHECK_SETTINGS.timeout, concurrency = CHECK_SETTINGS.concurrency,
    perHost = CHECK_SETTINGS.perHost, assetRoot = ROOT, serveLocalAssets = true,
    onProgress = () => {}, networkRetryDelays = CHECK_SETTINGS.networkRetryDelays,
    confirmationDelays = CHECK_SETTINGS.confirmationDelays, onRecovery = () => {},
    onRetry = message => console.log(message) }) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
        const page = await context.newPage();
        const documentURL = new URL("__image_check__", baseURL).href;
        await page.route(documentURL, route => route.fulfill({
            contentType: "text/html", body: '<!doctype html><meta name="referrer" content="strict-origin-when-cross-origin"><title>Image check</title>'
        }));
        // Relative image paths resolve to the same paths as the player page.
        if (serveLocalAssets) await page.route(url => url.origin === new URL(baseURL).origin
            && url.pathname.startsWith(new URL(baseURL).pathname) && url.href !== documentURL, async route => {
            const url = new URL(route.request().url());
            const prefix = new URL(baseURL).pathname;
            const relative = decodeURIComponent(url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname.slice(1));
            const filename = path.resolve(assetRoot, relative);
            if (!filename.startsWith(assetRoot + path.sep)) return route.fulfill({ status: 404, body: "Outside repository" });
            try { await route.fulfill({ path: filename }); }
            catch { await route.fulfill({ status: 404, body: "Missing image asset" }); }
        });
        const diagnostics = new Map();
        const initiatingURL = request => {
            while (request.redirectedFrom()) request = request.redirectedFrom();
            return request.url();
        };
        page.on("response", response => {
            if (response.request().resourceType() === "image") {
                const headers = response.headers();
                diagnostics.set(initiatingURL(response.request()), { status: response.status(), contentType: headers["content-type"],
                    challenge: headers["cf-mitigated"] === "challenge", ...(response.status() >= 400 ? { error: `HTTP ${response.status()}` } : {}) });
            }
        });
        page.on("requestfailed", request => {
            const error = request.failure()?.errorText || "Network failure";
            if (error !== "net::ERR_ABORTED") {
                const url = initiatingURL(request);
                diagnostics.set(url, { ...diagnostics.get(url), error });
            }
        });
        await page.goto(documentURL);
        const references = new Map();
        const failures = [];
        for (const image of images) {
            try {
                const url = new URL(image.url, baseURL).href;
                if (!["https:", "http:", "data:"].includes(new URL(url).protocol)) {
                    failures.push({ url, error: "Unsupported image URL protocol", classification: "broken", references: [image] });
                    continue;
                }
                if (!references.has(url)) references.set(url, []);
                references.get(url).push(image);
            } catch {
                failures.push({ url: image.url, error: "Invalid image URL", references: [image] });
            }
        }
        const unique = [...references.keys()];
        const loadImages = urls => page.evaluate(async ({ urls, timeout }) => Promise.all(urls.map(url => new Promise(resolve => {
            const image = new Image();
            const finish = error => {
                clearTimeout(timer);
                image.onload = image.onerror = null;
                if (error) image.removeAttribute("src");
                resolve({ url, error });
            };
            const timer = setTimeout(() => finish(`Timed out after ${timeout} ms`), timeout);
            image.onload = () => finish(image.naturalWidth > 0 ? null : "Image has no decoded pixels");
            image.onerror = () => finish("Browser could not load/decode image");
            image.src = url;
        }))), { urls, timeout });
        let done = 0;
        for (const batch of imageBatches(unique, concurrency, perHost)) {
            let remaining = batch;
            const attempts = new Map(remaining.map(url => [url, []]));
            for (let attempt = 0; attempt < 2 + networkRetryDelays.length && remaining.length; attempt += 1) {
                if (attempt >= 2) {
                    const delay = networkRetryDelays[attempt - 2];
                    onRetry(`Network changed: retrying ${remaining.length} affected image URL(s) in ${delay} ms (${attempt - 1}/${networkRetryDelays.length} recovery retries).`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                remaining.forEach(url => diagnostics.delete(url));
                const results = await loadImages(remaining);
                remaining = [];
                for (const result of results) {
                    if (!result.error) {
                        const history = attempts.get(result.url);
                        if (history.length) onRecovery({ url: result.url, attempts: [...history, result], references: references.get(result.url) });
                        continue;
                    }
                    const observation = { ...result, ...diagnostics.get(result.url) };
                    attempts.get(result.url).push(observation);
                    if (!attempt || observation.error === "net::ERR_NETWORK_CHANGED" && attempt < 1 + networkRetryDelays.length) remaining.push(result.url);
                    else {
                        const failure = { ...observation, attempts: attempts.get(result.url), references: references.get(result.url) };
                        failures.push({ ...failure, classification: classifyFailure(failure) });
                    }
                }
            }
            done += batch.length;
            onProgress(done, unique.length);
        }
        // Retest only inconclusive URLs after the main scan, in fresh contexts
        // and one at a time. Preserve the original origin and request headers;
        // neither a successful raw download nor another profile can override it.
        for (const [index, delay] of confirmationDelays.entries()) {
            const pending = failures.filter(failure => failure.classification === "inconclusive");
            if (!pending.length) break;
            onRetry(`Confirming ${pending.length} inconclusive image URL(s) in a fresh browser context after ${delay} ms (${index + 1}/${confirmationDelays.length}).`);
            await new Promise(resolve => setTimeout(resolve, delay));
            const confirmationRecoveries = new Map();
            const confirmed = await checkProfile(browser, pending.flatMap(failure => failure.references), {
                baseURL, timeout, concurrency: 1, perHost: 1, assetRoot, serveLocalAssets,
                networkRetryDelays: [], confirmationDelays: [], onRetry,
                onRecovery: result => confirmationRecoveries.set(result.url, result.attempts)
            });
            const byURL = new Map(confirmed.map(failure => [failure.url, failure]));
            for (const failure of pending) {
                const next = byURL.get(failure.url);
                if (next) {
                    const history = [...(failure.attempts || [failure]), ...(next.attempts || [next])];
                    Object.assign(failure, next, { attempts: history, classification: classifyFailure({ attempts: history }) });
                } else {
                    failures.splice(failures.indexOf(failure), 1);
                    onRecovery({ ...failure, attempts: [...(failure.attempts || [failure]),
                        ...(confirmationRecoveries.get(failure.url) || [{ url: failure.url, error: null }])], confirmationPass: index + 1 });
                }
            }
        }
        return failures;
    } finally {
        await context.close();
    }
}

function reportFailure(profile, failure) {
    const manual = failure.manuallyVerified;
    const inconclusive = failure.classification === "inconclusive";
    const label = manual ? "MANUALLY VERIFIED" : inconclusive ? "INCONCLUSIVE — verification required" : "FAIL";
    console.error(`\n${label} [${profile}] ${failure.error}\n  URL: ${failure.url}`);
    for (const reference of failure.references) {
        const identity = `${reference.label || reference.id || "Image"} (ID: ${reference.id || "—"})`;
        const message = `${identity} — ${failure.error} — ${failure.url} [${reference.location}]`;
        console.error(`  ${reference.file}: ${identity} [${reference.location}]`);
        if (process.env.GITHUB_ACTIONS === "true") {
            const escape = value => value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/,/g, "%2C").replace(/:/g, "%3A");
            console.log(`::${manual ? "warning" : "error"} file=${escape(reference.file)},title=${escape(label)} (${profile})::${escape(message)}`);
        }
    }
}

async function runImageChecks({ root = ROOT, files = [], reportPath = defaultReportPath(ROOT, "image-check-report.json") } = {}) {
    const { createImageMaintenance } = require("../imageMaintenance");
    await createImageMaintenance({ directory: path.join(root, "CYOAs"), linksFile: path.join(root, "image-links.json") }).checkLinks();
    const registry = readVerifications(root);
    const images = readImages(files, root);
    const production = new URL(process.env.IMAGE_CHECK_PRODUCTION_URL || PRODUCTION_URL);
    if (production.protocol !== "https:") throw new Error("IMAGE_CHECK_PRODUCTION_URL must be an HTTPS player directory URL ending in /.");
    if (!production.pathname.endsWith("/")) throw new Error("IMAGE_CHECK_PRODUCTION_URL must end in /.");
    const { chromium } = require("playwright");
    const browser = await chromium.launch();
    const summary = [];
    const recovered = [];
    const metadata = { startedAt: new Date().toISOString(), imageSetHash: imageSetHash(images), uniqueURLs: new Set(images.map(image => image.url)).size,
        node: process.version, playwright: require("playwright/package.json").version, chromium: browser.version(),
        platform: process.platform, architecture: process.arch, settings: CHECK_SETTINGS,
        profiles: { localhost: "http://localhost:8000/", production: production.href },
        commit: process.env.GITHUB_SHA || null, event: process.env.GITHUB_EVENT_NAME || "local" };
    console.log(`Image set SHA-256: ${metadata.imageSetHash}; Chromium ${metadata.chromium}; ${metadata.settings.concurrency} concurrent URLs, ${metadata.settings.perHost} per host.`);
    try {
        for (const [profile, baseURL] of [["localhost", "http://localhost:8000/"], ["production", production.href]]) {
            console.log(`Checking ${images.length} image references as ${profile} (${baseURL})...`);
            let lastProgress = 0;
            const results = await checkProfile(browser, images, { baseURL, assetRoot: root,
                onRecovery: result => recovered.push({ profile, ...result }),
                onProgress: (done, total) => {
                    if (done === total || done - lastProgress >= 32) {
                        console.log(`[${profile}] ${done}/${total} unique URLs checked`);
                        lastProgress = done;
                    }
                } });
            for (const failure of results) {
                summary.push({ profile, ...failure });
            }
        }
    } finally { await browser.close(); }
    const policyFailures = new Map();
    for (const image of images) {
        const error = validationMessage(image.url);
        if (!error) continue;
        if (!policyFailures.has(image.url)) policyFailures.set(image.url, { profile: "policy", url: image.url, error, references: [] });
        policyFailures.get(image.url).references.push(image);
    }
    for (const failure of policyFailures.values()) {
        summary.push(failure);
    }
    const evaluation = evaluateResults(summary, registry);
    for (const diagnostic of evaluation.diagnostics) reportFailure(diagnostic.profile, diagnostic);
    const failures = evaluation.failures.length;
    const accepted = new Set(evaluation.manualVerifications.map(entry => JSON.stringify([entry.file, entry.id, entry.url]))).size;
    const label = failures ? "FAILED" : accepted ? "PASS WITH MANUAL VERIFICATION" : "PASS";
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    metadata.finishedAt = new Date().toISOString();
    const report = { references: images.length, metadata, recovered, ...evaluation };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    if (recovered.length) console.log(`Recovered after retry: ${recovered.length} image/profile result(s). See the report for affected URLs and attempt history.`);
    console.log(`\n${label}: ${failures} blocking result(s); ${accepted} manually verified image(s). Full report: ${reportPath}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderImageSummary(report) + "\n");
    }
    if (failures) console.error("Open Repair Images Across Versions to fix confirmed failures or manually verify inconclusive results on the live CYOA. Commit repaired files, image-links.json and image-verifications.json before pushing.");
    return report;
}

if (require.main === module) runImageChecks({ files: process.argv.slice(2) }).then(result => {
    if (result.failures.length) process.exitCode = 1;
}).catch(error => {
    console.error(`IMAGE CHECK FAILED: ${error.message}\nInstall dependencies and Chromium first: npm install && npx playwright install chromium`);
    process.exitCode = 1;
});

module.exports = { collectImages, readImages, checkProfile, runImageChecks, imageBatches, imageSetHash };
