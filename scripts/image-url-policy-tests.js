const test = require("node:test");
const assert = require("node:assert/strict");
const { validationMessage, warningMessage } = require("../imageUrlPolicy");

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

test("problematic hosts get advisory warnings without validation errors", () => {
    for (const domain of ["rare-gallery.com", "raregallery.art", "wallpapercrafter.com", "eldrige.net", "tellest.com", "zestcoloring.com", "wallpaperbat.com"]) {
        for (const url of [`https://${domain}/image.jpg`, `https://cdn.${domain}/image.jpg`, `HTTPS://${domain.toUpperCase()}./image.jpg`, `//${domain}/image.jpg`]) {
            assert.match(warningMessage(url), /may work in your browser but fail in CI/);
            assert.match(warningMessage(url), /local image exporter/);
            assert.equal(validationMessage(url), "");
        }
    }
});

test("warnings do not match unrelated names, paths, invalid URLs or blocked hosts", () => {
    for (const url of ["", "https://", "images/local.png", "https://notrare-gallery.com/image.jpg", "https://rare-gallery.com.example.org/image.jpg",
        "https://example.org/?url=raregallery.art", "https://example.org/wallpapercrafter.com", "https://wallpapercave.com/image.jpg"]) {
        assert.equal(warningMessage(url), "", url);
    }
});
