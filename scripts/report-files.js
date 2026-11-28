const fs = require('node:fs');
const path = require('node:path');

const legacyReport = /^image-(?:check-report(?:-[a-f0-9]+)?|export-report|rehosting-report|url-test-report)\.json$/;
const reportPath = (root, filename) => path.join(root, 'reports', filename);

function resolveReportInput(root, filename) {
    const supplied = path.resolve(root, filename);
    if (fs.existsSync(supplied) || path.isAbsolute(filename) || path.basename(filename) !== filename) return supplied;
    return reportPath(root, filename);
}

function migrateLegacyReports(root) {
    if (fs.existsSync(path.join(root, '.image-export.lock'))) throw new Error('Another local image export is active. Stop it before migrating reports.');
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    const moved = [];
    for (const filename of fs.readdirSync(root).filter(name => legacyReport.test(name))) {
        const source = path.join(root, filename);
        const target = reportPath(root, filename);
        try { fs.linkSync(source, target); }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            if (!fs.readFileSync(source).equals(fs.readFileSync(target))) throw new Error(`Both ${filename} and reports/${filename} exist with different contents. Resolve the conflict before exporting; neither was overwritten.`);
        }
        fs.unlinkSync(source);
        moved.push(filename);
    }
    return moved;
}

module.exports = { reportPath, resolveReportInput, migrateLegacyReports };
