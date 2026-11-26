const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createVersionStore } = require("../cyoaVersions");
const { metadata, compareVersions, nextVersion, normalizeVersion, groupPublished, groupForEditor } = require("../versioning");
const { generateManifest } = require("../generate-manifest");

function fixture() {
    return [
        { type: "title", text: "Test Adventure" },
        { type: "points", values: { Points: 5 } },
        { name: "Weapons", subcategories: [{ name: "Physical", options: [
            { id: "stableId", label: "Speed", cost: { Points: 1 } },
            { id: "dependent", label: "Upgrade", prerequisites: "stableId", cost: { Points: 2 } }
        ] }] }
    ];
}

async function setup(context) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cyoa-versions-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    return { directory, store: createVersionStore(directory) };
}

test("versions compare numerically and suggest increments without floating point arithmetic", () => {
    assert(compareVersions("1.10", "1.9") > 0);
    assert.equal(compareVersions("1", "1.0.0"), 0);
    assert.equal(nextVersion([]), "0.1");
    assert.equal(nextVersion(["1", "1.1", "1.2"]), "1.3");
    assert.equal(nextVersion(["1.9", "1.10"]), "1.11");
    assert.equal(nextVersion(["1.2.1"]), "1.2.2");
    assert.equal(normalizeVersion(" v2.0 "), "2.0");
    for (const version of ["", "1.01", "1.2.3.4", "../1", "NaN", "9007199254740992"]) {
        assert.throws(() => normalizeVersion(version));
    }
});

test("creating a draft preserves the original URL as immutable v0.1 and copies stable IDs", async context => {
    const { store, directory } = await setup(context);
    const original = fixture();
    await fs.writeFile(path.join(directory, "original.json"), JSON.stringify(original));
    const draft = await store.createDraft("original.json");
    const published = await store.read("original.json");
    assert.equal(metadata(published).version, "0.1");
    assert.equal(metadata(published).status, "published");
    assert.deepEqual(published.filter(entry => entry.type !== "publication"), original);
    assert.deepEqual((await store.read(draft.filename)).filter(entry => entry.type !== "publication"), original);
    assert.equal(metadata(await store.read(draft.filename)).baseVersion, "0.1");
    await assert.rejects(store.save("original.json", fixture()), { status: 409 });
    await assert.rejects(store.remove("original.json"), { status: 409 });
    assert.equal((await store.list()).length, 1);
    assert.equal((await store.list(true)).length, 2);
    assert.equal(await store.suggestedVersion(draft.filename), "0.2");
});

test("draft edits and publication do not alter older releases, and manual versions are supported", async context => {
    const { store } = await setup(context);
    await store.create("adventure.json", fixture());
    assert.equal(await store.suggestedVersion("adventure.json"), "0.1");
    const first = await store.publish("adventure.json", "0.1", "First release");
    const original = await store.read(first.filename);
    const draft = await store.createDraft(first.filename);
    const edited = await store.read(draft.filename);
    edited[0].text = "Updated Adventure";
    await store.save(draft.filename, edited);
    const second = await store.publish(draft.filename, "1.2", "New choices");
    assert.equal(metadata(await store.read(second.filename)).releaseNotes, "New choices");
    assert.deepEqual(await store.read(first.filename), original);
    await assert.rejects(store.read(draft.filename), { status: 404 });
    assert.equal(await store.suggestedVersion(second.filename), "1.3");
    const patchDraft = await store.createDraft(second.filename);
    const patch = await store.publish(patchDraft.filename, "1.2.1");
    assert.equal(patch.version, "1.2.1");
    const majorDraft = await store.createDraft(patch.filename);
    const major = await store.publish(majorDraft.filename, "2.0");
    assert.equal(major.version, "2.0");
    await assert.rejects(store.save(second.filename, fixture()), { status: 409 });
});

test("concurrent and equivalent version numbers cannot overwrite a release", async context => {
    const { store } = await setup(context);
    await store.create("adventure.json", fixture());
    const results = await Promise.allSettled([
        store.publish("adventure.json", "1"),
        store.publish("adventure.json", "1.0")
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.find(result => result.status === "rejected").reason.status, 404);
    const published = (await store.list())[0];
    const draft = await store.createDraft(published.filename);
    await assert.rejects(store.publish(draft.filename, "1.0.0"), { status: 409 });
    await assert.rejects(store.create(draft.filename, fixture()), { status: 409 });
});

test("autosave cannot change publication metadata or mark a draft as published", async context => {
    const { store } = await setup(context);
    await store.create("adventure.json", fixture());
    const before = metadata(await store.read("adventure.json"));
    await store.save("adventure.json", [...fixture(), { type: "publication", seriesId: "other.json", status: "published", version: "99" }]);
    assert.deepEqual(metadata(await store.read("adventure.json")), before);
    await store.save("adventure.json", fixture());
    assert.deepEqual(metadata(await store.read("adventure.json")), before);
});

test("player lists and static manifests exclude drafts and group releases numerically", async context => {
    const { store, directory } = await setup(context);
    await store.create("adventure.json", fixture());
    const first = await store.publish("adventure.json", "1.9");
    const draft = await store.createDraft(first.filename);
    await store.publish(draft.filename, "1.10");
    const manifest = await generateManifest(directory);
    assert.equal(manifest.length, 2);
    assert(manifest.every(entry => entry.status === "published"));
    const groups = groupPublished(await store.list(true));
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].map(entry => entry.version), ["1.10", "1.9"]);
    const saved = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
    assert.deepEqual(saved, manifest);
});

test("deployable manifests exclude Git-ignored local CYOAs before parsing them", async context => {
    const { directory } = await setup(context);
    const env = { ...process.env };
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"]) delete env[key];
    const initialized = spawnSync("git", ["init", "-q", directory], { env, encoding: "utf8" });
    assert.equal(initialized.status, 0, initialized.stderr);
    await fs.writeFile(path.join(directory, ".gitignore"), "private.json\n");
    await fs.writeFile(path.join(directory, "private.json"), "invalid ignored JSON");
    await fs.writeFile(path.join(directory, "public.json"), JSON.stringify(fixture()));
    const manifest = await generateManifest(directory);
    assert.deepEqual(manifest.map(entry => entry.filename), ["public.json"]);
});

test("manifest write failures preserve the previous manifest and remove temporary files", async context => {
    const { directory } = await setup(context);
    const filename = path.join(directory, "manifest.json");
    const previous = '[{"filename":"previous.json","title":"Previous release"}]\n';
    await fs.writeFile(filename, previous);
    await fs.writeFile(path.join(directory, "public.json"), JSON.stringify(fixture()));
    const writeFile = fs.writeFile;
    context.mock.method(fs, "writeFile", async (target, ...args) => {
        if (String(target).endsWith(".manifest.tmp")) {
            await writeFile(target, "partial JSON");
            throw new Error("Simulated manifest write failure");
        }
        return writeFile(target, ...args);
    });
    await assert.rejects(generateManifest(directory), /Simulated manifest write failure/);
    assert.equal(await fs.readFile(filename, "utf8"), previous);
    assert(!(await fs.readdir(directory)).some(entry => entry.endsWith(".manifest.tmp")));
});

test("manifest rename failures preserve the previous manifest and remove temporary files", async context => {
    const { directory } = await setup(context);
    const filename = path.join(directory, "manifest.json");
    const previous = '[{"filename":"previous.json","title":"Previous release"}]\n';
    await fs.writeFile(filename, previous);
    await fs.writeFile(path.join(directory, "public.json"), JSON.stringify(fixture()));
    context.mock.method(fs, "rename", async (source, destination) => {
        assert.equal(destination, filename);
        assert.equal(await fs.readFile(filename, "utf8"), previous);
        assert.equal(JSON.parse(await fs.readFile(source, "utf8"))[0].filename, "public.json");
        throw new Error("Simulated manifest rename failure");
    });
    await assert.rejects(generateManifest(directory), /Simulated manifest rename failure/);
    assert.equal(await fs.readFile(filename, "utf8"), previous);
    assert(!(await fs.readdir(directory)).some(entry => entry.endsWith(".manifest.tmp")));
});

test("invalid filenames and broken prerequisites are rejected before publishing", async context => {
    const { store } = await setup(context);
    for (const filename of ["../escape.json", "manifest.json", "nested/file.json", ".trash.json"]) {
        await assert.rejects(store.create(filename, fixture()), { status: 400 });
    }
    const invalid = fixture();
    invalid[2].subcategories[0].options[1].prerequisites = "missingId";
    await store.create("invalid.json", invalid);
    await assert.rejects(store.publish("invalid.json", "0.1"), /Fix these issues before publishing/);
    assert.equal((await store.list()).length, 0);
});

test("removing a draft leaves published releases available", async context => {
    const { store } = await setup(context);
    await store.create("adventure.json", fixture());
    const release = await store.publish("adventure.json", "0.1");
    const draft = await store.createDraft(release.filename);
    await store.remove(draft.filename);
    assert.equal(metadata(await store.read(release.filename)).status, "published");
    assert.equal((await store.list(true)).length, 1);
});

test("publishing archives the source draft and stale autosaves cannot recreate it", async context => {
    const { store, directory } = await setup(context);
    await store.create("adventure.json", fixture());
    const original = await store.read("adventure.json");
    const release = await store.publish("adventure.json", "1.1");
    assert.deepEqual((await store.list(true)).map(entry => entry.filename), [release.filename]);
    const archived = await fs.readdir(path.join(directory, ".trash"));
    assert.equal(archived.length, 1);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, ".trash", archived[0]), "utf8")), original);
    await assert.rejects(store.save("adventure.json", original), { status: 404 });
    await assert.rejects(store.read("adventure.json"), { status: 404 });
});

test("an archive failure leaves the draft available and does not leave a partial publication", async context => {
    const { store, directory } = await setup(context);
    await store.create("adventure.json", fixture());
    const original = await store.read("adventure.json");
    const rename = fs.rename;
    context.mock.method(fs, "rename", async (source, destination) => {
        if (source === path.join(directory, "adventure.json")) throw new Error("Cannot archive draft");
        return rename(source, destination);
    });
    await assert.rejects(store.publish("adventure.json", "1.1"), /Cannot archive draft/);
    assert.deepEqual(await store.read("adventure.json"), original);
    assert.equal((await store.list()).length, 0);
    await assert.rejects(store.read("adventure_v1_1.json"), { status: 404 });
});

test("the editor groups a v1.1 draft with its v1.0 release while preserving separate CYOAs", () => {
    const published = { filename: "adventure.json", title: "Adventure", seriesId: "adventure.json", status: "published", version: "1.0" };
    const draft = { filename: "adventure_draft_v1_1.json", title: "Adventure", seriesId: "adventure.json", status: "draft", baseVersion: "1.0", targetVersion: "1.1" };
    const other = { filename: "other.json", title: "Adventure", status: "legacy" };
    const groups = groupForEditor([published, draft, other]);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0], [draft, published]);
    assert.deepEqual(groups[1], [other]);
    assert.deepEqual(groupPublished([published, draft, other])[0], [published]);
    assert.deepEqual(groupForEditor([published, draft, other], "adventure.json"), [[draft, published]]);
    assert.deepEqual(groupPublished([published, draft, other], "adventure.json"), [[published]]);
    assert.deepEqual(groupPublished([published, draft, other], "missing.json"), []);
});
