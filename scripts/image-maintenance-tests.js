const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createImageMaintenance, slotKey } = require("../imageMaintenance");
const { checkPushedImages, pushedCommits } = require("./check-push-images");
const { readVerifications, evaluateResults, pageURL } = require("../imageVerification");

const GOOD = "https://images.test/good.png";
const BAD = "https://images.test/bad.png";

function data(version, options, seriesId = "story.json") {
    return [
        { type: "headerImage", url: GOOD },
        { name: "Weapons", subcategories: [{ name: "Physical", options }] },
        { type: "publication", seriesId, status: "published", version, releaseNotes: "Keep this release unchanged" }
    ];
}
const option = (id, image = GOOD) => ({ id, label: id, description: "Gameplay text", image, cost: { Weapons: 2 } });

async function fixture(context, files, scan) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "image-maintenance-"));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const directory = path.join(root, "CYOAs");
    const linksFile = path.join(root, "image-links.json");
    await fs.mkdir(directory);
    for (const [file, value] of Object.entries(files)) await fs.writeFile(path.join(directory, file), JSON.stringify(value, null, 2) + "\n");
    await fs.writeFile(linksFile, JSON.stringify({ schemaVersion: 1, links: [] }, null, 2) + "\n");
    const defaultScan = async slots => slots.filter(slot => slot.url === BAD).map(slot => ({
        profile: "production", url: slot.url, error: "HTTP 404", references: [{ filename: slot.filename, file: slot.file, id: slot.id }]
    }));
    const maintenance = createImageMaintenance({ directory, linksFile, scan: scan || defaultScan });
    const read = async file => JSON.parse(await fs.readFile(path.join(directory, file), "utf8"));
    return { root, directory, linksFile, maintenance, read };
}

test("repairs same-ID options, headers, and img aliases without touching gameplay or valid historical images", async context => {
    const old = data("1", [option("same", BAD), option("working", "https://images.test/old-art.png"), { id: "alias", img: BAD }]);
    old[0].url = BAD;
    const latest = data("1.1", [option("same"), option("working"), option("alias")]);
    const { maintenance, read } = await fixture(context, { "old.json": old, "new.json": latest });
    const result = await maintenance.repair({ file: "new.json" });
    assert.equal(result.edits.length, 3);
    assert.deepEqual(result.unresolved, []);
    const expected = structuredClone(old);
    expected[0].url = GOOD;
    expected[1].subcategories[0].options[0].image = GOOD;
    expected[1].subcategories[0].options[2].img = GOOD;
    assert.deepEqual(await read("old.json"), expected);
    assert.deepEqual(await read("new.json"), latest);
});

test("does not connect a renamed ID by label; saved ID connections repair it and survive later versions", async context => {
    const old = data("1", [option("oldBalance", BAD)]);
    const latest = data("1.1", [option("newBalance")]);
    latest[1].subcategories[0].options[0].label = "oldBalance";
    const { maintenance, read, linksFile, directory } = await fixture(context, { "old.json": old, "new.json": latest });
    assert.equal((await maintenance.repair({ file: "new.json" })).unresolved.length, 1);
    const result = await maintenance.repair({ action: "link", file: "old.json", id: "oldBalance", sourceFile: "new.json", sourceId: "newBalance" });
    assert.equal(result.edits.length, 1);
    assert.equal((await read("old.json"))[1].subcategories[0].options[0].image, GOOD);
    assert.deepEqual(JSON.parse(await fs.readFile(linksFile, "utf8")).links, [{ seriesId: "story.json", ids: ["oldBalance", "newBalance"] }]);
    await fs.writeFile(path.join(directory, "future.json"), JSON.stringify(data("1.2", [option("newBalance", BAD)])));
    assert.equal((await maintenance.repair({ file: "future.json" })).edits.length, 1);
});

test("deleted options require a manual URL, which is verified before writing", async context => {
    const old = data("1", [option("deleted", BAD)]);
    const { maintenance, read } = await fixture(context, { "old.json": old, "new.json": data("1.1", []) });
    assert.equal((await maintenance.repair({ file: "new.json" })).unresolved[0].id, "deleted");
    await assert.rejects(maintenance.repair({ action: "replace", file: "old.json", id: "deleted", url: BAD }), /replacement image failed/);
    assert.deepEqual(await read("old.json"), old);
    await assert.rejects(maintenance.repair({ action: "replace", file: "old.json", id: "deleted", url: "https://wallpapercave.com/a.png" }), /Blocked image host/);
    const result = await maintenance.repair({ action: "replace", file: "old.json", id: "deleted", url: GOOD });
    assert.equal(result.edits.length, 1);
    assert.equal(result.unresolved.length, 0);
});

test("never uses an unrelated series or guesses when links merge two options in one version", async context => {
    const { maintenance, read } = await fixture(context, {
        "old.json": data("1", [option("same", BAD)]),
        "unrelated.json": data("1.1", [option("same")], "other.json"),
        "new.json": data("1.1", [option("renamed"), option("same", BAD)])
    });
    const result = await maintenance.repair({ file: "old.json" });
    assert.equal(result.unresolved.length, 2);
    assert.equal(result.edits.length, 0);
    await assert.rejects(maintenance.repair({ action: "link", file: "old.json", id: "same", sourceFile: "new.json", sourceId: "renamed" }), /Ambiguous image link/);
    assert.equal((await read("old.json"))[1].subcategories[0].options[0].image, BAD);
});

test("dry runs do not write repairs; concurrent edits abort rather than overwrite", async context => {
    const old = data("1", [option("same", BAD)]);
    const { maintenance, read } = await fixture(context, { "old.json": old, "new.json": data("1.1", [option("same")]) });
    assert.equal((await maintenance.repair({ dryRun: true })).edits.length, 1);
    assert.deepEqual(await read("old.json"), old);
    let directory;
    const other = await fixture(context, { "old.json": old, "new.json": data("1.1", [option("same")]) }, async slots => {
        const changed = data("1", [option("same", BAD)]);
        changed[1].name = "Edited during scan";
        await fs.writeFile(path.join(directory, "old.json"), JSON.stringify(changed));
        return slots.filter(slot => slot.url === BAD).map(slot => ({ references: [{ filename: slot.filename, id: slot.id }] }));
    });
    directory = other.directory;
    await assert.rejects(other.maintenance.repair(), /changed during the scan/);
    assert.equal((await other.read("old.json"))[1].name, "Edited during scan");
});

test("stale saved links fail the offline check with the missing ID", async context => {
    const { maintenance, linksFile } = await fixture(context, { "old.json": data("1", [option("known")]) });
    await fs.writeFile(linksFile, JSON.stringify({ schemaVersion: 1, links: [{ seriesId: "story.json", ids: ["known", "gone"] }] }));
    await assert.rejects(maintenance.checkLinks(), /missing option: story.json \/ gone/);
});

test("push check scans the committed snapshot, deduplicates refs, and blocks real failures", async context => {
    const { root, directory } = await fixture(context, { "old.json": data("1", [option("same", BAD)]) });
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"]) delete env[key];
    const git = args => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: root, env, encoding: "utf8" }).trim();
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.name", "Image Test"]);
    git(["config", "user.email", "images@example.invalid"]);
    git(["add", "."]);
    git(["-c", "commit.gpgsign=false", "commit", "-qm", "test: snapshot fixture"]);
    const sha = git(["rev-parse", "HEAD"]);
    await fs.writeFile(path.join(directory, "old.json"), JSON.stringify(data("1", [option("same", GOOD)])));
    const refs = `refs/heads/main ${sha} refs/heads/main ${"0".repeat(40)}\nrefs/tags/v1 ${sha} refs/tags/v1 ${"0".repeat(40)}\n`;
    assert.deepEqual(pushedCommits(refs, root, env), [sha]);
    let calls = 0;
    let scannedRoot;
    await assert.rejects(checkPushedImages(refs, async ({ root: snapshot }) => {
        calls += 1;
        scannedRoot = snapshot;
        const content = JSON.parse(await fs.readFile(path.join(snapshot, "CYOAs/old.json"), "utf8"));
        assert.equal(content[1].subcategories[0].options[0].image, BAD);
        return { failures: [{ url: BAD }] };
    }, { cwd: root, env }), /blocking image result.*pushed snapshots/);
    assert.equal(calls, 1);
    await assert.rejects(fs.access(scannedRoot));
    const verificationFile = path.join(root, "image-verifications.json");
    await fs.writeFile(verificationFile, JSON.stringify({ schemaVersion: 1, verifications: [{
        file: "old.json", id: "same", url: BAD, pageUrl: pageURL("old.json"), method: "manual", verifiedAt: new Date().toISOString()
    }] }));
    const checker = async ({ root: snapshot }) => evaluateResults([{
        url: BAD, error: "net::ERR_BLOCKED_BY_ORB", profile: "production",
        references: [{ filename: "old.json", file: "CYOAs/old.json", id: "same" }]
    }], readVerifications(snapshot));
    await assert.rejects(checkPushedImages(refs, checker, { cwd: root, env }), /blocking image result/); // Uncommitted proof cannot pass.
    git(["add", "image-verifications.json"]);
    git(["-c", "commit.gpgsign=false", "commit", "-qm", "test: committed manual verification"]);
    const confirmed = git(["rev-parse", "HEAD"]);
    await checkPushedImages(`refs/heads/main ${confirmed} refs/heads/main ${sha}\n`, checker, { cwd: root, env });
    assert.deepEqual(pushedCommits(`refs/heads/old ${"0".repeat(40)} refs/heads/old ${sha}\n`, root, env), []);
    assert.equal(slotKey({ filename: "old.json", id: "same" }), "old.json\0same");
});
