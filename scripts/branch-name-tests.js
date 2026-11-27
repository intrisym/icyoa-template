const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { validateBranchName, branchForEvent } = require("./validate-branch-name");

test("branch convention accepts commit-style types and permanent branches", () => {
    for (const name of ["main", "master", "feat/image-url-validation", "fix/editor-preview", "ci/image-checks", "chore/update-checks", "custom/parser/tokens"]) {
        assert.deepEqual(validateBranchName(name), [], name);
    }
    for (const name of ["", "feature", "codex/feat/images", "feat/codex-images", "fix/old-codex-branch", "Feat/images", "feat/Images", "feat/image--urls", "feat/", "feat: images"]) {
        assert.equal(validateBranchName(name).length, 1, name);
    }
});

test("CI validates the PR source and branch events while ignoring tags, deletions and queue refs", () => {
    assert.equal(branchForEvent({ pull_request: { head: { ref: "feat/source" } } }, "pull_request", "refs/pull/2/merge"), "feat/source");
    assert.equal(branchForEvent({ ref: "refs/heads/fix/push" }, "push"), "fix/push");
    assert.equal(branchForEvent({ ref: "feat/new", ref_type: "branch" }, "create"), "feat/new");
    assert.equal(branchForEvent({ ref: "v1", ref_type: "tag" }, "create"), null);
    assert.equal(branchForEvent({ ref: "refs/tags/v1" }, "push"), null);
    assert.equal(branchForEvent({ ref: "refs/heads/legacy", deleted: true }, "push"), null);
    assert.equal(branchForEvent({}, "merge_group", "refs/heads/gh-readonly-queue/main/pr-1"), null);
});

test("CI command fails invalid source branches even with valid PR titles", async context => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "branch-names-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    const eventPath = path.join(directory, "event.json");
    for (const [name, expected] of [["feat/image-urls", 0], ["codex/image-urls", 1], ["image-urls", 1]]) {
        await fs.writeFile(eventPath, JSON.stringify({ pull_request: { title: "feat: valid title", head: { ref: name } } }));
        const result = spawnSync(process.execPath, [path.join(__dirname, "validate-branch-name.js"), "--event"], {
            encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: "pull_request" }
        });
        assert.equal(result.status, expected, result.stderr);
        if (expected) assert(result.stdout.includes("::error title=Invalid branch name::"));
    }
});
