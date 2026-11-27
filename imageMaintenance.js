const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { metadata, compareVersions } = require("./versioning");
const { validationMessage } = require("./imageUrlPolicy");
const { classifyFailure, readVerifications, evaluateResults, productionURL, pageURL } = require("./imageVerification");
const { withCyoaWriteLock } = require("./cyoaWriteLock");

const ROOT = __dirname;
const HEADER = "@header";
const slotKey = slot => `${slot.filename}\0${slot.id}`;

function imageSlots(document) {
    const slots = [];
    const ids = new Set();
    const add = (node, field, id, label) => {
        if (!node[field] || typeof node[field] !== "string") return;
        if (!id || ids.has(id)) throw new Error(`${document.filename}: missing or duplicate image option ID ${id || "(empty)"}.`);
        ids.add(id);
        slots.push({ filename: document.filename, file: `CYOAs/${document.filename}`, id, label,
            location: `${label} (${id})`, url: node[field].trim(), node, field, document });
    };
    const walk = entry => {
        if (entry.id) add(entry, entry.image ? "image" : "img", entry.id, entry.label || entry.id);
        for (const option of entry.options || []) walk(option);
        for (const subcategory of entry.subcategories || []) walk(subcategory);
    };
    for (const entry of document.data) {
        if (entry.type === "headerImage") add(entry, "url", HEADER, "Header image");
        walk(entry);
    }
    return slots;
}

function groupsFor(documents, configuration) {
    if (configuration.schemaVersion !== 1 || !Array.isArray(configuration.links)) throw new Error("image-links.json must contain schemaVersion: 1 and a links array.");
    const slots = documents.flatMap(imageSlots);
    const parent = new Map();
    const key = (series, id) => JSON.stringify([series, id]);
    const find = value => {
        if (!parent.has(value)) parent.set(value, value);
        if (parent.get(value) !== value) parent.set(value, find(parent.get(value)));
        return parent.get(value);
    };
    for (const link of configuration.links) {
        if (typeof link.seriesId !== "string" || !Array.isArray(link.ids) || link.ids.length < 2
            || link.ids.some(id => typeof id !== "string" || !id || id === HEADER)) throw new Error("Each image link needs a seriesId and at least two option IDs (headers connect automatically).");
        for (const id of link.ids) {
            if (!slots.some(slot => slot.document.seriesId === link.seriesId && slot.id === id)) {
                throw new Error(`Image link references a missing option: ${link.seriesId} / ${id}. Update image-links.json.`);
            }
            parent.set(find(key(link.seriesId, id)), find(key(link.seriesId, link.ids[0])));
        }
    }
    const groups = new Map();
    for (const slot of slots) {
        const group = find(key(slot.document.seriesId, slot.id));
        if (!groups.has(group)) groups.set(group, []);
        if (groups.get(group).some(existing => existing.filename === slot.filename)) {
            throw new Error(`Ambiguous image link in ${slot.filename}: two options in the same version would be connected. Correct image-links.json.`);
        }
        groups.get(group).push(slot);
    }
    return groups;
}

function preferredSource(left, right) {
    const version = document => document.release?.targetVersion || document.release?.version || document.release?.baseVersion || "1";
    return compareVersions(version(right.document), version(left.document))
        || Number(right.document.release?.status === "draft") - Number(left.document.release?.status === "draft")
        || left.filename.localeCompare(right.filename);
}

function planRepairs(documents, configuration, failedSlots, inconclusiveSlots = new Set()) {
    const changes = [];
    const unresolved = [];
    for (const slots of groupsFor(documents, configuration).values()) {
        const source = slots.filter(slot => !failedSlots.has(slotKey(slot))).sort(preferredSource)[0];
        for (const target of slots.filter(slot => failedSlots.has(slotKey(slot)) && !inconclusiveSlots.has(slotKey(slot)))) {
            if (source) changes.push({ target, source, url: source.url });
            else unresolved.push(target);
        }
    }
    return { changes, unresolved };
}

async function scanSlots(slots, onProgress = () => {}) {
    const { chromium } = require("playwright");
    const { checkProfile } = require("./scripts/check-images");
    const browser = await chromium.launch();
    const failures = [];
    try {
        const production = process.env.IMAGE_CHECK_PRODUCTION_URL || "https://intrisym.github.io/icyoa-template/";
        if (!production.startsWith("https://") || !production.endsWith("/")) throw new Error("IMAGE_CHECK_PRODUCTION_URL must be an HTTPS directory URL ending in /.");
        // Do not pass object pointers/cycles into reports or browser evaluation.
        const references = slots.map(({ filename, file, id, label, location, url }) => ({ filename, file, id, label, location, url }));
        for (const [profile, baseURL] of [["localhost", "http://localhost:8000/"], ["production", production]]) {
            const results = await checkProfile(browser, references, { baseURL,
                onProgress: (done, total) => onProgress(`${profile}: ${done}/${total}`) });
            failures.push(...results.map(failure => ({ profile, ...failure })));
        }
        // A blocked host is not eligible as an automatic replacement even if
        // it happens to be reachable on the machine running the repair.
        for (const reference of references) {
            const error = validationMessage(reference.url);
            if (error) failures.push({ profile: "policy", url: reference.url, error, references: [reference] });
        }
        return failures;
    } finally { await browser.close(); }
}

async function readDocuments(directory) {
    const documents = [];
    for (const filename of (await fs.readdir(directory)).filter(file => file.endsWith(".json") && file !== "manifest.json").sort()) {
        const original = await fs.readFile(path.join(directory, filename), "utf8");
        const data = JSON.parse(original);
        if (!Array.isArray(data)) throw new Error(`${filename}: CYOA must be an array.`);
        const release = metadata(data);
        documents.push({ filename, original, data, release, seriesId: release?.seriesId || filename });
    }
    return documents;
}

// Stage complete files, then check for edits made while the network scan ran.
// Never overwrite gameplay fields with a stale snapshot from a long scan.
async function commitFiles(changes) {
    const staged = [];
    const applied = [];
    try {
        for (const change of changes) {
            const temporary = `${change.file}.${randomUUID()}.tmp`;
            staged.push({ ...change, temporary });
            await fs.writeFile(temporary, change.body);
        }
        for (const change of staged) {
            const current = await fs.readFile(change.file, "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
            if (current !== change.original) throw new Error(`${path.basename(change.file)} changed during the scan. Nothing was applied; run the check again.`);
        }
        for (const change of staged) {
            await fs.rename(change.temporary, change.file);
            applied.push(change);
        }
    } catch (error) {
        for (const change of applied.reverse()) {
            if (await fs.readFile(change.file, "utf8") !== change.body) continue;
            if (change.original === null) await fs.unlink(change.file);
            else {
                await fs.writeFile(change.temporary, change.original);
                await fs.rename(change.temporary, change.file);
            }
        }
        throw error;
    } finally { await Promise.all(staged.map(change => fs.rm(change.temporary, { force: true }))); }
}

function createImageMaintenance({ directory = path.join(ROOT, "CYOAs"), linksFile = path.join(ROOT, "image-links.json"), scan = scanSlots } = {}) {
    async function load() {
        const documents = await readDocuments(directory);
        const linksOriginal = await fs.readFile(linksFile, "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
        const configuration = linksOriginal ? JSON.parse(linksOriginal) : { schemaVersion: 1, links: [] };
        groupsFor(documents, configuration);
        const verificationFile = path.join(path.dirname(linksFile), "image-verifications.json");
        const verificationOriginal = await fs.readFile(verificationFile, "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
        const registry = readVerifications(path.dirname(linksFile));
        return { documents, configuration, linksOriginal, verificationFile, verificationOriginal, registry };
    }
    const describe = slot => ({ file: slot.filename, id: slot.id, label: slot.label, url: slot.url });
    return {
        async inspect(filename) {
            const { documents, configuration } = await load();
            const selected = documents.find(document => document.filename === filename);
            if (!selected) throw new Error("CYOA not found.");
            const versions = documents.filter(document => document.seriesId === selected.seriesId);
            return { versions: versions.map(document => ({ file: document.filename, version: document.release?.version || document.release?.targetVersion || document.release?.baseVersion || "1", status: document.release?.status || "legacy", images: imageSlots(document).map(describe) })), links: configuration.links.filter(link => link.seriesId === selected.seriesId) };
        },
        async checkLinks() { const { documents, configuration } = await load(); return { files: documents.length, links: configuration.links.length }; },
        async repair({ file, action = "repair", id, sourceFile, sourceId, url, confirmed = false, dryRun = false, onProgress } = {}) {
            return withCyoaWriteLock(directory, async () => {
            const { documents, configuration, linksOriginal, verificationFile, verificationOriginal, registry } = await load();
            const selected = file && documents.find(document => document.filename === file);
            if (file && !selected) throw new Error("CYOA not found.");
            const scope = selected ? documents.filter(document => document.seriesId === selected.seriesId) : documents;
            const slots = scope.flatMap(imageSlots);
            const target = slots.find(slot => slot.filename === file && slot.id === id);
            const edits = [];
            if (action === "link") {
                const source = slots.find(slot => slot.filename === sourceFile && slot.id === sourceId);
                if (!target || !source) throw new Error("Select existing image option IDs in both versions.");
                if (target.document.seriesId !== source.document.seriesId) throw new Error("Images can only connect within the same CYOA series.");
                if (id === HEADER || sourceId === HEADER) throw new Error("Header images are already connected automatically.");
                if (id !== sourceId && !configuration.links.some(link => link.seriesId === selected.seriesId && link.ids.includes(id) && link.ids.includes(sourceId))) {
                    configuration.links.push({ seriesId: selected.seriesId, ids: [id, sourceId] });
                }
                groupsFor(documents, configuration);
            } else if (action === "replace") {
                if (!target || typeof url !== "string" || !url.trim()) throw new Error("Select an existing image and enter a replacement URL.");
                const error = validationMessage(url);
                if (error) throw new Error(error);
                target.node[target.field] = url.trim();
                edits.push({ file, id, before: target.url, url: url.trim(), sourceFile: "manual replacement" });
            } else if (action === "verify") {
                if (!target || confirmed !== true || url !== target.url) throw new Error("Confirm that this exact image URL loads on the live CYOA. If the URL changed, run the check again.");
                const error = validationMessage(target.url);
                if (error) throw new Error(error);
            } else if (action !== "repair") throw new Error("Unknown image maintenance action.");
            const currentSlots = scope.flatMap(imageSlots);
            const failures = await scan(currentSlots, onProgress);
            const failed = new Set(failures.flatMap(failure => failure.references.map(slotKey)));
            const inconclusive = new Set(failures.filter(failure => classifyFailure(failure) === "inconclusive").flatMap(failure => failure.references.map(slotKey)));
            const broken = new Set(failures.filter(failure => classifyFailure(failure) === "broken").flatMap(failure => failure.references.map(slotKey)));
            for (const key of broken) inconclusive.delete(key);
            if (action === "verify") {
                if (broken.has(slotKey(target))) throw new Error("This image has a confirmed failure or policy violation. Manual verification cannot override it.");
                if (inconclusive.has(slotKey(target))) {
                    registry.verifications = registry.verifications.filter(entry => entry.file !== file || entry.id !== id);
                    registry.verifications.push({ file, id, url: new URL(target.url, productionURL()).href,
                        pageUrl: pageURL(file), method: "manual", verifiedAt: new Date().toISOString() });
                }
            }
            if (action === "replace" && failed.has(slotKey(target))) throw new Error(broken.has(slotKey(target))
                ? "The replacement image failed loading checks. No files were changed."
                : "The replacement check was inconclusive, so this URL could not be verified automatically. No files were changed.");
            const evaluation = evaluateResults(failures, registry);
            const pendingVerification = new Set(evaluation.failures.filter(failure => failure.classification === "inconclusive")
                .flatMap(failure => failure.references.map(slotKey)).filter(key => !broken.has(key)));
            const plan = planRepairs(scope, { schemaVersion: 1, links: configuration.links.filter(link => scope.some(document => document.seriesId === link.seriesId)) }, failed, inconclusive);
            const unverified = currentSlots.filter(slot => pendingVerification.has(slotKey(slot)));
            for (const change of plan.changes) {
                edits.push({ file: change.target.filename, id: change.target.id, before: change.target.url, url: change.url, sourceFile: change.source.filename, sourceId: change.source.id });
                change.target.node[change.target.field] = change.url;
            }
            const pending = documents.filter(document => JSON.stringify(JSON.parse(document.original)) !== JSON.stringify(document.data))
                .map(document => ({ file: path.join(directory, document.filename), original: document.original, body: JSON.stringify(document.data, null, 2) + "\n" }));
            const linksBody = JSON.stringify(configuration, null, 2) + "\n";
            if (linksBody !== linksOriginal) pending.push({ file: linksFile, original: linksOriginal, body: linksBody });
            if (action === "verify") {
                const body = JSON.stringify(registry, null, 2) + "\n";
                if (body !== verificationOriginal && registry.verifications.length) pending.push({ file: verificationFile, original: verificationOriginal, body });
            }
            // Include unchanged documents in the concurrency guard: a source
            // edited during verification must invalidate the entire plan.
            for (const document of documents) {
                if (await fs.readFile(path.join(directory, document.filename), "utf8") !== document.original) throw new Error(`${document.filename} changed during the scan. Run it again.`);
            }
            if (!dryRun) await commitFiles(pending);
            const manual = [...new Map(evaluation.manualVerifications.filter(entry => !broken.has(slotKey(entry))).map(entry => [slotKey(entry), {
                file: entry.filename, id: entry.id, url: entry.url, pageUrl: entry.pageUrl, expiresAt: entry.expiresAt
            }])).values()];
            return { dryRun, edits, unresolved: [...plan.unresolved.map(describe), ...unverified.map(slot => ({ ...describe(slot),
                verificationRequired: true, pageUrl: pageURL(slot.filename) }))], failures: evaluation.failures, manualVerifications: manual,
                linked: action === "link" ? { id, sourceId } : null,
                message: `${action === "link" ? `Connection ${dryRun ? "proposed" : "saved"}. ` : ""}${dryRun ? "Proposed" : "Applied"} ${edits.length} image repair(s); ${plan.unresolved.length} image(s) need a URL or ID connection; ${unverified.length} need manual verification; ${manual.length} have current manual confirmations.` };
            });
        }
    };
}

module.exports = { HEADER, imageSlots, groupsFor, planRepairs, slotKey, createImageMaintenance };
