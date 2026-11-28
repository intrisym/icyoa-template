const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { runImageChecks } = require("./check-images");
const { reportPath } = require("./report-files");

function pushedCommits(input, cwd = process.cwd(), env = process.env) {
    const tips = new Set();
    for (const line of input.trim().split("\n")) {
        if (!line.trim()) continue;
        const fields = line.trim().split(/\s+/);
        if (fields.length !== 4 || !/^[a-f0-9]{40,64}$/i.test(fields[1])) throw new Error("Invalid pre-push ref input.");
        if (/^0+$/.test(fields[1])) continue;
        const result = spawnSync("git", ["rev-parse", "--verify", "--end-of-options", `${fields[1]}^{commit}`], { encoding: "utf8", cwd, env });
        if (result.status === 0) tips.add(result.stdout.trim());
        else if (spawnSync("git", ["cat-file", "-t", fields[1]], { encoding: "utf8", cwd, env }).status !== 0) throw new Error("Cannot resolve pushed object.");
    }
    return [...tips];
}

async function checkPushedImages(input, check = runImageChecks, { cwd = process.cwd(), env = process.env } = {}) {
    let failures = 0;
    for (const commit of pushedCommits(input, cwd, env)) {
        console.log(`Checking images in committed snapshot ${commit.slice(0, 12)} (including every CYOA version)...`);
        const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "cyoa-push-images-"));
        try {
            const archive = path.join(temporary, "snapshot.tar");
            const checkout = path.join(temporary, "checkout");
            await fsp.mkdir(checkout);
            const descriptor = fs.openSync(archive, "w");
            try { execFileSync("git", ["archive", "--format=tar", commit], { cwd, env, stdio: ["ignore", descriptor, "pipe"] }); }
            finally { fs.closeSync(descriptor); }
            execFileSync("tar", ["-xf", archive, "-C", checkout]);
            const result = await check({ root: checkout, reportPath: reportPath(cwd, `image-check-report-${commit.slice(0, 12)}.json`) });
            failures += result.failures.length;
        } finally { await fsp.rm(temporary, { recursive: true, force: true }); }
    }
    if (failures) throw new Error(`${failures} blocking image result(s) in pushed snapshots. Repair confirmed failures or commit recent manual verification for inconclusive images before pushing.`);
}

if (require.main === module) checkPushedImages(fs.readFileSync(0, "utf8")).catch(error => {
    console.error(`PUSH BLOCKED: ${error.message}`);
    process.exitCode = 1;
});
module.exports = { pushedCommits, checkPushedImages };
