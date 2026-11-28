(function (root) {
    // Add domains here to update the editor's image-host blocklist.
    // A domain also blocks all of its subdomains.
    const blockedDomains = [
        {
            domain: "wallpapercave.com",
            reason: "Image requests to this host have failed DNS resolution. Choose another image host."
        }
    ];
    // Advisory only: these domains and their subdomains remain valid inputs.
    const warningDomains = [
        "rare-gallery.com", "raregallery.art", "wallpapercrafter.com",
        "eldrige.net", "tellest.com", "zestcoloring.com", "wallpaperbat.com"
    ];
    let messageId = 0;

    function validationMessage(value) {
        const text = String(value || "").trim();
        if (!text) return "";
        let url;
        try { url = new URL(text, "https://editor.invalid/"); }
        catch { return "Enter a valid image URL."; }
        const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
        const blocked = blockedDomains.find(entry => hostname === entry.domain || hostname.endsWith("." + entry.domain));
        return blocked ? `Blocked image host: ${blocked.domain}. ${blocked.reason}` : "";
    }

    function bindInput(input) {
        const message = input.ownerDocument.createElement("p");
        message.id = `imageUrlError${++messageId}`;
        message.className = "image-url-error";
        message.setAttribute("role", "status");
        message.setAttribute("aria-live", "polite");
        input.insertAdjacentElement("afterend", message);
        const description = input.getAttribute("aria-describedby");
        input.setAttribute("aria-describedby", [description, message.id].filter(Boolean).join(" "));
        const update = () => {
            const error = validationMessage(input.value);
            const warning = error ? "" : warningMessage(input.value);
            input.setCustomValidity(error);
            input.classList.toggle("image-url-invalid", Boolean(error));
            input.classList.toggle("image-url-caution", Boolean(warning));
            input.setAttribute("aria-invalid", String(Boolean(error)));
            message.classList.toggle("image-url-warning", Boolean(warning));
            message.textContent = error || warning;
            message.hidden = !error && !warning;
        };
        input.addEventListener("input", update);
        update(); // Existing/imported URLs must receive the same feedback.
    }

    function warningMessage(value) {
        if (validationMessage(value)) return "";
        let url;
        try { url = new URL(String(value || "").trim(), "https://editor.invalid/"); }
        catch { return ""; }
        const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
        const domain = warningDomains.find(domain => hostname === domain || hostname.endsWith("." + domain));
        return domain ? `Image host warning: ${domain}. This host has repeatedly blocked automated image checks or downloads. The image may work in your browser but fail in CI. Consider migrating it to ImgChest using the local image exporter.` : "";
    }

    const api = { blockedDomains, warningDomains, validationMessage, warningMessage, bindInput };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.CyoaImageUrlPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
