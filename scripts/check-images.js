const fs = require("node:fs");
const path = require("node:path");
const { validationMessage } = require("../imageUrlPolicy");

const ROOT = path.resolve(__dirname, "..");
const PRODUCTION_URL = "https://intrisym.github.io/icyoa-template/";

function collectImages(data, file) {
    const images = [];
    const add = (url, location) => {
        if (typeof url === "string" && url.trim()) images.push({ file, location, url: url.trim() });
    };
    const options = (category, location) => {
        for (const [index, option] of (category.options || []).entries()) {
            add(option.image || option.img, `${location}.options[${index}] (${option.id || option.name || "unnamed"})`);
        }
        for (const [index, subcategory] of (category.subcategories || []).entries()) {
            options(subcategory, `${location}.subcategories[${index}]`);
        }
    };
    for (const [index, entry] of data.entries()) {
        if (entry.type === "headerImage") add(entry.url, `[${index}] headerImage`);
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
async function checkProfile(browser, images, { baseURL, timeout = 10000, concurrency = 32, assetRoot = ROOT, onProgress = () => {} }) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
        const page = await context.newPage();
        const documentURL = new URL("__image_check__", baseURL).href;
        await page.route(documentURL, route => route.fulfill({
            contentType: "text/html", body: '<!doctype html><meta name="referrer" content="strict-origin-when-cross-origin"><title>Image check</title>'
        }));
        // Relative image paths resolve to the same paths as the player page.
        await page.route(url => url.origin === new URL(baseURL).origin && url.href !== documentURL, async route => {
            const url = new URL(route.request().url());
            const prefix = new URL(baseURL).pathname;
            const relative = decodeURIComponent(url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname.slice(1));
            const filename = path.resolve(assetRoot, relative);
            if (!filename.startsWith(assetRoot + path.sep)) return route.fulfill({ status: 404, body: "Outside repository" });
            try { await route.fulfill({ path: filename }); }
            catch { await route.fulfill({ status: 404, body: "Missing image asset" }); }
        });
        const diagnostics = new Map();
        page.on("response", response => {
            if (response.request().resourceType() === "image" && response.status() >= 400) {
                diagnostics.set(response.request().url(), `HTTP ${response.status()}`);
            }
        });
        page.on("requestfailed", request => diagnostics.set(request.url(), request.failure()?.errorText || "Network failure"));
        await page.goto(documentURL);
        const references = new Map();
        const failures = [];
        for (const image of images) {
            try {
                const url = new URL(image.url, baseURL).href;
                if (!references.has(url)) references.set(url, []);
                references.get(url).push(image);
            } catch {
                failures.push({ url: image.url, error: "Invalid image URL", references: [image] });
            }
        }
        const unique = [...references.keys()];
        for (let offset = 0; offset < unique.length; offset += concurrency) {
            const results = await page.evaluate(async ({ urls, timeout }) => Promise.all(urls.map(url => new Promise(resolve => {
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
            }))), { urls: unique.slice(offset, offset + concurrency), timeout });
            for (const result of results) {
                if (!result.error) continue;
                failures.push({ ...result, error: diagnostics.get(result.url) || result.error,
                    references: references.get(result.url) });
            }
            onProgress(Math.min(offset + concurrency, unique.length), unique.length);
        }
        return failures;
    } finally {
        await context.close();
    }
}

function reportFailure(profile, failure) {
    console.error(`\nFAIL [${profile}] ${failure.error}\n  URL: ${failure.url}`);
    for (const reference of failure.references) {
        const message = `${reference.location}: ${failure.error} — ${failure.url}`;
        console.error(`  ${reference.file}: ${reference.location}`);
        if (process.env.GITHUB_ACTIONS === "true") {
            const escape = value => value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/,/g, "%2C").replace(/:/g, "%3A");
            console.log(`::error file=${escape(reference.file)},title=Image failed (${profile})::${escape(message)}`);
        }
    }
}

async function runImageChecks({ root = ROOT, files = [], reportPath = path.join(ROOT, "image-check-report.json") } = {}) {
    const { createImageMaintenance } = require("../imageMaintenance");
    await createImageMaintenance({ directory: path.join(root, "CYOAs"), linksFile: path.join(root, "image-links.json") }).checkLinks();
    const images = readImages(files, root);
    const production = new URL(process.env.IMAGE_CHECK_PRODUCTION_URL || PRODUCTION_URL);
    if (production.protocol !== "https:") throw new Error("IMAGE_CHECK_PRODUCTION_URL must be an HTTPS player directory URL ending in /.");
    if (!production.pathname.endsWith("/")) throw new Error("IMAGE_CHECK_PRODUCTION_URL must end in /.");
    const { chromium } = require("playwright");
    const browser = await chromium.launch();
    let failures = 0;
    const summary = [];
    try {
        for (const [profile, baseURL] of [["localhost", "http://localhost:8000/"], ["production", production.href]]) {
            console.log(`Checking ${images.length} image references as ${profile} (${baseURL})...`);
            const results = await checkProfile(browser, images, { baseURL, assetRoot: root,
                onProgress: (done, total) => console.log(`[${profile}] ${done}/${total} unique URLs checked`) });
            for (const failure of results) {
                reportFailure(profile, failure);
                summary.push({ profile, ...failure });
            }
            failures += results.length;
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
        reportFailure("policy", failure);
        summary.push(failure);
        failures += 1;
    }
    fs.writeFileSync(reportPath, JSON.stringify({ references: images.length, failures: summary }, null, 2) + "\n");
    console.log(`\n${failures ? "FAILED" : "PASS"}: ${failures} image loading failure(s). Full report: ${reportPath}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Image loading checks\n\n${images.length} references checked under localhost and production origins. **${failures} failures.**\n\nSee error annotations and the image-check-report artifact for affected files and URLs.\n`);
    }
    if (failures) console.error("Repair connected versions with npm run images:repair, or open Repair Images Across Versions in the visual editor. Commit repaired files and image-links.json before pushing.");
    return { references: images.length, failures: summary };
}

if (require.main === module) runImageChecks({ files: process.argv.slice(2) }).then(result => {
    if (result.failures.length) process.exitCode = 1;
}).catch(error => {
    console.error(`IMAGE CHECK FAILED: ${error.message}\nInstall dependencies and Chromium first: npm install && npx playwright install chromium`);
    process.exitCode = 1;
});

module.exports = { collectImages, readImages, checkProfile, runImageChecks };
