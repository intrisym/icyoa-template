const fs = require("node:fs");
const path = require("node:path");

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_PRODUCTION_URL = "https://intrisym.github.io/icyoa-template/";

function productionURL() {
    const url = new URL(process.env.IMAGE_CHECK_PRODUCTION_URL || DEFAULT_PRODUCTION_URL);
    if (url.protocol !== "https:" || !url.pathname.endsWith("/") || url.search || url.hash) throw new Error("IMAGE_CHECK_PRODUCTION_URL must be an HTTPS directory URL ending in /.");
    return url.href;
}

function filename(reference) { return reference.filename || reference.file.replace(/^CYOAs\//, ""); }

function pageURL(file, base = productionURL()) {
    const page = new URL(base);
    page.searchParams.set("cyoa", file);
    return page.href;
}

function classifyFailure(failure) {
    if (failure.classification) return failure.classification;
    if (failure.profile === "policy" || /^(Invalid|Unsupported) image URL/.test(failure.error)) return "broken";
    const attempts = failure.attempts || [failure];
    const definitelyFailed = attempt => {
        if (attempt.challenge || /ERR_BLOCKED_BY_|ORB|CORB/.test(attempt.error || "")) return false;
        const status = attempt.status || Number((attempt.error || "").match(/^HTTP (\d+)/)?.[1]);
        return status === 404 || status === 410 || (status === 200 && /^image\//.test(attempt.contentType || "") && /decode|decoded pixels/.test(attempt.error || ""));
    };
    return attempts.length && attempts.every(definitelyFailed) ? "broken" : "inconclusive";
}

function readVerifications(root) {
    const file = path.join(root, "image-verifications.json");
    let registry;
    try { registry = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return { schemaVersion: 1, verifications: [] }; throw error; }
    if (!registry || registry.schemaVersion !== 1 || !Array.isArray(registry.verifications)) throw new Error("image-verifications.json needs schemaVersion: 1 and a verifications array.");
    for (const entry of registry.verifications) {
        if (!entry || ![entry.file, entry.id, entry.url, entry.pageUrl, entry.verifiedAt].every(value => typeof value === "string" && value)
            || !Number.isFinite(Date.parse(entry.verifiedAt)) || entry.method !== "manual") throw new Error("Invalid manual verification in image-verifications.json.");
    }
    return registry;
}

function matchingVerification(reference, url, registry, { now = Date.now(), base = productionURL() } = {}) {
    return registry.verifications.find(entry => {
        const date = Date.parse(entry.verifiedAt);
        return entry.file === filename(reference) && entry.id === reference.id && entry.url === url
            && entry.pageUrl === pageURL(filename(reference), base) && entry.method === "manual"
            && date <= now && now - date < MAX_AGE_MS;
    });
}

function evaluateResults(results, registry, options = {}) {
    const failures = [];
    const manualVerifications = [];
    const diagnostics = [];
    for (const result of results) {
        const classification = classifyFailure(result);
        const remaining = [];
        const verifiedReferences = [];
        for (const reference of result.references) {
            const verification = classification === "inconclusive" && matchingVerification(reference, result.url, registry, options);
            if (verification) {
                verifiedReferences.push(reference);
                manualVerifications.push({ ...reference, url: result.url, pageUrl: verification.pageUrl,
                    verifiedAt: verification.verifiedAt, expiresAt: new Date(Date.parse(verification.verifiedAt) + MAX_AGE_MS).toISOString(), profile: result.profile });
            } else remaining.push(reference);
        }
        const diagnostic = { ...result, classification, manuallyVerified: false, references: remaining };
        if (remaining.length) { diagnostics.push(diagnostic); failures.push(diagnostic); }
        if (verifiedReferences.length) diagnostics.push({ ...result, classification, manuallyVerified: true, references: verifiedReferences });
    }
    return { failures, manualVerifications, diagnostics };
}

module.exports = { MAX_AGE_MS, productionURL, pageURL, classifyFailure, readVerifications, matchingVerification, evaluateResults };
