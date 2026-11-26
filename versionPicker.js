(function (root) {
    let pickerCount = 0;

    function render({ container, versions, currentFile, editor = false, onOpen, onCancel, onDelete }) {
        const make = (tag, className, text) => {
            const element = document.createElement(tag);
            element.className = className;
            if (text) element.textContent = text;
            return element;
        };
        const selected = versions.find(version => version.filename === currentFile) || versions[0];
        if (!selected) return;
        const latest = versions.find(version => version.status !== "draft");
        const picker = make("div", "version-picker");
        const heading = make("div", "version-picker-heading");
        heading.append(
            make("span", "version-picker-eyebrow", `${versions.length} ${versions.length === 1 ? "version" : "versions"} available`),
            make("h4", "version-picker-title", selected.title || selected.filename),
            make("p", "version-picker-description", editor
                ? "Continue a draft or revisit a published release."
                : "Choose the release you want to play. Your current version stays available.")
        );
        picker.appendChild(heading);
        const list = make("fieldset", "version-picker-list");
        const legend = make("legend", "version-picker-legend", "Available versions");
        list.appendChild(legend);
        const footer = make("div", "version-picker-footer");
        const secondary = make("div", "version-picker-secondary");
        const actions = make("div", "version-picker-actions");
        const cancel = make("button", "version-picker-cancel", "Cancel");
        cancel.type = "button";
        cancel.addEventListener("click", onCancel);
        const open = make("button", "version-picker-open");
        open.type = "button";
        actions.append(cancel, open);
        let chosen = selected;
        const updateAction = () => {
            open.textContent = editor
                ? chosen.status === "published" ? "View release →" : chosen.status === "draft" ? "Edit draft →" : "Open editor →"
                : "Play this version →";
            secondary.replaceChildren();
            if (editor && onDelete && chosen.status !== "published") {
                const remove = make("button", "version-picker-delete", "Move to trash");
                remove.type = "button";
                remove.addEventListener("click", () => onDelete(chosen));
                secondary.appendChild(remove);
            } else {
                secondary.appendChild(make("span", "version-picker-hint", editor ? "Published releases are read-only" : "Previous releases are preserved"));
            }
        };
        const name = `cyoa-version-${++pickerCount}`;
        const rows = [];
        for (const version of versions) {
            const draft = version.status === "draft";
            const number = draft ? version.targetVersion : version.version;
            const row = make("label", "version-option");
            const radio = make("input", "version-option-radio");
            radio.type = "radio";
            radio.name = name;
            radio.value = version.filename;
            radio.checked = version.filename === selected.filename;
            row.dataset.selected = String(radio.checked);
            const content = make("span", "version-option-content");
            const line = make("span", "version-option-heading");
            line.appendChild(make("span", "version-option-number", number ? `v${number}` : draft ? "New draft" : "Version 1"));
            const badge = make("span", "version-option-badge", draft ? "Draft" : version.status === "published" ? "Published" : "Editable");
            badge.dataset.kind = draft ? "draft" : "published";
            line.appendChild(badge);
            if (version.filename === currentFile) line.appendChild(make("span", "version-option-current", "Current"));
            content.appendChild(line);
            const detail = draft
                ? version.baseVersion ? `Based on v${version.baseVersion} · Changes save to this draft` : "A work in progress · Ready when you are"
                : version.filename === latest?.filename ? "Latest release" : "Previous release";
            content.appendChild(make("span", "version-option-detail", detail));
            if (version.releaseNotes) content.appendChild(make("span", "version-option-notes", version.releaseNotes));
            row.append(radio, content);
            radio.addEventListener("change", () => {
                if (!radio.checked) return;
                chosen = version;
                rows.forEach(entry => { entry.row.dataset.selected = String(entry.radio.checked); });
                updateAction();
            });
            rows.push({ row, radio });
            list.appendChild(row);
        }
        open.addEventListener("click", () => onOpen(chosen));
        footer.append(secondary, actions);
        picker.append(list, footer);
        updateAction();
        container.replaceChildren(picker);
        picker.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
            }
            if (event.key === "Tab") {
                const focusable = Array.from(picker.querySelectorAll('input:checked, button:not([disabled])'));
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }
        });
        queueMicrotask(() => rows.find(entry => entry.radio.checked)?.radio.focus({ preventScroll: true }));
    }

    root.CyoaVersionPicker = { render };
})(typeof globalThis !== "undefined" ? globalThis : this);
