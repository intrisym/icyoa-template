const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { validateCyoaData, validateCyoa } = require("./validate-cyoas");
const { buildDiagnostics, formatDiagnostics, renderSummary, reportGithub } = require("./validation-report");

const ROOT = path.join(__dirname, "..");

function fixture() {
    return [
        { type: "title", text: "Validation test" },
        { type: "points", values: { Points: 5 } },
        { name: "Weapons", subcategories: [{ name: "Physical", options: [
            { id: "speed", label: "Speed", cost: { Points: 1 } },
            { id: "upgrade", label: "Upgrade", prerequisites: "speed", conflictsWith: ["speed"] }
        ] }] }
    ];
}

function option(data) {
    return data[2].subcategories[0].options[1];
}

test("valid inputs pass and stale prerequisites and incompatibilities fail with their location", () => {
    const data = fixture();
    assert.deepEqual(validateCyoaData("test.json", data).errors, []);
    data[2].subcategories[0].options[0].id = "renamedSpeed";
    const errors = validateCyoaData("test.json", data).errors;
    assert(errors.some(error => error.includes("test.json: Weapons > Physical > option[1]") && error.includes(".prerequisites") && error.includes('"speed"')));
    assert(errors.some(error => error.includes(".conflictsWith") && error.includes('"speed"')));
});

test("nested prerequisite syntax and logical object shapes are validated", () => {
    for (const requirement of ["speed &&", { and: ["speed", "speed ||"] }, { unknown: "speed" }, 42, {}]) {
        const data = fixture();
        option(data).prerequisites = requirement;
        assert(validateCyoaData("test.json", data).errors.some(error => error.includes("prerequisites")));
    }
    const data = fixture();
    option(data).prerequisites = { and: ["speed", { not: "speed__2" }] };
    assert.deepEqual(validateCyoaData("test.json", data).errors, []);
});

test("incompatibilities reject objects, numbers, and blank array entries", () => {
    for (const conflicts of [{ id: "speed" }, 42, ["speed", ""], [null], [42]]) {
        const data = fixture();
        option(data).conflictsWith = conflicts;
        assert(validateCyoaData("test.json", data).errors.some(error => error.includes("conflictsWith")));
    }
});

test("malformed node shapes return actionable errors instead of crashing", () => {
    for (const data of [[null], [false], [{ name: "Category", options: {} }], [{ name: "Category", subcategories: [null] }]]) {
        assert(validateCyoaData("test.json", data).errors.length > 0);
    }
    const data = fixture();
    option(data).prerequisitesBySelection = "speed";
    assert(validateCyoaData("test.json", data).errors.some(error => error.includes("prerequisitesBySelection")));
    assert(validateCyoaData("test.json", [{ type: "points", values: null }]).errors.some(error => error.includes("values map")));
});

test("invalid costs, duplicate IDs, unknown currencies, groups, and selection limits fail", () => {
    const mutations = [
        data => { option(data).id = "speed"; },
        data => { option(data).cost = { Points: "invalid" }; },
        data => { option(data).cost = { UnknownCurrency: 1 }; },
        data => { option(data).prerequisites = 'group("missing")'; },
        data => { option(data).prerequisites = 'category("missing")'; },
        data => { option(data).maxSelections = "invalid"; },
        data => { data[2].maxSelections = 1.5; },
        data => { data[2].subcategories[0].defaultOptionMaxSelections = -1; }
    ];
    for (const mutate of mutations) {
        const data = fixture();
        mutate(data);
        assert(validateCyoaData("test.json", data).errors.length > 0);
    }
});

async function temporaryDirectory(context) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cyoa-checks-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    return directory;
}

test("invalid JSON is reported with a filename", async context => {
    const directory = await temporaryDirectory(context);
    const filename = path.join(directory, "invalid.json");
    await fs.writeFile(filename, "{broken JSON");
    const result = validateCyoa(path.relative(path.join(ROOT, "CYOAs"), filename));
    assert(result.errors.some(error => error.includes("invalid.json") && error.includes("invalid JSON")));
});

test("the shell runner works from another directory, runs every check, and returns failure", async context => {
    const directory = await temporaryDirectory(context);
    const log = path.join(directory, "checks.log");
    const npm = path.join(directory, "npm");
    await fs.writeFile(npm, '#!/bin/sh\nprintf "%s\\n" "$2" >> "$CHECK_LOG"\nif [ "$2" = "$FAIL_CHECK" ]; then\nif [ "${GITHUB_ACTIONS:-}" = true ]; then printf "::error file=CYOAs/test.json::Missing prerequisite speed\\n"; fi\nprintf "Missing prerequisite speed\\n"; exit 1; fi\nprintf "Verbose passing output\\n"\n', { mode: 0o755 });
    const env = { ...process.env, PATH: directory + path.delimiter + process.env.PATH, CHECK_LOG: log, FAIL_CHECK: "test:cyoas", GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "" };
    const result = spawnSync("sh", [path.join(ROOT, "scripts/check.sh")], { cwd: directory, env, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert(result.stderr.includes("Failed checks: test:cyoas"));
    const checks = (await fs.readFile(log, "utf8")).trim().split("\n");
    assert.deepEqual(checks, ["test:cyoas", "check:js", "test:validation", "test:functional", "test:versions", "test:ids"]);
    assert.equal(result.stderr.split("Missing prerequisite speed").length - 1, 2);
    assert(!result.stdout.includes("Verbose passing output"));
    assert(result.stdout.includes("PASS test:functional"));
    assert(result.stderr.includes("=== CYOA ERRORS TO FIX ==="));
    env.FAIL_CHECK = "none";
    assert.equal(spawnSync("sh", [path.join(ROOT, "scripts/check.sh")], { cwd: directory, env }).status, 0);
    env.FAIL_CHECK = "test:cyoas";
    env.GITHUB_ACTIONS = "true";
    const githubResult = spawnSync("sh", [path.join(ROOT, "scripts/check.sh")], { cwd: directory, env, encoding: "utf8" });
    assert.equal(githubResult.status, 1);
    assert(githubResult.stdout.includes("::group::Passed: test:functional (details)"));
    assert.equal(githubResult.stdout.split("::error file=").length - 1, 1);
    assert(!githubResult.stderr.includes("::error file="));
});

test("validation reports identify the option label, ID, field, and file with errors before warnings", () => {
    const data = fixture();
    option(data).prerequisites = "missingSpeed";
    const result = validateCyoaData("draft.json", data);
    result.warnings.push("draft.json: Example warning");
    const diagnostics = buildDiagnostics("draft.json", result, JSON.stringify(data));
    assert.equal(diagnostics[0].file, "CYOAs/draft.json");
    assert.equal(diagnostics[0].optionLabel, "Upgrade");
    assert.equal(diagnostics[0].optionId, "upgrade");
    assert.equal(diagnostics[0].field, "prerequisites");
    const output = formatDiagnostics(diagnostics);
    assert(output.startsWith("CYOA VALIDATION FAILED: 1 error(s)"));
    assert(output.includes("Option: Upgrade (upgrade)"));
    assert(output.includes("Field: prerequisites"));
    assert(output.indexOf("missingSpeed") < output.indexOf("Example warning"));
});

test("GitHub reports create file annotations and a job summary without unsafe command or Markdown interpolation", async context => {
    const directory = await temporaryDirectory(context);
    const summaryPath = path.join(directory, "summary.md");
    const annotations = [];
    const diagnostics = [{ level: "error", file: "CYOAs/a,b.json", optionLabel: "<Upgrade>|", field: "prerequisites",
        message: "Missing 50%\n::notice::injected" }];
    reportGithub(diagnostics, { summaryPath, write: value => annotations.push(value) });
    assert.equal(annotations.length, 1);
    assert(annotations[0].startsWith("::error file=CYOAs/a%2Cb.json,"));
    assert(annotations[0].includes("50%25%0A::notice::injected"));
    assert(!annotations[0].includes("\n"));
    const summary = await fs.readFile(summaryPath, "utf8");
    assert(summary.includes("## CYOA validation failed: 1 error(s)"));
    assert(summary.includes("&lt;Upgrade&gt;&#124;"));
    assert(summary.includes("| File | Option | Field | Problem |"));
    assert(!formatDiagnostics(diagnostics).includes("\n::notice::injected"));
    assert(renderSummary([]).includes("CYOA validation passed"));
});

test("file-level errors are still readable when JSON cannot be parsed", () => {
    const diagnostics = buildDiagnostics("broken.json", { errors: ["broken.json: invalid JSON"], warnings: [] }, "{broken");
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].file, "CYOAs/broken.json");
    assert(formatDiagnostics(diagnostics).includes("invalid JSON"));
    assert(renderSummary(diagnostics).includes("File-level issue"));
});

test("the configured pre-push hook checks every push and propagates the check result", async context => {
    const directory = await temporaryDirectory(context);
    await fs.mkdir(path.join(directory, "scripts"));
    await fs.writeFile(path.join(directory, "scripts/check.sh"), '#!/bin/sh\nprintf "checked\\n" >> "$CHECK_LOG"\nexit "${CHECK_EXIT:-1}"\n');
    await fs.writeFile(path.join(directory, "git"), '#!/bin/sh\nprintf "%s\\n" "$CHECK_REPO"\n', { mode: 0o755 });
    const log = path.join(directory, "hook.log");
    const env = { ...process.env, PATH: directory + path.delimiter + process.env.PATH, CHECK_REPO: directory, CHECK_LOG: log, CHECK_EXIT: "1" };
    const hook = path.join(ROOT, ".githooks/pre-push");
    const run = input => spawnSync("sh", [hook], { env, input, encoding: "utf8" });
    assert.equal(run("refs/heads/feature abc refs/heads/feature def\n").status, 1);
    assert.equal(run("refs/heads/main 000000 refs/heads/main def\n").status, 1);
    assert.equal(run("refs/heads/main abc refs/heads/main def\n").status, 1);
    assert.equal(run("refs/tags/v1 abc refs/tags/v1 def\n").status, 1);
    assert.equal((await fs.readFile(log, "utf8")).trim().split("\n").length, 4);
    env.CHECK_EXIT = "0";
    assert.equal(run("refs/heads/feature abc refs/heads/feature def\n").status, 0);
});
