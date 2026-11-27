const test = require("node:test");
const assert = require("node:assert/strict");
const { validateImageUrl, testImageUrl, renderUrlSummary } = require("./test-image-url");

test("accepts direct image URLs and rejects invalid schemes, credentials and multiline input", () => {
    assert.equal(validateImageUrl(" https://cdn.imgchest.com/files/39c64342c3e9.jpg "), "https://cdn.imgchest.com/files/39c64342c3e9.jpg");
    for (const value of ["", "cdn.imgchest.com/image.jpg", "file:///etc/passwd", "javascript:alert(1)", "data:image/png;base64,abc", "https://user:secret@example.com/image.jpg", "https://example.com/image.jpg\n::error::injected"]) {
        assert.throws(() => validateImageUrl(value), undefined, value);
    }
});

test("tests only the supplied URL under both origins and requests actual remote resources", async () => {
    const calls = [];
    const report = await testImageUrl("https://cdn.imgchest.com/files/39c64342c3e9.jpg", {
        browser: {}, check: async (browser, images, options) => { calls.push({ images, options }); return []; }
    });
    assert.equal(report.status, "working");
    assert.equal(calls.length, 2);
    assert(calls.every(call => call.images.length === 1 && call.options.serveLocalAssets === false));
    assert.equal(calls[0].options.baseURL, "http://localhost:8000/");
    assert.equal(calls[1].options.baseURL, "https://intrisym.github.io/icyoa-template/");
});

test("inconclusive responses stay inconclusive and confirmed failures cannot pass", async () => {
    for (const [error, expected] of [["net::ERR_BLOCKED_BY_ORB", "inconclusive"], ["HTTP 404", "broken"]]) {
        const report = await testImageUrl("https://images.test/image.png", { browser: {}, check: async () => [{ error }] });
        assert.equal(report.status, expected);
        assert(report.results.every(result => result.status === expected));
    }
    const mixed = await testImageUrl("https://images.test/image.png", { browser: {},
        check: async (browser, images, options) => options.baseURL.startsWith("http:") ? [] : [{ error: "HTTP 403" }] });
    assert.equal(mixed.results[0].status, "working");
    assert.equal(mixed.results[1].status, "inconclusive");
    assert.equal(mixed.status, "inconclusive");
});

test("a successful download does not hide the project's domain policy", async () => {
    const report = await testImageUrl("https://wallpapercave.com/image.jpg", { browser: {}, check: async () => [] });
    assert.equal(report.status, "blocked by project policy");
    assert(report.results.every(result => result.status === "working"));
    assert.match(report.policyError, /Blocked image host/);
});

test("reports per-context results without unsafe Markdown, HTML or workflow-command interpolation", () => {
    const summary = renderUrlSummary({ url: 'https://images.test/image.jpg?x="<script>|`', status: "inconclusive",
        results: [{ context: "GitHub Pages embedding", status: "inconclusive", error: "HTTP 403\n::error::fake" }] });
    assert(summary.includes("| Context | Result | Details |"));
    assert(summary.includes("INCONCLUSIVE"));
    assert(!summary.includes("<script>"));
    assert(!summary.includes("\n::error::fake"));
    assert(summary.includes("&#124;"));
    assert(summary.includes("cdn.imgchest.com/files/"));
});

test("rejects invalid production origins before starting a browser", async () => {
    await assert.rejects(testImageUrl("https://images.test/image.jpg", { browser: {}, baseURL: "http://example.com/" }), /HTTPS player directory/);
});
