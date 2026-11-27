const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { MAX_AGE_MS, classifyFailure, evaluateResults, pageURL, readVerifications } = require("../imageVerification");
const { createImageMaintenance } = require("../imageMaintenance");

const URL = "https://images.test/image.jpg";
const NOW = Date.parse("2026-11-26T12:00:00Z");
const reference = { file: "CYOAs/story.json", filename: "story.json", id: "city", location: "City" };
const failure = { url: URL, error: "net::ERR_BLOCKED_BY_ORB", profile: "production", references: [reference] };
const entry = { file: "story.json", id: "city", url: URL, pageUrl: pageURL("story.json"), method: "manual", verifiedAt: new Date(NOW - 1000).toISOString() };
const registry = value => ({ schemaVersion: 1, verifications: [value] });

test("ORB, restrictions, transient errors and inconsistent retries are inconclusive", () => {
    for (const item of [failure, { error: "HTTP 403" }, { error: "HTTP 429" }, { error: "HTTP 503" },
        { error: "net::ERR_NAME_NOT_RESOLVED" }, { error: "Timed out after 10000 ms" },
        { error: "HTTP 404", challenge: true }, { attempts: [{ error: "HTTP 404" }, { error: "HTTP 503" }] }]) {
        assert.equal(classifyFailure(item), "inconclusive", JSON.stringify(item));
    }
    assert.equal(classifyFailure({ error: "Invalid image URL" }), "broken");
    assert.equal(classifyFailure({ error: "HTTP 410" }), "broken");
    assert.equal(classifyFailure({ attempts: [{ error: "HTTP 404" }, { error: "HTTP 404" }] }), "broken");
});

test("current exact URL/option/page confirmations satisfy only inconclusive results and remain visible", () => {
    const result = evaluateResults([failure], registry(entry), { now: NOW });
    assert.equal(result.failures.length, 0);
    assert.equal(result.manualVerifications.length, 1);
    assert.equal(result.diagnostics[0].classification, "inconclusive");
    assert.equal(result.diagnostics[0].manuallyVerified, true);
    assert.equal(result.manualVerifications[0].expiresAt, new Date(Date.parse(entry.verifiedAt) + MAX_AGE_MS).toISOString());
    for (const change of [
        { url: URL + "?changed" }, { id: "differentOption" }, { file: "other.json" },
        { pageUrl: "https://example.com/" }, { verifiedAt: new Date(NOW - MAX_AGE_MS).toISOString() },
        { verifiedAt: new Date(NOW + 1000).toISOString() }
    ]) assert.equal(evaluateResults([failure], registry({ ...entry, ...change }), { now: NOW }).failures.length, 1, JSON.stringify(change));
    for (const change of [{ error: "HTTP 404" }, { profile: "policy", error: "Blocked image host" }]) {
        assert.equal(evaluateResults([{ ...failure, ...change }], registry(entry), { now: NOW }).failures.length, 1);
    }
});

test("a confirmation for one occurrence cannot cover another version using the same URL", () => {
    const other = { ...reference, file: "CYOAs/other.json", filename: "other.json" };
    const result = evaluateResults([{ ...failure, references: [reference, other] }], registry(entry), { now: NOW });
    assert.deepEqual(result.failures[0].references, [other]);
    assert.equal(result.diagnostics.length, 2);
    assert.deepEqual(result.diagnostics.find(item => item.manuallyVerified).references, [reference]);
});

async function maintenanceFixture(context, mode = "inconclusive") {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "manual-image-verification-"));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const directory = path.join(root, "CYOAs");
    await fs.mkdir(directory);
    const data = [{ name: "Locations", options: [{ id: "city", label: "City", image: URL, cost: { Points: 1 } }] }];
    await fs.writeFile(path.join(directory, "story.json"), JSON.stringify(data));
    // A working counterpart must never cause an inconclusive image to be replaced.
    await fs.writeFile(path.join(directory, "new.json"), JSON.stringify([
        { type: "publication", seriesId: "story.json", status: "published", version: "1.1" },
        { name: "Locations", options: [{ id: "city", label: "City", image: "https://images.test/new.jpg" }] }
    ]));
    const scan = async slots => slots.filter(slot => slot.filename === "story.json").map(slot => ({
        profile: "production", error: mode === "broken" ? "HTTP 404" : "net::ERR_BLOCKED_BY_ORB", url: slot.url,
        references: [{ filename: slot.filename, file: slot.file, id: slot.id }]
    }));
    return { root, directory, data, maintenance: createImageMaintenance({ directory, linksFile: path.join(root, "image-links.json"), scan }) };
}

test("inconclusive images are not replaced; recording confirmation requires explicit consent and exact URL", async context => {
    const { maintenance, root, directory, data } = await maintenanceFixture(context);
    const first = await maintenance.repair({ file: "story.json" });
    assert.equal(first.edits.length, 0);
    assert.equal(first.unresolved[0].verificationRequired, true);
    await assert.rejects(maintenance.repair({ action: "verify", file: "story.json", id: "city", url: URL }), /Confirm that this exact image/);
    await assert.rejects(maintenance.repair({ action: "verify", file: "story.json", id: "city", url: URL + "?changed", confirmed: true }), /If the URL changed/);
    const result = await maintenance.repair({ action: "verify", file: "story.json", id: "city", url: URL, confirmed: true });
    assert.equal(result.unresolved.length, 0);
    assert.equal(result.manualVerifications.length, 1);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "story.json"), "utf8")), data);
    assert.equal(readVerifications(root).verifications.length, 1);
    const next = await maintenance.repair({ file: "story.json" });
    assert.equal(next.edits.length, 0);
    assert.equal(next.unresolved.length, 0);
});

test("manual confirmations cannot override confirmed failures", async context => {
    const { maintenance } = await maintenanceFixture(context, "broken");
    await assert.rejects(maintenance.repair({ action: "verify", file: "story.json", id: "city", url: URL, confirmed: true }), /cannot override/);
});
