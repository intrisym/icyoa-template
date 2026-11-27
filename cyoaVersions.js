const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { metadata, describe, normalizeVersion, compareVersions, nextVersion } = require("./versioning");
const { validateCyoaData } = require("./scripts/validate-cyoas");
const { withCyoaWriteLock } = require("./cyoaWriteLock");

function fail(status, message) {
    const error = new Error(message);
    error.status = status;
    throw error;
}

function createVersionStore(directory) {
    let pendingMutation = Promise.resolve();

    function filePath(filename) {
        if (typeof filename !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.json$/.test(filename)
            || filename === "manifest.json" || filename.includes("..")) {
            fail(400, "Invalid CYOA filename.");
        }
        return path.join(directory, filename);
    }

    async function read(filename) {
        try {
            const data = JSON.parse(await fs.readFile(filePath(filename), "utf8"));
            if (!Array.isArray(data)) fail(400, "CYOA must contain a JSON array.");
            return data;
        } catch (error) {
            if (error.code === "ENOENT") fail(404, "CYOA not found.");
            throw error;
        }
    }

    async function list(includeDrafts = false) {
        const filenames = (await fs.readdir(directory)).filter(filename => filename.endsWith(".json") && filename !== "manifest.json");
        const entries = await Promise.all(filenames.map(async filename => describe(filename, await read(filename))));
        return entries.filter(entry => includeDrafts || entry.status !== "draft");
    }

    function mutate(callback) {
        const result = pendingMutation.then(() => withCyoaWriteLock(directory, callback));
        pendingMutation = result.catch(() => {});
        return result;
    }

    async function write(filename, data, exclusive = false) {
        const destination = filePath(filename);
        const temporary = path.join(directory, `.${randomUUID()}.tmp`);
        try {
            await fs.writeFile(temporary, JSON.stringify(data, null, 2) + "\n");
            if (exclusive) await fs.link(temporary, destination);
            else await fs.rename(temporary, destination);
        } catch (error) {
            if (error.code === "EEXIST") fail(409, "That file or version already exists.");
            throw error;
        } finally {
            await fs.unlink(temporary).catch(() => {});
        }
    }

    function withMetadata(data, release) {
        return [...data.filter(entry => entry?.type !== "publication"), { type: "publication", ...release }];
    }

    async function archive(filename) {
        const trashDirectory = path.join(directory, ".trash");
        await fs.mkdir(trashDirectory, { recursive: true });
        const archivedFile = path.join(trashDirectory, `${Date.now()}-${randomUUID()}-${filename}`);
        await fs.rename(filePath(filename), archivedFile);
        return archivedFile;
    }

    async function assertLinksSurviveRemoval(filename) {
        const linksFile = path.join(path.dirname(directory), "image-links.json");
        const configuration = await fs.readFile(linksFile, "utf8").then(JSON.parse).catch(error => {
            if (error.code === "ENOENT") return { schemaVersion: 1, links: [] };
            throw error;
        });
        if (!configuration.links?.length) return;
        const { groupsFor } = require("./imageMaintenance");
        const documents = [];
        for (const entry of await list(true)) {
            if (entry.filename === filename) continue;
            const data = await read(entry.filename);
            documents.push({ filename: entry.filename, data, seriesId: metadata(data)?.seriesId || entry.filename });
        }
        try { groupsFor(documents, configuration); }
        catch (error) { fail(409, `Cannot remove this draft because saved image connections would become invalid. Update image-links.json first. ${error.message}`); }
    }

    return {
        read,
        list,
        maintainImages(task) {
            return mutate(task);
        },
        save(filename, data) {
            return mutate(async () => {
                if (!Array.isArray(data)) fail(400, "CYOA must contain a JSON array.");
                let existing = null;
                try { existing = await read(filename); } catch (error) {
                    if (error.status !== 404 || filename !== "temp-input.json") throw error;
                }
                const release = existing && metadata(existing);
                if (release?.status === "published") fail(409, "Published versions are read-only. Create a draft to make changes.");
                const saved = data.filter(entry => entry?.type !== "publication");
                if (release) saved.push(release);
                await write(filename, saved);
            });
        },
        create(filename, data) {
            return mutate(() => write(filename, withMetadata(data, {
                seriesId: filename,
                status: "draft",
                sourceFile: null,
                createdAt: new Date().toISOString()
            }), true));
        },
        createDraft(filename) {
            return mutate(async () => {
                let data = await read(filename);
                let release = metadata(data);
                if (!release) {
                    release = { seriesId: filename, status: "published", version: "0.1", publishedAt: new Date().toISOString() };
                    data = withMetadata(data, release);
                    await write(filename, data);
                }
                const draftFile = `${release.seriesId.replace(/\.json$/, "")}_draft_${randomUUID()}.json`;
                await write(draftFile, withMetadata(data, {
                    seriesId: release.seriesId,
                    status: "draft",
                    sourceFile: filename,
                    baseVersion: release.version || release.baseVersion || null,
                    createdAt: new Date().toISOString()
                }), true);
                return { filename: draftFile };
            });
        },
        publish(filename, requestedVersion, releaseNotes = "") {
            return mutate(async () => {
                const data = await read(filename);
                const release = metadata(data);
                if (release?.status !== "draft") fail(409, "Only drafts can be published.");
                const { errors } = validateCyoaData(filename, data);
                if (errors.length) fail(400, `Fix these issues before publishing: ${errors.join("; ")}`);
                let version;
                try { version = normalizeVersion(requestedVersion); } catch (error) { fail(400, error.message); }
                const versions = (await list()).filter(entry => entry.seriesId === release.seriesId && entry.version).map(entry => entry.version);
                if (versions.some(existing => compareVersions(existing, version) === 0)) fail(409, "That version is already published. Choose another number.");
                if (typeof releaseNotes !== "string" || releaseNotes.length > 10000) fail(400, "Release notes must be text up to 10,000 characters.");
                const publishedFile = `${release.seriesId.replace(/\.json$/, "")}_v${version.replace(/\./g, "_")}.json`;
                await fs.mkdir(path.join(directory, ".trash"), { recursive: true });
                await write(publishedFile, withMetadata(data, {
                    seriesId: release.seriesId,
                    status: "published",
                    version,
                    sourceFile: filename,
                    publishedAt: new Date().toISOString(),
                    releaseNotes
                }), true);
                try {
                    await assertLinksSurviveRemoval(filename);
                    await archive(filename);
                } catch (error) {
                    await fs.unlink(filePath(publishedFile));
                    throw error;
                }
                return { filename: publishedFile, version };
            });
        },
        async suggestedVersion(filename) {
            const data = await read(filename);
            const seriesId = metadata(data)?.seriesId || filename;
            const versions = (await list()).filter(entry => entry.seriesId === seriesId && entry.version).map(entry => entry.version);
            return nextVersion(versions);
        },
        remove(filename) {
            return mutate(async () => {
                const release = metadata(await read(filename));
                if (release?.status === "published") fail(409, "Published versions cannot be deleted from the editor.");
                await assertLinksSurviveRemoval(filename);
                await archive(filename);
            });
        }
    };
}

module.exports = { createVersionStore };
