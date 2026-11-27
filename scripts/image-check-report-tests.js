const test = require("node:test");
const assert = require("node:assert/strict");
const { collectImages } = require("./check-images");
const { renderImageSummary } = require("./image-check-report");

const reference = { file: "CYOAs/story_v1_0.json", cyoaTitle: "My Story", id: "city", label: "Futuristic City", location: "options[0]" };
const diagnostic = { classification: "broken", profile: "production", error: "HTTP 404", url: "https://images.test/city.jpg", references: [reference] };

test("image references carry human labels, IDs and CYOA titles for headers and nested options", () => {
    const images = collectImages([
        { type: "title", text: "My Story" },
        { type: "headerImage", url: "https://images.test/header.jpg" },
        { name: "Locations", subcategories: [{ subcategories: [{ options: [{ id: "city", label: "Futuristic City", image: diagnostic.url }] }] }] }
    ], reference.file);
    assert.deepEqual(images.map(({ label, id, cyoaTitle }) => ({ label, id, cyoaTitle })), [
        { label: "Header image", id: "@header", cyoaTitle: "My Story" },
        { label: "Futuristic City", id: "city", cyoaTitle: "My Story" }
    ]);
});

test("CI summary lists CYOA, option, ID, errors and image links, deduplicating profiles", () => {
    const summary = renderImageSummary({ references: 2, diagnostics: [diagnostic, { ...diagnostic, profile: "localhost" }] });
    assert(summary.startsWith("## Image loading checks failed"));
    assert(summary.includes("| CYOA | Option | ID | Problem | Image URL |"));
    assert(summary.includes("My Story"));
    assert(summary.includes("Futuristic City"));
    assert(summary.includes("<code>city</code>"));
    assert.equal(summary.match(/<code>city<\/code>/g).length, 1);
    assert(summary.includes("production: HTTP 404<br>localhost: HTTP 404"));
    assert(summary.includes("1 confirmed failures"));
    assert(summary.includes('href="https://images.test/city.jpg"'));
    assert(summary.includes("story&#95;v1&#95;0.json"));
});

test("errors appear before verification requests; accepted manual checks are collapsed and not blocking", () => {
    const unknown = { ...diagnostic, classification: "inconclusive", error: "net::ERR_BLOCKED_BY_ORB", references: [{ ...reference, id: "forest", label: "Forest" }] };
    const manual = { ...unknown, manuallyVerified: true, references: [{ ...reference, id: "header", label: "Header image" }] };
    const summary = renderImageSummary({ references: 3, diagnostics: [manual, unknown, diagnostic] });
    assert(summary.indexOf("### Confirmed failures") < summary.indexOf("### Inconclusive"));
    assert(summary.indexOf("### Inconclusive") < summary.indexOf("<details>"));
    assert(summary.includes("1 need manual verification"));
    assert(summary.includes("1 manually accepted"));
    assert(summary.includes("Manually accepted images (1) — not blocking"));
    assert(summary.includes("Save a seven-day confirmation"));
    const accepted = renderImageSummary({ diagnostics: [manual] });
    assert(accepted.startsWith("## Image loading checks passed"));
    assert(!accepted.includes("### Inconclusive"));
});

test("relative image paths combine local and production URLs into a single option row", () => {
    const references = [{ ...reference, url: "images/city.jpg" }];
    const summary = renderImageSummary({ diagnostics: [
        { ...diagnostic, references, profile: "localhost", url: "http://localhost:8000/images/city.jpg" },
        { ...diagnostic, references, profile: "production", url: "https://intrisym.github.io/icyoa-template/images/city.jpg" }
    ] });
    assert.equal(summary.match(/<code>city<\/code>/g).length, 1);
    assert(summary.includes('href="https://intrisym.github.io/icyoa-template/images/city.jpg"'));
    assert(summary.includes("1 confirmed failures"));
});

test("confirmed policy errors take precedence over another profile's inconclusive or manual result", () => {
    const summary = renderImageSummary({ diagnostics: [
        { ...diagnostic, classification: "inconclusive", manuallyVerified: true },
        { ...diagnostic, classification: "inconclusive", profile: "localhost" },
        { ...diagnostic, profile: "policy", error: "Blocked image host" }
    ] });
    assert(summary.includes("1 confirmed failures"));
    assert(summary.includes("0 need manual verification"));
    assert(summary.includes("0 manually accepted"));
    assert.equal(summary.match(/<code>city<\/code>/g).length, 1);
});

test("untrusted labels, IDs, filenames, errors and URLs cannot inject markup or break table rows", () => {
    const summary = renderImageSummary({ diagnostics: [{ ...diagnostic, url: "javascript:alert(1)",
        error: "<script>bad</script>|\n::error::fake", references: [{ ...reference,
            label: "[Click](https://evil.test) <b>Bad</b>|`", id: 'id|<img src=x>', cyoaTitle: 'Title"<bad>' }] }] });
    assert(!summary.includes("<script>"));
    assert(!summary.includes("<img src=x>"));
    assert(!summary.includes("\n::error::fake"));
    assert(!summary.includes("[Click](https://evil.test)"));
    assert(!summary.includes('href="javascript:'));
    assert(summary.includes("&#124;"));
    assert(summary.includes("&lt;script&gt;"));
});

test("successful checks show no error table and larger result sets list every affected option", () => {
    const success = renderImageSummary({ references: 12 });
    assert(success.startsWith("## Image loading checks passed"));
    assert(!success.includes("| CYOA |"));
    const summary = renderImageSummary({ diagnostics: Array.from({ length: 300 }, (_, index) => ({
        ...diagnostic, references: [{ ...reference, id: `option${index}`, label: `Option ${index}` }]
    })) });
    assert(summary.includes("300 confirmed failures"));
    for (let index = 0; index < 300; index += 1) assert(summary.includes(`<code>option${index}</code>`));
});
