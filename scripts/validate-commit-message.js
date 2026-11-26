const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const SPECIFICATION = "https://www.conventionalcommits.org/en/v1.0.0/";
const footerPattern = /^([\p{L}\p{N}_-]+|BREAKING CHANGE)(: | #)(.*)$/u;

function validateMessage(message) {
    const errors = [];
    const lines = String(message).replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
    const header = lines[0];
    const parsed = header.match(/^([\p{L}][\p{L}\p{N}_-]*)(?:\(([^()\r\n]+)\))?(!)?: (\S.*)$/u);
    if (!parsed || parsed[2] && (parsed[2].trim() !== parsed[2] || !/[\p{L}\p{N}]/u.test(parsed[2]))) {
        errors.push("Use <type>[optional scope][!]: <description>, for example fix(versioning): archive completed drafts.");
    }
    if (lines.length > 1 && lines[1].trim()) errors.push("Separate the description from the body or footers with a blank line.");
    if (message.includes("\0")) errors.push("Commit messages cannot contain NUL characters.");
    let footer = null;
    const finishFooter = () => {
        if (footer && !footer.value.trim()) errors.push(`Footer ${footer.token} must have a non-empty value.`);
    };
    for (let index = 2; index < lines.length; index += 1) {
        const line = lines[index];
        const breaking = /^breaking[ -]change\b/i.test(line);
        if (breaking && !/^(BREAKING CHANGE|BREAKING-CHANGE): /.test(line)) {
            errors.push(`Line ${index + 1}: use uppercase BREAKING CHANGE: <description> or BREAKING-CHANGE: <description>.`);
        }
        const trailer = line.match(footerPattern);
        if (trailer && (footer || !lines[index - 1].trim())) {
            finishFooter();
            footer = { token: trailer[1], value: trailer[3] };
        } else if (footer) {
            footer.value += "\n" + line;
        } else if (breaking) {
            errors.push(`Line ${index + 1}: separate the breaking-change footer from the body with a blank line.`);
        }
    }
    finishFooter();
    return errors;
}

function git(args, options = {}) {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, ...options }).trimEnd();
}

function readMessageFile(filename) {
    const raw = fs.readFileSync(filename, "utf8");
    const configured = spawnSync("git", ["config", "--get", "commit.cleanup"], { encoding: "utf8" });
    const cleanup = configured.stdout.trim() || (process.env.GIT_EDITOR === ":" ? "whitespace" : "strip");
    if (cleanup === "verbatim") return raw;
    let message = raw;
    if (cleanup === "scissors") {
        const comment = spawnSync("git", ["config", "--get", "core.commentChar"], { encoding: "utf8" }).stdout.trim() || "#";
        const marker = `${comment} ------------------------ >8 ------------------------`;
        message = raw.split(marker)[0];
    }
    return git(["stripspace", ...(cleanup === "strip" ? ["--strip-comments"] : [])], { input: message });
}

function baseline() {
    const root = git(["rev-parse", "--show-toplevel"]);
    const config = JSON.parse(fs.readFileSync(path.join(root, ".commit-conventions.json"), "utf8"));
    if (!/^[a-f0-9]{40,64}$/i.test(config.baseline)) throw new Error("Invalid Conventional Commits baseline.");
    git(["cat-file", "-e", `${config.baseline}^{commit}`]);
    return config.baseline;
}

function collectCommits(tips, { exclude = [], noMerges = false } = {}) {
    if (!tips.length) return [];
    const output = git(["rev-list", "--reverse", ...(noMerges ? ["--no-merges"] : []), ...tips, "--not", baseline(), ...exclude]);
    return output ? output.split("\n") : [];
}

function commitTip(ref, optional = false) {
    const result = spawnSync("git", ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { encoding: "utf8" });
    if (result.status !== 0) {
        if (optional && spawnSync("git", ["cat-file", "-t", ref], { encoding: "utf8" }).status === 0) return null;
        throw new Error(`Cannot resolve commit ${ref}. Fetch the full history before validating commits.`);
    }
    return result.stdout.trim();
}

function commitsForPush(input) {
    const tips = [];
    for (const line of input.trim().split("\n")) {
        if (!line.trim()) continue;
        const fields = line.trim().split(/\s+/);
        if (fields.length !== 4 || !/^[a-f0-9]+$/i.test(fields[1])) throw new Error("Invalid pre-push reference input.");
        if (/^0+$/.test(fields[1])) continue;
        const tip = commitTip(fields[1], true);
        if (tip) tips.push(tip);
    }
    return collectCommits([...new Set(tips)]);
}

function eventTargets(event, eventName, sha) {
    if (eventName === "pull_request" || eventName === "pull_request_target") {
        return { title: event.pull_request.title, tips: [commitTip(event.pull_request.head.sha)] };
    }
    if (eventName === "merge_group") {
        return { tips: [commitTip(event.merge_group.head_sha)], exclude: [commitTip(event.merge_group.base_sha)], noMerges: true };
    }
    const ref = eventName === "push" ? event.after : sha || "HEAD";
    return { tips: !ref || /^0+$/.test(ref) ? [] : [commitTip(ref, eventName === "push")] };
}

function validateCommits(commits) {
    return commits.flatMap(commit => {
        const message = git(["show", "-s", "--format=%B", commit]);
        return validateMessage(message).map(error => ({ subject: `${commit.slice(0, 12)} ${message.split("\n")[0]}`, error }));
    });
}

function escapeCommand(value) {
    return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function report(issues, checked) {
    if (!issues.length) {
        console.log(`Conventional Commits passed (${checked}).`);
        return;
    }
    console.error(`CONVENTIONAL COMMITS FAILED: ${issues.length} issue(s)`);
    for (const issue of issues) {
        console.error(`\n${JSON.stringify(issue.subject)}\n  ${issue.error}`);
        if (process.env.GITHUB_ACTIONS === "true") console.log(`::error title=Conventional Commits::${escapeCommand(issue.subject + ": " + issue.error)}`);
    }
    console.error(`\nRequired format: <type>[optional scope][!]: <description>\nSpecification: ${SPECIFICATION}`);
    if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_STEP_SUMMARY) {
        const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\r\n]/g, " ");
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Conventional Commits errors\n\n"
            + issues.map(issue => `- <code>${escape(issue.subject)}</code>: ${escape(issue.error)}`).join("\n") + "\n");
    }
    process.exitCode = 1;
}

function main(args = process.argv.slice(2)) {
    let issues = [];
    let checked = "message";
    if (args[0] === "--file" && args.length === 2) {
        issues = validateMessage(readMessageFile(args[1])).map(error => ({ subject: "Commit message", error }));
    } else if (args[0] === "--pre-push" && args.length === 1) {
        const commits = commitsForPush(fs.readFileSync(0, "utf8"));
        checked = `${commits.length} commit(s)`;
        issues = validateCommits(commits);
    } else if (args[0] === "--range" && args.length === 2) {
        const commits = collectCommits([commitTip(args[1])]);
        checked = `${commits.length} commit(s)`;
        issues = validateCommits(commits);
    } else if (args[0] === "--event" && args.length === 1) {
        const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
        const targets = eventTargets(event, process.env.GITHUB_EVENT_NAME, process.env.GITHUB_SHA);
        const commits = collectCommits(targets.tips, targets);
        issues = validateCommits(commits);
        if (targets.title !== undefined) {
            const titleErrors = /[\r\n]/.test(targets.title) ? ["The pull request title must be a single Conventional Commits header."] : validateMessage(targets.title);
            issues.unshift(...titleErrors.map(error => ({ subject: "Pull request title", error })));
        }
        checked = `${commits.length} commit(s)${targets.title !== undefined ? " and PR title" : ""}`;
    } else {
        throw new Error("Usage: node scripts/validate-commit-message.js --file <message-file> | --range <ref> | --pre-push | --event");
    }
    report(issues, checked);
}

if (require.main === module) {
    try { main(); } catch (error) {
        console.error(`Conventional Commits check could not run: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { validateMessage, collectCommits, commitsForPush, eventTargets, validateCommits };
