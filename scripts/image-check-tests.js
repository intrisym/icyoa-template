const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { collectImages, checkProfile } = require("./check-images");

test("collects header images and nested option image/img fields, ignoring ordinary links", () => {
    assert.deepEqual(collectImages([
        { type: "headerImage", url: " https://images.test/header.png " },
        { name: "Weapons", options: [{ id: "one", img: "one.png", url: "https://not-an-image.test" }],
            subcategories: [{ subcategories: [{ options: [{ id: "two", image: "two.png", img: "unused.png" }] }] }] }
    ], "CYOAs/test.json").map(image => [image.url, image.file]), [
        ["https://images.test/header.png", "CYOAs/test.json"],
        ["one.png", "CYOAs/test.json"], ["two.png", "CYOAs/test.json"]
    ]);
});

test("visual editor flags loaded and typed blocked URLs in header and option fields", async context => {
    const { chromium } = require("playwright");
    const browser = await chromium.launch();
    context.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const fixture = [
        { type: "title", text: "Image validation fixture" },
        { type: "headerImage", url: "https://wallpapercave.com/header.png" },
        { name: "Weapons", subcategories: [{ name: "Physical", options: [
            { id: "balance", label: "Balance", image: "https://cdn.wallpapercave.com/balance.png" }
        ] }] }
    ];
    const maintenanceRequests = [];
    await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== "https://editor.test") return route.abort();
        if (url.pathname === "/api/config") return route.fulfill({ json: fixture });
        if (url.pathname === "/api/cyoas") return route.fulfill({ json: [] });
        if (url.pathname === "/api/image-maintenance") {
            if (route.request().method() === "GET") return route.fulfill({ json: { versions: [
                { file: "old.json", version: "1", status: "published", images: [{ id: "oldBalance", label: "Balance", url: "https://images.test/bad.png" }] },
                { file: "fixture.json", version: "1.1", status: "published", images: [{ id: "balance", label: "Balance", url: "https://images.test/good.png" }] }
            ], links: [] } });
            const request = route.request().postDataJSON();
            maintenanceRequests.push(request);
            return route.fulfill({ json: request.action === "repair" ? {
                edits: [], unresolved: [{ file: "old.json", id: "oldBalance", label: "Balance" }],
                failures: [{ profile: "production", error: "HTTP 403", references: [{ filename: "old.json", id: "oldBalance" }] }], message: "1 image needs input."
            } : { edits: [{ file: "old.json", id: "oldBalance" }], unresolved: [], failures: [], message: "Applied 1 image repair." } });
        }
        if (url.pathname === "/index.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Preview fixture</title>" });
        try {
            const filename = path.join(__dirname, "..", url.pathname.slice(1));
            await fs.access(filename);
            await route.fulfill({ path: filename });
        } catch { await route.fulfill({ status: 404 }); }
    });
    await page.goto("https://editor.test/editor.html?cyoa=fixture.json");
    await page.waitForSelector("#globalHeaderInput[aria-invalid=true]");
    await page.locator("#expandAllBtn").click();
    const optionInput = page.locator(".option-body input[type=url]");
    await optionInput.waitFor();
    for (const input of [page.locator("#globalHeaderInput"), optionInput]) {
        assert.equal(await input.getAttribute("aria-invalid"), "true");
        assert.equal(await input.evaluate(node => node.validity.customError), true);
        assert.match(await input.evaluate(node => node.nextElementSibling.textContent), /Blocked image host: wallpapercave.com/);
        assert.equal(await input.evaluate(node => getComputedStyle(node).outlineStyle), "solid");
        await input.fill("https://example.com/replacement.png");
        assert.equal(await input.getAttribute("aria-invalid"), "false");
        assert.equal(await input.evaluate(node => node.nextElementSibling.hidden), true);
        await input.fill("https://wallpapercave.com/another.png");
        assert.equal(await input.getAttribute("aria-invalid"), "true");
        await input.fill("");
        assert.equal(await input.evaluate(node => node.validity.customError), false);
        assert.equal(await input.getAttribute("aria-invalid"), "false");
    }
    fixture.push({ type: "publication", status: "published", version: "1.1", seriesId: "fixture.json" });
    await page.reload();
    await page.waitForSelector("#editableContent[disabled]");
    await page.locator("#maintainImagesBtn").click();
    await page.waitForFunction(() => document.querySelector("#imageMaintenanceStatus").textContent.includes("connect automatically"));
    await page.locator("#scanRepairImagesBtn").click();
    await page.waitForFunction(() => document.querySelector("#imageMaintenanceStatus").textContent === "1 image needs input.");
    await page.locator("#imageMaintenanceResults button").click();
    assert.equal(await page.locator("#repairImageVersion").inputValue(), "old.json");
    assert.equal(await page.locator("#repairImageTarget").inputValue(), "oldBalance");
    await page.locator("#repairSourceVersion").selectOption("fixture.json");
    await page.locator("#repairSourceId").fill("balance");
    await page.locator("#linkVersionImageBtn").click();
    await page.waitForFunction(() => document.querySelector("#imageMaintenanceStatus").textContent === "Applied 1 image repair.");
    assert.equal(maintenanceRequests[1].action, "link");
    assert.equal(maintenanceRequests[1].file, "old.json");
    assert.equal(maintenanceRequests[1].sourceId, "balance");
    assert.equal(maintenanceRequests[1].id, "oldBalance");
    await page.locator("#repairImageVersion").selectOption("old.json");
    await page.locator("#repairImageUrl").fill("https://images.test/replacement.png");
    await page.locator("#replaceVersionImageBtn").click();
    await page.waitForFunction(() => !document.querySelector("#imageMaintenanceFields").disabled);
    assert.equal(maintenanceRequests[2].action, "replace");
    assert.equal(maintenanceRequests[2].url, "https://images.test/replacement.png");
    assert.equal(await page.locator("#globalHeaderInput").isDisabled(), true);
    assert.deepEqual(errors, []);
});

test("Chromium decodes images, catches blocking/404/HTML/timeouts, deduplicates URLs and sends production referrers", async context => {
    const requests = [];
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const { chromium } = require("playwright");
    const browser = await chromium.launch();
    context.after(() => browser.close());
    const originalNewContext = browser.newContext.bind(browser);
    const fixtureBrowser = { newContext: async options => {
        const browserContext = await originalNewContext(options);
        await browserContext.route("https://fixtures.test/**", async route => {
            const request = route.request();
            const pathname = new URL(request.url()).pathname;
            requests.push({ url: pathname, referer: request.headers().referer });
            if (pathname === "/timeout") return; // Deliberately leave the request pending.
            if (pathname === "/good.png") return route.fulfill({ contentType: "image/png", body: png });
            if (pathname === "/blocked") return route.fulfill({ status: 403 });
            if (pathname === "/html") return route.fulfill({ contentType: "text/html", body: "<h1>Access denied</h1>" });
            return route.fulfill({ status: 404 });
        });
        return browserContext;
    } };
    const url = "https://fixtures.test";
    const images = ["/good.png", "/good.png", "/blocked", "/missing", "/html", "/timeout"]
        .map((suffix, index) => ({ file: "CYOAs/test.json", location: `options[${index}]`, url: url + suffix }));
    const failures = await checkProfile(fixtureBrowser, images, { baseURL: "http://localhost:8000/", timeout: 1000 });
    assert.equal(failures.length, 4, JSON.stringify(failures));
    assert(failures.some(failure => failure.error === "HTTP 403"));
    assert(failures.some(failure => failure.error === "HTTP 404"));
    assert(failures.some(failure => failure.url.endsWith("/html")));
    assert(failures.some(failure => failure.error.includes("Timed out")));
    assert(requests.every(request => request.referer === "http://localhost:8000/"));
    assert.equal(requests.filter(request => request.url === "/good.png").length, 1);

    // Inspect the browser-generated Referer on an HTTPS request; supply only
    // the image response to make the production-origin assertion deterministic.
    const productionRequests = [];
    const wrappedBrowser = { newContext: async options => {
        const browserContext = await originalNewContext(options);
        await browserContext.route("https://images.test/**", async route => {
            const referrer = route.request().headers().referer;
            productionRequests.push(referrer);
            if (route.request().url().endsWith("/referrer.png") && referrer === "https://intrisym.github.io/") {
                return route.fulfill({ status: 403 });
            }
            await route.fulfill({ contentType: "image/png", body: png });
        });
        return browserContext;
    } };
    const referrerImage = { file: "CYOAs/test.json", location: "referrer-sensitive image", url: "https://images.test/referrer.png" };
    assert.deepEqual(await checkProfile(wrappedBrowser, [referrerImage], { baseURL: "http://localhost:8000/" }), []);
    const productionFailures = await checkProfile(wrappedBrowser, [
        { file: "CYOAs/test.json", location: "headerImage", url: "https://images.test/header.png" },
        { file: "CYOAs/test.json", location: "missing relative image", url: "missing-image-fixture.png" },
        { file: "CYOAs/test.json", location: "invalid URL", url: "https://" },
        referrerImage
    ], { baseURL: "https://intrisym.github.io/icyoa-template/" });
    assert.deepEqual(productionRequests, ["http://localhost:8000/", "https://intrisym.github.io/", "https://intrisym.github.io/"]);
    assert.equal(productionFailures.length, 3);
    assert(productionFailures.some(failure => failure.error === "HTTP 404" && failure.url.endsWith("/icyoa-template/missing-image-fixture.png")));
    assert(productionFailures.some(failure => failure.error === "Invalid image URL" && failure.references[0].location === "invalid URL"));
    assert(productionFailures.some(failure => failure.error === "HTTP 403" && failure.references[0] === referrerImage));
});
