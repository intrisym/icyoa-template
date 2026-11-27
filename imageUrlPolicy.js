(function (root) {
    // Add domains here to update the editor's image-host blocklist.
    // A domain also blocks all of its subdomains.
    const blockedDomains = [
        {
            domain: "wallpapercave.com",
            reason: "Image requests to this host have failed DNS resolution. Choose another image host."
        }
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
            input.setCustomValidity(error);
            input.classList.toggle("image-url-invalid", Boolean(error));
            input.setAttribute("aria-invalid", String(Boolean(error)));
            message.textContent = error;
            message.hidden = !error;
        };
        input.addEventListener("input", update);
        update(); // Existing/imported URLs must receive the same feedback.
    }

    const api = { blockedDomains, validationMessage, bindInput };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.CyoaImageUrlPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
