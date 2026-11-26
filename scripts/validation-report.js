const fs = require("node:fs");

function buildDiagnostics(file, result, source = "") {
    const labels = new Map();
    try {
        const data = JSON.parse(source);
        const visit = node => {
            if (!node || typeof node !== "object") return;
            for (const option of Array.isArray(node.options) ? node.options : []) {
                if (option?.id) labels.set(option.id, option.label || option.id);
            }
            for (const child of Array.isArray(node.subcategories) ? node.subcategories : []) visit(child);
        };
        if (Array.isArray(data)) data.forEach(visit);
    } catch {}
    return ["error", "warning"].flatMap(level => (result[level === "error" ? "errors" : "warnings"] || []).map(message => {
        const owner = message.match(/\(([^()]+)\)\.([A-Za-z_][A-Za-z0-9_]*)/);
        return {
            level,
            file: `CYOAs/${file}`,
            optionId: owner?.[1] || "",
            optionLabel: labels.get(owner?.[1]) || "",
            field: owner?.[2] || "",
            message: message.startsWith(file + ": ") ? message.slice(file.length + 2) : message
        };
    }));
}

function formatDiagnostics(diagnostics) {
    const singleLine = value => String(value).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    const lines = [];
    for (const level of ["error", "warning"]) {
        const issues = diagnostics.filter(issue => issue.level === level);
        if (!issues.length) continue;
        lines.push(level === "error" ? `CYOA VALIDATION FAILED: ${issues.length} error(s)` : `CYOA validation warnings: ${issues.length}`);
        issues.forEach((issue, index) => {
            lines.push(`\n${index + 1}. File: ${singleLine(issue.file)}`);
            if (issue.optionLabel || issue.optionId) lines.push(`   Option: ${singleLine(issue.optionLabel || issue.optionId)}${issue.optionLabel && issue.optionId ? ` (${singleLine(issue.optionId)})` : ""}`);
            if (issue.field) lines.push(`   Field: ${singleLine(issue.field)}`);
            lines.push(`   ${level === "error" ? "Error" : "Warning"}: ${singleLine(issue.message)}`);
        });
    }
    if (diagnostics.some(issue => issue.level === "error")) lines.push("\nCorrect the listed fields, then rerun: sh scripts/check.sh");
    return lines.join("\n");
}

function escapeCommand(value, property = false) {
    const escaped = String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    return property ? escaped.replace(/:/g, "%3A").replace(/,/g, "%2C") : escaped;
}

function cell(value) {
    return "<code>" + String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\|/g, "&#124;").replace(/`/g, "&#96;").replace(/[\r\n]/g, " ") + "</code>";
}

function renderSummary(diagnostics) {
    const errors = diagnostics.filter(issue => issue.level === "error");
    const warnings = diagnostics.filter(issue => issue.level === "warning");
    const lines = [errors.length ? `## CYOA validation failed: ${errors.length} error(s)` : "## CYOA validation passed", ""];
    for (const issues of [errors, warnings]) {
        if (!issues.length) continue;
        lines.push(issues === errors ? "### Errors to fix" : "### Warnings", "", "| File | Option | Field | Problem |", "| --- | --- | --- | --- |");
        for (const issue of issues) lines.push(`| ${cell(issue.file)} | ${cell(issue.optionLabel || issue.optionId || "File-level issue")} | ${cell(issue.field || "—")} | ${cell(issue.message)} |`);
        lines.push("");
    }
    if (errors.length) lines.push("Correct the listed fields and rerun `sh scripts/check.sh` before pushing.", "");
    return lines.join("\n");
}

function reportGithub(diagnostics, { summaryPath = process.env.GITHUB_STEP_SUMMARY, write = console.log } = {}) {
    for (const issue of diagnostics) {
        const title = [issue.optionLabel || "CYOA validation", issue.field].filter(Boolean).join(" — ");
        write(`::${issue.level} file=${escapeCommand(issue.file, true)},title=${escapeCommand(title, true)}::${escapeCommand(issue.message)}`);
    }
    if (summaryPath) fs.appendFileSync(summaryPath, renderSummary(diagnostics) + "\n");
}

module.exports = { buildDiagnostics, formatDiagnostics, renderSummary, reportGithub };
