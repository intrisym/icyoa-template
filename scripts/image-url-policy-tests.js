const test = require("node:test");
const assert = require("node:assert/strict");
const { validationMessage } = require("../imageUrlPolicy");

test("blocks exact domains, subdomains, mixed case, trailing DNS dots and protocol-relative URLs", () => {
    for (const url of [
        "https://wallpapercave.com/wp/image.png", "http://wallpapercave.com/image.png",
        "https://cdn.wallpapercave.com/image.png", " HTTPS://WallpaperCave.COM/image.png ",
        "https://wallpapercave.com./image.png", "//wallpapercave.com/image.png",
        "https://example.com@wallpapercave.com/image.png"
    ]) assert.match(validationMessage(url), /Blocked image host: wallpapercave\.com/, url);
});

test("does not block unrelated domains, paths, query strings or optional empty fields", () => {
    for (const url of [
        "", " ", "https://example.com/image.png", "https://notwallpapercave.com/image.png",
        "https://wallpapercave.com.example.com/image.png", "https://wallpapercave.com@example.com/image.png",
        "https://example.com/wallpapercave.com/image.png", "https://example.com/?source=wallpapercave.com",
        "./images/header.png", "/images/header.png"
    ]) assert.equal(validationMessage(url), "", url);
});

test("reports malformed URLs without throwing", () => {
    assert.equal(validationMessage("https://"), "Enter a valid image URL.");
});
