const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const url = require("url");
const { createVersionStore } = require("./cyoaVersions");
const { metadata } = require("./versioning");
const { createImageMaintenance } = require("./imageMaintenance");

const ROOT = __dirname;
const CYOAS_DIR = path.join(ROOT, "CYOAs");
const versionStore = createVersionStore(CYOAS_DIR);
const imageMaintenance = createImageMaintenance();
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_SIZE = 10 * 1024 * 1024; // Increased to 10MB for larger CYOAs

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf"
};

const NECROMANCER_SPELL_SCHOOL_SLUGS = new Map([
    ["Liber Mortis", "liberMortis"],
    ["Liber Animas", "liberAnimas"],
    ["Kroveri Hæma", "kroveriHma"],
    ["Promræn Caro", "promraenCaro"],
    ["Reunu Pertemru", "reunuPertemru"]
]);

function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
    });
    res.end(payload);
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
            body += chunk;
            if (body.length > MAX_BODY_SIZE) {
                reject(new Error("Payload too large"));
                req.destroy();
            }
        });
        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}

async function handleGetCyoas(req, res) {
    try {
        const includeDrafts = url.parse(req.url, true).query.editor === "1";
        const cyoas = await versionStore.list(includeDrafts);
        sendJson(res, 200, cyoas);
    } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
    }
}

async function validateFileParam(pathname) {
    if (!pathname) return null;
    const normalized = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    if (normalized.includes("..") || !normalized.endsWith(".json")) {
        return null;
    }
    const filePath = path.join(CYOAS_DIR, normalized);
    if (!filePath.startsWith(CYOAS_DIR)) {
        return null;
    }
    return filePath;
}

function stripGeneratedNecromancerTierPrereq(prereq) {
    if (!prereq || typeof prereq !== "string") return prereq;
    return prereq
        .replace(/\s*\(?\s*group\("[^"]+Tier[234]Spells"\)\s*>=\s*[234]\s*\)?\s*/g, "")
        .replace(/^\s*&&\s*|\s*&&\s*$/g, "")
        .replace(/\(\s*\)/g, "")
        .trim();
}

function mergeNecromancerPrereq(existing, generated) {
    const cleanExisting = stripGeneratedNecromancerTierPrereq(existing);
    if (!cleanExisting) return generated;
    if (cleanExisting === generated) return generated;
    return `(${cleanExisting}) && (${generated})`;
}

function pruneUndefinedJsonValues(value) {
    if (Array.isArray(value)) {
        value.forEach(pruneUndefinedJsonValues);
        return;
    }
    if (!value || typeof value !== "object") return;
    Object.keys(value).forEach(key => {
        if (value[key] === undefined) delete value[key];
        else pruneUndefinedJsonValues(value[key]);
    });
}

function applyNecromancerSpellRules(data, fileName = "") {
    if (path.basename(fileName) !== "necromancer.json" || !Array.isArray(data)) return data;

    const pointsEntry = data.find(entry => entry?.type === "points");
    const spells = data.find(entry => entry?.name === "Spells");
    if (!pointsEntry || !spells || !Array.isArray(spells.subcategories)) return data;

    const spellSchools = spells.subcategories.filter(subcat => subcat?.name !== "Points");
    const generatedGroups = [];
    const generatedGroupIds = new Set();
    const allTier1Ids = [];

    spellSchools.forEach(school => {
        const slug = NECROMANCER_SPELL_SCHOOL_SLUGS.get(school?.name);
        if (!slug || !Array.isArray(school.subcategories)) return;
        const tiers = new Map(school.subcategories.map(tier => [tier?.name, tier]));
        ["Tier 4", "Tier 3", "Tier 2", "Tier 1"].forEach(tierName => {
            const tier = tiers.get(tierName);
            if (!tier || !Array.isArray(tier.options)) return;
            const tierNumber = tierName.match(/\d+/)?.[0];
            const groupId = `${slug}Tier${tierNumber}Spells`;
            generatedGroupIds.add(groupId);
            generatedGroups.push({
                id: groupId,
                label: `${school.name} ${tierName} Spells`,
                optionIds: tier.options.map(option => option?.id).filter(Boolean)
            });
            if (tierName === "Tier 1") {
                allTier1Ids.push(...tier.options.map(option => option?.id).filter(Boolean));
            }
        });
    });

    pointsEntry.optionGroups = [
        ...(Array.isArray(pointsEntry.optionGroups)
            ? pointsEntry.optionGroups.filter(group => !generatedGroupIds.has(group?.id))
            : []),
        ...generatedGroups
    ];

    spellSchools.forEach(school => {
        const slug = NECROMANCER_SPELL_SCHOOL_SLUGS.get(school?.name);
        if (!slug || !Array.isArray(school.subcategories)) return;
        const tiers = new Map(school.subcategories.map(tier => [tier?.name, tier]));
        const tier4 = tiers.get("Tier 4");
        const tier3 = tiers.get("Tier 3");
        const tier2 = tiers.get("Tier 2");
        const tier1 = tiers.get("Tier 1");
        (tier4?.options || []).forEach(option => {
            option.prerequisites = stripGeneratedNecromancerTierPrereq(option.prerequisites) || undefined;
        });
        (tier3?.options || []).forEach(option => {
            option.prerequisites = mergeNecromancerPrereq(option.prerequisites, `group("${slug}Tier4Spells") >= 4`);
        });
        (tier2?.options || []).forEach(option => {
            option.prerequisites = mergeNecromancerPrereq(option.prerequisites, `group("${slug}Tier3Spells") >= 3`);
        });
        (tier1?.options || []).forEach(option => {
            option.prerequisites = mergeNecromancerPrereq(option.prerequisites, `group("${slug}Tier2Spells") >= 2`);
        });
    });

    const pointsSubcategory = spells.subcategories.find(subcat => subcat?.name === "Points");
    const motherPathId = "spellsPointsMotherSPath";
    const motherPath = (pointsSubcategory?.options || []).find(option => option?.id === motherPathId);
    if (motherPath) {
        motherPath.conflictsWith = Array.from(new Set(["spellsPointsNormalPath", ...allTier1Ids]));
    }
    spellSchools.forEach(school => {
        const tier1 = (school.subcategories || []).find(tier => tier?.name === "Tier 1");
        (tier1?.options || []).forEach(option => {
            option.conflictsWith = Array.from(new Set([motherPathId, ...allTier1Ids.filter(id => id !== option.id)]));
        });
    });

    pruneUndefinedJsonValues(data);
    return data;
}

async function handleGetConfig(req, res) {
    try {
        const parsedUrl = url.parse(req.url, true);
        const fileName = parsedUrl.query.file || "temp-input.json";
        const filePath = await validateFileParam(fileName);

        if (!filePath) {
            sendJson(res, 400, { ok: false, error: "Invalid file parameter." });
            return;
        }

        try {
            await fsp.access(filePath);
        } catch {
            sendJson(res, 404, { ok: false, error: "File not found." });
            return;
        }

        const data = await fsp.readFile(filePath, "utf8");
        res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
        });
        res.end(data);
    } catch (err) {
        sendJson(res, 500, {
            ok: false,
            error: err.message || String(err)
        });
    }
}

async function handlePutConfig(req, res) {
    try {
        const parsedUrl = url.parse(req.url, true);
        const fileName = parsedUrl.query.file || "temp-input.json";
        const filePath = await validateFileParam(fileName);

        if (!filePath) {
            sendJson(res, 400, { ok: false, error: "Invalid file parameter." });
            return;
        }

        const raw = await readRequestBody(req);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) {
            sendJson(res, 400, {
                ok: false,
                error: "Config must be a JSON array."
            });
            return;
        }
        const existing = await versionStore.read(fileName).catch(error => {
            if (error.status === 404) return null;
            throw error;
        });
        const normalized = applyNecromancerSpellRules(parsed, metadata(existing || [])?.seriesId || fileName);
        await versionStore.save(fileName, normalized);
        sendJson(res, 200, {
            ok: true
        });
    } catch (err) {
        const status = err.status || (err instanceof SyntaxError ? 400 : 500);
        sendJson(res, status, {
            ok: false,
            error: err.message || String(err)
        });
    }
}


async function handleCreateCyoa(req, res) {
    try {
        const raw = await readRequestBody(req);
        const { filename, title } = JSON.parse(raw);
        if (typeof filename !== "string" || !filename.endsWith(".json")) {
            return sendJson(res, 400, { ok: false, error: "Invalid filename" });
        }
        const template = [
            { "type": "title", "text": title || "New CYOA" },
            { "type": "description", "text": "A new adventure begins." },
            { "type": "points", "values": { "Points": 100 }, "allowNegative": [] },
            { "type": "settings", "themeMode": "toggle" },
            { "type": "backpack", "enabled": true }
        ];

        await versionStore.create(filename, template);
        sendJson(res, 201, { ok: true, filename });
    } catch (err) {
        sendJson(res, err.status || 500, { ok: false, error: err.message });
    }
}

async function handleDeleteCyoa(req, res) {
    try {
        const parsedUrl = url.parse(req.url, true);
        const fileName = parsedUrl.query.file;
        const filePath = await validateFileParam(fileName);

        if (!filePath) {
            return sendJson(res, 400, { ok: false, error: "Invalid file parameter." });
        }

        await versionStore.remove(fileName);

        sendJson(res, 200, { ok: true, trashed: true });
    } catch (err) {
        sendJson(res, err.status || 500, { ok: false, error: err.message });
    }
}

async function handleVersionAction(req, res, action) {
    try {
        const body = JSON.parse(await readRequestBody(req));
        const result = action === "draft"
            ? await versionStore.createDraft(body.file)
            : await versionStore.publish(body.file, body.version, body.releaseNotes);
        sendJson(res, 201, { ok: true, ...result });
    } catch (error) {
        sendJson(res, error.status || (error instanceof SyntaxError ? 400 : 500), { ok: false, error: error.message });
    }
}

async function serveStaticAsset(res, pathname) {
    try {
        let resourcePath = pathname;
        if (resourcePath === "" || resourcePath === "/") {
            resourcePath = "index.html";
        } else if (resourcePath.startsWith("/")) {
            resourcePath = resourcePath.slice(1);
        }

        resourcePath = path.normalize(resourcePath);
        if (resourcePath.includes("..")) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
        }

        let filePath = path.join(ROOT, resourcePath);
        const stat = await fsp.stat(filePath).catch(async (err) => {
            if (err.code === "ENOENT" && !path.extname(resourcePath)) {
                const withHtml = `${filePath}.html`;
                const htmlStat = await fsp.stat(withHtml).catch(() => null);
                if (htmlStat) {
                    filePath = withHtml;
                    return htmlStat;
                }
            }
            throw err;
        });

        if (stat && stat.isDirectory()) {
            filePath = path.join(filePath, "index.html");
        }

        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, {
            "Content-Type": mime
        });
        fs.createReadStream(filePath).pipe(res);
    } catch (err) {
        const status = err.code === "ENOENT" ? 404 : 500;
        res.writeHead(status, {
            "Content-Type": "text/plain; charset=utf-8"
        });
        res.end(status === 404 ? "Not found" : `Server error: ${err.message || err}`);
    }
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || "/");
    const pathname = parsedUrl.pathname || "/";

    if (pathname === "/api/image-maintenance" && (req.method === "GET" || req.method === "POST")) {
        try {
            const result = req.method === "GET"
                ? await imageMaintenance.inspect(url.parse(req.url, true).query.file)
                : await versionStore.maintainImages(async () => {
                    const body = JSON.parse(await readRequestBody(req));
                    if (!body.file) throw new Error("Select a CYOA first.");
                    return imageMaintenance.repair({ file: body.file, action: body.action, id: body.id,
                        sourceFile: body.sourceFile, sourceId: body.sourceId, url: body.url, confirmed: body.confirmed });
                });
            sendJson(res, 200, result);
        } catch (error) { sendJson(res, 400, { error: error.message }); }
        return;
    }

    if (req.method === "GET" && pathname === "/api/cyoas") {
        await handleGetCyoas(req, res);
        return;
    }

    if (req.method === "GET" && pathname === "/api/cyoas/next-version") {
        try {
            const file = url.parse(req.url, true).query.file;
            sendJson(res, 200, { version: await versionStore.suggestedVersion(file) });
        } catch (error) {
            sendJson(res, error.status || 500, { ok: false, error: error.message });
        }
        return;
    }

    if (req.method === "POST" && (pathname === "/api/cyoas/draft" || pathname === "/api/cyoas/publish")) {
        await handleVersionAction(req, res, pathname.endsWith("/draft") ? "draft" : "publish");
        return;
    }

    if (req.method === "GET" && pathname === "/api/config") {
        await handleGetConfig(req, res);
        return;
    }

    if (req.method === "PUT" && pathname === "/api/config") {
        await handlePutConfig(req, res);
        return;
    }

    if (req.method === "POST" && pathname === "/api/cyoas") {
        await handleCreateCyoa(req, res);
        return;
    }

    if (req.method === "DELETE" && pathname === "/api/cyoas") {
        await handleDeleteCyoa(req, res);
        return;
    }

    if (req.method === "GET") {
        await serveStaticAsset(res, pathname);
        return;
    }

    res.writeHead(405, {
        "Allow": "GET, PUT"
    });
    res.end("Method not allowed");
});

if (require.main === module) {
    server.listen(PORT, () => {
        const baseUrl = `http://localhost:${PORT}`;
        console.log(`View CYOA at ${baseUrl}/`);
        console.log(`Open the visual editor at ${baseUrl}/editor.html`);
    });
}

module.exports = {
    applyNecromancerSpellRules,
    server
};
