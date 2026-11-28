const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { collectImages, checkProfile } = require("./check-images");

test("failed editor reload blocks stale writes until the repaired draft is reconciled", async context => {
    const browser = await require("playwright").chromium.launch();
    context.after(() => browser.close());
    const page = await browser.newPage();
    const before = "https://images.test/before.png";
    const after = "https://images.test/after.png";
    let data = [{ type: "title", text: "Reload fixture" }, { type: "headerImage", url: before },
        { type: "points", values: { Points: 5 } }, { name: "Choices", options: [] },
        { type: "publication", status: "draft", seriesId: "fixture.json" }];
    const writes = [];
    let checks = 0;
    let reloadsBlocked = false;
    let failReload = true;
    await page.route("**/*", async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== "https://editor.test") return route.abort();
        if (url.pathname === "/api/config") {
            if (request.method() === "PUT") {
                data = request.postDataJSON(); writes.push(data);
                return route.fulfill({ json: { ok: true } });
            }
            return reloadsBlocked && failReload ? route.fulfill({ status: 503 }) : route.fulfill({ json: data });
        }
        if (url.pathname === "/api/cyoas") return route.fulfill({ json: [] });
        if (url.pathname === "/api/image-maintenance") {
            if (request.method() === "GET") return route.fulfill({ json: { versions: [], links: [] } });
            checks++;
            data = structuredClone(data);
            data.find(entry => entry.type === "headerImage").url = after;
            reloadsBlocked = true;
            return route.fulfill({ json: { edits: [], failures: [], unresolved: [] } });
        }
        const filename = path.resolve(__dirname, "..", url.pathname.slice(1) || "index.html");
        try { return await route.fulfill({ path: filename }); }
        catch { return route.fulfill({ status: 404 }); }
    });
    await page.goto("https://editor.test/editor.html?cyoa=fixture.json");
    await page.waitForSelector("#globalHeaderInput");
    await page.locator("#maintainImagesBtn").click();
    await page.waitForFunction(() => document.querySelector("#imageMaintenanceStatus").textContent.includes("Draft writes remain blocked"));
    assert.equal(await page.locator("#globalHeaderInput").isDisabled(), true);
    const saved = writes.length;
    await page.locator("#scanRepairImagesBtn").click();
    await page.waitForFunction(() => document.querySelector("#imageMaintenanceStatus").textContent.includes("Reload failed"));
    assert.equal(writes.length, saved);
    assert.equal(checks, 1);
    failReload = false;
    await page.locator("#scanRepairImagesBtn").click();
    await page.waitForFunction(() => document.querySelector("#imageMaintenanceStatus").textContent === "All images are up to date.");
    assert.equal(writes.length, saved + 1);
    assert.equal(writes.at(-1).find(entry => entry.type === "headerImage").url, after);
    assert.equal(await page.locator("#globalHeaderInput").inputValue(), after);
    assert.equal(await page.locator("#globalHeaderInput").isDisabled(), false);
});

test("checkout interception respects the deployment-directory boundary", async context => {
    const root = await fs.mkdtemp(path.join(require("node:os").tmpdir(), "image-assets-"));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    await fs.mkdir(path.join(root, "images"));
    await fs.writeFile(path.join(root, "images/local.png"), png);
    const browser = await require("playwright").chromium.launch();
    context.after(() => browser.close());
    const remote = [];
    const wrapped = { newContext: async options => {
        const session = await browser.newContext(options);
        await session.route("https://assets.test/**", route => {
            const pathname = new URL(route.request().url()).pathname;
            remote.push(pathname);
            return pathname.includes("missing") || pathname.startsWith("/project/")
                ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: "image/png", body: png });
        });
        return session;
    } };
    const images = ["images/local.png", "/shared/banner.png", "/projectile/banner.png", "/shared/missing.png"]
        .map(url => ({ file: "CYOAs/example.json", id: url, url }));
    const failures = await checkProfile(wrapped, images, { baseURL: "https://assets.test/project/", assetRoot: root });
    assert.equal(failures.length, 1);
    assert.equal(failures[0].url, "https://assets.test/shared/missing.png");
    assert.equal(failures[0].classification, "broken");
    assert.ok(remote.includes("/shared/banner.png"));
    assert.ok(remote.includes("/projectile/banner.png"));
    assert.ok(!remote.includes("/project/images/local.png"));
});

test("redirected failures retain terminal diagnostics under the initiating URL", async context => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const server = require("node:http").createServer((request, response) => {
        if (request.url.startsWith("/redirect/")) {
            response.writeHead(302, { Location: request.url.replace("/redirect/", "/terminal/"), "Cache-Control": "no-store" });
            response.end();
        } else if (request.url === "/terminal/good") {
            response.writeHead(200, { "Content-Type": "image/png" }); response.end(png);
        } else { response.writeHead(404, { "Cache-Control": "no-store" }); response.end(); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    context.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await require("playwright").chromium.launch();
    context.after(() => browser.close());
    const origin = `http://127.0.0.1:${server.address().port}`;
    const failures = await checkProfile(browser, ["good", "missing"].map(id => ({ id, file: "CYOAs/test.json", url: `${origin}/redirect/${id}` })),
        { baseURL: origin + "/", serveLocalAssets: false });
    assert.equal(failures.length, 1, JSON.stringify(failures));
    assert.equal(failures[0].url, `${origin}/redirect/missing`);
    assert.equal(failures[0].classification, "broken");
    assert.deepEqual(failures[0].attempts.map(attempt => attempt.status), [404, 404]);
});

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
    let headerScenario = false;
    let verificationScenario = false;
    let manuallyConfirmed = false;
    await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== "https://editor.test") return route.abort();
        if (url.pathname === "/api/config") return route.fulfill({ json: fixture });
        if (url.pathname === "/api/cyoas") return route.fulfill({ json: [] });
        if (url.pathname === "/api/image-maintenance") {
            if (route.request().method() === "GET") return route.fulfill({ json: { versions: [
                { file: "old.json", version: "1", status: "published", images: [
                    { id: "oldBalance", label: "Balance", url: "https://images.test/bad.png" },
                    { id: "deletedOption", label: "Deleted option", url: "https://images.test/deleted.png" }
                ] },
                { file: "fixture.json", version: "1.1", status: "published", images: [{ id: "balance", label: "Balance", url: "https://images.test/good.png" }] }
            ], links: [] } });
            const request = route.request().postDataJSON();
            maintenanceRequests.push(request);
            if (verificationScenario) {
                if (request.action === "verify") manuallyConfirmed = true;
                return route.fulfill({ json: { edits: [], failures: [],
                    unresolved: manuallyConfirmed ? [] : [{ file: "old.json", id: "oldBalance", label: "Balance", url: "https://images.test/blocked.png",
                        verificationRequired: true, pageUrl: "https://intrisym.github.io/icyoa-template/?cyoa=old.json" }],
                    manualVerifications: manuallyConfirmed ? [{ file: "old.json", id: "oldBalance", expiresAt: "2026-12-03T12:00:00Z" }] : []
                } });
            }
            if (request.action === "repair" && headerScenario) return route.fulfill({ json: {
                edits: [], unresolved: [{ file: "old.json", id: "@header", label: "Header image" }], failures: []
            } });
            if (request.action === "link" && request.sourceId !== "balance") return route.fulfill({ status: 400, json: { error: "Select an existing matching option ID." } });
            const deleted = { file: "old.json", id: "deletedOption", label: "Deleted option", url: "https://images.test/deleted.png" };
            return route.fulfill({ json: request.action === "repair" ? {
                edits: [], unresolved: [{ file: "old.json", id: "oldBalance", label: "Balance" }, deleted],
                failures: [{ profile: "production", error: "HTTP 403", references: [{ filename: "old.json", id: "oldBalance" }] }], message: "1 image needs input."
            } : request.action === "link" ? { edits: [{ file: "old.json", id: "oldBalance" }], unresolved: [deleted], failures: [], linked: { id: "oldBalance", sourceId: "balance" } }
                : { edits: [{ file: "old.json", id: "deletedOption" }], unresolved: [], failures: [] } });
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
        await input.fill("https://rare-gallery.com/image.jpg");
        assert.equal(await input.getAttribute("aria-invalid"), "false");
        assert.equal(await input.evaluate(node => node.validity.customError), false);
        assert.equal(await input.evaluate(node => node.classList.contains("image-url-caution")), true);
        assert.match(await input.evaluate(node => node.nextElementSibling.textContent), /may work in your browser but fail in CI/);
        await input.fill("https://cdn.imgchest.com/files/image.jpg");
        assert.equal(await input.evaluate(node => node.nextElementSibling.hidden), true);
        assert.equal(await input.evaluate(node => node.classList.contains("image-url-caution")), false);
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
    await page.waitForFunction(() => document.querySelector("#imageMaintenanceStatus").textContent === "2 images need your help.");
    assert.equal(maintenanceRequests.length, 1); // Opening the dialog starts the sync check.
    assert.equal(await page.locator("#imageRepairLabel").textContent(), "Balance");
    assert.equal(await page.locator("#imageMaintenanceFields").isVisible(), false);
    assert.equal(await page.locator("#imageRepairDetails").isVisible(), false);
    await page.locator("#nextRepairImageBtn").click();
    assert.equal(await page.locator("#imageRepairLabel").textContent(), "Deleted option");
    await page.locator("#nextRepairImageBtn").click();
    assert.equal(await page.locator("#imageRepairLabel").textContent(), "Balance");
    await page.locator("#chooseImageIdBtn").click();
    assert.equal(await page.locator("#repairImageUrl").isVisible(), false);
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    for (const selector of ["#chooseImageIdBtn", "#chooseImageUrlBtn", "#applyImageRepairBtn"]) {
        const button = page.locator(selector);
        await button.hover();
        const contrast = await button.evaluate(node => {
            const luminance = color => {
                const [red, green, blue] = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
                    const channel = value / 255;
                    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
                });
                return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
            };
            const style = getComputedStyle(node);
            const foreground = luminance(style.color);
            const background = luminance(style.backgroundColor);
            return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        });
        assert(contrast >= 4.5, `${selector} contrast ${contrast}`);
    }
    await page.locator("#repairSourceVersion").selectOption("fixture.json");
    await page.locator("#repairSourceId").fill("wrongId");
    await page.locator("#applyImageRepairBtn").click();
    await page.waitForSelector("#imageRepairError:not([hidden])");
    assert.equal(await page.locator("#repairSourceId").inputValue(), "wrongId");
    await page.locator("#repairSourceId").fill("balance");
    await page.locator("#applyImageRepairBtn").click();
    await page.waitForFunction(() => document.querySelector("#imageMaintenanceStatus").textContent === "1 image needs your help.");
    assert.equal(maintenanceRequests[2].action, "link");
    assert.equal(maintenanceRequests[2].file, "old.json");
    assert.equal(maintenanceRequests[2].sourceId, "balance");
    assert.equal(maintenanceRequests[2].id, "oldBalance");
    assert.equal(await page.locator("#imageRepairLabel").textContent(), "Deleted option");
    await page.locator("#chooseImageUrlBtn").click();
    assert.equal(await page.locator("#repairSourceId").isVisible(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator("#imageMaintenanceDialog").evaluate(node => node.scrollWidth <= node.clientWidth), true);
    await page.locator("#repairImageUrl").fill("https://wallpapercave.com/bad.png");
    await page.locator("#applyImageRepairBtn").click();
    assert.equal(maintenanceRequests.length, 3); // Blocklisted URLs are rejected before a network scan.
    await page.locator("#repairImageUrl").fill("https://images.test/replacement.png");
    await page.locator("#applyImageRepairBtn").click();
    await page.waitForFunction(() => document.querySelector("#imageMaintenanceStatus").textContent === "All images are up to date.");
    assert.equal(maintenanceRequests[3].action, "replace");
    assert.equal(maintenanceRequests[3].id, "deletedOption");
    assert.equal(maintenanceRequests[3].url, "https://images.test/replacement.png");
    assert.equal(await page.locator("#imageRepairIssue").isVisible(), false);
    assert.match(await page.locator("#imageMaintenanceResults").textContent(), /2 images repaired/);
    headerScenario = true;
    await page.locator("#scanRepairImagesBtn").click();
    await page.waitForFunction(() => document.querySelector("#imageMaintenanceStatus").textContent === "1 image needs your help.");
    assert.equal(await page.locator("#imageRepairLabel").textContent(), "Header image");
    assert.equal(await page.locator("#imageRepairChoice").isVisible(), false);
    assert.equal(await page.locator("#repairImageUrl").isVisible(), true);
    verificationScenario = true;
    await page.locator("#scanRepairImagesBtn").click();
    await page.waitForSelector("#imageManualVerification:not([hidden])");
    assert.equal(await page.locator("#imageRepairChoice").isVisible(), false);
    assert.equal(await page.locator("#imageMaintenanceFields").isVisible(), false);
    assert.equal(await page.locator("#imageVerificationPage").getAttribute("href"), "https://intrisym.github.io/icyoa-template/?cyoa=old.json");
    const beforeConfirmation = maintenanceRequests.length;
    await page.locator("#confirmImageVerificationBtn").click();
    assert.equal(maintenanceRequests.length, beforeConfirmation);
    assert.equal(await page.locator("#imageRepairError").isVisible(), true);
    await page.locator("#imageVerificationConfirmed").check();
    await page.locator("#confirmImageVerificationBtn").click();
    await page.waitForFunction(() => document.querySelector("#imageMaintenanceStatus").textContent === "Checks complete with manual verification.");
    assert.equal(maintenanceRequests.at(-1).action, "verify");
    assert.equal(maintenanceRequests.at(-1).confirmed, true);
    assert.equal(maintenanceRequests.at(-1).url, "https://images.test/blocked.png");
    assert.match(await page.locator("#imageMaintenanceResults").textContent(), /Automated checks remain inconclusive/);
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
            if (pathname === "/flaky.png" && requests.filter(request => request.url === pathname).length > 1) return route.fulfill({ contentType: "image/png", body: png });
            if (pathname === "/blocked") return route.fulfill({ status: 403 });
            if (pathname === "/html") return route.fulfill({ contentType: "text/html", body: "<h1>Access denied</h1>" });
            return route.fulfill({ status: 404 });
        });
        return browserContext;
    } };
    const url = "https://fixtures.test";
    const images = ["/good.png", "/good.png", "/blocked", "/missing", "/html", "/timeout", "/flaky.png"]
        .map((suffix, index) => ({ file: "CYOAs/test.json", location: `options[${index}]`, url: url + suffix }));
    const failures = await checkProfile(fixtureBrowser, images, { baseURL: "http://localhost:8000/", timeout: 1000 });
    assert.equal(failures.length, 4, JSON.stringify(failures));
    assert(failures.some(failure => failure.error === "HTTP 403"));
    assert(failures.some(failure => failure.error === "HTTP 404"));
    assert(failures.some(failure => failure.url.endsWith("/html")));
    assert(failures.some(failure => failure.error.includes("Timed out")));
    assert(requests.every(request => request.referer === "http://localhost:8000/"));
    assert.equal(requests.filter(request => request.url === "/good.png").length, 1);
    assert.equal(requests.filter(request => request.url === "/flaky.png").length, 2);
    assert.equal(failures.find(failure => failure.url.endsWith("/blocked")).classification, "inconclusive");
    assert.equal(failures.find(failure => failure.url.endsWith("/missing")).classification, "broken");
    assert.equal(failures.find(failure => failure.url.endsWith("/missing")).attempts.length, 2);

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
    assert.deepEqual(productionRequests, ["http://localhost:8000/", "https://intrisym.github.io/", "https://intrisym.github.io/", "https://intrisym.github.io/"]);
    assert.equal(productionFailures.length, 3);
    assert(productionFailures.some(failure => failure.error === "HTTP 404" && failure.url.endsWith("/icyoa-template/missing-image-fixture.png")));
    assert(productionFailures.some(failure => failure.error === "Invalid image URL" && failure.references[0].location === "invalid URL"));
    assert(productionFailures.some(failure => failure.error === "HTTP 403" && failure.references[0] === referrerImage));
});
