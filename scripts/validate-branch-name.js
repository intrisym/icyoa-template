const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

function validateBranchName(name) {
    if (name === "main" || name === "master") return [];
    if (typeof name === "string" && !name.toLowerCase().includes("codex")
        && /^[a-z][a-z0-9-]*\/[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(name)) return [];
    return ["Use <type>/<description> in lowercase, for example feat/image-url-validation or fix/editor-preview. Do not include codex. main and master are exempt."];
}

function branchForEvent(event, eventName, ref) {
    if (eventName === "pull_request" || eventName === "pull_request_target") return event.pull_request.head.ref;
    if (eventName === "create") return event.ref_type === "branch" ? event.ref : null;
    if (eventName === "merge_group" || event.deleted) return null;
    const branchRef = event.ref || ref;
    return branchRef?.startsWith("refs/heads/") ? branchRef.slice("refs/heads/".length) : null;
}

function main(args = process.argv.slice(2)) {
    let name;
    if (args.length === 1 && args[0] === "--event") {
        name = branchForEvent(JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")), process.env.GITHUB_EVENT_NAME, process.env.GITHUB_REF);
        if (name === null) return console.log("Branch naming: no contributor branch to check (tag, deletion, or merge queue).");
    } else if (args.length === 2 && args[0] === "--name") name = args[1];
    else if (!args.length) name = execFileSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { encoding: "utf8" }).trim();
    else throw new Error("Usage: node scripts/validate-branch-name.js [--event | --name <branch>]");
    const errors = validateBranchName(name);
    if (errors.length) {
        console.error(`BRANCH NAME FAILED: ${JSON.stringify(name)}\n${errors.join("\n")}`);
        if (process.env.GITHUB_ACTIONS === "true") console.log(`::error title=Invalid branch name::${errors.join(" ")}`);
        process.exitCode = 1;
    } else console.log(`Branch naming passed: ${name}`);
}

if (require.main === module) {
    try { main(); } catch (error) { console.error(`Branch name check could not run: ${error.message}`); process.exitCode = 1; }
}
module.exports = { validateBranchName, branchForEvent };
