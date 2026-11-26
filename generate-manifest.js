const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { spawnSync } = require("child_process");
const { createVersionStore } = require("./cyoaVersions");
const { describe } = require("./versioning");

function deployableFiles(directory, files) {
    if (!files.length) return files;
    const env = { ...process.env };
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"]) delete env[key];
    const options = { cwd: directory, env, encoding: "utf8" };
    const repository = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], options);
    if (repository.error?.code === "ENOENT" || /not a git repository/i.test(repository.stderr || "")) return files;
    if (repository.error) throw repository.error;
    if (repository.status !== 0) throw new Error(repository.stderr || "Could not inspect Git ignore rules.");
    if (repository.stdout.trim() !== "true") return files;
    const result = spawnSync("git", ["check-ignore", "--stdin", "-z"], { ...options, input: files.join("\0") + "\0" });
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr || "Could not inspect Git ignore rules.");
    const ignored = new Set(result.stdout.split("\0").filter(Boolean));
    return files.filter(filename => !ignored.has(filename));
}

async function generateManifest(directory = path.join(__dirname, "CYOAs")) {
    const files = (await fs.readdir(directory)).filter(filename => filename.endsWith(".json") && filename !== "manifest.json").sort();
    const store = createVersionStore(directory);
    const entries = await Promise.all(deployableFiles(directory, files).map(async filename => describe(filename, await store.read(filename))));
    const cyoas = entries.filter(entry => entry.status !== "draft");
    const temporary = path.join(directory, `.${randomUUID()}.manifest.tmp`);
    try {
        await fs.writeFile(temporary, JSON.stringify(cyoas, null, 2) + "\n");
        await fs.rename(temporary, path.join(directory, "manifest.json"));
    } finally {
        await fs.unlink(temporary).catch(error => {
            if (error.code !== "ENOENT") throw error;
        });
    }
    return cyoas;
}

if (require.main === module) {
    generateManifest().then(cyoas => {
        console.log(`Generated manifest with ${cyoas.length} playable CYOAs.`);
    }).catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { generateManifest };
