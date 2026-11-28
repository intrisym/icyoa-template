const fs = require("node:fs");
const path = require("node:path");
const { validationMessage } = require("../imageUrlPolicy");
const { classifyFailure, readVerifications, evaluateResults } = require("../imageVerification");
const { renderImageSummary } = require("./image-check-report");
const { reportPath: defaultReportPath } = require("./report-files");

const ROOT = path.resolve(__dirname, "..");
const PRODUCTION_URL = "https://intrisym.github.io/icyoa-template/";

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
async function checkProfile(browser, images, { baseURL, timeout = 10000, concurrency = 32, assetRoot = ROOT, serveLocalAssets = true,
    onProgress = () => {}, networkRetryDelays = [1000, 2000, 4000],
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
        for (let offset = 0; offset < unique.length; offset += concurrency) {
            let remaining = unique.slice(offset, offset + concurrency);
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
                    if (!result.error) continue;
                    const observation = { ...result, ...diagnostics.get(result.url) };
                    attempts.get(result.url).push(observation);
                    if (!attempt || observation.error === "net::ERR_NETWORK_CHANGED" && attempt < 1 + networkRetryDelays.length) remaining.push(result.url);
                    else {
                        const failure = { ...observation, attempts: attempts.get(result.url), references: references.get(result.url) };
                        failures.push({ ...failure, classification: classifyFailure(failure) });
                    }
                }
            }
            onProgress(Math.min(offset + concurrency, unique.length), unique.length);
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
    try {
        for (const [profile, baseURL] of [["localhost", "http://localhost:8000/"], ["production", production.href]]) {
            console.log(`Checking ${images.length} image references as ${profile} (${baseURL})...`);
            const results = await checkProfile(browser, images, { baseURL, assetRoot: root,
                onProgress: (done, total) => console.log(`[${profile}] ${done}/${total} unique URLs checked`) });
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
    fs.writeFileSync(reportPath, JSON.stringify({ references: images.length, ...evaluation }, null, 2) + "\n");
    console.log(`\n${label}: ${failures} blocking result(s); ${accepted} manually verified image(s). Full report: ${reportPath}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderImageSummary({ references: images.length, ...evaluation }) + "\n");
    }
    if (failures) console.error("Open Repair Images Across Versions to fix confirmed failures or manually verify inconclusive results on the live CYOA. Commit repaired files, image-links.json and image-verifications.json before pushing.");
    return { references: images.length, ...evaluation };
}

if (require.main === module) runImageChecks({ files: process.argv.slice(2) }).then(result => {
    if (result.failures.length) process.exitCode = 1;
}).catch(error => {
    console.error(`IMAGE CHECK FAILED: ${error.message}\nInstall dependencies and Chromium first: npm install && npx playwright install chromium`);
    process.exitCode = 1;
});

module.exports = { collectImages, readImages, checkProfile, runImageChecks };
