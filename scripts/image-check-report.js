const { pageURL } = require("../imageVerification");

function escape(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/\|/g, "&#124;").replace(/`/g, "&#96;")
        .replace(/[\[\]*_]/g, character => `&#${character.charCodeAt(0)};`).replace(/[\r\n]/g, " ");
}

function imageLink(value) {
    try {
        const url = new URL(value);
        if (["http:", "https:"].includes(url.protocol)) return `<a href="${escape(url.href)}">${escape(url.hostname)}</a>`;
    } catch {}
    return `<code>${escape(value)}</code>`;
}

function renderImageSummary({ references = 0, diagnostics = [], failures = [], manualVerifications = [] }) {
    const rows = new Map();
    for (const diagnostic of diagnostics.length ? diagnostics : failures) {
        for (const reference of diagnostic.references) {
            const file = reference.file || `CYOAs/${reference.filename}`;
            const key = JSON.stringify([file, reference.id || reference.location, reference.url || diagnostic.url]);
            const level = diagnostic.manuallyVerified ? 2 : diagnostic.classification === "inconclusive" ? 1 : 0;
            if (!rows.has(key)) rows.set(key, { file, filename: reference.filename || file.replace(/^CYOAs\//, ""),
                title: reference.cyoaTitle, option: reference.label || (reference.id === "@header" ? "Header image" : reference.id || "Unnamed option"),
                id: reference.id || "—", url: diagnostic.url, level, errors: new Set() });
            const row = rows.get(key);
            if (diagnostic.profile === "production") row.url = diagnostic.url;
            row.level = Math.min(row.level, level);
            row.errors.add(`${diagnostic.profile || "check"}: ${diagnostic.error}`);
        }
    }
    const sorted = [...rows.values()].sort((a, b) => a.file.localeCompare(b.file) || a.option.localeCompare(b.option) || a.id.localeCompare(b.id));
    const broken = sorted.filter(row => row.level === 0);
    const unverified = sorted.filter(row => row.level === 1);
    const accepted = sorted.filter(row => row.level === 2);
    const lines = [broken.length || unverified.length ? "## Image loading checks failed" : "## Image loading checks passed", "",
        `${references} image references checked. **${broken.length} confirmed failures · ${unverified.length} need manual verification · ${accepted.length} manually accepted.**`, ""];
    function table(items) {
        lines.push("| CYOA | Option | ID | Problem | Image URL |", "| --- | --- | --- | --- | --- |");
        for (const row of items) {
            const cyoa = `<a href="${escape(pageURL(row.filename))}">${escape(row.title || row.filename)}</a><br><code>${escape(row.file)}</code>`;
            lines.push(`| ${cyoa} | ${escape(row.option)} | <code>${escape(row.id)}</code> | ${[...row.errors].map(escape).join("<br>")} | ${imageLink(row.url)} |`);
        }
        lines.push("");
    }
    if (broken.length) {
        lines.push("### Confirmed failures — fix these images", "", "Replace the image URL or connect the option to a working counterpart using **Repair Images Across Versions**.", "");
        table(broken);
    }
    if (unverified.length) {
        lines.push("### Inconclusive — manual verification required", "",
            "The checker could not establish availability. Open the linked CYOA, reload without cache, and check the exact image. Save a seven-day confirmation in the editor and commit `image-verifications.json`. These results do not prove the images are down.", "");
        table(unverified);
    }
    if (accepted.length) {
        lines.push("<details>", `<summary>Manually accepted images (${accepted.length}) — not blocking</summary>`, "",
            "Automated checks remain inconclusive. These images have current, exact-URL manual confirmations.", "");
        table(accepted);
        const dates = [...new Set(manualVerifications.map(entry => entry.expiresAt).filter(Boolean))].sort();
        if (dates.length) lines.push(`Earliest confirmation expiry: <code>${escape(dates[0])}</code>.`, "");
        lines.push("</details>", "");
    }
    if (broken.length || unverified.length) lines.push("After resolving the rows above, commit the repairs/confirmations and rerun `npm run test:images`. The downloadable **image-check-report** artifact contains the full diagnostics.", "");
    return lines.join("\n");
}

module.exports = { renderImageSummary };
