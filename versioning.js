(function (root) {
    const VERSION_PATTERN = /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,2}$/;

    function normalizeVersion(value) {
        const version = String(value || "").trim().replace(/^v/i, "");
        if (!VERSION_PATTERN.test(version) || version.split(".").some(part => !Number.isSafeInteger(Number(part)))) {
            throw new Error("Enter a version such as 0.1, 1.3, or 1.2.1.");
        }
        return version;
    }

    function compareVersions(first, second) {
        const left = normalizeVersion(first).split(".").map(Number);
        const right = normalizeVersion(second).split(".").map(Number);
        for (let index = 0; index < 3; index += 1) {
            const difference = (left[index] || 0) - (right[index] || 0);
            if (difference) return difference;
        }
        return 0;
    }

    function nextVersion(versions) {
        if (!versions.length) return "0.1";
        const latest = [...versions].sort(compareVersions).pop().split(".").map(Number);
        if (latest.length === 1) latest.push(0);
        latest[latest.length - 1] += 1;
        return normalizeVersion(latest.join("."));
    }

    function metadata(data) {
        return data.find(entry => entry?.type === "publication") || null;
    }

    function describe(filename, data) {
        const release = metadata(data);
        return {
            filename,
            title: data.find(entry => entry?.type === "title")?.text || filename,
            seriesId: release?.seriesId || filename,
            status: release?.status || "legacy",
            version: release?.version || null,
            sourceFile: release?.sourceFile || null,
            baseVersion: release?.baseVersion || null,
            targetVersion: release?.targetVersion || null,
            releaseNotes: release?.releaseNotes || ""
        };
    }

    function groupEntries(entries, seriesId = null) {
        const groups = new Map();
        entries.forEach(entry => {
            const key = entry.seriesId || entry.filename;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(entry);
        });
        return Array.from(groups.values()).filter(group => !seriesId || (group[0].seriesId || group[0].filename) === seriesId);
    }

    function groupPublished(entries, seriesId = null) {
        return groupEntries(entries.filter(entry => entry.status !== "draft"), seriesId).map(group => group.sort((first, second) =>
            compareVersions(second.version || "0.1", first.version || "0.1")));
    }

    function groupForEditor(entries, seriesId = null) {
        return groupEntries(entries, seriesId).map(group => group.sort((first, second) => {
            const draftOrder = Number(second.status === "draft") - Number(first.status === "draft");
            if (draftOrder) return draftOrder;
            return compareVersions(second.targetVersion || second.version || second.baseVersion || "0.1",
                first.targetVersion || first.version || first.baseVersion || "0.1");
        }));
    }

    const api = { normalizeVersion, compareVersions, nextVersion, metadata, describe, groupPublished, groupForEditor };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.CyoaVersioning = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
