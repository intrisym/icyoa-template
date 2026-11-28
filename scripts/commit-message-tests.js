const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { validateMessage } = require("./validate-commit-message");

const ROOT = path.join(__dirname, "..");
const VALIDATOR = path.join(__dirname, "validate-commit-message.js");

const validMessages = [
    "fix: correct prerequisites",
    "feat(editor): select a CYOA version",
    "feat!: replace the save format",
    "feat(api)!: replace the save format",
    "CUSTOM(Parser): support additional tokens",
    "maintenance: refresh fixtures",
    "fix(parser): " + "a".repeat(150),
    "fix: support defaults\n\nA free-form body.\nAnother line.\n\nAnother paragraph.",
    "feat: change defaults\n\nBREAKING CHANGE: configuration keys have changed",
    "feat: change defaults\n\nBREAKING-CHANGE: configuration keys have changed",
    "fix: correct defaults\n\nReviewed-by: Z\nRefs: #123",
    "fix: correct defaults\n\nRefs #123\nReviewed-by: Z",
    "fix: correct defaults\n\nRefs: #123\nAdditional details on another line.\nReviewed-by: Z",
    "revert: undo parser change\n\nRefs: abc123",
    "docs: explain the API\n\nOrdinary free-form body text: still allowed.",
    "fix: improve detection\n\nBreaking change detection now ignores quoted examples.",
    "fix: improve detection\n\nThe parser recognizes these tokens.\nBreaking change detection remains ordinary prose.",
    "fix: improve detection\n\nRefs: #123\nBreaking change detection is explained in this footer value.",
    "fix: normalize line endings\r\n\r\nDescription.\r\n"
];

for (const message of validMessages) test(`accepts ${JSON.stringify(message.split("\n")[0])}`, () => {
    assert.deepEqual(validateMessage(message), []);
});

const invalidMessages = [
    "", "Update things", "fix:no separating space", "fix: ", "fix:  description", "fix(): description",
    "fix( api ): description", "fix(!): description", "fix(api)!!: description", "fix(api):\tdescription",
    "fix: description\nBody without a blank line",
    "feat: change defaults\n\nbreaking change: keys changed",
    "feat: change defaults\n\nBreaking-Change: keys changed",
    "feat: change defaults\n\nBREAKING CHANGE: ",
    "feat: change defaults\n\nBREAKING CHANGE #123",
    "feat: change defaults\n\nBody.\nBREAKING CHANGE: keys changed",
    "fix: correct defaults\n\nRefs: \nReviewed-by: Z",
    "Merge branch 'feature'", 'Revert "old change"', "fixup! fix: correct defaults",
    "fix: bad\0message"
];

for (const message of invalidMessages) test(`rejects ${JSON.stringify(message.split("\n")[0])}`, () => {
    assert(validateMessage(message).length > 0);
});

async function repository(context) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "conventional-commits-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "" };
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"]) delete env[key];
    const git = args => {
        const result = spawnSync("git", args, { cwd: directory, env, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        return result.stdout.trim();
    };
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.name", "Hook Test"]);
    git(["config", "user.email", "hook@example.invalid"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["commit", "--allow-empty", "-m", "Legacy initial commit"]);
    const baseline = git(["rev-parse", "HEAD"]);
    await fs.mkdir(path.join(directory, "scripts"));
    await fs.mkdir(path.join(directory, ".githooks"));
    const validatorPath = path.join(directory, "scripts/validate-commit-message.js");
    const source = await fs.readFile(VALIDATOR, "utf8");
    const fixtureSource = source.replace(/const HISTORY_BASELINE = "[a-f0-9]+";/, `const HISTORY_BASELINE = "${baseline}";`);
    assert.notEqual(fixtureSource, source, "Fixture must use its own repository's baseline.");
    await fs.writeFile(validatorPath, fixtureSource);
    await fs.copyFile(path.join(ROOT, "scripts/validate-branch-name.js"), path.join(directory, "scripts/validate-branch-name.js"));
    await fs.copyFile(path.join(ROOT, ".githooks/commit-msg"), path.join(directory, ".githooks/commit-msg"));
    await fs.chmod(path.join(directory, ".githooks/commit-msg"), 0o755);
    git(["config", "core.hooksPath", ".githooks"]);
    const check = (args, { input, extraEnv = {} } = {}) => spawnSync(process.execPath, [validatorPath, ...args], {
        cwd: directory, env: { ...env, ...extraEnv }, input, encoding: "utf8"
    });
    return { directory, env, git, check, baseline };
}

test("the real commit-msg hook blocks invalid commits on newly created branches", async context => {
    const { directory, env, git } = await repository(context);
    git(["checkout", "-b", "feature/hook-test"]);
    const invalid = spawnSync("git", ["commit", "--allow-empty", "-m", "Not conventional"], { cwd: directory, env, encoding: "utf8" });
    assert.notEqual(invalid.status, 0);
    assert(invalid.stderr.includes("CONVENTIONAL COMMITS FAILED"));
    git(["commit", "--allow-empty", "-m", "fix(hooks): validate commits"]);
    assert.equal(git(["log", "-1", "--format=%s"]), "fix(hooks): validate commits");
});

test("Git comment cleanup is honored without treating actual committed body comments as templates", async context => {
    const { directory, env, git, check } = await repository(context);
    const filename = path.join(directory, "message.txt");
    await fs.writeFile(filename, "fix: validate comments\n# Git editor instructions\n");
    assert.equal(check(["--file", filename], { extraEnv: { GIT_EDITOR: "editor" } }).status, 0);
    const rawBody = spawnSync("git", ["commit", "--allow-empty", "-m", "fix: validate comments\n# Actual body without a blank line"], { cwd: directory, env, encoding: "utf8" });
    assert.notEqual(rawBody.status, 0);
    git(["config", "core.commentChar", ";"]);
    await fs.writeFile(filename, "fix: validate comments\n; Custom comment character\n");
    assert.equal(check(["--file", filename], { extraEnv: { GIT_EDITOR: "editor" } }).status, 0);
});

test("pre-push checks new branch commits and catches a bypassed commit-msg hook", async context => {
    const { git, check, baseline } = await repository(context);
    assert.equal(check(["--range", "HEAD"]).status, 0);
    git(["checkout", "-b", "feature/new-branch"]);
    git(["commit", "--allow-empty", "-m", "feat: add a feature"]);
    const valid = git(["rev-parse", "HEAD"]);
    assert.equal(check(["--pre-push"], { input: `refs/heads/feature ${valid} refs/heads/feat/example ${"0".repeat(40)}\n` }).status, 0);
    const badBranch = check(["--pre-push"], { input: `refs/heads/feat/example ${valid} refs/heads/codex/example ${"0".repeat(40)}\n` });
    assert.equal(badBranch.status, 1);
    assert(badBranch.stderr.includes("Invalid target branch"));
    git(["-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "Bypassed invalid message"]);
    const invalid = git(["rev-parse", "HEAD"]);
    const result = check(["--pre-push"], { input: `refs/heads/feature ${invalid} refs/heads/feat/example ${baseline}\nrefs/tags/v1 ${invalid} refs/tags/v1 ${"0".repeat(40)}\n` });
    assert.equal(result.status, 1);
    assert(result.stderr.includes("Bypassed invalid message"));
    assert.equal(check(["--pre-push"], { input: `refs/heads/feature ${"0".repeat(40)} refs/heads/feature ${invalid}\n` }).status, 0);
    assert.equal(check(["--pre-push"], { input: `refs/heads/feature ${"f".repeat(40)} refs/heads/feature ${baseline}\n` }).status, 1);
});

test("CI checks contributed commits without imposing a PR title format", async context => {
    const { directory, git, check } = await repository(context);
    git(["commit", "--allow-empty", "-m", "feat: add a feature"]);
    const sha = git(["rev-parse", "HEAD"]);
    const eventPath = path.join(directory, "event.json");
    const run = async title => {
        await fs.writeFile(eventPath, JSON.stringify({ action: "edited", pull_request: { title, head: { sha } } }));
        return check(["--event"], { extraEnv: { GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: "pull_request" } });
    };
    assert.equal((await run("feat(editor): select versions")).status, 0);
    const invalidTitle = await run("Add version selection");
    assert.equal(invalidTitle.status, 0);
    assert.equal((await run("feat: title\n\nBody is not allowed in a title")).status, 0);
    await fs.writeFile(eventPath, JSON.stringify({ after: sha }));
    assert.equal(check(["--event"], { extraEnv: { GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: "push" } }).status, 0);
    await fs.writeFile(eventPath, JSON.stringify({ ref: "feature/new-branch", ref_type: "branch" }));
    assert.equal(check(["--event"], { extraEnv: { GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: "create", GITHUB_SHA: sha } }).status, 0);
});

test("push and PR ranges exclude published history but reject newly introduced invalid messages", async context => {
    const { directory, git, check } = await repository(context);
    git(["-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "Already published merge message"]);
    const base = git(["rev-parse", "HEAD"]);
    git(["update-ref", "refs/remotes/upstream/main", base]);
    git(["update-ref", "refs/remotes/origin/main", base]);
    git(["commit", "--allow-empty", "-m", "fix: restore images"]);
    const eventPath = path.join(directory, "range-event.json");
    const run = async (name, event) => {
        await fs.writeFile(eventPath, JSON.stringify(event));
        return check(["--event"], { extraEnv: { GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: name } });
    };
    for (const valid of [true, false]) {
        if (!valid) git(["-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "New invalid message"]);
        const head = git(["rev-parse", "HEAD"]);
        const expected = valid ? 0 : 1;
        assert.equal(check(["--pre-push", "upstream"], { input: `refs/heads/main ${head} refs/heads/main ${base}\n` }).status, expected);
        assert.equal(check(["--pre-push", "upstream"], { input: `refs/heads/feature ${head} refs/heads/feat/example ${"0".repeat(40)}\n` }).status, expected);
        assert.equal((await run("push", { before: base, after: head })).status, expected);
        assert.equal((await run("push", { before: "0".repeat(40), after: head, repository: { default_branch: "main" } })).status, expected);
        assert.equal((await run("pull_request", { pull_request: { title: "Any title", base: { sha: base }, head: { sha: head } } })).status, expected);
    }
});

test("merge queue checks contributor commits without rejecting the synthetic merge message", async context => {
    const { directory, git, check } = await repository(context);
    git(["checkout", "-b", "feature/queued"]);
    git(["commit", "--allow-empty", "-m", "feat: queued feature"]);
    git(["checkout", "main"]);
    git(["commit", "--allow-empty", "-m", "fix: update main"]);
    const base = git(["rev-parse", "HEAD"]);
    git(["-c", "core.hooksPath=/dev/null", "merge", "--no-ff", "feature/queued", "-m", "Synthetic merge queue commit"]);
    const head = git(["rev-parse", "HEAD"]);
    const eventPath = path.join(directory, "merge-group.json");
    await fs.writeFile(eventPath, JSON.stringify({ merge_group: { base_sha: base, head_sha: head } }));
    assert.equal(check(["--event"], { extraEnv: { GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: "merge_group" } }).status, 0);
});
