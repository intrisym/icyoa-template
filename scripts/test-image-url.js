const fs = require("node:fs");
const path = require("node:path");
const { checkProfile } = require("./check-images");
const { productionURL, classifyFailure } = require("../imageVerification");
const { validationMessage } = require("../imageUrlPolicy");

function validateImageUrl(value) {
    const text = String(value || "").trim();
    let url;
    try { url = new URL(text); } catch { throw new Error("Enter a complete http:// or https:// image URL."); }
    if (!text || /[\u0000-\u0020\u007f]/.test(text) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new Error("Use an HTTP(S) image URL without embedded credentials or whitespace.");
    }
    return url.href;
}

const escape = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/\|/g, "&#124;").replace(/`/g, "&#96;")
    .replace(/[\[\]*_]/g, character => `&#${character.charCodeAt(0)};`).replace(/[\r\n]/g, " ");

function renderUrlSummary(report) {
    const lines = ["## Single image URL test", "", `**Result: ${escape(report.status.toUpperCase())}**`, "",
        `URL: <code>${escape(report.url)}</code>`, "", "| Context | Result | Details |", "| --- | --- | --- |"];
    for (const result of report.results || []) {
        lines.push(`| ${escape(result.context)} | **${escape(result.status.toUpperCase())}** | ${escape(result.error || "Image loaded and decoded successfully.")} |`);
    }
    if (report.error) lines.push(`| Input | **INVALID** | ${escape(report.error)} |`);
    if (report.policyError) lines.push(`| Project domain policy | **BLOCKED** | ${escape(report.policyError)} |`);
    lines.push("", "The production test embeds the image under the supplied player origin, without deploying a page. A successful result confirms loading from this runner at test time. An inconclusive result (for example ORB, access restrictions or a timeout) does not establish that the image is down.", "",
        "Use a direct image URL, not a gallery or post page. ImgChest's individual image links typically use `https://cdn.imgchest.com/files/...`.", "");
    return lines.join("\n");
}

async function testImageUrl(value, { browser, check = checkProfile, baseURL = productionURL() } = {}) {
    const url = validateImageUrl(value);
    const base = new URL(baseURL);
    if (base.protocol !== "https:" || !base.pathname.endsWith("/") || base.search || base.hash || base.username || base.password) {
        throw new Error("The production URL must be an HTTPS player directory ending in /.");
    }
    let ownsBrowser = false;
    if (!browser) {
        browser = await require("playwright").chromium.launch();
        ownsBrowser = true;
    }
    const results = [];
    try {
        for (const [context, origin] of [["Localhost embedding", "http://localhost:8000/"], ["GitHub Pages embedding", base.href]]) {
            const failures = await check(browser, [{ file: "Supplied URL", id: "image", label: "Supplied image", location: "Image URL", url }], { baseURL: origin, serveLocalAssets: false });
            const failure = failures[0];
            results.push({ context, baseURL: origin, status: failure ? classifyFailure(failure) : "working",
                ...(failure ? { error: failure.error, attempts: failure.attempts } : {}) });
        }
    } finally { if (ownsBrowser) await browser.close(); }
    const policyError = validationMessage(url);
    const status = policyError ? "blocked by project policy" : results.some(result => result.status === "broken") ? "broken"
        : results.some(result => result.status === "inconclusive") ? "inconclusive" : "working";
    return { url, productionURL: base.href, status, results, ...(policyError ? { policyError } : {}) };
}

async function main() {
    const args = process.argv.slice(2);
    const value = args.length ? args[0] : process.env.IMAGE_TEST_URL || (process.env.IMAGE_TEST_URL_FILE ? fs.readFileSync(process.env.IMAGE_TEST_URL_FILE, "utf8") : "");
    let report;
    let url;
    try {
        if (args.length > 1) throw new Error("Pass one quoted image URL, or set IMAGE_TEST_URL.");
        url = validateImageUrl(value);
        report = await testImageUrl(url);
    } catch (error) {
        report = { url: url || "(invalid or missing image URL)", status: "unable to test", results: [], error: error.message };
    }
    fs.writeFileSync(path.resolve("image-url-test-report.json"), JSON.stringify(report, null, 2) + "\n");
    const summary = renderUrlSummary(report);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
    console.log(summary);
    if (report.status !== "working") process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(`Image URL test could not finish: ${error.message}`); process.exitCode = 1; });
module.exports = { validateImageUrl, testImageUrl, renderUrlSummary };
