const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { reportPath, resolveReportInput, migrateLegacyReports } = require('./report-files');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-report-files-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}
test('legacy reports move without changing the resumable export cache or application JSON', t => {
    const root = fixture(t);
    const content = JSON.stringify({ uploads: [{ source: 'old', url: 'new' }] });
    fs.writeFileSync(path.join(root, 'image-export-report.json'), content);
    fs.writeFileSync(path.join(root, 'image-check-report-a123.json'), '{}');
    fs.writeFileSync(path.join(root, 'image-links.json'), '{}');
    assert.equal(migrateLegacyReports(root).length, 2);
    assert.equal(fs.readFileSync(reportPath(root, 'image-export-report.json'), 'utf8'), content);
    assert.ok(fs.existsSync(path.join(root, 'image-links.json')));
    assert.equal(resolveReportInput(root, 'image-export-report.json'), reportPath(root, 'image-export-report.json'));
    assert.deepEqual(migrateLegacyReports(root), []);
});
test('conflicting reports and active exporters are never overwritten', t => {
    const root = fixture(t);
    fs.mkdirSync(path.join(root, 'reports'));
    fs.writeFileSync(path.join(root, 'image-export-report.json'), 'old');
    fs.writeFileSync(reportPath(root, 'image-export-report.json'), 'new');
    assert.throws(() => migrateLegacyReports(root), /different contents/);
    assert.equal(fs.readFileSync(path.join(root, 'image-export-report.json'), 'utf8'), 'old');
    assert.equal(fs.readFileSync(reportPath(root, 'image-export-report.json'), 'utf8'), 'new');
    fs.mkdirSync(path.join(root, '.image-export.lock'));
    assert.throws(() => migrateLegacyReports(root), /active/);
});
