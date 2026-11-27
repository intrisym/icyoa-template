const fs = require("node:fs/promises");
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");

const heldLocks = new AsyncLocalStorage();

// All application/CLI writers share this cross-process lock. Fail instead of
// queuing stale document bodies behind a long-running repair. Nested version
// store -> maintenance calls in the same operation may reuse the lock.
async function withCyoaWriteLock(directory, task) {
    const key = await fs.realpath(directory);
    if (heldLocks.getStore()?.has(key)) return task();
    const lock = path.join(key, ".write-lock");
    try { await fs.mkdir(lock); }
    catch (error) {
        if (error.code !== "EEXIST") throw error;
        const conflict = new Error("Another CYOA write or repair is in progress. Retry after it finishes. If a process crashed, stop all editor/CLI writers before removing CYOAs/.write-lock.");
        conflict.status = 409;
        throw conflict;
    }
    const scope = new Set([...(heldLocks.getStore() || []), key]);
    try {
        await fs.writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n");
        return await heldLocks.run(scope, task);
    } finally {
        scope.delete(key);
        await fs.rm(lock, { recursive: true, force: true });
    }
}

module.exports = { withCyoaWriteLock };
