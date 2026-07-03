(function () {
    const CORE_TYPES_ORDER = ["title", "description", "headerImage", "points", "settings"];
    const BASE_OPTION_KEYS = new Set(["id", "label", "description", "image", "inputType", "inputLabel", "cost", "costOptions", "pointAllocation", "sliderModifiers", "attributeEffects", "maxSelections", "countsAsOneSelection", "bypassSubcategoryMaxSelections", "prerequisites", "conflictsWith", "autoGrants", "modifiedCosts", "discounts", "discountGrants", "alignment", "titleAlignment", "metaAlignment", "descriptionAlignment", "borderColor", "darkBorderColor"]);

    const state = {
        data: [],
        previewReady: false,
        lastPreviewError: null,
        selectedFile: new URLSearchParams(window.location.search).get('cyoa') || null,
        filterQuery: ""
    };
    const CONFIG_ENDPOINT = "/api/config";
    const tempSyncState = {
        enabled: false,
        pendingData: null,
        saving: false,
        warningShown: false,
        loadFallbackWarned: false
    };
    const categoryOpenState = new WeakMap();
    const subcategoryOpenState = new WeakMap();
    const sectionOpenState = new Map();
    const optionIdAutoMap = new WeakMap();
    const optionOpenState = new WeakMap();
    const LIGHT_THEME_DEFAULTS = {
        type: "theme",
        "bg-color": "#f9f9f9",
        "container-bg": "#ffffff",
        "text-color": "#333333",
        "text-muted": "#555555",
        "accent-color": "#007acc",
        "accent-text": "#ffffff",
        "border-color": "#dddddd",
        "item-bg": "#f4f4f4",
        "item-header-bg": "#e0e0e0",
        "points-bg": "#f0f0f0",
        "points-border": "#cccccc",
        "points-text": "#000000",
        "selection-glow-color": "#2563eb",
        "shadow-color": "rgba(0,0,0,0.1)",
        "option-meta-bg": "#f8fafc",
        "option-meta-heading-bg": "rgba(0, 122, 204, 0.14)",
        "option-meta-heading-text": "#333333",
        "option-meta-points-color": "#cccccc",
        "option-meta-conditional-color": "#0ea5e9",
        "option-meta-auto-grants-color": "#16a34a",
        "option-meta-slider-modifiers-color": "#7c3aed",
        "option-meta-prerequisites-color": "#f59e0b",
        "option-meta-conflicts-color": "#dc2626",
        "font-base": "20px",
        "font-title": "44px",
        "font-description": "22px",
        "font-tab": "20px",
        "font-accordion": "22px",
        "font-subcategory": "24px",
        "font-option-title": "24px",
        "font-option-req": "19px",
        "font-option-desc": "23px",
        "font-story": "21px",
        "font-story-input": "20px",
        "font-points": "20px",
        "font-points-value": "20px",
        "font-prereq-help": "17px",
        "font-label": "19px",
        "font-heading": "Verdana, sans-serif",
        "font-body": "'Quicksand', sans-serif"
    };
    const DARK_THEME_DEFAULTS = {
        type: "darkTheme",
        "bg-color": "#111827",
        "container-bg": "#1f2937",
        "text-color": "#f3f4f6",
        "text-muted": "#9ca3af",
        "accent-color": "#b91c1c",
        "accent-text": "#ffffff",
        "border-color": "#374151",
        "item-bg": "#1f2937",
        "item-header-bg": "#374151",
        "points-bg": "rgba(185, 28, 28, 0.95)",
        "points-border": "#fbbf24",
        "points-text": "#000000",
        "selection-glow-color": "#2563eb",
        "shadow-color": "rgba(0, 0, 0, 0.5)",
        "option-meta-bg": "#111827",
        "option-meta-heading-bg": "rgba(185, 28, 28, 0.18)",
        "option-meta-heading-text": "#f3f4f6",
        "option-meta-points-color": "#fbbf24",
        "option-meta-conditional-color": "#38bdf8",
        "option-meta-auto-grants-color": "#22c55e",
        "option-meta-slider-modifiers-color": "#a78bfa",
        "option-meta-prerequisites-color": "#f59e0b",
        "option-meta-conflicts-color": "#f87171",
        "font-base": "20px",
        "font-title": "44px",
        "font-description": "22px",
        "font-tab": "20px",
        "font-accordion": "22px",
        "font-subcategory": "24px",
        "font-option-title": "24px",
        "font-option-req": "19px",
        "font-option-desc": "23px",
        "font-story": "21px",
        "font-story-input": "20px",
        "font-points": "20px",
        "font-points-value": "20px",
        "font-prereq-help": "17px",
        "font-label": "19px",
        "font-heading": "Verdana, sans-serif",
        "font-body": "'Quicksand', sans-serif"
    };

    function walkEditorSubcategories(subcategories, callback, path = []) {
        if (!Array.isArray(subcategories)) return;
        subcategories.forEach((subcat, index) => {
            const nextPath = path.concat([{ index, name: subcat?.name || "" }]);
            callback(subcat, nextPath);
            if (Array.isArray(subcat?.subcategories) && subcat.subcategories.length) {
                walkEditorSubcategories(subcat.subcategories, callback, nextPath);
            }
        });
    }

    function ensureSubcategoryDefaults(subcat) {
        if (!subcat || typeof subcat !== "object") return;
        if (!Array.isArray(subcat.options)) subcat.options = [];
        if (!Array.isArray(subcat.subcategories)) subcat.subcategories = [];
        subcat.subcategories.forEach(child => ensureSubcategoryDefaults(child));
    }

    function snapshotOpenStates(categorySnapshots) {
        const existingCategoryEls = categoryListEl?.querySelectorAll?.(".category-card");
        if (!existingCategoryEls || !existingCategoryEls.length) return;
        categorySnapshots.forEach(({ entry: category }, idx) => {
            const catEl = existingCategoryEls[idx];
            if (!catEl) return;
            categoryOpenState.set(category, catEl.open);
            const subEls = Array.from(catEl.querySelectorAll(".subcategory-item"));
            let subElIndex = 0;
            walkEditorSubcategories(category.subcategories || [], (subcat) => {
                const subEl = subEls[subElIndex++];
                if (!subEl) return;
                subcategoryOpenState.set(subcat, subEl.open);

                const directOptionList = subEl.querySelector(":scope > .subcategory-body > .option-list");
                const optEls = directOptionList ? directOptionList.querySelectorAll(":scope > .option-item") : [];
                (subcat.options || []).forEach((opt, optIdx) => {
                    const optEl = optEls[optIdx];
                    if (!optEl) return;
                    optionOpenState.set(opt, optEl.open);
                });
            });
        });
    }

    const globalSettingsEl = document.getElementById("globalSettings");
    const categoryListEl = document.getElementById("categoryList");
    const previewFrame = document.getElementById("previewFrame");
    const previewStatusEl = document.getElementById("previewStatus");
    const reloadPreviewBtn = document.getElementById("reloadPreviewBtn");
    const openPreviewTabBtn = document.getElementById("openPreviewTabBtn");
    const editorMessageEl = document.getElementById("editorMessage");
    const addCategoryBtn = document.getElementById("addCategoryBtn");
    const importJsonBtn = document.getElementById("importJsonBtn");
    const exportJsonBtn = document.getElementById("exportJsonBtn");
    const selectCyoaBtn = document.getElementById("selectCyoaBtn");
    const editorThemeToggleBtn = document.getElementById("editorThemeToggle");
    const importFileInput = document.getElementById("importFileInput");
    const editorSearchInput = document.getElementById("editorSearchInput");
    const editorOverviewEl = document.getElementById("editorOverview");
    const editorNavigatorEl = document.getElementById("editorNavigator");
    const expandAllBtn = document.getElementById("expandAllBtn");
    const collapseAllBtn = document.getElementById("collapseAllBtn");
    const EDITOR_THEME_STORAGE_KEY = "cyoa-editor-theme";

    let previewUpdateHandle = null;
    let pendingPreviewData = null;
    let detachedPreviewWindow = null;

    function cloneData(data) {
        return JSON.parse(JSON.stringify(data));
    }

    function scrollPreviewToExample(selector) {
        if (!previewFrame?.contentWindow || !previewFrame.contentDocument) return;
        try {
            const doc = previewFrame.contentDocument;
            const target = doc.querySelector(selector);
            if (!target) return;
            target.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        } catch (err) {
            // Ignore cross-origin or access errors.
        }
    }

    function showEditorMessage(text, tone = "info", timeout = 4000) {
        if (!editorMessageEl) return;
        editorMessageEl.textContent = text;
        editorMessageEl.dataset.tone = tone;
        if (timeout) {
            setTimeout(() => {
                if (editorMessageEl.textContent === text) {
                    editorMessageEl.textContent = "";
                    delete editorMessageEl.dataset.tone;
                }
            }, timeout);
        }
    }

    function getPreviewUrl() {
        return state.selectedFile
            ? `index.html?cyoa=${encodeURIComponent(state.selectedFile)}`
            : "index.html";
    }

    function getPreferredTheme() {
        const storedTheme = localStorage.getItem(EDITOR_THEME_STORAGE_KEY);
        if (storedTheme === "light" || storedTheme === "dark") {
            return storedTheme;
        }
        return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    function applyEditorTheme(theme) {
        const mode = theme === "dark" ? "dark" : "light";
        document.documentElement.dataset.theme = mode;
        if (editorThemeToggleBtn) {
            const nextMode = mode === "dark" ? "Light Mode" : "Dark Mode";
            editorThemeToggleBtn.textContent = nextMode;
            editorThemeToggleBtn.title = `Switch to ${nextMode.toLowerCase()}`;
            editorThemeToggleBtn.setAttribute("aria-label", `Switch to ${nextMode.toLowerCase()}`);
        }
    }

    function initializeEditorTheme() {
        applyEditorTheme(getPreferredTheme());
    }

    function queueTempSave(data) {
        if (!tempSyncState.enabled) return;
        tempSyncState.pendingData = data;
        if (!tempSyncState.saving) {
            void flushTempSaveQueue();
        }
    }

    async function flushTempSaveQueue() {
        if (!tempSyncState.enabled || !tempSyncState.pendingData) return;
        const payload = tempSyncState.pendingData;
        tempSyncState.pendingData = null;
        tempSyncState.saving = true;
        try {
            const endpoint = state.selectedFile
                ? `${CONFIG_ENDPOINT}?file=${encodeURIComponent(state.selectedFile)}`
                : CONFIG_ENDPOINT;
            const res = await fetch(endpoint, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
        } catch (err) {
            tempSyncState.enabled = false;
            if (!tempSyncState.warningShown) {
                showEditorMessage(`Lost connection to temp file server. Edits will no longer sync: ${err.message}`, "warning", 6000);
                tempSyncState.warningShown = true;
            }
        } finally {
            tempSyncState.saving = false;
            if (tempSyncState.enabled && tempSyncState.pendingData) {
                void flushTempSaveQueue();
            }
        }
    }

    async function loadSelectedConfig() {
        try {
            const endpoint = state.selectedFile
                ? `${CONFIG_ENDPOINT}?file=${encodeURIComponent(state.selectedFile)}`
                : CONFIG_ENDPOINT;
            const res = await fetch(endpoint, {
                cache: "no-store"
            });
            if (!res.ok) {
                return {
                    ok: false,
                    error: `HTTP ${res.status}`
                };
            }
            const data = await res.json();
            if (!Array.isArray(data)) {
                return {
                    ok: false,
                    error: "Config file must contain a JSON array."
                };
            }
            tempSyncState.enabled = true;
            tempSyncState.warningShown = false;
            return {
                ok: true,
                data
            };
        } catch (err) {
            tempSyncState.enabled = false;
            return {
                ok: false,
                error: err?.message || String(err)
            };
        }
    }


    function findInsertIndexForType(type) {
        const orderIndex = CORE_TYPES_ORDER.indexOf(type);
        if (orderIndex === -1) return state.data.length;

        for (let i = orderIndex - 1; i >= 0; i--) {
            const priorType = CORE_TYPES_ORDER[i];
            const idx = state.data.findIndex(entry => entry.type === priorType);
            if (idx !== -1) {
                return idx + 1;
            }
        }
        return 0;
    }

    function ensureEntry(type, factory, options = {}) {
        let index = state.data.findIndex(entry => entry.type === type);
        let entry;
        if (index !== -1) {
            entry = state.data[index];
            if (options.mergeDefaults) {
                const defaults = typeof factory === "function" ? factory() : factory;
                Object.entries(defaults).forEach(([key, val]) => {
                    if (!Object.prototype.hasOwnProperty.call(entry, key)) {
                        entry[key] = val;
                    }
                });
            }
            return {
                entry,
                index
            };
        }
        const value = typeof factory === "function" ? factory() : factory;
        const insertIndex = findInsertIndexForType(type);
        state.data.splice(insertIndex, 0, value);
        return {
            entry: state.data[insertIndex],
            index: insertIndex
        };
    }

    function getCategorySnapshots() {
        const result = [];
        state.data.forEach((entry, index) => {
            if (entry && !entry.type) {
                if (!Array.isArray(entry.subcategories)) {
                    entry.subcategories = [];
                }
                entry.subcategories.forEach(sub => ensureSubcategoryDefaults(sub));
                result.push({
                    entry,
                    index
                });
            }
        });
        return result;
    }

    function collectOptionIds() {
        const ids = new Set();
        state.data.forEach(entry => {
            if (!entry.type && Array.isArray(entry.subcategories)) {
                walkEditorSubcategories(entry.subcategories, sub => {
                    (sub.options || []).forEach(opt => {
                        if (opt.id) ids.add(opt.id);
                    });
                });
            }
        });
        return ids;
    }

    function normalizeIdList(value) {
        if (!value) return [];
        const raw = Array.isArray(value) ? value : String(value).split(/[,\n]/g);
        return Array.from(new Set(raw.map(id => String(id || "").trim()).filter(Boolean)));
    }

    function getModifiedCostRulesForEditor(entity) {
        if (!entity || typeof entity !== "object") return [];
        if (Array.isArray(entity.modifiedCosts)) return entity.modifiedCosts;
        if (Array.isArray(entity.discounts)) return entity.discounts;
        return [];
    }

    function ensureModifiedCostRulesForEditor(entity) {
        if (!entity || typeof entity !== "object") return [];
        if (Array.isArray(entity.modifiedCosts)) return entity.modifiedCosts;
        if (Array.isArray(entity.discounts)) {
            entity.modifiedCosts = entity.discounts;
            delete entity.discounts;
            return entity.modifiedCosts;
        }
        entity.modifiedCosts = [];
        return entity.modifiedCosts;
    }

    function setModifiedCostRulesForEditor(entity, rules) {
        if (!entity || typeof entity !== "object") return;
        if (Array.isArray(rules) && rules.length) {
            entity.modifiedCosts = rules;
        } else {
            delete entity.modifiedCosts;
        }
        delete entity.discounts;
    }

    const RESERVED_EXPR_IDENTIFIERS = new Set([
        "true", "false", "null", "undefined", "if", "else", "return", "let", "var", "const",
        "function", "while", "for", "do", "switch", "case", "break", "continue", "default",
        "new", "this", "typeof", "instanceof", "void", "delete", "in", "of", "with", "try",
        "catch", "finally", "throw", "class", "extends", "super", "import", "export", "from",
        "as", "await", "async", "yield"
    ]);

    function formatPrerequisiteValue(value) {
        if (value == null || value === "") return "";
        if (typeof value === "string") return value;
        if (Array.isArray(value)) return value.join(", ");
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
    }

    function parsePrerequisiteValue(raw) {
        const text = String(raw || "").trim();
        if (!text) return { value: null, error: null };

        if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
            try {
                return { value: JSON.parse(text), error: null };
            } catch (err) {
                return { value: null, error: `Prerequisite JSON is invalid: ${err.message}` };
            }
        }

        if (/[()!&|]/.test(text)) {
            return { value: text, error: null };
        }

        const ids = normalizeIdList(text);
        if (!ids.length) return { value: null, error: null };
        return { value: ids.length === 1 ? ids[0] : ids, error: null };
    }

    function unquoteRequirementPointName(rawName = "") {
        const text = String(rawName).trim();
        if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
            return text.slice(1, -1).replace(/\\(["'\\])/g, "$1");
        }
        return text;
    }

    function getPointRequirementPattern() {
        const pointNamePattern = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_][A-Za-z0-9_]*)`;
        return new RegExp(`(${pointNamePattern})\\s*(?:(?:>=|<=|>|<|==|=)\\s*-?\\d+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?\\+)`, "g");
    }

    function getScopeRequirementPattern() {
        const quotedNamePattern = String.raw`("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`;
        return new RegExp(`\\b(category|subcategory)\\s*\\(\\s*${quotedNamePattern}\\s*\\)`, "g");
    }

    function extractRequirementScopes(value) {
        const scopes = [];
        const visit = requirement => {
            if (!requirement) return;
            if (typeof requirement === "string") {
                requirement.replace(getScopeRequirementPattern(), (_, scopeType, rawName) => {
                    scopes.push({ type: scopeType, name: unquoteRequirementPointName(rawName) });
                    return "";
                });
                return;
            }
            if (Array.isArray(requirement)) {
                requirement.forEach(visit);
                return;
            }
            if (typeof requirement === "object") {
                visit(requirement.and);
                visit(requirement.or);
                visit(requirement.not);
            }
        };
        visit(value);
        return scopes;
    }

    function extractRequirementPointTypes(value) {
        const pointTypes = new Set();
        const visit = requirement => {
            if (!requirement) return;
            if (typeof requirement === "string") {
                requirement.replace(getPointRequirementPattern(), (_, rawName) => {
                    pointTypes.add(unquoteRequirementPointName(rawName));
                    return "";
                });
                return;
            }
            if (Array.isArray(requirement)) {
                requirement.forEach(visit);
                return;
            }
            if (typeof requirement === "object") {
                visit(requirement.and);
                visit(requirement.or);
                visit(requirement.not);
            }
        };
        visit(value);
        return pointTypes;
    }

    function extractReferencedIds(value) {
        const ids = new Set();
        if (!value) return ids;

        if (typeof value === "string") {
            const withoutPointRequirements = value
                .replace(getPointRequirementPattern(), "")
                .replace(getScopeRequirementPattern(), "");
            const tokens = withoutPointRequirements.match(/!?[A-Za-z_][A-Za-z0-9_]*(?:__\d+)?/g) || [];
            tokens.forEach(token => {
                const core = token.startsWith("!") ? token.slice(1) : token;
                const [id] = core.split("__");
                if (id && !RESERVED_EXPR_IDENTIFIERS.has(id)) ids.add(id);
            });
            return ids;
        }

        if (Array.isArray(value)) {
            normalizeIdList(value).forEach(id => {
                const [base] = String(id).split("__");
                if (base) ids.add(base);
            });
            return ids;
        }

        if (typeof value === "object") {
            const fromAnd = normalizeIdList(value.and || []);
            const fromOr = normalizeIdList(value.or || []);
            [...fromAnd, ...fromOr].forEach(id => {
                const [base] = String(id).split("__");
                if (base) ids.add(base);
            });
        }

        return ids;
    }

    function isSafeCssColorValue(value) {
        if (value === undefined || value === null || value === "") return true;
        const color = String(value).trim();
        return /^#[0-9a-f]{3,8}$/i.test(color)
            || /^rgba?\(\s*(\d{1,3}%?\s*,\s*){2}\d{1,3}%?(\s*,\s*(0|1|0?\.\d+|[1-9]\d*%))?\s*\)$/i.test(color)
            || /^hsla?\(\s*-?\d+(\.\d+)?(deg|rad|turn)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(\s*,\s*(0|1|0?\.\d+|[1-9]\d*%))?\s*\)$/i.test(color)
            || /^[a-z]+$/i.test(color);
    }

    function tokenizeDerivedFormulaForEditor(formula) {
        const tokens = [];
        let index = 0;
        while (index < formula.length) {
            const char = formula[index];
            if (/\s/.test(char)) {
                index += 1;
                continue;
            }
            if ("+-*/(),".includes(char)) {
                tokens.push(char);
                index += 1;
                continue;
            }
            if (char === '"' || char === "'") {
                const quote = char;
                let value = "";
                index += 1;
                while (index < formula.length) {
                    const current = formula[index];
                    if (current === "\\") {
                        value += formula[index + 1] || "";
                        index += 2;
                        continue;
                    }
                    if (current === quote) break;
                    value += current;
                    index += 1;
                }
                if (formula[index] !== quote) throw new Error("Unclosed quoted point type");
                tokens.push({ type: "name", value });
                index += 1;
                continue;
            }
            const numberMatch = formula.slice(index).match(/^\d+(?:\.\d+)?/);
            if (numberMatch) {
                tokens.push({ type: "number", value: Number(numberMatch[0]) });
                index += numberMatch[0].length;
                continue;
            }
            const nameMatch = formula.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
            if (nameMatch) {
                tokens.push({ type: "name", value: nameMatch[0] });
                index += nameMatch[0].length;
                continue;
            }
            throw new Error(`Unexpected character "${char}"`);
        }
        return tokens;
    }

    function validateDerivedFormulaForEditor(formula, pointTypes, optionIds) {
        const tokens = tokenizeDerivedFormulaForEditor(formula);
        let index = 0;
        const peek = () => tokens[index];
        const consume = expected => {
            const token = tokens[index];
            const value = typeof token === "string" ? token : token?.value;
            if (expected !== undefined && value !== expected) throw new Error(`Expected "${expected}"`);
            index += 1;
            return token;
        };
        const parseExpression = () => {
            let value = parseTerm();
            while (peek() === "+" || peek() === "-") {
                consume();
                parseTerm();
                value = 0;
            }
            return value;
        };
        const parseTerm = () => {
            let value = parseFactor();
            while (peek() === "*" || peek() === "/") {
                consume();
                parseFactor();
                value = 0;
            }
            return value;
        };
        const parseFactor = () => {
            if (peek() === "+") {
                consume("+");
                return parseFactor();
            }
            if (peek() === "-") {
                consume("-");
                return parseFactor();
            }
            if (peek() === "(") {
                consume("(");
                const value = parseExpression();
                consume(")");
                return value;
            }
            const token = consume();
            if (token?.type === "number") return token.value;
            if (token?.type === "name") {
                if (token.value === "selected" && peek() === "(") {
                    consume("(");
                    const optionToken = consume();
                    if (optionToken?.type !== "name") throw new Error("selected() requires a quoted option ID");
                    if (!optionIds.has(optionToken.value)) throw new Error(`Unknown selected option ID "${optionToken.value}"`);
                    consume(")");
                    return 0;
                }
                if (!pointTypes.has(token.value)) throw new Error(`Unknown point type "${token.value}"`);
                return 0;
            }
            throw new Error("Expected a number, point type, or expression");
        };
        parseExpression();
        if (index < tokens.length) throw new Error("Unexpected token after formula");
    }

    function getDerivedFormulaWarnings(entry, index, pointTypes) {
        const warnings = [];
        const label = `Derived value ${index + 1}`;
        const optionIds = collectOptionIds();
        const checkFormula = (formula, context, required = false) => {
            const text = String(formula || "");
            if (!text.trim()) {
                if (required) warnings.push(`${context} is required.`);
                return;
            }
            try {
                validateDerivedFormulaForEditor(text, pointTypes, optionIds);
            } catch (err) {
                warnings.push(`${context} is invalid: ${err.message}`);
            }
        };
        if (!String(entry?.pointType || "").trim()) warnings.push(`${label}: choose a point type to update.`);
        else if (!pointTypes.has(entry.pointType)) warnings.push(`${label}: target point type "${entry.pointType}" is not defined in the CYOA points.`);
        checkFormula(entry?.formula, `${label}: formula`, true);
        checkFormula(entry?.min, `${label}: min formula`);
        checkFormula(entry?.max, `${label}: max formula`);
        return Array.from(new Set(warnings));
    }

    function getDerivedValuesWarnings(pointsEntry) {
        const pointTypes = new Set(Object.keys(pointsEntry?.values || {}));
        const seenTargets = new Set();
        const warnings = [];
        (Array.isArray(pointsEntry?.derivedValues) ? pointsEntry.derivedValues : [])
            .forEach((entry, index) => {
                warnings.push(...getDerivedFormulaWarnings(entry, index, pointTypes));
                const target = String(entry?.pointType || "").trim();
                if (!target) return;
                if (seenTargets.has(target)) warnings.push(`Derived value ${index + 1}: target point type "${target}" is already used by another derived value.`);
                seenTargets.add(target);
            });
        return warnings;
    }

    function getOptionValidationWarnings(option) {
        const warnings = [];
        const allIds = collectOptionIds();
        const pointTypes = new Set(getPointTypeNames());
        const selfId = String(option?.id || "").trim();
        const warnUnknownPointTypes = (costMap, context) => {
            if (!costMap || typeof costMap !== "object") return;
            Object.keys(costMap).forEach(type => {
                if (!pointTypes.has(type)) warnings.push(`${context}: point type "${type}" is not defined in the CYOA points.`);
            });
        };

        warnUnknownPointTypes(option?.cost, "Base cost");
        (option?.costOptions || []).forEach((costOption, index) => {
            warnUnknownPointTypes(costOption?.cost, `Alternative cost ${index + 1}`);
            (costOption?.costBySelection || []).forEach((tierCost, tierIndex) => {
                warnUnknownPointTypes(tierCost, `Alternative cost ${index + 1} selection ${tierIndex + 1}`);
            });
        });
        (option?.pointAllocation?.types || []).forEach(type => {
            if (!pointTypes.has(type)) warnings.push(`Point allocation references unknown point type "${type}".`);
        });
        if (!isSafeCssColorValue(option?.borderColor)) warnings.push("Light border color must be a safe CSS color string.");
        if (!isSafeCssColorValue(option?.darkBorderColor)) warnings.push("Dark border color must be a safe CSS color string.");

        const prereqIds = Array.from(extractReferencedIds(option?.prerequisites));
        prereqIds.forEach(id => {
            if (id === selfId && selfId) warnings.push("Prerequisite references this option itself.");
            if (!allIds.has(id)) warnings.push(`Prerequisite references unknown option ID "${id}".`);
        });
        Array.from(extractRequirementPointTypes(option?.prerequisites)).forEach(type => {
            if (!pointTypes.has(type)) warnings.push(`Prerequisite references unknown point type "${type}".`);
        });
        (option?.costOptions || []).forEach((costOption, index) => {
            Array.from(extractRequirementPointTypes(costOption?.prerequisites)).forEach(type => {
                if (!pointTypes.has(type)) warnings.push(`Payment option ${index + 1} prerequisite references unknown point type "${type}".`);
            });
        });
        const categoryNames = new Set(state.data.filter(entry => !entry.type || entry.name).map(entry => entry.name).filter(Boolean));
        const subcategoryNames = new Set();
        state.data.filter(entry => !entry.type || entry.name).forEach(category => {
            walkEditorSubcategories(category.subcategories || [], (subcat, path = []) => {
                if (subcat?.name) subcategoryNames.add(subcat.name);
                const pathNames = [category.name, ...path.map(entry => entry?.name).filter(Boolean)];
                if (pathNames.length > 1) subcategoryNames.add(pathNames.join(" > "));
            });
        });
        const warnUnknownScopeRequirements = (requirement, context) => {
            extractRequirementScopes(requirement).forEach(scope => {
                if (scope.type === "category" && !categoryNames.has(scope.name)) warnings.push(`${context} references unknown category "${scope.name}".`);
                if (scope.type === "subcategory" && !subcategoryNames.has(scope.name)) warnings.push(`${context} references unknown subcategory "${scope.name}".`);
            });
        };
        warnUnknownScopeRequirements(option?.prerequisites, "Prerequisite");
        (option?.costOptions || []).forEach((costOption, index) => {
            warnUnknownScopeRequirements(costOption?.prerequisites, `Payment option ${index + 1} prerequisite`);
        });

        const rawConflicts = Array.isArray(option?.conflictsWith) ? option.conflictsWith : [];
        const conflicts = normalizeIdList(rawConflicts);
        if (rawConflicts.length !== conflicts.length) {
            warnings.push("Incompatible option list contains duplicates or blank IDs.");
        }
        conflicts.forEach(id => {
            if (id === selfId && selfId) warnings.push("Incompatible option list contains this option itself.");
            if (!allIds.has(id)) warnings.push(`Incompatible option ID "${id}" does not exist.`);
        });

        const rules = getModifiedCostRulesForEditor(option);
        rules.forEach((rule, index) => {
            const ruleNo = index + 1;
            const ids = normalizeIdList(rule?.idsAny || rule?.ids || (rule?.id ? [rule.id] : []));
            const slotMode = (Number(rule?.slots) || 0) > 0 && (rule?.mode === "free" || rule?.mode === "half");
            if (!ids.length) warnings.push(`Rule ${ruleNo}: add at least one trigger option ID.`);
            ids.forEach(id => {
                if (id === selfId && selfId) warnings.push(`Rule ${ruleNo}: trigger list includes this option itself.`);
                if (!allIds.has(id)) warnings.push(`Rule ${ruleNo}: trigger ID "${id}" does not exist.`);
            });
            if (Array.isArray(rule?.idsAny)) {
                const min = Math.max(1, Number(rule?.minSelected) || 1);
                if (min > ids.length && ids.length > 0) {
                    warnings.push(`Rule ${ruleNo}: "Min selected" (${min}) is greater than trigger IDs (${ids.length}).`);
                }
            }
            if (slotMode) {
                const slots = Number(rule?.slots) || 0;
                if (slots < 1) warnings.push(`Rule ${ruleNo}: slots must be at least 1.`);
            } else if (
                (!rule?.cost || !Object.keys(rule.cost).length)
                && (!rule?.costDelta || !Object.keys(rule.costDelta).length)
                && (!rule?.costPercent || !Object.keys(rule.costPercent).length)
                && (!rule?.minCost || !Object.keys(rule.minCost).length)
                && (!rule?.maxCost || !Object.keys(rule.maxCost).length)
            ) {
                warnings.push(`Rule ${ruleNo}: add a modified, relative, percentage, minimum, or maximum cost map.`);
            }
            warnUnknownPointTypes(rule?.cost, `Rule ${ruleNo} modified cost`);
            warnUnknownPointTypes(rule?.costDelta, `Rule ${ruleNo} relative cost change`);
            warnUnknownPointTypes(rule?.costPercent, `Rule ${ruleNo} percentage cost change`);
            warnUnknownPointTypes(rule?.minCost, `Rule ${ruleNo} minimum cost`);
            warnUnknownPointTypes(rule?.maxCost, `Rule ${ruleNo} maximum cost`);
            Object.keys(rule?.minCost || {}).forEach(type => {
                const min = Number(rule.minCost[type]);
                const max = Number(rule?.maxCost?.[type]);
                if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
                    warnings.push(`Rule ${ruleNo}: minimum cost for "${type}" is greater than maximum cost.`);
                }
            });
            if (rule?.priority !== undefined && !Number.isFinite(Number(rule.priority))) {
                warnings.push(`Rule ${ruleNo}: priority must be a number.`);
            }
        });

        const grantRules = Array.isArray(option?.discountGrants) ? option.discountGrants : [];
        grantRules.forEach((rule, index) => {
            const ruleNo = index + 1;
            const targets = normalizeIdList(rule?.targetIds || rule?.targets || (rule?.targetId ? [rule.targetId] : []));
            if (!targets.length) {
                warnings.push(`Grant rule ${ruleNo}: add at least one target option ID.`);
            }
            targets.forEach(id => {
                if (id === selfId && selfId) warnings.push(`Grant rule ${ruleNo}: target list includes this option itself.`);
                if (!allIds.has(id)) warnings.push(`Grant rule ${ruleNo}: target option ID "${id}" does not exist.`);
            });
            const slots = Number(rule?.slots) || 0;
            if (slots < 1) {
                warnings.push(`Grant rule ${ruleNo}: slots must be at least 1.`);
            }
        });

        return Array.from(new Set(warnings));
    }

    function getSortedOptionIds(excludeIds = []) {
        const exclude = new Set(normalizeIdList(excludeIds));
        return Array.from(collectOptionIds())
            .filter(id => id && !exclude.has(id))
            .sort((a, b) => a.localeCompare(b));
    }

    let optionDatalistCounter = 0;

    function mountIdListEditor(container, {
        ids = [],
        excludeIds = [],
        emptyText = "No option IDs selected yet.",
        onChange
    } = {}) {
        if (!container) return;
        const normalized = normalizeIdList(ids);
        container.innerHTML = "";

        const list = document.createElement("div");
        list.className = "list-stack";
        if (!normalized.length) {
            const empty = document.createElement("div");
            empty.className = "empty-state";
            empty.textContent = emptyText;
            list.appendChild(empty);
        } else {
            normalized.forEach(id => {
                const row = document.createElement("div");
                row.className = "option-rule-row";

                const input = document.createElement("input");
                input.type = "text";
                input.value = id;
                input.readOnly = true;

                const removeBtn = document.createElement("button");
                removeBtn.type = "button";
                removeBtn.className = "button-icon danger";
                removeBtn.title = "Remove";
                removeBtn.textContent = "✕";
                removeBtn.addEventListener("click", () => {
                    const next = normalized.filter(entry => entry !== id);
                    onChange?.(next);
                });

                row.appendChild(input);
                row.appendChild(removeBtn);
                list.appendChild(row);
            });
        }
        container.appendChild(list);

        const addRow = document.createElement("div");
        addRow.className = "option-rule-row";

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Add option ID";

        const datalist = document.createElement("datalist");
        const datalistId = `option-id-list-${++optionDatalistCounter}`;
        datalist.id = datalistId;
        getSortedOptionIds([...excludeIds, ...normalized]).forEach(id => {
            const opt = document.createElement("option");
            opt.value = id;
            datalist.appendChild(opt);
        });
        input.setAttribute("list", datalistId);

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "button-subtle";
        addBtn.textContent = "Add";
        const commit = () => {
            const nextId = input.value.trim();
            if (!nextId) return;
            if (normalized.includes(nextId)) {
                showEditorMessage(`"${nextId}" is already in this list.`, "warning", 3000);
                return;
            }
            if (excludeIds.includes(nextId)) {
                showEditorMessage(`"${nextId}" is not allowed here.`, "warning", 3000);
                return;
            }
            onChange?.([...normalized, nextId]);
        };
        addBtn.addEventListener("click", commit);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                commit();
            }
        });

        addRow.appendChild(input);
        addRow.appendChild(addBtn);
        container.appendChild(addRow);
        container.appendChild(datalist);
    }

    function slugifyLabel(label) {
        if (typeof label !== "string") return "";
        // Split by transitions between lowercase and uppercase, and match all alphanumeric groups
        const words = label.replace(/([a-z])([A-Z])/g, "$1 $2").match(/[A-Za-z0-9]+/g);
        if (!words || !words.length) return "";
        const [first, ...rest] = words;
        const firstPart = first.toLowerCase();
        const remainder = rest.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join("");
        return firstPart + remainder;
    }

    function normalizeIdBase(base) {
        if (base == null) return "option";
        let normalized = String(base).trim();
        normalized = normalized.replace(/[^A-Za-z0-9_]/g, "");
        if (!normalized) normalized = "option";
        if (/^\d/.test(normalized)) {
            normalized = `opt${normalized}`;
        }
        return normalized;
    }

    function generateOptionId(label = "option", {
        path = [],
        skipOption = null
    } = {}) {
        const used = collectOptionIds();
        if (skipOption && skipOption.id) {
            used.delete(skipOption.id);
        }

        // Combine path parts and label
        const fullParts = [...path, label].filter(Boolean);
        const base = fullParts.map((p, i) => {
            const s = slugifyLabel(p);
            // Capitalize first letter of subsequent parts for camelCase
            return i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
        }).join("");

        const normalized = normalizeIdBase(base);
        let candidate = normalized;
        let attempt = 1;
        while (used.has(candidate)) {
            candidate = `${normalized}${attempt}`;
            attempt += 1;
        }
        return candidate;
    }

    function syncOptionIds(path, options = []) {
        if (!Array.isArray(options)) return;
        options.forEach(opt => {
            optionIdAutoMap.set(opt, true);
            opt.id = generateOptionId(opt.label, { path, skipOption: opt });
        });
    }

    function syncSubcategoryTreeOptionIds(basePath, subcategories = []) {
        if (!Array.isArray(subcategories)) return;
        subcategories.forEach(subcat => {
            const nextPath = [...basePath, subcat?.name || ""].filter(Boolean);
            syncOptionIds(nextPath, subcat?.options || []);
            syncSubcategoryTreeOptionIds(nextPath, subcat?.subcategories || []);
        });
    }

    function regenerateAllOptionIds() {
        const categories = getCategorySnapshots();
        categories.forEach(({ entry: category }) => {
            const basePath = [category?.name || ""].filter(Boolean);
            syncSubcategoryTreeOptionIds(basePath, category?.subcategories || []);
        });
    }

    function schedulePreviewUpdate() {
        pendingPreviewData = cloneData(state.data);
        if (previewUpdateHandle) return;
        previewUpdateHandle = setTimeout(() => {
            previewUpdateHandle = null;
            flushPreviewUpdate();
        }, 250);
    }

    function postPreviewUpdate(targetWindow, payload) {
        if (!targetWindow || targetWindow.closed) return false;
        targetWindow.postMessage({
            type: "cyoa-data-update",
            payload
        }, "*");
        return true;
    }

    function flushPreviewUpdate() {
        if (!pendingPreviewData) return;
        const hasDetachedPreview = !!(detachedPreviewWindow && !detachedPreviewWindow.closed);
        if (!state.previewReady && !hasDetachedPreview) return;
        const payload = pendingPreviewData;
        if (previewStatusEl) {
            previewStatusEl.textContent = "Updating preview…";
            previewStatusEl.dataset.state = "pending";
        }
        queueTempSave(payload);
        if (state.previewReady && previewFrame?.contentWindow) {
            postPreviewUpdate(previewFrame.contentWindow, payload);
        }
        if (hasDetachedPreview) {
            postPreviewUpdate(detachedPreviewWindow, payload);
        }
        pendingPreviewData = null;
    }

    function preventSummaryToggle(element) {
        if (!element) return;
        ["click", "mousedown"].forEach(eventName => {
            element.addEventListener(eventName, (event) => {
                event.stopPropagation();
            });
        });
    }

    function createSectionContainer(title, {
        defaultOpen = true,
        storageKey = title
    } = {}) {
        const details = document.createElement("details");
        details.className = "section-block";
        details.dataset.storageKey = storageKey;
        const stored = sectionOpenState.has(storageKey) ? sectionOpenState.get(storageKey) : defaultOpen;
        if (stored) {
            details.open = true;
        }
        const summary = document.createElement("summary");
        summary.textContent = title;
        const body = document.createElement("div");
        body.className = "section-body";
        details.append(summary, body);
        details.addEventListener("toggle", () => {
            sectionOpenState.set(storageKey, details.open);
        });
        return {
            container: details,
            body,
            summary
        };
    }

    function moveArrayItem(arr, index, direction) {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= arr.length) return false;
        const temp = arr[index];
        arr[index] = arr[targetIndex];
        arr[targetIndex] = temp;
        return true;
    }

    function keepPanelOpen(category, subcategory) {
        if (category) categoryOpenState.set(category, true);
        if (subcategory) subcategoryOpenState.set(subcategory, true);
    }

    function slugifyKey(str) {
        return String(str || "").replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '');
    }

    function normalizedPathKey(parts = []) {
        return parts
            .filter(part => part != null && String(part).trim() !== "")
            .map(part => slugifyKey(String(part)))
            .filter(Boolean)
            .join("__") || "section";
    }

    function buildEditorNodeId(kind, parts = []) {
        return `editor-${kind}-${normalizedPathKey(parts)}`;
    }

    function normalizeFilterText(value) {
        return String(value || "").trim().toLowerCase();
    }

    function optionMatchesFilter(option, query) {
        if (!query) return true;
        const haystack = [
            option?.label,
            option?.id,
            option?.description,
            option?.image
        ].join(" ").toLowerCase();
        return haystack.includes(query);
    }

    function subcategoryMatchesFilter(subcat, query) {
        if (!query) return true;
        const haystack = [
            subcat?.name,
            subcat?.text,
            subcat?.type
        ].join(" ").toLowerCase();
        if (haystack.includes(query)) return true;
        if ((subcat?.options || []).some(option => optionMatchesFilter(option, query))) return true;
        return (subcat?.subcategories || []).some(child => subcategoryMatchesFilter(child, query));
    }

    function categoryMatchesFilter(category, query) {
        if (!query) return true;
        const haystack = [
            category?.name,
            category?.description
        ].join(" ").toLowerCase();
        if (haystack.includes(query)) return true;
        return (category?.subcategories || []).some(subcat => subcategoryMatchesFilter(subcat, query));
    }

    function countSubcategoryNodes(subcategories = []) {
        return subcategories.reduce((total, subcat) => total + 1 + countSubcategoryNodes(subcat?.subcategories || []), 0);
    }

    function countOptionNodes(subcategories = []) {
        return subcategories.reduce((total, subcat) => total + (subcat?.options || []).length + countOptionNodes(subcat?.subcategories || []), 0);
    }

    function createSummaryHeader(labelText, badges = []) {
        const wrapper = document.createElement("div");
        wrapper.className = "summary-main";

        const text = document.createElement("span");
        text.className = "summary-text";
        text.textContent = labelText;
        wrapper.appendChild(text);

        if (badges.length) {
            const meta = document.createElement("div");
            meta.className = "summary-meta";
            badges.forEach(badgeText => {
                const badge = document.createElement("span");
                badge.className = "summary-badge";
                badge.textContent = badgeText;
                meta.appendChild(badge);
            });
            wrapper.appendChild(meta);
        }

        return wrapper;
    }

    function revealEditorNode(targetId) {
        if (!targetId) return;
        const target = document.getElementById(targetId);
        if (!target) return;
        let current = target.parentElement;
        while (current) {
            if (current.tagName === "DETAILS") {
                current.open = true;
            }
            current = current.parentElement;
        }
        target.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }

    function setAllEditorDetailsOpen(open) {
        getCategorySnapshots().forEach(({ entry: category }) => {
            categoryOpenState.set(category, open);
            walkEditorSubcategories(category.subcategories || [], (subcat) => {
                subcategoryOpenState.set(subcat, open);
                (subcat.options || []).forEach(option => {
                    optionOpenState.set(option, open);
                });
            });
        });
        globalSettingsEl?.querySelectorAll("details").forEach((node) => {
            if (node.dataset.storageKey) {
                sectionOpenState.set(node.dataset.storageKey, open);
            }
            node.open = open;
        });
        categoryListEl?.querySelectorAll("details").forEach((node) => {
            if (node.dataset.storageKey) {
                sectionOpenState.set(node.dataset.storageKey, open);
            }
            node.open = open;
        });
    }

    function renderEditorNavigation(categorySnapshots = getCategorySnapshots()) {
        if (!editorOverviewEl || !editorNavigatorEl) return;

        const visibleCategories = categorySnapshots
            .map((snapshot, position) => ({ ...snapshot, position }))
            .filter(({ entry }) => categoryMatchesFilter(entry, state.filterQuery));

        const totalSubcategories = visibleCategories.reduce((sum, { entry }) => sum + countSubcategoryNodes(entry.subcategories || []), 0);
        const totalOptions = visibleCategories.reduce((sum, { entry }) => sum + countOptionNodes(entry.subcategories || []), 0);

        editorOverviewEl.innerHTML = "";
        const overviewText = document.createElement("div");
        overviewText.className = "editor-overview-text";
        overviewText.textContent = `${visibleCategories.length} categories, ${totalSubcategories} subcategories, ${totalOptions} options`;
        editorOverviewEl.appendChild(overviewText);

        editorNavigatorEl.innerHTML = "";
        if (!visibleCategories.length) {
            const empty = document.createElement("div");
            empty.className = "navigator-empty";
            empty.textContent = state.filterQuery
                ? `No matches for "${state.filterQuery}".`
                : "No categories yet.";
            editorNavigatorEl.appendChild(empty);
            return;
        }

        const searching = Boolean(state.filterQuery);
        const list = document.createElement("div");
        list.className = "nav-list";

        visibleCategories.forEach(({ entry: category, position }) => {
            const categoryName = category.name?.trim() ? category.name : `Category ${position + 1}`;
            const categoryBtn = document.createElement("button");
            categoryBtn.type = "button";
            categoryBtn.className = "nav-item";
            categoryBtn.dataset.targetId = buildEditorNodeId("category", [position + 1]);
            categoryBtn.innerHTML = `
                <span class="nav-item-label">
                    <span class="nav-item-depth">C</span>
                    <span class="nav-item-text">${categoryName}</span>
                </span>
                <span class="nav-item-meta">${countOptionNodes(category.subcategories || [])} options</span>
            `;
            list.appendChild(categoryBtn);

            if (!searching) return;

            const appendSubcategoryItems = (subcategories, indexPath = [], depth = 1, parentNames = []) => {
                (subcategories || []).forEach((subcat, subIndex) => {
                    if (!subcategoryMatchesFilter(subcat, state.filterQuery)) return;
                    const nextIndexPath = [...indexPath, subIndex + 1];
                    const nextNames = [...parentNames, subcat.name || `Subcategory ${subIndex + 1}`];
                    const subBtn = document.createElement("button");
                    subBtn.type = "button";
                    subBtn.className = "nav-item";
                    subBtn.dataset.targetId = buildEditorNodeId("subcategory", [position + 1, ...nextIndexPath]);
                    subBtn.innerHTML = `
                        <span class="nav-item-label">
                            <span class="nav-item-depth">${depth}</span>
                            <span class="nav-item-text">${nextNames.join(" / ")}</span>
                        </span>
                        <span class="nav-item-meta">${(subcat.options || []).length} direct</span>
                    `;
                    list.appendChild(subBtn);

                    (subcat.options || []).forEach((option, optionIndex) => {
                        if (!optionMatchesFilter(option, state.filterQuery)) return;
                        const optionBtn = document.createElement("button");
                        optionBtn.type = "button";
                        optionBtn.className = "nav-item";
                        optionBtn.dataset.targetId = buildEditorNodeId("option", [position + 1, ...nextIndexPath, optionIndex + 1]);
                        optionBtn.innerHTML = `
                            <span class="nav-item-label">
                                <span class="nav-item-depth">•</span>
                                <span class="nav-item-text">${option.label || `Option ${optionIndex + 1}`}</span>
                            </span>
                            <span class="nav-item-meta">${option.id || "auto id"}</span>
                        `;
                        list.appendChild(optionBtn);
                    });

                    appendSubcategoryItems(subcat.subcategories || [], nextIndexPath, depth + 1, nextNames);
                });
            };

            appendSubcategoryItems(category.subcategories || []);
        });

        editorNavigatorEl.appendChild(list);
    }

    function buildSubcategoryKey(catIndex, catName, subIndex, subName) {
        const catPart = `${catIndex}-${slugifyKey(catName || `Category${catIndex}`)}`;
        const subPart = `${subIndex}-${slugifyKey(subName || `Sub${subIndex}`)}`;
        return `${catPart}__${subPart}`;
    }

    function createDefaultCategory() {
        return {
            name: "New Category",
            subcategories: [createDefaultSubcategory()]
        };
    }

    function createDefaultSubcategory() {
        return {
            name: "New Section",
            type: "storyBlock",
            text: "",
            options: [],
            subcategories: []
        };
    }

    function createDefaultOption(categoryName = "", subcategoryName = "") {
        const option = {
            label: "New Option",
            description: "",
            costOptions: [
                {
                    cost: {}
                }
            ]
        };
        const path = [];
        if (Array.isArray(categoryName)) {
            categoryName.filter(Boolean).forEach(part => path.push(part));
        } else if (categoryName) {
            path.push(categoryName);
        }
        if (Array.isArray(subcategoryName)) {
            subcategoryName.filter(Boolean).forEach(part => path.push(part));
        } else if (subcategoryName) {
            path.push(subcategoryName);
        }

        option.id = generateOptionId(option.label, { path });
        optionIdAutoMap.set(option, true);
        return option;
    }

    function ensurePaymentOptionsForEditor(option) {
        if (!option || typeof option !== "object") return;
        if (Array.isArray(option.costOptions) && option.costOptions.length > 0) {
            option.costOptions = option.costOptions.map(entry => {
                const normalized = {
                    cost: entry?.cost && typeof entry.cost === "object" ? entry.cost : {}
                };
                if (Array.isArray(entry?.costBySelection)) {
                    normalized.costBySelection = entry.costBySelection.map(cost =>
                        cost && typeof cost === "object" && !Array.isArray(cost) ? cost : {}
                    );
                }
                return normalized;
            });
            delete option.cost;
            return;
        }

        const migratedCost = option.cost && typeof option.cost === "object" && !Array.isArray(option.cost)
            ? { ...option.cost }
            : {};
        option.costOptions = [
            {
                cost: migratedCost
            }
        ];
        delete option.cost;
    }

    function renderModifiedCostRulesEditor(container, owner, {
        emptyText = "No modified cost rules yet.",
        addButtonText = "Add modified cost rule",
        includeSlotBehavior = false,
        onChange = () => {}
    } = {}) {
        container.innerHTML = "";
        const rules = Array.isArray(owner?.modifiedCosts) || Array.isArray(owner?.discounts)
            ? ensureModifiedCostRulesForEditor(owner)
            : [];
        if (!rules.length) {
            const empty = document.createElement("div");
            empty.className = "empty-state";
            empty.textContent = emptyText;
            container.appendChild(empty);
        }

        rules.forEach((rule, ruleIndex) => {
            const ruleCard = document.createElement("div");
            ruleCard.className = "discount-rule-card";
            const getRuleBehavior = () => {
                if (includeSlotBehavior && (Number(rule?.slots) || 0) > 0 && (rule?.mode === "free" || rule?.mode === "half")) {
                    return "slots";
                }
                if (Object.prototype.hasOwnProperty.call(rule || {}, "costDelta")) {
                    return "relative";
                }
                if (Object.prototype.hasOwnProperty.call(rule || {}, "costPercent")) {
                    return "percent";
                }
                return "cost";
            };

            const header = document.createElement("div");
            header.className = "discount-rule-header";
            const title = document.createElement("strong");
            title.textContent = `Rule ${ruleIndex + 1}`;
            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.textContent = "✕";
            removeBtn.title = "Delete rule";
            removeBtn.addEventListener("click", () => {
                rules.splice(ruleIndex, 1);
                setModifiedCostRulesForEditor(owner, rules);
                renderModifiedCostRulesEditor(container, owner, { emptyText, addButtonText, includeSlotBehavior, onChange });
                onChange();
            });
            header.append(title, removeBtn);
            ruleCard.appendChild(header);

            const behaviorRow = document.createElement("div");
            behaviorRow.className = "field-inline field-inline-three";
            const behaviorLabel = document.createElement("label");
            behaviorLabel.textContent = includeSlotBehavior ? "Rule behavior" : "Behavior";
            const behaviorInput = document.createElement("select");
            const costBehavior = document.createElement("option");
            costBehavior.value = "cost";
            costBehavior.textContent = "Set modified cost";
            behaviorInput.appendChild(costBehavior);
            const relativeBehavior = document.createElement("option");
            relativeBehavior.value = "relative";
            relativeBehavior.textContent = "Adjust cost relatively";
            behaviorInput.appendChild(relativeBehavior);
            const percentBehavior = document.createElement("option");
            percentBehavior.value = "percent";
            percentBehavior.textContent = "Adjust cost by percentage";
            behaviorInput.appendChild(percentBehavior);
            if (includeSlotBehavior) {
                const slotBehavior = document.createElement("option");
                slotBehavior.value = "slots";
                slotBehavior.textContent = "Discount slots";
                behaviorInput.appendChild(slotBehavior);
            }
            behaviorInput.value = getRuleBehavior();
            behaviorInput.addEventListener("change", () => {
                if (behaviorInput.value === "slots") {
                    delete rule.cost;
                    delete rule.costDelta;
                    delete rule.costPercent;
                    delete rule.minCost;
                    delete rule.maxCost;
                    rule.slots = Math.max(1, Number(rule.slots) || 1);
                    rule.mode = rule.mode === "free" ? "free" : "half";
                } else if (behaviorInput.value === "relative") {
                    delete rule.slots;
                    delete rule.mode;
                    delete rule.cost;
                    delete rule.costPercent;
                    rule.costDelta = rule.costDelta && Object.keys(rule.costDelta).length ? rule.costDelta : {};
                } else if (behaviorInput.value === "percent") {
                    delete rule.slots;
                    delete rule.mode;
                    delete rule.cost;
                    delete rule.costDelta;
                    rule.costPercent = rule.costPercent && Object.keys(rule.costPercent).length ? rule.costPercent : {};
                } else {
                    delete rule.slots;
                    delete rule.mode;
                    delete rule.costDelta;
                    delete rule.costPercent;
                    rule.cost = rule.cost && Object.keys(rule.cost).length ? rule.cost : {};
                }
                renderModifiedCostRulesEditor(container, owner, { emptyText, addButtonText, includeSlotBehavior, onChange });
                onChange();
            });

            const priorityLabel = document.createElement("label");
            priorityLabel.textContent = "Priority";
            const priorityInput = document.createElement("input");
            priorityInput.type = "number";
            priorityInput.value = Number.isFinite(Number(rule.priority)) ? String(rule.priority) : String(ruleIndex + 1);
            priorityInput.title = "Higher priority matching modified cost rules override lower priority matching rules.";
            priorityInput.addEventListener("input", () => {
                const value = priorityInput.value.trim();
                if (value === "") {
                    delete rule.priority;
                } else {
                    const parsed = Number(value);
                    if (Number.isFinite(parsed)) rule.priority = parsed;
                }
                onChange();
            });
            behaviorRow.append(behaviorLabel, behaviorInput, priorityLabel, priorityInput);
            ruleCard.appendChild(behaviorRow);

            const modeRow = document.createElement("div");
            modeRow.className = "field-inline field-inline-three";
            const modeLabel = document.createElement("label");
            modeLabel.textContent = "Trigger mode";
            const modeInput = document.createElement("select");
            const modeAll = document.createElement("option");
            modeAll.value = "all";
            modeAll.textContent = "Require all listed IDs";
            const modeAny = document.createElement("option");
            modeAny.value = "any";
            modeAny.textContent = "Require at least N IDs";
            modeInput.append(modeAll, modeAny);

            const isAnyMode = Array.isArray(rule.idsAny) && rule.idsAny.length > 0;
            modeInput.value = isAnyMode ? "any" : "all";

            const minLabel = document.createElement("label");
            minLabel.textContent = "Min selected";
            const minInput = document.createElement("input");
            minInput.type = "number";
            minInput.min = "1";
            minInput.value = Number.isFinite(rule.minSelected) && rule.minSelected > 0 ? String(rule.minSelected) : "1";
            minInput.disabled = modeInput.value !== "any";

            modeInput.addEventListener("change", () => {
                const triggerIds = normalizeIdList(modeInput.value === "any"
                    ? rule.idsAny
                    : (Array.isArray(rule.ids) ? rule.ids : (rule.id ? [rule.id] : [])));
                if (modeInput.value === "any") {
                    rule.idsAny = triggerIds;
                    rule.minSelected = Math.max(1, Number(rule.minSelected) || 1);
                    delete rule.ids;
                    delete rule.id;
                } else {
                    rule.ids = triggerIds;
                    delete rule.idsAny;
                    delete rule.minSelected;
                    delete rule.id;
                }
                renderModifiedCostRulesEditor(container, owner, { emptyText, addButtonText, includeSlotBehavior, onChange });
                onChange();
            });

            minInput.addEventListener("input", () => {
                const parsed = Math.max(1, Number(minInput.value) || 1);
                rule.minSelected = parsed;
                minInput.value = String(parsed);
                onChange();
            });
            modeRow.append(modeLabel, modeInput, minLabel, minInput);
            ruleCard.appendChild(modeRow);

            const idsField = document.createElement("div");
            idsField.className = "field";
            const idsLabel = document.createElement("label");
            idsLabel.textContent = "Trigger option IDs";
            const idsContainer = document.createElement("div");
            const setTriggerIds = (nextIds) => {
                if (modeInput.value === "any") {
                    rule.idsAny = nextIds;
                    rule.minSelected = Math.max(1, Number(rule.minSelected) || 1);
                    delete rule.ids;
                    delete rule.id;
                } else {
                    rule.ids = nextIds;
                    delete rule.idsAny;
                    delete rule.minSelected;
                    delete rule.id;
                }
                mountIdListEditor(idsContainer, {
                    ids: modeInput.value === "any" ? rule.idsAny : rule.ids,
                    emptyText: "No trigger IDs added yet.",
                    onChange: setTriggerIds
                });
                onChange();
            };
            mountIdListEditor(idsContainer, {
                ids: modeInput.value === "any" ? rule.idsAny : rule.ids,
                emptyText: "No trigger IDs added yet.",
                onChange: setTriggerIds
            });
            idsField.append(idsLabel, idsContainer);
            ruleCard.appendChild(idsField);

            if (behaviorInput.value === "slots") {
                const slotSettingsRow = document.createElement("div");
                slotSettingsRow.className = "field-inline field-inline-three";
                const slotsLabel = document.createElement("label");
                slotsLabel.textContent = "Slots";
                const slotsInput = document.createElement("input");
                slotsInput.type = "number";
                slotsInput.min = "1";
                slotsInput.value = String(Math.max(1, Number(rule.slots) || 1));
                const discountModeLabel = document.createElement("label");
                discountModeLabel.textContent = "Slot mode";
                const discountModeInput = document.createElement("select");
                const halfMode = document.createElement("option");
                halfMode.value = "half";
                halfMode.textContent = "Half cost";
                const freeMode = document.createElement("option");
                freeMode.value = "free";
                freeMode.textContent = "Free";
                discountModeInput.append(halfMode, freeMode);
                discountModeInput.value = rule.mode === "free" ? "free" : "half";
                slotsInput.addEventListener("input", () => {
                    const parsed = Math.max(1, Number(slotsInput.value) || 1);
                    rule.slots = parsed;
                    slotsInput.value = String(parsed);
                    onChange();
                });
                discountModeInput.addEventListener("change", () => {
                    rule.mode = discountModeInput.value === "free" ? "free" : "half";
                    onChange();
                });
                slotSettingsRow.append(slotsLabel, slotsInput, discountModeLabel, discountModeInput);
                ruleCard.appendChild(slotSettingsRow);
            } else {
                const ruleCostField = document.createElement("div");
                ruleCostField.className = "field";
                const ruleCostLabel = document.createElement("label");
                ruleCostLabel.textContent = behaviorInput.value === "relative"
                    ? "Relative cost change when triggered"
                    : behaviorInput.value === "percent"
                        ? "Percentage cost change when triggered"
                        : "Modified cost when triggered";
                const ruleCostHint = document.createElement("div");
                ruleCostHint.className = "field-help";
                ruleCostHint.textContent = behaviorInput.value === "relative"
                    ? "Adds these values to the current cost. Use positive numbers to increase price and negative numbers to reduce it."
                    : behaviorInput.value === "percent"
                        ? "Changes positive costs by this percentage and rounds the final price up. Example: -15 makes a cost 15% cheaper."
                        : "Replaces the current cost for the listed point types.";
                const ruleCostContainer = document.createElement("div");
                ruleCostContainer.className = "cost-list";
                if (behaviorInput.value === "relative") {
                    renderPointMapEditor(ruleCostContainer, rule.costDelta || {}, (nextCost) => {
                        rule.costDelta = nextCost || {};
                        onChange();
                    });
                } else if (behaviorInput.value === "percent") {
                    renderPointMapEditor(ruleCostContainer, rule.costPercent || {}, (nextCost) => {
                        rule.costPercent = nextCost || {};
                        onChange();
                    });
                } else {
                    renderPointMapEditor(ruleCostContainer, rule.cost || {}, (nextCost) => {
                        if (nextCost) rule.cost = nextCost;
                        else delete rule.cost;
                        onChange();
                    });
                }
                ruleCostField.append(ruleCostLabel, ruleCostHint, ruleCostContainer);
                ruleCard.appendChild(ruleCostField);

                const minCostField = document.createElement("div");
                minCostField.className = "field";
                const minCostLabel = document.createElement("label");
                minCostLabel.textContent = "Minimum cost after modifiers";
                const minCostHint = document.createElement("div");
                minCostHint.className = "field-help";
                minCostHint.textContent = "Optional lower bound. Example: set Points 0 to prevent this rule from making the option grant points.";
                const minCostContainer = document.createElement("div");
                minCostContainer.className = "cost-list";
                renderPointMapEditor(minCostContainer, rule.minCost || {}, (nextCost) => {
                    if (nextCost) rule.minCost = nextCost;
                    else delete rule.minCost;
                    onChange();
                });
                minCostField.append(minCostLabel, minCostHint, minCostContainer);
                ruleCard.appendChild(minCostField);

                const maxCostField = document.createElement("div");
                maxCostField.className = "field";
                const maxCostLabel = document.createElement("label");
                maxCostLabel.textContent = "Maximum cost after modifiers";
                const maxCostHint = document.createElement("div");
                maxCostHint.className = "field-help";
                maxCostHint.textContent = "Optional upper bound. Example: set Points 10 to prevent this rule from costing more than 10.";
                const maxCostContainer = document.createElement("div");
                maxCostContainer.className = "cost-list";
                renderPointMapEditor(maxCostContainer, rule.maxCost || {}, (nextCost) => {
                    if (nextCost) rule.maxCost = nextCost;
                    else delete rule.maxCost;
                    onChange();
                });
                maxCostField.append(maxCostLabel, maxCostHint, maxCostContainer);
                ruleCard.appendChild(maxCostField);
            }

            container.appendChild(ruleCard);
        });

        const addRuleBtn = document.createElement("button");
        addRuleBtn.type = "button";
        addRuleBtn.className = "button-subtle";
        addRuleBtn.textContent = addButtonText;
        addRuleBtn.addEventListener("click", () => {
            const rules = ensureModifiedCostRulesForEditor(owner);
            rules.push({
                ids: [],
                cost: {},
                priority: rules.length + 1
            });
            renderModifiedCostRulesEditor(container, owner, { emptyText, addButtonText, includeSlotBehavior, onChange });
            onChange();
        });
        container.appendChild(addRuleBtn);
    }

    function renderGlobalSettings() {
        const fragment = document.createDocumentFragment();

        const titleEntry = ensureEntry("title", () => ({
            type: "title",
            text: ""
        })).entry;
        const titleSection = createSectionContainer("Title");
        const titleField = document.createElement("div");
        titleField.className = "field";
        const titleLabel = document.createElement("label");
        titleLabel.textContent = "Displayed title";
        titleLabel.htmlFor = "globalTitleInput";
        const titleInput = document.createElement("input");
        titleInput.id = "globalTitleInput";
        titleInput.type = "text";
        titleInput.value = titleEntry.text || "";
        titleInput.placeholder = "Naruto Jumpchain CYOA";
        titleInput.addEventListener("input", () => {
            titleEntry.text = titleInput.value;
            schedulePreviewUpdate();
        });
        titleField.appendChild(titleLabel);
        titleField.appendChild(titleInput);
        titleSection.body.appendChild(titleField);
        fragment.appendChild(titleSection.container);

        const descriptionEntry = ensureEntry("description", () => ({
            type: "description",
            text: ""
        })).entry;
        const descriptionSection = createSectionContainer("Description");
        const descField = document.createElement("div");
        descField.className = "field";
        const descLabel = document.createElement("label");
        descLabel.textContent = "Intro text";
        descLabel.htmlFor = "globalDescriptionInput";
        const descriptionTextarea = document.createElement("textarea");
        descriptionTextarea.id = "globalDescriptionInput";
        descriptionTextarea.value = descriptionEntry.text || "";
        descriptionTextarea.placeholder = "World overview shown under the header. Supports Markdown like **bold**, *italic*, # headings, lists, links, and legacy [color=#d32f2f]red[/color] tags.";
        descriptionTextarea.addEventListener("input", () => {
            descriptionEntry.text = descriptionTextarea.value;
            schedulePreviewUpdate();
        });
        descField.appendChild(descLabel);
        descField.appendChild(descriptionTextarea);
        descriptionSection.body.appendChild(descField);
        fragment.appendChild(descriptionSection.container);

        const headerImageEntry = ensureEntry("headerImage", () => ({
            type: "headerImage",
            url: ""
        })).entry;
        const headerSection = createSectionContainer("Header Image");
        const headerField = document.createElement("div");
        headerField.className = "field";
        const headerLabel = document.createElement("label");
        headerLabel.textContent = "Image URL";
        headerLabel.htmlFor = "globalHeaderInput";
        const headerInput = document.createElement("input");
        headerInput.id = "globalHeaderInput";
        headerInput.type = "url";
        headerInput.placeholder = "https://example.com/header.png";
        headerInput.value = headerImageEntry.url || "";
        headerInput.addEventListener("input", () => {
            if (headerInput.value.trim()) {
                headerImageEntry.url = headerInput.value.trim();
            } else {
                delete headerImageEntry.url;
            }
            schedulePreviewUpdate();
        });
        headerField.appendChild(headerLabel);
        headerField.appendChild(headerInput);

        // Prevent upscaling toggle
        const preventField = document.createElement("div");
        preventField.className = "field";
        const preventInput = document.createElement("input");
        preventInput.type = "checkbox";
        preventInput.id = "preventUpscaleCheckbox";
        preventInput.checked = !!headerImageEntry.preventUpscale;
        preventInput.addEventListener("change", () => {
            headerImageEntry.preventUpscale = preventInput.checked;
            if (!headerImageEntry.preventUpscale) delete headerImageEntry.preventUpscale;
            schedulePreviewUpdate();
        });
        const preventLabel = document.createElement("label");
        preventLabel.htmlFor = preventInput.id;
        preventLabel.textContent = "Prevent upscaling (don't stretch small images)";
        preventField.appendChild(preventInput);
        preventField.appendChild(preventLabel);
        headerSection.body.appendChild(preventField);

        headerSection.body.appendChild(headerField);
        fragment.appendChild(headerSection.container);

        const pointsEntry = ensureEntry("points", () => ({
            type: "points",
            values: {},
            allowNegative: [],
            attributeRanges: {}
        })).entry;
        if (!pointsEntry.values) pointsEntry.values = {};
        if (!pointsEntry.pointTooltips || typeof pointsEntry.pointTooltips !== "object" || Array.isArray(pointsEntry.pointTooltips)) pointsEntry.pointTooltips = {};
        if (!Array.isArray(pointsEntry.allowNegative)) pointsEntry.allowNegative = [];
        if (!pointsEntry.pointCategories || typeof pointsEntry.pointCategories !== "object" || Array.isArray(pointsEntry.pointCategories)) pointsEntry.pointCategories = {};
        if (!pointsEntry.pointCategoryDefaults || typeof pointsEntry.pointCategoryDefaults !== "object" || Array.isArray(pointsEntry.pointCategoryDefaults)) pointsEntry.pointCategoryDefaults = {};
        if (!Array.isArray(pointsEntry.derivedValues)) pointsEntry.derivedValues = [];
        if (!Array.isArray(pointsEntry.enableablePointSets)) pointsEntry.enableablePointSets = [];
        if (!pointsEntry.attributeRanges) pointsEntry.attributeRanges = {};
        fragment.appendChild(renderPointsSection(pointsEntry));

        const settingsEntry = ensureEntry("settings", () => ({
            type: "settings",
            themeMode: "toggle"
        }), {
            mergeDefaults: true
        }).entry;
        fragment.appendChild(renderThemeModeSection(settingsEntry));
        fragment.appendChild(renderOptionAlignmentSection(settingsEntry));
        const currentThemeMode = settingsEntry.themeMode === "light" || settingsEntry.themeMode === "dark" || settingsEntry.themeMode === "toggle"
            ? settingsEntry.themeMode
            : "toggle";

        const backpackEntry = ensureEntry("backpack", () => ({
            type: "backpack",
            enabled: true
        })).entry;
        fragment.appendChild(renderBackpackSection(backpackEntry));

        const themeEntry = ensureEntry("theme", () => ({ ...LIGHT_THEME_DEFAULTS }), {
            mergeDefaults: true
        }).entry;
        const darkThemeEntry = ensureEntry("darkTheme", () => ({ ...DARK_THEME_DEFAULTS }), {
            mergeDefaults: true
        }).entry;
        if (currentThemeMode === "toggle" || currentThemeMode === "light") {
            fragment.appendChild(renderThemeSection(themeEntry, "Light Theme Settings"));
            fragment.appendChild(renderTypographySection(themeEntry, "Light Typography Settings"));
        }
        if (currentThemeMode === "toggle" || currentThemeMode === "dark") {
            fragment.appendChild(renderThemeSection(darkThemeEntry, "Dark Theme Settings"));
            fragment.appendChild(renderTypographySection(darkThemeEntry, "Dark Typography Settings"));
        }

        globalSettingsEl.innerHTML = "";
        globalSettingsEl.appendChild(fragment);
    }

    function renderPointsSection(pointsEntry) {
        const {
            container,
            body
        } = createSectionContainer("Point Pools");
        const pointCategories = normalizePointCategories(pointsEntry);
        const categoryNames = Object.keys(pointCategories);

        const valuesContainer = document.createElement("div");
        valuesContainer.className = "list-stack";

        Object.entries(pointsEntry.values).forEach(([currency, amount]) => {
            let pointTypeName = currency;
            const row = document.createElement("div");
            row.className = "list-row";

            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.value = currency;
            nameInput.placeholder = "Point type, e.g. [color=gold]Gold[/color]";

            const valueInput = document.createElement("input");
            valueInput.type = "number";
            valueInput.value = typeof amount === "number" ? amount : 0;

            const tooltipInput = document.createElement("input");
            tooltipInput.type = "text";
            tooltipInput.value = pointsEntry.pointTooltips?.[currency] || "";
            tooltipInput.placeholder = "Optional tooltip";

            const categorySelect = document.createElement("select");
            const noneOpt = document.createElement("option");
            noneOpt.value = "";
            noneOpt.textContent = "Uncategorized";
            categorySelect.appendChild(noneOpt);
            categoryNames.forEach(category => {
                const opt = document.createElement("option");
                opt.value = category;
                opt.textContent = category;
                categorySelect.appendChild(opt);
            });
            categorySelect.value = getAssignedPointCategory(pointsEntry, currency);

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Remove currency";
            removeBtn.textContent = "✕";

            valueInput.addEventListener("input", () => {
                pointsEntry.values[pointTypeName] = Number(valueInput.value) || 0;
                schedulePreviewUpdate();
            });

            tooltipInput.addEventListener("input", () => {
                const tooltip = tooltipInput.value.trim();
                if (tooltip) pointsEntry.pointTooltips[pointTypeName] = tooltip;
                else delete pointsEntry.pointTooltips[pointTypeName];
                schedulePreviewUpdate();
            });

            nameInput.addEventListener("blur", () => {
                const newName = nameInput.value.trim();
                const oldName = pointTypeName;
                if (!newName || newName === oldName) {
                    nameInput.value = oldName;
                    return;
                }
                if (pointsEntry.values.hasOwnProperty(newName)) {
                    showEditorMessage(`Currency "${newName}" already exists.`, "warning");
                    nameInput.value = oldName;
                    return;
                }
                const existingValue = pointsEntry.values[oldName];
                delete pointsEntry.values[oldName];
                pointsEntry.values[newName] = existingValue;
                if (Object.prototype.hasOwnProperty.call(pointsEntry.pointTooltips, oldName)) {
                    pointsEntry.pointTooltips[newName] = pointsEntry.pointTooltips[oldName];
                    delete pointsEntry.pointTooltips[oldName];
                }
                (pointsEntry.derivedValues || []).forEach(entry => {
                    if (entry?.pointType === oldName) entry.pointType = newName;
                });
                (pointsEntry.enableablePointSets || []).forEach(set => {
                    if (set?.pointType === oldName) set.pointType = newName;
                    if (Array.isArray(set?.subtypes)) set.subtypes = set.subtypes.map(type => type === oldName ? newName : type);
                });
                renamePointTypeReferences(oldName, newName);
                Object.values(pointCategories).forEach(types => {
                    const idx = types.indexOf(oldName);
                    if (idx !== -1) types[idx] = newName;
                });

                const allowIdx = pointsEntry.allowNegative.indexOf(oldName);
                if (allowIdx !== -1) {
                    pointsEntry.allowNegative[allowIdx] = newName;
                }
                pointTypeName = newName;
                categorySelect.value = getAssignedPointCategory(pointsEntry, pointTypeName);
                renderCategories();
                schedulePreviewUpdate();
            });

            removeBtn.addEventListener("click", () => {
                delete pointsEntry.values[pointTypeName];
                delete pointsEntry.pointTooltips[pointTypeName];
                pointsEntry.allowNegative = pointsEntry.allowNegative.filter(t => t !== pointTypeName);
                pointsEntry.derivedValues = (pointsEntry.derivedValues || []).filter(entry => entry?.pointType !== pointTypeName);
                (pointsEntry.enableablePointSets || []).forEach(set => {
                    if (Array.isArray(set?.subtypes)) set.subtypes = set.subtypes.filter(type => type !== pointTypeName);
                });
                pointsEntry.enableablePointSets = (pointsEntry.enableablePointSets || []).filter(set => set?.pointType !== pointTypeName);
                Object.values(pointCategories).forEach(types => {
                    const idx = types.indexOf(pointTypeName);
                    if (idx !== -1) types.splice(idx, 1);
                });
                normalizePointCategories(pointsEntry);
                renderGlobalSettings();
                renderCategories();
                schedulePreviewUpdate();
            });

            categorySelect.addEventListener("change", () => {
                Object.values(pointCategories).forEach(types => {
                    const idx = types.indexOf(pointTypeName);
                    if (idx !== -1) types.splice(idx, 1);
                });
                if (categorySelect.value) {
                    if (!Array.isArray(pointCategories[categorySelect.value])) pointCategories[categorySelect.value] = [];
                    pointCategories[categorySelect.value].push(pointTypeName);
                }
                normalizePointCategories(pointsEntry);
                renderGlobalSettings();
                schedulePreviewUpdate();
            });

            row.appendChild(nameInput);
            row.appendChild(valueInput);
            row.appendChild(tooltipInput);
            row.appendChild(categorySelect);
            row.appendChild(removeBtn);
            valuesContainer.appendChild(row);
        });

        const addCurrencyBtn = document.createElement("button");
        addCurrencyBtn.type = "button";
        addCurrencyBtn.className = "button-subtle";
        addCurrencyBtn.textContent = "Add currency";
        addCurrencyBtn.addEventListener("click", () => {
            let base = "New Currency";
            let suffix = 1;
            let candidate = base;
            while (pointsEntry.values.hasOwnProperty(candidate)) {
                suffix += 1;
                candidate = `${base} ${suffix}`;
            }
            pointsEntry.values[candidate] = 0;
            renderGlobalSettings();
            renderCategories();
            schedulePreviewUpdate();
        });

        body.appendChild(valuesContainer);
        body.appendChild(addCurrencyBtn);

        const categoryHeading = document.createElement("div");
        categoryHeading.className = "subheading";
        categoryHeading.textContent = "Point categories";
        body.appendChild(categoryHeading);

        const categoriesContainer = document.createElement("div");
        categoriesContainer.className = "list-stack";
        categoryNames.forEach(category => {
            const row = document.createElement("div");
            row.className = "list-row";

            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.value = category;
            nameInput.placeholder = "Category name";

            const count = document.createElement("span");
            count.className = "muted-inline";
            count.textContent = `${pointCategories[category].length} point type${pointCategories[category].length === 1 ? "" : "s"}`;

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Remove point category";
            removeBtn.textContent = "✕";

            nameInput.addEventListener("blur", () => {
                const newName = nameInput.value.trim();
                if (!newName || newName === category) {
                    nameInput.value = category;
                    return;
                }
                if (pointCategories.hasOwnProperty(newName)) {
                    showEditorMessage(`Point category "${newName}" already exists.`, "warning");
                    nameInput.value = category;
                    return;
                }
                pointCategories[newName] = pointCategories[category];
                delete pointCategories[category];
                if (Object.prototype.hasOwnProperty.call(pointsEntry.pointCategoryDefaults, category)) {
                    pointsEntry.pointCategoryDefaults[newName] = pointsEntry.pointCategoryDefaults[category];
                    delete pointsEntry.pointCategoryDefaults[category];
                }
                renderGlobalSettings();
                schedulePreviewUpdate();
            });

            removeBtn.addEventListener("click", () => {
                delete pointCategories[category];
                delete pointsEntry.pointCategoryDefaults[category];
                renderGlobalSettings();
                schedulePreviewUpdate();
            });

            const defaultLabel = document.createElement("label");
            defaultLabel.className = "checkbox-option compact";
            const defaultCheckbox = document.createElement("input");
            defaultCheckbox.type = "checkbox";
            defaultCheckbox.checked = pointsEntry.pointCategoryDefaults[category] !== false;
            defaultCheckbox.addEventListener("change", () => {
                pointsEntry.pointCategoryDefaults[category] = defaultCheckbox.checked;
                schedulePreviewUpdate();
            });
            const defaultText = document.createElement("span");
            defaultText.textContent = "Shown by default";
            defaultLabel.append(defaultCheckbox, defaultText);

            row.appendChild(nameInput);
            row.appendChild(count);
            row.appendChild(defaultLabel);
            row.appendChild(removeBtn);
            categoriesContainer.appendChild(row);
        });

        const addCategoryBtn = document.createElement("button");
        addCategoryBtn.type = "button";
        addCategoryBtn.className = "button-subtle";
        addCategoryBtn.textContent = "Add point category";
        addCategoryBtn.addEventListener("click", () => {
            let base = "New Category";
            let suffix = 1;
            let candidate = base;
            while (pointCategories.hasOwnProperty(candidate)) {
                suffix += 1;
                candidate = `${base} ${suffix}`;
            }
            pointCategories[candidate] = [];
            pointsEntry.pointCategoryDefaults[candidate] = true;
            renderGlobalSettings();
            schedulePreviewUpdate();
        });

        body.appendChild(categoriesContainer);
        body.appendChild(addCategoryBtn);

        const derivedHeading = document.createElement("div");
        derivedHeading.className = "subheading";
        derivedHeading.textContent = "Derived values";
        body.appendChild(derivedHeading);

        const derivedHelp = document.createElement("div");
        derivedHelp.className = "field-help";
        derivedHelp.textContent = "Optional formulas that update point totals from other point types.";
        body.appendChild(derivedHelp);

        const derivedContainer = document.createElement("div");
        derivedContainer.className = "list-stack";
        renderDerivedValuesEditor(derivedContainer, pointsEntry);
        body.appendChild(derivedContainer);

        const enablementHeading = document.createElement("div");
        enablementHeading.className = "subheading";
        enablementHeading.textContent = "Enableable sub-point groups";
        body.appendChild(enablementHeading);

        const enablementHelp = document.createElement("div");
        enablementHelp.className = "field-help";
        enablementHelp.textContent = "Optional. Choose a parent point type, then choose sub-point types players can enable up to a fixed or formula-based limit.";
        body.appendChild(enablementHelp);

        const enablementContainer = document.createElement("div");
        enablementContainer.className = "list-stack";
        renderPointEnablementSetsEditor(enablementContainer, pointsEntry);
        body.appendChild(enablementContainer);

        const negHeading = document.createElement("div");
        negHeading.className = "subheading";
        negHeading.textContent = "Allow negative balances";
        body.appendChild(negHeading);

        const checkboxGrid = document.createElement("div");
        checkboxGrid.className = "checkbox-grid";
        Object.keys(pointsEntry.values).forEach(currency => {
            const label = document.createElement("label");
            label.className = "checkbox-option";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = pointsEntry.allowNegative.includes(currency);
            checkbox.addEventListener("change", () => {
                const idx = pointsEntry.allowNegative.indexOf(currency);
                if (checkbox.checked && idx === -1) {
                    pointsEntry.allowNegative.push(currency);
                }
                if (!checkbox.checked && idx !== -1) {
                    pointsEntry.allowNegative.splice(idx, 1);
                }
                schedulePreviewUpdate();
            });
            label.appendChild(checkbox);
            const span = document.createElement("span");
            span.textContent = currency;
            label.appendChild(span);
            checkboxGrid.appendChild(label);
        });
        body.appendChild(checkboxGrid);

        const rangesHeading = document.createElement("div");
        rangesHeading.className = "subheading";
        rangesHeading.textContent = "Attribute ranges";
        body.appendChild(rangesHeading);

        const rangesContainer = document.createElement("div");
        rangesContainer.className = "list-stack";

        Object.entries(pointsEntry.attributeRanges).forEach(([attr, range]) => {
            const row = document.createElement("div");
            row.className = "list-row";

            const attrInput = document.createElement("input");
            attrInput.type = "text";
            attrInput.value = attr;
            attrInput.placeholder = "Attribute (e.g., Strength)";

            const minInput = document.createElement("input");
            minInput.type = "number";
            minInput.value = typeof range?.min === "number" ? range.min : 0;

            const maxInput = document.createElement("input");
            maxInput.type = "number";
            maxInput.value = typeof range?.max === "number" ? range.max : 0;

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Remove attribute";
            removeBtn.textContent = "✕";

            minInput.addEventListener("input", () => {
                pointsEntry.attributeRanges[attr].min = Number(minInput.value) || 0;
                schedulePreviewUpdate();
            });
            maxInput.addEventListener("input", () => {
                pointsEntry.attributeRanges[attr].max = Number(maxInput.value) || 0;
                schedulePreviewUpdate();
            });

            attrInput.addEventListener("blur", () => {
                const newName = attrInput.value.trim();
                if (!newName || newName === attr) {
                    attrInput.value = attr;
                    return;
                }
                if (pointsEntry.attributeRanges.hasOwnProperty(newName)) {
                    showEditorMessage(`Attribute "${newName}" already exists.`, "warning");
                    attrInput.value = attr;
                    return;
                }
                const existing = pointsEntry.attributeRanges[attr];
                delete pointsEntry.attributeRanges[attr];
                pointsEntry.attributeRanges[newName] = existing;
                renderGlobalSettings();
                schedulePreviewUpdate();
            });

            removeBtn.addEventListener("click", () => {
                delete pointsEntry.attributeRanges[attr];
                renderGlobalSettings();
                schedulePreviewUpdate();
            });

            row.appendChild(attrInput);
            row.appendChild(minInput);
            row.appendChild(maxInput);
            row.appendChild(removeBtn);
            rangesContainer.appendChild(row);
        });

        const addAttrBtn = document.createElement("button");
        addAttrBtn.type = "button";
        addAttrBtn.className = "button-subtle";
        addAttrBtn.textContent = "Add attribute";
        addAttrBtn.addEventListener("click", () => {
            let base = "Attribute";
            let suffix = 1;
            let candidate = base;
            while (pointsEntry.attributeRanges.hasOwnProperty(candidate)) {
                suffix += 1;
                candidate = `${base} ${suffix}`;
            }
            pointsEntry.attributeRanges[candidate] = {
                min: 0,
                max: 10
            };
            renderGlobalSettings();
            schedulePreviewUpdate();
        });

        body.appendChild(rangesContainer);
        body.appendChild(addAttrBtn);

        return container;
    }

    function normalizeDerivedValuesForEditor(pointsEntry) {
        if (!Array.isArray(pointsEntry.derivedValues)) pointsEntry.derivedValues = [];
        pointsEntry.derivedValues = pointsEntry.derivedValues
            .map(entry => ({
                pointType: String(entry?.pointType || "").trim(),
                formula: String(entry?.formula || "").trim(),
                round: ["none", "floor", "ceil", "round"].includes(entry?.round) ? entry.round : "none",
                min: entry?.min === undefined || entry?.min === null || entry?.min === "" ? undefined : String(entry.min),
                max: entry?.max === undefined || entry?.max === null || entry?.max === "" ? undefined : String(entry.max)
            }))
            .filter(entry => entry.pointType || entry.formula);
        return pointsEntry.derivedValues;
    }

    function renderDerivedValuesEditor(container, pointsEntry) {
        container.innerHTML = "";
        const pointTypes = getPointTypeNames();
        const derivedValues = normalizeDerivedValuesForEditor(pointsEntry);
        const usedPointTypes = new Set(derivedValues.map(entry => entry.pointType).filter(Boolean));
        const validationBox = document.createElement("div");
        validationBox.className = "inline-warning-list";
        const updateWarnings = () => {
            const warnings = getDerivedValuesWarnings(pointsEntry);
            validationBox.innerHTML = "";
            validationBox.style.display = warnings.length ? "block" : "none";
            warnings.forEach(text => {
                const row = document.createElement("div");
                row.className = "inline-warning";
                row.textContent = text;
                validationBox.appendChild(row);
            });
        };

        if (!derivedValues.length) {
            const empty = document.createElement("div");
            empty.className = "field-note";
            empty.textContent = "No derived values configured.";
            container.appendChild(empty);
        }

        derivedValues.forEach((entry, index) => {
            const row = document.createElement("div");
            row.className = "list-row formula-row";

            const targetSelect = document.createElement("select");
            const usedByOtherRows = new Set(derivedValues
                .filter((_, otherIndex) => otherIndex !== index)
                .map(otherEntry => otherEntry.pointType)
                .filter(Boolean));
            const availableTypes = pointTypes
                .filter(type => type === entry.pointType || !usedByOtherRows.has(type));
            if (entry.pointType && !availableTypes.includes(entry.pointType)) availableTypes.unshift(entry.pointType);
            availableTypes.forEach(type => {
                const opt = document.createElement("option");
                opt.value = type;
                opt.textContent = getPointTypeDisplayName(type);
                targetSelect.appendChild(opt);
            });
            targetSelect.value = entry.pointType || pointTypes[0] || "";
            targetSelect.addEventListener("change", () => {
                entry.pointType = targetSelect.value;
                pointsEntry.derivedValues[index] = entry;
                renderDerivedValuesEditor(container, pointsEntry);
                schedulePreviewUpdate();
            });

            const formulaInput = document.createElement("input");
            formulaInput.type = "text";
            formulaInput.value = entry.formula;
            formulaInput.placeholder = "Formula, e.g. (Base + Bonus) * 2";
            formulaInput.addEventListener("input", () => {
                entry.formula = formulaInput.value;
                pointsEntry.derivedValues[index] = entry;
                updateWarnings();
                schedulePreviewUpdate();
            });

            const roundSelect = document.createElement("select");
            [
                ["none", "No rounding"],
                ["floor", "Round down"],
                ["ceil", "Round up"],
                ["round", "Nearest"]
            ].forEach(([value, label]) => {
                const opt = document.createElement("option");
                opt.value = value;
                opt.textContent = label;
                roundSelect.appendChild(opt);
            });
            roundSelect.value = entry.round || "none";
            roundSelect.addEventListener("change", () => {
                entry.round = roundSelect.value;
                pointsEntry.derivedValues[index] = entry;
                updateWarnings();
                schedulePreviewUpdate();
            });

            const minInput = document.createElement("input");
            minInput.type = "text";
            minInput.placeholder = "Min formula";
            minInput.value = entry.min === undefined ? "" : String(entry.min);
            minInput.addEventListener("input", () => {
                if (minInput.value === "") delete entry.min;
                else entry.min = minInput.value;
                pointsEntry.derivedValues[index] = entry;
                updateWarnings();
                schedulePreviewUpdate();
            });

            const maxInput = document.createElement("input");
            maxInput.type = "text";
            maxInput.placeholder = "Max formula";
            maxInput.value = entry.max === undefined ? "" : String(entry.max);
            maxInput.addEventListener("input", () => {
                if (maxInput.value === "") delete entry.max;
                else entry.max = maxInput.value;
                pointsEntry.derivedValues[index] = entry;
                updateWarnings();
                schedulePreviewUpdate();
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Remove derived value";
            removeBtn.textContent = "✕";
            removeBtn.addEventListener("click", () => {
                pointsEntry.derivedValues.splice(index, 1);
                renderDerivedValuesEditor(container, pointsEntry);
                schedulePreviewUpdate();
            });

            row.append(targetSelect, formulaInput, roundSelect, minInput, maxInput, removeBtn);
            container.appendChild(row);
        });

        updateWarnings();
        container.appendChild(validationBox);

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "button-subtle";
        addBtn.textContent = "Add derived value";
        const nextUnusedPointType = pointTypes.find(type => !usedPointTypes.has(type));
        addBtn.disabled = !nextUnusedPointType;
        if (!nextUnusedPointType) addBtn.title = "Every point type already has a derived value.";
        addBtn.addEventListener("click", () => {
            if (!nextUnusedPointType) return;
            pointsEntry.derivedValues.push({
                pointType: nextUnusedPointType,
                formula: "0",
                round: "floor"
            });
            renderDerivedValuesEditor(container, pointsEntry);
            schedulePreviewUpdate();
        });
        container.appendChild(addBtn);
    }

    function normalizeEnableablePointSetsForEditor(pointsEntry) {
        if (!Array.isArray(pointsEntry.enableablePointSets)) pointsEntry.enableablePointSets = [];
        const validTypes = new Set(getPointTypeNames());
        pointsEntry.enableablePointSets = pointsEntry.enableablePointSets
            .map(set => {
                const pointType = String(set?.pointType || "").trim();
                const subtypes = Array.isArray(set?.subtypes)
                    ? [...new Set(set.subtypes.map(type => String(type || "").trim()).filter(type =>
                        validTypes.has(type) && type !== pointType
                    ))]
                    : [];
                const limitFormula = String(set?.limitFormula ?? set?.limit ?? "0").trim();
                return {
                    pointType,
                    subtypes,
                    limitFormula,
                    expandedByDefault: set?.expandedByDefault === true
                };
            })
            .filter(set => set.pointType || set.subtypes.length || set.limitFormula);
        return pointsEntry.enableablePointSets;
    }

    function getPointEnablementWarnings(set, index, pointTypes) {
        const warnings = [];
        const label = `Sub-point group ${index + 1}`;
        const optionIds = collectOptionIds();
        if (!String(set?.pointType || "").trim()) warnings.push(`${label}: choose a parent point type.`);
        else if (!pointTypes.has(set.pointType)) warnings.push(`${label}: parent point type "${set.pointType}" is not defined.`);
        if (!Array.isArray(set?.subtypes) || !set.subtypes.length) warnings.push(`${label}: choose at least one sub-point type.`);
        (set?.subtypes || []).forEach(type => {
            if (!pointTypes.has(type)) warnings.push(`${label}: sub-point type "${type}" is not defined.`);
            if (type === set.pointType) warnings.push(`${label}: parent point type cannot also be a sub-point type.`);
        });
        const formula = String(set?.limitFormula || "");
        if (!formula.trim()) {
            warnings.push(`${label}: limit formula is required.`);
        } else {
            try {
                validateDerivedFormulaForEditor(formula, pointTypes, optionIds);
            } catch (err) {
                warnings.push(`${label}: limit formula is invalid: ${err.message}`);
            }
        }
        return Array.from(new Set(warnings));
    }

    function renderPointEnablementSetsEditor(container, pointsEntry) {
        container.innerHTML = "";
        const pointTypes = getPointTypeNames();
        const pointTypeSet = new Set(pointTypes);
        const sets = normalizeEnableablePointSetsForEditor(pointsEntry);

        if (!sets.length) {
            const empty = document.createElement("div");
            empty.className = "field-note";
            empty.textContent = "No enableable sub-point groups configured.";
            container.appendChild(empty);
        }

        sets.forEach((set, index) => {
            const card = document.createElement("div");
            card.className = "cost-option-card";

            const header = document.createElement("div");
            header.className = "cost-option-card-header";

            const title = document.createElement("strong");
            title.textContent = `Sub-point group ${index + 1}`;

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Remove enableable sub-point group";
            removeBtn.textContent = "✕";
            removeBtn.addEventListener("click", () => {
                pointsEntry.enableablePointSets.splice(index, 1);
                renderPointEnablementSetsEditor(container, pointsEntry);
                schedulePreviewUpdate();
            });
            header.append(title, removeBtn);

            const nameRow = document.createElement("div");
            nameRow.className = "list-row";
            const parentSelect = document.createElement("select");
            const blankOpt = document.createElement("option");
            blankOpt.value = "";
            blankOpt.textContent = "Parent point type";
            parentSelect.appendChild(blankOpt);
            pointTypes.forEach(type => {
                const opt = document.createElement("option");
                opt.value = type;
                opt.textContent = type;
                parentSelect.appendChild(opt);
            });
            parentSelect.value = set.pointType;
            parentSelect.addEventListener("change", () => {
                set.pointType = parentSelect.value;
                set.subtypes = (set.subtypes || []).filter(type => type !== set.pointType);
                pointsEntry.enableablePointSets[index] = set;
                renderPointEnablementSetsEditor(container, pointsEntry);
                schedulePreviewUpdate();
            });
            const limitInput = document.createElement("input");
            limitInput.type = "text";
            limitInput.value = set.limitFormula;
            limitInput.placeholder = "Enable limit, e.g. 2 or 10 + Constitution";
            limitInput.addEventListener("input", () => {
                set.limitFormula = limitInput.value;
                pointsEntry.enableablePointSets[index] = set;
                renderPointEnablementWarnings();
                schedulePreviewUpdate();
            });
            const expandedLabel = document.createElement("label");
            expandedLabel.className = "checkbox-option compact";
            const expandedCheckbox = document.createElement("input");
            expandedCheckbox.type = "checkbox";
            expandedCheckbox.checked = set.expandedByDefault === true;
            expandedCheckbox.addEventListener("change", () => {
                set.expandedByDefault = expandedCheckbox.checked;
                pointsEntry.enableablePointSets[index] = set;
                schedulePreviewUpdate();
            });
            const expandedText = document.createElement("span");
            expandedText.textContent = "Expanded by default";
            expandedLabel.append(expandedCheckbox, expandedText);
            nameRow.append(parentSelect, limitInput, expandedLabel);

            const choices = document.createElement("div");
            choices.className = "checkbox-grid";
            pointTypes.filter(type => type !== set.pointType).forEach(type => {
                const label = document.createElement("label");
                label.className = "checkbox-option";
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.checked = set.subtypes.includes(type);
                checkbox.addEventListener("change", () => {
                    const current = new Set(set.subtypes || []);
                    if (checkbox.checked) {
                        current.add(type);
                    } else current.delete(type);
                    set.subtypes = Array.from(current).filter(entry => entry !== set.pointType);
                    pointsEntry.enableablePointSets[index] = set;
                    renderPointEnablementWarnings();
                    schedulePreviewUpdate();
                });
                const text = document.createElement("span");
                text.textContent = type;
                label.append(checkbox, text);
                choices.appendChild(label);
            });

            const warningsEl = document.createElement("div");
            warningsEl.className = "field-warning";
            const renderPointEnablementWarnings = () => {
                const warnings = getPointEnablementWarnings(set, index, pointTypeSet);
                warningsEl.textContent = warnings.join(" ");
                warningsEl.hidden = warnings.length === 0;
            };
            renderPointEnablementWarnings();

            card.append(header, nameRow, choices, warningsEl);
            container.appendChild(card);
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "button-subtle";
        addBtn.textContent = "Add enableable sub-point group";
        addBtn.addEventListener("click", () => {
            pointsEntry.enableablePointSets.push({
                pointType: "",
                subtypes: [],
                limitFormula: "1",
                expandedByDefault: false
            });
            renderPointEnablementSetsEditor(container, pointsEntry);
            schedulePreviewUpdate();
        });
        container.appendChild(addBtn);
    }

    function renderAlignmentSelect(currentValue, defaultLabel, onChange) {
        const select = document.createElement("select");
        [
            ["", defaultLabel],
            ["left", "Align left"],
            ["center", "Align center"],
            ["right", "Align right"],
            ["justify", "Justify"]
        ].forEach(([value, label]) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            select.appendChild(option);
        });
        select.value = ["left", "center", "right", "justify"].includes(currentValue) ? currentValue : "";
        select.addEventListener("change", () => onChange(select.value));
        return select;
    }

    function renderOptionAlignmentSection(settingsEntry) {
        const {
            container,
            body
        } = createSectionContainer("Option Alignment", {
            defaultOpen: true
        });

        const grid = document.createElement("div");
        grid.className = "field-inline field-inline-three";
        [
            ["optionTitleAlignment", "Option title", "Default: center"],
            ["optionMetaAlignment", "Costs and prerequisites", "Default: center"],
            ["optionDescriptionAlignment", "Option description", "Default: center"]
        ].forEach(([key, labelText, defaultLabel]) => {
            const label = document.createElement("label");
            label.textContent = labelText;
            const select = renderAlignmentSelect(settingsEntry[key], defaultLabel, (value) => {
                if (value) settingsEntry[key] = value;
                else delete settingsEntry[key];
                schedulePreviewUpdate();
            });
            grid.append(label, select);
        });
        const description = document.createElement("p");
        description.style.fontSize = "12px";
        description.style.color = "var(--text-muted)";
        description.textContent = "Controls text alignment across option titles, option detail blocks such as costs and prerequisites, and option descriptions. Leave defaults to preserve legacy centered options.";

        body.append(grid, description);
        return container;
    }

    function renderBackpackSection(backpackEntry) {
        if (backpackEntry.enabled === undefined) {
            backpackEntry.enabled = true;
        }
        const {
            container,
            body
        } = createSectionContainer("Backpack Feature", {
            defaultOpen: false
        });

        const field = document.createElement("div");
        field.className = "field-inline";

        const label = document.createElement("label");
        label.textContent = "Enable Backpack";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = backpackEntry.enabled !== false;
        checkbox.addEventListener("change", () => {
            backpackEntry.enabled = checkbox.checked;
            schedulePreviewUpdate();
        });

        field.appendChild(checkbox);
        field.appendChild(label);
        body.appendChild(field);

        const description = document.createElement("p");
        description.style.fontSize = "12px";
        description.style.color = "var(--text-muted)";
        description.innerHTML = "When enabled, shows a button at the bottom of the page that displays all selected choices in a modal that can be downloaded as an image.";
        body.appendChild(description);

        return container;
    }

    function renderThemeModeSection(settingsEntry) {
        const {
            container,
            body
        } = createSectionContainer("Theme Availability", {
            defaultOpen: true
        });

        const field = document.createElement("div");
        field.className = "field";

        const label = document.createElement("label");
        label.textContent = "Player theme mode";

        const select = document.createElement("select");
        select.innerHTML = `
            <option value="toggle">Allow light/dark toggle</option>
            <option value="light">Light mode only</option>
            <option value="dark">Dark mode only</option>
        `;
        const currentMode = settingsEntry.themeMode === "light" || settingsEntry.themeMode === "dark" || settingsEntry.themeMode === "toggle"
            ? settingsEntry.themeMode
            : settingsEntry.darkModeEnabled === false
                ? "light"
                : "toggle";
        select.value = currentMode;
        settingsEntry.themeMode = currentMode;
        delete settingsEntry.darkModeEnabled;

        select.addEventListener("change", () => {
            settingsEntry.themeMode = select.value;
            renderGlobalSettings();
            schedulePreviewUpdate();
        });

        const description = document.createElement("p");
        description.style.fontSize = "12px";
        description.style.color = "var(--text-muted)";
        description.textContent = "Use light-only or dark-only when a CYOA is designed for one specific visual style. Existing CYOAs default to allowing the toggle.";

        field.append(label, select);
        body.append(field, description);

        return container;
    }

    function renderThemeSection(themeEntry, sectionTitle = "Theme Settings") {
        const {
            container,
            body
        } = createSectionContainer(sectionTitle, {
            defaultOpen: false
        });

        const themes = {
            "bg-color": "Page Background",
            "container-bg": "Content Background",
            "text-color": "Main Text",
            "text-muted": "Muted Text",
            "accent-color": "Primary Accent",
            "accent-text": "Accent Text Color",
            "border-color": "Border Color",
            "item-bg": "Category Background",
            "item-header-bg": "Category Header",
            "points-bg": "Points Tracker Background",
            "points-border": "Points Tracker Border",
            "points-text": "Points Value Text",
            "selection-glow-color": "Selected Option Glow",
            "shadow-color": "Shadow Color",
            "option-meta-bg": "Option Detail Background",
            "option-meta-heading-bg": "Option Detail Header Background",
            "option-meta-heading-text": "Option Detail Header Text",
            "option-meta-points-color": "Option Detail Points Accent",
            "option-meta-conditional-color": "Option Detail Conditional Accent",
            "option-meta-auto-grants-color": "Option Detail Auto-Grant Accent",
            "option-meta-slider-modifiers-color": "Option Detail Slider Modifier Accent",
            "option-meta-prerequisites-color": "Option Detail Prerequisite Accent",
            "option-meta-conflicts-color": "Option Detail Conflict Accent"
        };

        const grid = document.createElement("div");
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "1fr 1fr";
        grid.style.gap = "12px";

        Object.entries(themes).forEach(([key, labelText]) => {
            const field = document.createElement("div");
            field.className = "field";

            const label = document.createElement("label");
            label.textContent = labelText;

            const inputContainer = document.createElement("div");
            inputContainer.style.display = "flex";
            inputContainer.style.gap = "8px";

            const colorInput = document.createElement("input");
            colorInput.type = "color";
            colorInput.style.padding = "0";
            colorInput.style.width = "32px";
            colorInput.style.height = "32px";
            colorInput.style.border = "none";
            colorInput.style.cursor = "pointer";

            const textInput = document.createElement("input");
            textInput.type = "text";
            textInput.style.flex = "1";
            textInput.placeholder = "#RRGGBB";

            // Initialize values
            const val = themeEntry[key] || "";
            textInput.value = val;
            if (val.startsWith("#")) {
                colorInput.value = val.length === 4 ? `#${val[1]}${val[1]}${val[2]}${val[2]}${val[3]}${val[3]}` : val;
            }

            const update = (newVal) => {
                themeEntry[key] = newVal;
                textInput.value = newVal;
                if (newVal.startsWith("#")) {
                    colorInput.value = newVal.length === 4 ? `#${newVal[1]}${newVal[1]}${newVal[2]}${newVal[2]}${newVal[3]}${newVal[3]}` : newVal;
                }
                schedulePreviewUpdate();
            };

            colorInput.addEventListener("input", () => update(colorInput.value));
            textInput.addEventListener("input", () => update(textInput.value));

            inputContainer.append(colorInput, textInput);
            field.append(label, inputContainer);
            grid.appendChild(field);
        });

        body.appendChild(grid);
        return container;
    }

    function renderTypographySection(themeEntry, sectionTitle = "Typography Settings") {
        const {
            container,
            body
        } = createSectionContainer(sectionTitle, {
            defaultOpen: false
        });

        const previewTargets = {
            "font-base": ".container",
            "font-title": "#cyoaTitle",
            "font-description": "#cyoaDescription",
            "font-tab": ".tab-navigation .tab-button",
            "font-accordion": ".accordion-header",
            "font-subcategory": ".subcategory-content-title",
            "font-option-title": ".option-content strong",
            "font-option-req": ".option-requirements",
            "font-option-desc": ".option-description",
            "font-story": ".story-block",
            "font-story-input": ".story-input-wrapper input",
            "font-points": "#pointsTracker",
            "font-points-value": "#pointsDisplay span",
            "font-prereq-help": ".prereq-help",
            "font-label": ".story-input-wrapper label, .dynamic-choice-wrapper label, .slider-wrapper label"
        };

        const typography = {
            "font-base": "Base Text",
            "font-title": "Title",
            "font-description": "Description",
            "font-tab": "Tab Label",
            "font-accordion": "Category Header",
            "font-subcategory": "Subcategory Header",
            "font-option-title": "Option Title",
            "font-option-req": "Option Requirements",
            "font-option-desc": "Option Description",
            "font-story": "Story Block",
            "font-story-input": "Story Input",
            "font-points": "Points Tracker",
            "font-points-value": "Points Values",
            "font-prereq-help": "Prereq Help Badge",
            "font-label": "Labels"
        };

        const grid = document.createElement("div");
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "1fr 1fr";
        grid.style.gap = "12px";

        Object.entries(typography).forEach(([key, labelText]) => {
            const field = document.createElement("div");
            field.className = "field";

            const label = document.createElement("label");
            label.textContent = `${labelText} (px)`;

            const inputRow = document.createElement("div");
            inputRow.className = "field-inline";

            const previewBtn = document.createElement("button");
            previewBtn.type = "button";
            previewBtn.className = "button-subtle";
            previewBtn.textContent = "Preview";
            previewBtn.title = "Jump to an example in the preview";
            previewBtn.addEventListener("click", () => {
                const selector = previewTargets[key];
                if (selector) scrollPreviewToExample(selector);
            });

            const input = document.createElement("input");
            input.type = "number";
            input.min = "8";
            input.step = "1";

            const defaults = {
                "font-base": 20,
                "font-title": 44,
                "font-description": 22,
                "font-tab": 20,
                "font-accordion": 22,
                "font-subcategory": 24,
                "font-option-title": 24,
                "font-option-req": 19,
                "font-option-desc": 23,
                "font-story": 21,
                "font-story-input": 20,
                "font-points": 20,
                "font-points-value": 20,
                "font-prereq-help": 17,
                "font-label": 19
            };

            const raw = themeEntry[key];
            const numeric = typeof raw === "string" ? parseFloat(raw) : (typeof raw === "number" ? raw : NaN);
            const initialVal = Number.isFinite(numeric) ? numeric : (defaults[key] || 16);
            input.value = initialVal;
            input.placeholder = `e.g. ${defaults[key] || 16}`;

            const range = document.createElement("input");
            range.type = "range";
            range.min = "8";
            range.max = "60";
            range.step = "1";
            range.value = initialVal;

            const applyValue = (value) => {
                if (value === "") {
                    delete themeEntry[key];
                } else {
                    themeEntry[key] = `${Number(value) || 0}px`;
                }
                schedulePreviewUpdate();
            };

            input.addEventListener("input", () => {
                const value = input.value.trim();
                if (value !== "") range.value = value;
                applyValue(value);
            });

            range.addEventListener("input", () => {
                input.value = range.value;
                applyValue(range.value);
            });

            inputRow.appendChild(previewBtn);
            inputRow.appendChild(range);
            inputRow.appendChild(input);
            field.appendChild(label);
            field.appendChild(inputRow);
            grid.appendChild(field);
        });

        const familyFields = {
            "font-heading": {
                label: "Heading Font Family",
                placeholder: "Verdana, sans-serif",
                options: [{
                        label: "Luckiest Guy",
                        value: "'Luckiest Guy', cursive"
                    },
                    {
                        label: "Impact",
                        value: "Impact, 'Arial Black', sans-serif"
                    },
                    {
                        label: "Georgia",
                        value: "Georgia, serif"
                    },
                    {
                        label: "Trebuchet MS",
                        value: "'Trebuchet MS', sans-serif"
                    },
                    {
                        label: "Verdana",
                        value: "Verdana, sans-serif"
                    }
                ]
            },
            "font-body": {
                label: "Body Font Family",
                placeholder: "'Quicksand', sans-serif",
                options: [{
                        label: "Quicksand",
                        value: "'Quicksand', sans-serif"
                    },
                    {
                        label: "Arial",
                        value: "Arial, sans-serif"
                    },
                    {
                        label: "Helvetica",
                        value: "'Helvetica Neue', Helvetica, Arial, sans-serif"
                    },
                    {
                        label: "Verdana",
                        value: "Verdana, sans-serif"
                    },
                    {
                        label: "Georgia",
                        value: "Georgia, serif"
                    },
                    {
                        label: "Times New Roman",
                        value: "'Times New Roman', Times, serif"
                    }
                ]
            }
        };

        Object.entries(familyFields).forEach(([key, config]) => {
            const field = document.createElement("div");
            field.className = "field";
            field.style.gridColumn = "1 / -1";

            const label = document.createElement("label");
            label.textContent = config.label;

            const select = document.createElement("select");
            const defaultOption = document.createElement("option");
            defaultOption.value = "";
            defaultOption.textContent = "Use default";
            select.appendChild(defaultOption);

            config.options.forEach((opt) => {
                const optionEl = document.createElement("option");
                optionEl.value = opt.value;
                optionEl.textContent = opt.label;
                select.appendChild(optionEl);
            });

            const customOption = document.createElement("option");
            customOption.value = "__custom__";
            customOption.textContent = "Custom...";
            select.appendChild(customOption);

            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = config.placeholder;
            input.value = themeEntry[key] || "";

            const currentValue = (themeEntry[key] || "").trim();
            const isPreset = config.options.some(opt => opt.value === currentValue);
            select.value = currentValue === "" ? "" : (isPreset ? currentValue : "__custom__");
            input.style.display = select.value === "__custom__" ? "block" : "none";

            const applyFontFamilyValue = (value) => {
                if (value === "") {
                    delete themeEntry[key];
                } else {
                    themeEntry[key] = value;
                }
                schedulePreviewUpdate();
            };

            select.addEventListener("change", () => {
                if (select.value === "__custom__") {
                    input.style.display = "block";
                    applyFontFamilyValue(input.value.trim());
                    return;
                }
                input.style.display = "none";
                applyFontFamilyValue(select.value.trim());
            });

            input.addEventListener("input", () => {
                if (select.value !== "__custom__") return;
                applyFontFamilyValue(input.value.trim());
            });

            field.appendChild(label);
            field.appendChild(select);
            field.appendChild(input);
            grid.appendChild(field);
        });

        body.appendChild(grid);
        return container;
    }

    function getPointTypeNames() {
        const pointsEntry = state.data.find(entry => entry.type === "points");
        const names = Object.keys(pointsEntry?.values || {});
        return names.length ? names : ["Points"];
    }

    function normalizePointCategories(pointsEntry) {
        if (!pointsEntry.pointCategories || typeof pointsEntry.pointCategories !== "object" || Array.isArray(pointsEntry.pointCategories)) {
            pointsEntry.pointCategories = {};
        }
        if (!pointsEntry.pointTooltips || typeof pointsEntry.pointTooltips !== "object" || Array.isArray(pointsEntry.pointTooltips)) {
            pointsEntry.pointTooltips = {};
        }
        if (!pointsEntry.pointCategoryDefaults || typeof pointsEntry.pointCategoryDefaults !== "object" || Array.isArray(pointsEntry.pointCategoryDefaults)) {
            pointsEntry.pointCategoryDefaults = {};
        }
        const validTypes = new Set(Object.keys(pointsEntry.values || {}));
        Object.keys(pointsEntry.pointTooltips).forEach(type => {
            const tooltip = String(pointsEntry.pointTooltips[type] || "").trim();
            if (!validTypes.has(type) || !tooltip) delete pointsEntry.pointTooltips[type];
            else pointsEntry.pointTooltips[type] = tooltip;
        });
        Object.keys(pointsEntry.pointCategories).forEach(category => {
            const cleanTypes = Array.isArray(pointsEntry.pointCategories[category])
                ? [...new Set(pointsEntry.pointCategories[category].filter(type => validTypes.has(type)))]
                : [];
            if (!String(category || "").trim()) {
                delete pointsEntry.pointCategories[category];
            } else {
                pointsEntry.pointCategories[category] = cleanTypes;
            }
        });
        Object.keys(pointsEntry.pointCategoryDefaults).forEach(category => {
            if (!Object.prototype.hasOwnProperty.call(pointsEntry.pointCategories, category)) {
                delete pointsEntry.pointCategoryDefaults[category];
            } else {
                pointsEntry.pointCategoryDefaults[category] = pointsEntry.pointCategoryDefaults[category] !== false;
            }
        });
        return pointsEntry.pointCategories;
    }

    function getAssignedPointCategory(pointsEntry, pointType) {
        return Object.entries(normalizePointCategories(pointsEntry))
            .find(([, types]) => types.includes(pointType))?.[0] || "";
    }

    function stripFormattingMarkup(text = "") {
        return String(text)
            .replace(/`([^`]+)`/g, "$1")
            .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "$1")
            .replace(/^\s{0,3}#{1,6}\s+/gm, "")
            .replace(/^\s*[-*+]\s+/gm, "")
            .replace(/^\s*\d+\.\s+/gm, "")
            .replace(/^\s*>\s?/gm, "")
            .replace(/\*/g, "")
            .replace(/_/g, "")
            .replace(/\[\/?(color|size|weight)(=[^\]\s]+)?\]/gi, "");
    }

    function getPointTypeDisplayName(type = "") {
        return stripFormattingMarkup(type) || type;
    }

    function renamePointMapKey(map, oldName, newName) {
        if (!map || typeof map !== "object" || Array.isArray(map) || !Object.prototype.hasOwnProperty.call(map, oldName)) return;
        const existing = map[oldName];
        delete map[oldName];
        map[newName] = existing;
    }

    function renamePointTypeReferences(oldName, newName) {
        state.data.forEach(entry => {
            if (!entry || typeof entry !== "object") return;

            renamePointMapKey(entry.discountAmount, oldName, newName);

            const visitCostRules = (owner) => {
                [...(owner?.modifiedCosts || []), ...(owner?.discounts || [])].forEach(rule => {
                    renamePointMapKey(rule?.cost, oldName, newName);
                    renamePointMapKey(rule?.costDelta, oldName, newName);
                    renamePointMapKey(rule?.costPercent, oldName, newName);
                    renamePointMapKey(rule?.minCost, oldName, newName);
                    renamePointMapKey(rule?.maxCost, oldName, newName);
                });
            };

            const visitOption = (option) => {
                renamePointMapKey(option?.cost, oldName, newName);
                (option?.costOptions || []).forEach(costOption => renamePointMapKey(costOption?.cost, oldName, newName));
                (option?.costOptions || []).forEach(costOption => (costOption?.costBySelection || []).forEach(cost => renamePointMapKey(cost, oldName, newName)));
                renamePointMapKey(option?.costPerPoint, oldName, newName);
                if (Array.isArray(option?.pointAllocation?.types)) {
                    option.pointAllocation.types = option.pointAllocation.types.map(type => type === oldName ? newName : type);
                }
                visitCostRules(option);
            };

            const visitSubcategory = (subcat) => {
                (subcat?.costOptions || []).forEach(costOption => renamePointMapKey(costOption?.cost, oldName, newName));
                (subcat?.costOptions || []).forEach(costOption => (costOption?.costBySelection || []).forEach(cost => renamePointMapKey(cost, oldName, newName)));
                renamePointMapKey(subcat?.discountAmount, oldName, newName);
                visitCostRules(subcat);
                (subcat?.options || []).forEach(visitOption);
                (subcat?.subcategories || []).forEach(visitSubcategory);
            };

            visitCostRules(entry);
            (entry.options || []).forEach(visitOption);
            (entry.subcategories || []).forEach(visitSubcategory);
        });
    }

    function renderPointTypeAmountControls(parent, {
        labelPrefix,
        getMap,
        setMap,
        placeholder = "e.g. 1"
    }) {
        const container = document.createElement("div");
        container.className = "point-type-amount-controls";
        parent.appendChild(container);

        const render = () => {
            container.innerHTML = "";
            const map = getMap() || {};
            const allTypes = getPointTypeNames();
            const activeTypes = Object.keys(map);

            if (activeTypes.length === 0) {
                const empty = document.createElement("div");
                empty.className = "field-note";
                empty.textContent = "No point types configured.";
                container.appendChild(empty);
            }

            activeTypes.forEach(type => {
                const row = document.createElement("div");
                row.className = "field-inline";

                const label = document.createElement("label");
                label.textContent = `${labelPrefix} (${getPointTypeDisplayName(type)})`;

                const input = document.createElement("input");
                input.type = "number";
                input.value = (typeof map[type] === "number") ? map[type] : "";
                input.placeholder = placeholder;
                input.addEventListener("input", () => {
                    const value = input.value.trim();
                    let nextMap = getMap() || {};
                    if (value === "") {
                        delete nextMap[type];
                        if (Object.keys(nextMap).length === 0) {
                            setMap(null);
                        } else {
                            setMap(nextMap);
                        }
                    } else {
                        nextMap[type] = Number(value) || 0;
                        setMap(nextMap);
                    }
                    render();
                    schedulePreviewUpdate();
                });

                const removeBtn = document.createElement("button");
                removeBtn.type = "button";
                removeBtn.className = "button-icon danger";
                removeBtn.textContent = "✕";
                removeBtn.title = `Remove ${getPointTypeDisplayName(type)}`;
                removeBtn.addEventListener("click", () => {
                    const nextMap = getMap() || {};
                    delete nextMap[type];
                    if (Object.keys(nextMap).length === 0) {
                        setMap(null);
                    } else {
                        setMap(nextMap);
                    }
                    render();
                    schedulePreviewUpdate();
                });

                row.appendChild(label);
                row.appendChild(input);
                row.appendChild(removeBtn);
                container.appendChild(row);
            });

            const addRow = document.createElement("div");
            addRow.className = "field-inline";

            const addLabel = document.createElement("label");
            addLabel.textContent = `Add ${labelPrefix} type`;

            const select = document.createElement("select");
            const available = allTypes.filter(type => !activeTypes.includes(type));
            const placeholderOption = document.createElement("option");
            placeholderOption.value = "";
            placeholderOption.textContent = available.length ? "Select type" : "No more types";
            select.appendChild(placeholderOption);
            available.forEach(type => {
                const opt = document.createElement("option");
                opt.value = type;
                opt.textContent = getPointTypeDisplayName(type);
                select.appendChild(opt);
            });

            const addBtn = document.createElement("button");
            addBtn.type = "button";
            addBtn.className = "button-subtle";
            addBtn.textContent = "Add";
            addBtn.disabled = available.length === 0;
            addBtn.addEventListener("click", () => {
                const selected = select.value;
                if (!selected) return;
                const nextMap = getMap() || {};
                if (!Object.prototype.hasOwnProperty.call(nextMap, selected)) {
                    nextMap[selected] = 0;
                }
                setMap(nextMap);
                render();
                schedulePreviewUpdate();
            });

            addRow.appendChild(addLabel);
            addRow.appendChild(select);
            addRow.appendChild(addBtn);
            container.appendChild(addRow);
        };

        render();
    }



    function renderCategories() {
        const categories = getCategorySnapshots();
        snapshotOpenStates(categories);
        categoryListEl.innerHTML = "";
        renderEditorNavigation(categories);


        if (!categories.length) {
            const emptyState = document.createElement("div");
            emptyState.className = "empty-state";
            emptyState.textContent = "No categories yet. Add one to start structuring your CYOA.";
            categoryListEl.appendChild(emptyState);
            return;
        }

        const categoryIndices = categories.map(cat => cat.index);

        categories.forEach(({ entry: category, index: dataIndex }, position) => {
            if (!categoryMatchesFilter(category, state.filterQuery)) return;
            const details = document.createElement("details");
            details.className = "category-card";
            details.id = buildEditorNodeId("category", [position + 1]);
            const storedOpen = categoryOpenState.has(category) ? categoryOpenState.get(category) : false;
            if (storedOpen) {
                details.open = true;
            }
            details.addEventListener("toggle", () => {
                categoryOpenState.set(category, details.open);
            });

            const summary = document.createElement("summary");
            const summaryLabel = document.createElement("span");
            summaryLabel.className = "summary-label";
            summaryLabel.appendChild(createSummaryHeader(
                category.name?.trim() ? category.name : `Category ${position + 1}`,
                [
                    `${countSubcategoryNodes(category.subcategories || [])} sections`,
                    `${countOptionNodes(category.subcategories || [])} options`
                ]
            ));
            summary.appendChild(summaryLabel);

            const actions = document.createElement("div");
            actions.className = "category-actions";
            preventSummaryToggle(actions);

            const upBtn = document.createElement("button");
            upBtn.type = "button";
            upBtn.className = "button-icon";
            upBtn.disabled = position === 0;
            upBtn.title = "Move category up";
            upBtn.textContent = "↑";
            upBtn.addEventListener("click", (event) => {
                event.preventDefault();
                const targetIndex = categoryIndices[position - 1];
                const currentIndex = categoryIndices[position];
                const temp = state.data[currentIndex];
                state.data[currentIndex] = state.data[targetIndex];
                state.data[targetIndex] = temp;
                keepPanelOpen(category);
                renderCategories();
                schedulePreviewUpdate();
            });

            const downBtn = document.createElement("button");
            downBtn.type = "button";
            downBtn.className = "button-icon";
            downBtn.disabled = position === categoryIndices.length - 1;
            downBtn.title = "Move category down";
            downBtn.textContent = "↓";
            downBtn.addEventListener("click", (event) => {
                event.preventDefault();
                const targetIndex = categoryIndices[position + 1];
                const currentIndex = categoryIndices[position];
                const temp = state.data[currentIndex];
                state.data[currentIndex] = state.data[targetIndex];
                state.data[targetIndex] = temp;
                keepPanelOpen(category);
                renderCategories();
                schedulePreviewUpdate();
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Delete category";
            removeBtn.textContent = "✕";
            removeBtn.addEventListener("click", (event) => {
                event.preventDefault();
                if (!confirm(`Delete category "${category.name || ""}"?`)) return;
                state.data.splice(dataIndex, 1);
                renderCategories();
                schedulePreviewUpdate();
            });

            actions.appendChild(upBtn);
            actions.appendChild(downBtn);
            actions.appendChild(removeBtn);
            summary.appendChild(actions);
            details.appendChild(summary);

            const body = document.createElement("div");
            body.className = "category-body";

            const {
                container: categoryAdvancedSection,
                body: categoryAdvancedBody
            } = createSectionContainer("Advanced Fields", {
                storageKey: `category-advanced-${position}`,
                defaultOpen: false
            });
            body.appendChild(categoryAdvancedSection);

            const nameField = document.createElement("div");
            nameField.className = "field";
            const nameLabel = document.createElement("label");
            nameLabel.textContent = "Name";
            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.value = category.name || "";
            nameInput.placeholder = "Category name";
            nameInput.addEventListener("input", () => {
                category.name = nameInput.value;
                summaryLabel.innerHTML = "";
                summaryLabel.appendChild(createSummaryHeader(
                    nameInput.value.trim() ? nameInput.value : `Category ${position + 1}`,
                    [
                        `${countSubcategoryNodes(category.subcategories || [])} sections`,
                        `${countOptionNodes(category.subcategories || [])} options`
                    ]
                ));

                // Sync all options in this category
                syncSubcategoryTreeOptionIds([category.name], category.subcategories || []);

                renderEditorNavigation(getCategorySnapshots());
                schedulePreviewUpdate();
            });
            nameField.appendChild(nameLabel);
            nameField.appendChild(nameInput);
            body.appendChild(nameField);

            const descriptionField = document.createElement("div");
            descriptionField.className = "field";
            const descriptionLabel = document.createElement("label");
            descriptionLabel.textContent = "Description (Optional)";
            const descriptionInput = document.createElement("textarea");
            descriptionInput.value = category.description || "";
            descriptionInput.placeholder = "Shown below the category tab title. Supports Markdown like **bold**, *italic*, lists, links, and legacy [color=#d32f2f]red[/color] tags.";
            descriptionInput.addEventListener("input", () => {
                if (descriptionInput.value.trim()) {
                    category.description = descriptionInput.value;
                } else {
                    delete category.description;
                }
                schedulePreviewUpdate();
            });
            descriptionField.appendChild(descriptionLabel);
            descriptionField.appendChild(descriptionInput);
            body.appendChild(descriptionField);

            const requiresField = document.createElement("div");
            requiresField.className = "field";
            const requiresLabel = document.createElement("label");
            requiresLabel.textContent = "Requires Option (Optional)";
            const requiresInput = document.createElement("input");
            requiresInput.type = "text";
            requiresInput.value = category.requiresOption || "";
            requiresInput.placeholder = "e.g. some_id && !another_id";
            requiresInput.addEventListener("input", () => {
                if (requiresInput.value.trim()) {
                    category.requiresOption = requiresInput.value.trim();
                } else {
                    delete category.requiresOption;
                }
                schedulePreviewUpdate();
            });
            requiresField.appendChild(requiresLabel);
            requiresField.appendChild(requiresInput);
            categoryAdvancedBody.appendChild(requiresField);

            const categoryMaxRow = document.createElement("div");
            categoryMaxRow.className = "field-inline";
            const categoryMaxLabel = document.createElement("label");
            categoryMaxLabel.textContent = "Max selections (category)";
            const categoryMaxInput = document.createElement("input");
            categoryMaxInput.type = "number";
            categoryMaxInput.min = "1";
            const initialCategoryMax = category.maxSelections ?? (category.singleSelectionOnly === true ? 1 : "");
            categoryMaxInput.value = initialCategoryMax;
            categoryMaxInput.placeholder = "Leave blank for unlimited";
            categoryMaxInput.addEventListener("input", () => {
                const value = categoryMaxInput.value.trim();
                const num = Number(value);
                if (value === "") {
                    delete category.maxSelections;
                    delete category.singleSelectionOnly;
                } else if (!Number.isFinite(num) || num < 1) {
                    category.maxSelections = 1;
                    delete category.singleSelectionOnly;
                    categoryMaxInput.value = "1";
                } else {
                    category.maxSelections = Math.floor(num);
                    delete category.singleSelectionOnly;
                }
                schedulePreviewUpdate();
            });
            categoryMaxRow.appendChild(categoryMaxLabel);
            categoryMaxRow.appendChild(categoryMaxInput);
            categoryAdvancedBody.appendChild(categoryMaxRow);

            const categorySubviewField = document.createElement("div");
            categorySubviewField.className = "field-inline";
            const categorySubviewLabel = document.createElement("label");
            categorySubviewLabel.textContent = "Subcategory view";
            const categorySubviewSelect = document.createElement("select");
            categorySubviewSelect.innerHTML = `
                <option value="tabs">Tabbed list</option>
                <option value="all">Show all content</option>
            `;
            categorySubviewSelect.value = category.subcategoryDisplayMode === "all" ? "all" : "tabs";
            categorySubviewSelect.addEventListener("change", () => {
                if (categorySubviewSelect.value === "all") {
                    category.subcategoryDisplayMode = "all";
                } else {
                    delete category.subcategoryDisplayMode;
                }
                schedulePreviewUpdate();
            });
            categorySubviewField.appendChild(categorySubviewLabel);
            categorySubviewField.appendChild(categorySubviewSelect);
            categoryAdvancedBody.appendChild(categorySubviewField);

            const renderSubcategoryEditor = (parentArray, subcat, subIndex, container, namePath = [], indexPath = []) => {
                ensureSubcategoryDefaults(subcat);
                if (!subcategoryMatchesFilter(subcat, state.filterQuery)) return;

                const subDetails = document.createElement("details");
                subDetails.className = "subcategory-item";
                const nextIndexPath = [...indexPath, subIndex + 1];
                subDetails.id = buildEditorNodeId("subcategory", [position + 1, ...nextIndexPath]);
                const storedSubOpen = subcategoryOpenState.has(subcat) ? subcategoryOpenState.get(subcat) : false;
                if (storedSubOpen) subDetails.open = true;

                const subSummary = document.createElement("summary");
                const subSummaryLabel = document.createElement("span");
                subSummaryLabel.className = "summary-label";
                subSummaryLabel.appendChild(createSummaryHeader(
                    subcat.name || `Subcategory ${subIndex + 1}`,
                    [
                        `${(subcat.options || []).length} options`,
                        `${countSubcategoryNodes(subcat.subcategories || [])} nested`
                    ]
                ));
                subSummary.appendChild(subSummaryLabel);

                const subActions = document.createElement("div");
                subActions.className = "category-actions";
                preventSummaryToggle(subActions);

                const subUpBtn = document.createElement("button");
                subUpBtn.type = "button";
                subUpBtn.className = "button-icon";
                subUpBtn.disabled = subIndex === 0;
                subUpBtn.title = "Move section up";
                subUpBtn.textContent = "↑";
                subUpBtn.addEventListener("click", (event) => {
                    event.preventDefault();
                    if (moveArrayItem(parentArray, subIndex, -1)) {
                        keepPanelOpen(category, subcat);
                        renderCategories();
                        schedulePreviewUpdate();
                    }
                });

                const subDownBtn = document.createElement("button");
                subDownBtn.type = "button";
                subDownBtn.className = "button-icon";
                subDownBtn.disabled = subIndex === parentArray.length - 1;
                subDownBtn.title = "Move section down";
                subDownBtn.textContent = "↓";
                subDownBtn.addEventListener("click", (event) => {
                    event.preventDefault();
                    if (moveArrayItem(parentArray, subIndex, 1)) {
                        keepPanelOpen(category, subcat);
                        renderCategories();
                        schedulePreviewUpdate();
                    }
                });

                const subRemoveBtn = document.createElement("button");
                subRemoveBtn.type = "button";
                subRemoveBtn.className = "button-icon danger";
                subRemoveBtn.title = "Delete section";
                subRemoveBtn.textContent = "✕";
                subRemoveBtn.addEventListener("click", (event) => {
                    event.preventDefault();
                    if (!confirm(`Delete section "${subcat.name || ""}"?`)) return;
                    parentArray.splice(subIndex, 1);
                    keepPanelOpen(category);
                    subcategoryOpenState.delete(subcat);
                    renderCategories();
                    schedulePreviewUpdate();
                });

                subActions.appendChild(subUpBtn);
                subActions.appendChild(subDownBtn);
                subActions.appendChild(subRemoveBtn);
                subSummary.appendChild(subActions);
                subDetails.appendChild(subSummary);
                subDetails.addEventListener("toggle", () => {
                    subcategoryOpenState.set(subcat, subDetails.open);
                });

                const subBody = document.createElement("div");
                subBody.className = "subcategory-body";

                const {
                    container: subAdvancedSection,
                    body: subAdvancedBody
                } = createSectionContainer("Advanced Fields", {
                    storageKey: `${normalizedPathKey([category.name, ...namePath, subcat.name || `Subcategory${subIndex + 1}`])}-advanced`,
                    defaultOpen: false
                });
                subBody.appendChild(subAdvancedSection);

                const subNameField = document.createElement("div");
                subNameField.className = "field";
                const subNameLabel = document.createElement("label");
                subNameLabel.textContent = "Name";
                const subNameInput = document.createElement("input");
                subNameInput.type = "text";
                subNameInput.value = subcat.name || "";
                subNameInput.placeholder = "Background";
                subNameInput.addEventListener("input", () => {
                    subcat.name = subNameInput.value;
                    subSummaryLabel.innerHTML = "";
                    subSummaryLabel.appendChild(createSummaryHeader(
                        subcat.name || `Subcategory ${subIndex + 1}`,
                        [
                            `${(subcat.options || []).length} options`,
                            `${countSubcategoryNodes(subcat.subcategories || [])} nested`
                        ]
                    ));
                    syncSubcategoryTreeOptionIds([category.name], [subcat]);
                    renderEditorNavigation(getCategorySnapshots());
                    schedulePreviewUpdate();
                });
                subNameField.appendChild(subNameLabel);
                subNameField.appendChild(subNameInput);
                subBody.appendChild(subNameField);

                const subRequiresField = document.createElement("div");
                subRequiresField.className = "field";
                const subRequiresLabel = document.createElement("label");
                subRequiresLabel.textContent = "Requires Option (Optional)";
                const subRequiresInput = document.createElement("input");
                subRequiresInput.type = "text";
                subRequiresInput.value = subcat.requiresOption || "";
                subRequiresInput.placeholder = "e.g. some_id && !another_id";
                subRequiresInput.addEventListener("input", () => {
                    if (subRequiresInput.value.trim()) {
                        subcat.requiresOption = subRequiresInput.value.trim();
                    } else {
                        delete subcat.requiresOption;
                    }
                    schedulePreviewUpdate();
                });
                subRequiresField.appendChild(subRequiresLabel);
                subRequiresField.appendChild(subRequiresInput);
                subAdvancedBody.appendChild(subRequiresField);

                const typeField = document.createElement("div");
                typeField.className = "field-inline";
                const typeLabel = document.createElement("label");
                typeLabel.textContent = "Type";
                const typeInput = document.createElement("input");
                typeInput.type = "text";
                typeInput.value = subcat.type || "";
                typeInput.placeholder = "storyBlock";
                typeInput.addEventListener("input", () => {
                    if (typeInput.value.trim()) {
                        subcat.type = typeInput.value.trim();
                    } else {
                        delete subcat.type;
                    }
                    schedulePreviewUpdate();
                });
                typeField.appendChild(typeLabel);
                typeField.appendChild(typeInput);
                subAdvancedBody.appendChild(typeField);

                const nestedViewField = document.createElement("div");
                nestedViewField.className = "field-inline";
                const nestedViewLabel = document.createElement("label");
                nestedViewLabel.textContent = "Nested subcategory view";
                const nestedViewSelect = document.createElement("select");
                nestedViewSelect.innerHTML = `
                    <option value="tabs">Tabbed list</option>
                    <option value="all">Show all content</option>
                `;
                nestedViewSelect.value = subcat.subcategoryDisplayMode === "all" ? "all" : "tabs";
                nestedViewSelect.addEventListener("change", () => {
                    if (nestedViewSelect.value === "all") {
                        subcat.subcategoryDisplayMode = "all";
                    } else {
                        delete subcat.subcategoryDisplayMode;
                    }
                    schedulePreviewUpdate();
                });
                nestedViewField.appendChild(nestedViewLabel);
                nestedViewField.appendChild(nestedViewSelect);
                subAdvancedBody.appendChild(nestedViewField);

                const colorRow = document.createElement("div");
                colorRow.className = "field-inline";
                const colorFields = [
                    ["backgroundColor", "Background color", "e.g. red or #7f1d1d"],
                    ["textColor", "Text color", "e.g. white"],
                    ["accentColor", "Header/accent color", "e.g. #dc2626"]
                ];
                colorFields.forEach(([key, labelText, placeholder]) => {
                    const label = document.createElement("label");
                    label.textContent = labelText;
                    const input = document.createElement("input");
                    input.type = "text";
                    input.value = subcat[key] || "";
                    input.placeholder = placeholder;
                    input.addEventListener("input", () => {
                        const value = input.value.trim();
                        if (value) {
                            subcat[key] = value;
                        } else {
                            delete subcat[key];
                        }
                        schedulePreviewUpdate();
                    });
                    colorRow.appendChild(label);
                    colorRow.appendChild(input);
                });
                subAdvancedBody.appendChild(colorRow);

                const darkColorRow = document.createElement("div");
                darkColorRow.className = "field-inline";
                const darkColorFields = [
                    ["darkBackgroundColor", "Dark background color", "e.g. #450a0a"],
                    ["darkTextColor", "Dark text color", "e.g. #fee2e2"],
                    ["darkAccentColor", "Dark header/accent color", "e.g. #1f0707"]
                ];
                darkColorFields.forEach(([key, labelText, placeholder]) => {
                    const label = document.createElement("label");
                    label.textContent = labelText;
                    const input = document.createElement("input");
                    input.type = "text";
                    input.value = subcat[key] || "";
                    input.placeholder = placeholder;
                    input.addEventListener("input", () => {
                        const value = input.value.trim();
                        if (value) {
                            subcat[key] = value;
                        } else {
                            delete subcat[key];
                        }
                        schedulePreviewUpdate();
                    });
                    darkColorRow.appendChild(label);
                    darkColorRow.appendChild(input);
                });
                subAdvancedBody.appendChild(darkColorRow);

                const maxRow = document.createElement("div");
                maxRow.className = "field-inline";
                const maxLabel = document.createElement("label");
                maxLabel.textContent = "Max selections";
                const maxInput = document.createElement("input");
                maxInput.type = "number";
                maxInput.value = subcat.maxSelections ?? "";
                maxInput.placeholder = "Leave blank for unlimited";
                maxInput.addEventListener("input", () => {
                    const value = maxInput.value.trim();
                    if (value === "") {
                        delete subcat.maxSelections;
                    } else {
                        subcat.maxSelections = Number(value) || 0;
                    }
                    schedulePreviewUpdate();
                });

                const minLabel = document.createElement("label");
                minLabel.textContent = "Min selections";
                const minInput = document.createElement("input");
                minInput.type = "number";
                minInput.value = subcat.minSelections ?? "";
                minInput.placeholder = "Optional";
                minInput.addEventListener("input", () => {
                    const value = minInput.value.trim();
                    if (value === "") {
                        delete subcat.minSelections;
                    } else {
                        subcat.minSelections = Number(value) || 0;
                    }
                    schedulePreviewUpdate();
                });
                maxRow.appendChild(maxLabel);
                maxRow.appendChild(maxInput);
                maxRow.appendChild(minLabel);
                maxRow.appendChild(minInput);
                subBody.appendChild(maxRow);

                const defaultOptionMaxRow = document.createElement("div");
                defaultOptionMaxRow.className = "field-inline";
                const defaultOptionMaxLabel = document.createElement("label");
                defaultOptionMaxLabel.textContent = "Default max selections per option";
                const defaultOptionMaxInput = document.createElement("input");
                defaultOptionMaxInput.type = "number";
                defaultOptionMaxInput.min = "1";
                defaultOptionMaxInput.value = subcat.defaultOptionMaxSelections ?? "";
                defaultOptionMaxInput.placeholder = "Default: 1";
                defaultOptionMaxInput.title = "Applies to options in this subcategory that do not define their own max selections.";
                defaultOptionMaxInput.addEventListener("input", () => {
                    const value = defaultOptionMaxInput.value.trim();
                    if (value === "") {
                        delete subcat.defaultOptionMaxSelections;
                    } else {
                        const parsed = Math.max(1, Math.floor(Number(value) || 1));
                        subcat.defaultOptionMaxSelections = parsed;
                        defaultOptionMaxInput.value = String(parsed);
                    }
                    schedulePreviewUpdate();
                });
                defaultOptionMaxRow.append(defaultOptionMaxLabel, defaultOptionMaxInput);
                subBody.appendChild(defaultOptionMaxRow);

                const discountRow = document.createElement("div");
                discountRow.className = "field-inline";
                const discountFirstLabel = document.createElement("label");
                discountFirstLabel.textContent = "Discount: first N";
                const discountFirstInput = document.createElement("input");
                discountFirstInput.type = "number";
                discountFirstInput.value = subcat.discountFirstN ?? "";
                discountFirstInput.placeholder = "e.g. 1";
                discountFirstInput.addEventListener("input", () => {
                    const value = discountFirstInput.value.trim();
                    if (value === "") {
                        delete subcat.discountFirstN;
                    } else {
                        subcat.discountFirstN = Number(value) || 0;
                    }
                    schedulePreviewUpdate();
                });
                discountRow.appendChild(discountFirstLabel);
                discountRow.appendChild(discountFirstInput);
                subAdvancedBody.appendChild(discountRow);

                renderPointTypeAmountControls(subAdvancedBody, {
                    labelPrefix: "Discount Amount",
                    getMap: () => subcat.discountAmount,
                    setMap: (next) => {
                        if (next) subcat.discountAmount = next;
                        else delete subcat.discountAmount;
                    }
                });

                const subCostOptionsSection = document.createElement("div");
                subCostOptionsSection.className = "field";
                const subCostOptionsLabel = document.createElement("label");
                subCostOptionsLabel.textContent = "Default payment options";
                const subCostOptionsHint = document.createElement("div");
                subCostOptionsHint.className = "field-help";
                subCostOptionsHint.textContent = "Options in this subcategory inherit these payment choices unless they define their own payment options. Enable merging to add these default costs into every option-specific payment choice.";
                const subCostOptionsContainer = document.createElement("div");
                subCostOptionsContainer.className = "list-stack";
                renderCostOptionsEditor(subCostOptionsContainer, subcat, {
                    allowEmpty: true,
                    emptyText: "No default payment options. Options use their own payment options.",
                    includeSelectionCosts: true
                });
                const mergeDefaultLabel = document.createElement("label");
                mergeDefaultLabel.className = "checkbox-option";
                const mergeDefaultCheckbox = document.createElement("input");
                mergeDefaultCheckbox.type = "checkbox";
                mergeDefaultCheckbox.checked = subcat.mergeDefaultCostOptions === true;
                mergeDefaultCheckbox.addEventListener("change", () => {
                    if (mergeDefaultCheckbox.checked) {
                        subcat.mergeDefaultCostOptions = true;
                    } else {
                        delete subcat.mergeDefaultCostOptions;
                    }
                    schedulePreviewUpdate();
                });
                const mergeDefaultText = document.createElement("span");
                mergeDefaultText.textContent = "Add these default costs into each option-specific payment choice";
                mergeDefaultLabel.append(mergeDefaultCheckbox, mergeDefaultText);
                subCostOptionsSection.append(subCostOptionsLabel, subCostOptionsHint, mergeDefaultLabel, subCostOptionsContainer);
                subBody.appendChild(subCostOptionsSection);

                const subModifiedCostSection = document.createElement("div");
                subModifiedCostSection.className = "field";
                const subModifiedCostLabel = document.createElement("label");
                subModifiedCostLabel.textContent = "Modified costs for all options";
                const subModifiedCostHint = document.createElement("div");
                subModifiedCostHint.className = "field-help";
                subModifiedCostHint.textContent = "Rules here apply to every option in this subcategory. Option-specific modified costs with the same or higher priority can override them.";
                const subModifiedCostContainer = document.createElement("div");
                subModifiedCostContainer.className = "list-stack";
                renderModifiedCostRulesEditor(subModifiedCostContainer, subcat, {
                    emptyText: "No subcategory-wide modified cost rules yet.",
                    addButtonText: "Add subcategory modified cost rule",
                    includeSlotBehavior: false,
                    onChange: schedulePreviewUpdate
                });
                subModifiedCostSection.append(subModifiedCostLabel, subModifiedCostHint, subModifiedCostContainer);
                subAdvancedBody.appendChild(subModifiedCostSection);

                const columnsRow = document.createElement("div");
                columnsRow.className = "field-inline";
                const columnsLabel = document.createElement("label");
                columnsLabel.textContent = "Columns per row";
                const columnsInput = document.createElement("input");
                columnsInput.type = "number";
                columnsInput.min = "1";
                columnsInput.value = subcat.columnsPerRow ?? 2;
                columnsInput.placeholder = "2";
                columnsInput.addEventListener("input", () => {
                    const value = columnsInput.value.trim();
                    const num = Number(value);
                    if (value === "" || num < 1) {
                        subcat.columnsPerRow = 2;
                        columnsInput.value = 2;
                    } else {
                        subcat.columnsPerRow = num;
                    }
                    schedulePreviewUpdate();
                });
                columnsRow.appendChild(columnsLabel);
                columnsRow.appendChild(columnsInput);
                subBody.appendChild(columnsRow);

                const textField = document.createElement("div");
                textField.className = "field";
                const textLabel = document.createElement("label");
                textLabel.textContent = "Description";
                const textArea = document.createElement("textarea");
                textArea.value = subcat.text || "";
                textArea.placeholder = "Explain how to use this section.";
                textArea.addEventListener("input", () => {
                    subcat.text = textArea.value;
                    schedulePreviewUpdate();
                });
                textField.appendChild(textLabel);
                textField.appendChild(textArea);
                subBody.appendChild(textField);

                const optionsHeading = document.createElement("div");
                optionsHeading.className = "subheading";
                optionsHeading.textContent = "Options";
                subBody.appendChild(optionsHeading);

                const optionsContainer = document.createElement("div");
                optionsContainer.className = "option-list";
                renderOptionsList(
                    optionsContainer,
                    category,
                    subcat,
                    subIndex,
                    [category.name, ...namePath, subcat.name],
                    [position + 1, ...nextIndexPath]
                );
                subBody.appendChild(optionsContainer);

                const addOptionBtn = document.createElement("button");
                addOptionBtn.type = "button";
                addOptionBtn.className = "button-subtle";
                addOptionBtn.textContent = "Add option";
                addOptionBtn.addEventListener("click", () => {
                    subcat.options = subcat.options || [];
                    subcat.options.push(createDefaultOption([category.name, ...namePath, subcat.name]));
                    keepPanelOpen(category, subcat);
                    renderCategories();
                    schedulePreviewUpdate();
                });
                subBody.appendChild(addOptionBtn);

                const nestedContainer = document.createElement("div");
                nestedContainer.className = "subcategory-list";
                (subcat.subcategories || []).forEach((childSubcat, childIdx) => {
                    renderSubcategoryEditor(subcat.subcategories, childSubcat, childIdx, nestedContainer, [...namePath, subcat.name || `Subcategory${subIndex + 1}`], nextIndexPath);
                });
                subBody.appendChild(nestedContainer);

                const addNestedBtn = document.createElement("button");
                addNestedBtn.type = "button";
                addNestedBtn.className = "button-subtle";
                addNestedBtn.textContent = "Add nested subcategory";
                addNestedBtn.addEventListener("click", () => {
                    subcat.subcategories = subcat.subcategories || [];
                    const newSub = createDefaultSubcategory();
                    subcat.subcategories.push(newSub);
                    keepPanelOpen(category, subcat);
                    keepPanelOpen(category, newSub);
                    renderCategories();
                    schedulePreviewUpdate();
                });
                subBody.appendChild(addNestedBtn);

                subDetails.appendChild(subBody);
                container.appendChild(subDetails);
            };

            const subcategoriesContainer = document.createElement("div");
            subcategoriesContainer.className = "subcategory-list";
            (category.subcategories || []).forEach((subcat, subIndex) => {
                renderSubcategoryEditor(category.subcategories, subcat, subIndex, subcategoriesContainer, [], []);
            });

            body.appendChild(subcategoriesContainer);

            const addSubBtn = document.createElement("button");
            addSubBtn.type = "button";
            addSubBtn.className = "button-subtle";
            addSubBtn.textContent = "Add subcategory";
            addSubBtn.addEventListener("click", () => {
                const newSub = createDefaultSubcategory();
                category.subcategories.push(newSub);
                keepPanelOpen(category, newSub);
                renderCategories();
                schedulePreviewUpdate();
            });
            body.appendChild(addSubBtn);

            details.appendChild(body);
            categoryListEl.appendChild(details);
        });
    }

    function formatOptionSummary(option) {
        const label = option.label || "Untitled option";
        const id = option.id ? ` (${option.id})` : "";
        return `${label}${id}`;
    }

    function renderOptionsList(container, category, subcategory, subIndex, fullPathParts = [], indexPath = []) {
        container.innerHTML = "";
        subcategory.options = subcategory.options || [];
        const normalizedPath = Array.isArray(fullPathParts) && fullPathParts.length
            ? fullPathParts.filter(Boolean)
            : [category.name, subcategory.name].filter(Boolean);
        subcategory.options.forEach((option, optionIndex) => {
            if (!optionMatchesFilter(option, state.filterQuery)) return;
            const details = document.createElement("details");
            details.className = "option-item";
            details.id = buildEditorNodeId("option", [...indexPath, optionIndex + 1]);

            const storedOpen = optionOpenState.has(option) ? optionOpenState.get(option) : false;
            if (storedOpen) {
                details.open = true;
            }
            details.addEventListener("toggle", () => {
                optionOpenState.set(option, details.open);
            });

            const summary = document.createElement("summary");
            const summaryLabel = document.createElement("span");
            summaryLabel.className = "summary-label";
            summaryLabel.appendChild(createSummaryHeader(
                formatOptionSummary(option),
                Object.keys(option.cost || {}).length ? [`${Object.keys(option.cost).length} cost type${Object.keys(option.cost).length === 1 ? "" : "s"}`] : []
            ));
            summary.appendChild(summaryLabel);

            optionIdAutoMap.set(option, true);

            const toolbar = document.createElement("div");
            toolbar.className = "option-toolbar";

            const upBtn = document.createElement("button");
            upBtn.type = "button";
            upBtn.className = "button-icon";
            upBtn.disabled = optionIndex === 0;
            upBtn.title = "Move option up";
            upBtn.textContent = "↑";
            upBtn.addEventListener("click", () => {
                if (moveArrayItem(subcategory.options, optionIndex, -1)) {
                    keepPanelOpen(category, subcategory);
                    renderCategories();
                    schedulePreviewUpdate();
                }
            });

            const downBtn = document.createElement("button");
            downBtn.type = "button";
            downBtn.className = "button-icon";
            downBtn.disabled = optionIndex === subcategory.options.length - 1;
            downBtn.title = "Move option down";
            downBtn.textContent = "↓";
            downBtn.addEventListener("click", () => {
                if (moveArrayItem(subcategory.options, optionIndex, 1)) {
                    keepPanelOpen(category, subcategory);
                    renderCategories();
                    schedulePreviewUpdate();
                }
            });

            const cloneBtn = document.createElement("button");
            cloneBtn.type = "button";
            cloneBtn.className = "button-icon";
            cloneBtn.title = "Duplicate option";
            cloneBtn.textContent = "⧉";
            cloneBtn.addEventListener("click", () => {
                const copy = cloneData(option);
                const baseId = option.id ? `${option.id}_copy` : (option.label || "option");
                copy.id = generateOptionId(baseId, {
                    path: normalizedPath
                });
                optionIdAutoMap.set(copy, true);
                subcategory.options.splice(optionIndex + 1, 0, copy);
                keepPanelOpen(category, subcategory);
                renderCategories();
                schedulePreviewUpdate();
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Delete option";
            removeBtn.textContent = "✕";
            removeBtn.addEventListener("click", () => {
                if (!confirm(`Delete option "${option.label || option.id || ""}"?`)) return;
                subcategory.options.splice(optionIndex, 1);
                keepPanelOpen(category, subcategory);
                renderCategories();
                schedulePreviewUpdate();
            });

            toolbar.appendChild(upBtn);
            toolbar.appendChild(downBtn);
            toolbar.appendChild(cloneBtn);
            toolbar.appendChild(removeBtn);
            summary.appendChild(toolbar);
            preventSummaryToggle(toolbar);
            details.appendChild(summary);

            const body = document.createElement("div");
            body.className = "option-body";
            ensurePaymentOptionsForEditor(option);

            const {
                container: optionAdvancedSection,
                body: optionAdvancedBody
            } = createSectionContainer("Advanced Fields", {
                storageKey: `${normalizedPathKey([...normalizedPath, option.id || option.label || `Option${optionIndex + 1}`])}-advanced`,
                defaultOpen: false
            });
            body.appendChild(optionAdvancedSection);

            const optionSectionKeyBase = normalizedPathKey([...normalizedPath, option.id || option.label || `Option${optionIndex + 1}`]);
            const {
                container: inputSelectionSection,
                body: inputSelectionBody
            } = createSectionContainer("Input & Selection", {
                storageKey: `${optionSectionKeyBase}-advanced-input-selection`,
                defaultOpen: false
            });
            const {
                container: dependenciesSection,
                body: dependenciesBody
            } = createSectionContainer("Dependencies", {
                storageKey: `${optionSectionKeyBase}-advanced-dependencies`,
                defaultOpen: false
            });
            const {
                container: automationSection,
                body: automationBody
            } = createSectionContainer("Automatic Grants", {
                storageKey: `${optionSectionKeyBase}-advanced-automation`,
                defaultOpen: false
            });
            const {
                container: pricingSection,
                body: pricingBody
            } = createSectionContainer("Conditional Pricing", {
                storageKey: `${optionSectionKeyBase}-advanced-pricing`,
                defaultOpen: false
            });
            const {
                container: styleSection,
                body: styleBody
            } = createSectionContainer("Style", {
                storageKey: `${optionSectionKeyBase}-advanced-style`,
                defaultOpen: false
            });
            const {
                container: customJsonSection,
                body: customJsonBody
            } = createSectionContainer("Custom JSON Fields", {
                storageKey: `${optionSectionKeyBase}-advanced-custom-json`,
                defaultOpen: false
            });
            optionAdvancedBody.append(inputSelectionSection, dependenciesSection, automationSection, pricingSection, styleSection, customJsonSection);

            const validationBox = document.createElement("div");
            validationBox.className = "inline-warning-list";
            const refreshOptionWarnings = (extraWarnings = []) => {
                const warnings = [...extraWarnings, ...getOptionValidationWarnings(option)];
                validationBox.innerHTML = "";
                if (!warnings.length) {
                    validationBox.style.display = "none";
                    return;
                }
                validationBox.style.display = "block";
                warnings.forEach(text => {
                    const row = document.createElement("div");
                    row.className = "inline-warning";
                    row.textContent = `⚠ ${text}`;
                    validationBox.appendChild(row);
                });
            };
            body.appendChild(validationBox);

            const idField = document.createElement("div");
            idField.className = "field";
            const idLabel = document.createElement("label");
            idLabel.textContent = "ID";
            const idInput = document.createElement("input");
            idInput.type = "text";
            idInput.value = option.id || "";
            idInput.placeholder = "Auto-generated";
            idInput.readOnly = true;
            idInput.title = "Auto-generated from the option path and label";
            idField.appendChild(idLabel);
            idField.appendChild(idInput);
            body.appendChild(idField);

            const labelField = document.createElement("div");
            labelField.className = "field";
            const labelLabel = document.createElement("label");
            labelLabel.textContent = "Label";
            const labelInput = document.createElement("input");
            labelInput.type = "text";
            labelInput.value = option.label || "";
            labelInput.placeholder = "Displayed choice text. Supports Markdown emphasis and legacy [color=#d32f2f], [weight=600], and [size=120%] tags.";
            labelInput.addEventListener("input", () => {
                option.label = labelInput.value;
                const newId = generateOptionId(option.label, {
                    path: normalizedPath,
                    skipOption: option
                });
                option.id = newId;
                optionIdAutoMap.set(option, true);
                idInput.value = newId;
                summaryLabel.innerHTML = "";
                summaryLabel.appendChild(createSummaryHeader(
                    formatOptionSummary(option),
                    Object.keys(option.cost || {}).length ? [`${Object.keys(option.cost).length} cost type${Object.keys(option.cost).length === 1 ? "" : "s"}`] : []
                ));
                refreshOptionWarnings();
                renderEditorNavigation(getCategorySnapshots());
                schedulePreviewUpdate();
            });
            labelField.appendChild(labelLabel);
            labelField.appendChild(labelInput);
            body.appendChild(labelField);

            const descField = document.createElement("div");
            descField.className = "field";
            const descLabel = document.createElement("label");
            descLabel.textContent = "Description";
            const descTextarea = document.createElement("textarea");
            descTextarea.value = option.description || "";
            descTextarea.placeholder = "Explain what this choice does. Supports Markdown like **bold**, *italic*, lists, links, and legacy [color=#d32f2f]red[/color] tags.";
            descTextarea.addEventListener("input", () => {
                option.description = descTextarea.value;
                schedulePreviewUpdate();
            });
            descField.appendChild(descLabel);
            descField.appendChild(descTextarea);
            body.appendChild(descField);

            const imageField = document.createElement("div");
            imageField.className = "field";
            const imageLabel = document.createElement("label");
            imageLabel.textContent = "Image URL (optional)";
            const imageInput = document.createElement("input");
            imageInput.type = "url";
            imageInput.value = option.image || "";
            imageInput.placeholder = "https://example.com/image.png";
            imageInput.addEventListener("input", () => {
                if (imageInput.value.trim()) {
                    option.image = imageInput.value.trim();
                } else {
                    delete option.image;
                }
                schedulePreviewUpdate();
            });
            imageField.appendChild(imageLabel);
            imageField.appendChild(imageInput);
            body.appendChild(imageField);

            const inputTypeField = document.createElement("div");
            inputTypeField.className = "field-inline";
            const inputTypeLabel = document.createElement("label");
            inputTypeLabel.textContent = "Input type";
            const inputTypeInput = document.createElement("input");
            inputTypeInput.type = "text";
            inputTypeInput.value = option.inputType || "";
            inputTypeInput.placeholder = "button, slider, text...";
            inputTypeInput.addEventListener("input", () => {
                if (inputTypeInput.value.trim()) {
                    option.inputType = inputTypeInput.value.trim();
                } else {
                    delete option.inputType;
                }
                schedulePreviewUpdate();
            });
            const inputLabelLabel = document.createElement("label");
            inputLabelLabel.textContent = "Input label";
            const inputLabelInput = document.createElement("input");
            inputLabelInput.type = "text";
            inputLabelInput.value = option.inputLabel || "";
            inputLabelInput.placeholder = "Shown next to sliders/text inputs";
            inputLabelInput.addEventListener("input", () => {
                if (inputLabelInput.value.trim()) {
                    option.inputLabel = inputLabelInput.value;
                } else {
                    delete option.inputLabel;
                }
                schedulePreviewUpdate();
            });
            inputTypeField.appendChild(inputTypeLabel);
            inputTypeField.appendChild(inputTypeInput);
            inputTypeField.appendChild(inputLabelLabel);
            inputTypeField.appendChild(inputLabelInput);
            inputSelectionBody.appendChild(inputTypeField);

            const optionLimitField = document.createElement("div");
            optionLimitField.className = "field-inline";
            const optionLimitLabel = document.createElement("label");
            optionLimitLabel.textContent = "Max selections";
            const optionLimitInput = document.createElement("input");
            optionLimitInput.type = "number";
            optionLimitInput.min = "1";
            optionLimitInput.value = option.maxSelections ?? "";
            optionLimitInput.placeholder = "Default: 1";
            optionLimitInput.addEventListener("input", () => {
                const raw = optionLimitInput.value.trim();
                if (!raw) {
                    delete option.maxSelections;
                } else {
                    const parsed = Math.max(1, Number(raw) || 1);
                    option.maxSelections = parsed;
                    optionLimitInput.value = String(parsed);
                }
                schedulePreviewUpdate();
            });
            optionLimitField.appendChild(optionLimitLabel);
            optionLimitField.appendChild(optionLimitInput);
            inputSelectionBody.appendChild(optionLimitField);

            const countAsOneField = document.createElement("div");
            countAsOneField.className = "field";
            const countAsOneToggle = document.createElement("label");
            countAsOneToggle.className = "checkbox-option";
            const countAsOneInput = document.createElement("input");
            countAsOneInput.type = "checkbox";
            countAsOneInput.checked = option.countsAsOneSelection === true;
            const countAsOneText = document.createElement("span");
            countAsOneText.textContent = "Count repeated picks as 1 toward subcategory max selections";
            countAsOneInput.addEventListener("change", () => {
                if (countAsOneInput.checked) {
                    option.countsAsOneSelection = true;
                } else {
                    delete option.countsAsOneSelection;
                }
                schedulePreviewUpdate();
            });
            countAsOneToggle.appendChild(countAsOneInput);
            countAsOneToggle.appendChild(countAsOneText);
            countAsOneField.appendChild(countAsOneToggle);
            inputSelectionBody.appendChild(countAsOneField);

            const bypassSubcatLimitField = document.createElement("div");
            bypassSubcatLimitField.className = "field";
            const bypassSubcatLimitToggle = document.createElement("label");
            bypassSubcatLimitToggle.className = "checkbox-option";
            const bypassSubcatLimitInput = document.createElement("input");
            bypassSubcatLimitInput.type = "checkbox";
            bypassSubcatLimitInput.checked = option.bypassSubcategoryMaxSelections === true;
            const bypassSubcatLimitText = document.createElement("span");
            bypassSubcatLimitText.textContent = "Bypass subcategory max selections";
            bypassSubcatLimitInput.addEventListener("change", () => {
                if (bypassSubcatLimitInput.checked) {
                    option.bypassSubcategoryMaxSelections = true;
                } else {
                    delete option.bypassSubcategoryMaxSelections;
                }
                schedulePreviewUpdate();
            });
            bypassSubcatLimitToggle.appendChild(bypassSubcatLimitInput);
            bypassSubcatLimitToggle.appendChild(bypassSubcatLimitText);
            bypassSubcatLimitField.appendChild(bypassSubcatLimitToggle);
            inputSelectionBody.appendChild(bypassSubcatLimitField);

            const costOptionsSection = document.createElement("div");
            costOptionsSection.className = "field";
            const costOptionsLabel = document.createElement("label");
            costOptionsLabel.textContent = "Payment options";
            const costOptionsHint = document.createElement("div");
            costOptionsHint.className = "field-help";
            costOptionsHint.textContent = "Leave empty to inherit this subcategory's default payment options.";
            const costOptionsContainer = document.createElement("div");
            costOptionsContainer.className = "list-stack";
            renderCostOptionsEditor(costOptionsContainer, option, {
                allowEmpty: true,
                emptyText: "No option-specific payment options. This option inherits subcategory defaults. Add payment options here to configure separate choices such as Ally vs Bitter Enemy, each with its own prerequisites."
            });
            costOptionsSection.append(costOptionsLabel, costOptionsHint, costOptionsContainer);
            body.appendChild(costOptionsSection);

            const pointAllocationSection = document.createElement("div");
            pointAllocationSection.className = "field";
            const pointAllocationLabel = document.createElement("label");
            pointAllocationLabel.textContent = "Point allocation";
            const pointAllocationHint = document.createElement("div");
            pointAllocationHint.className = "field-help";
            pointAllocationHint.textContent = "Optional. Let players split a fixed grant across multiple point types.";
            const pointAllocationContainer = document.createElement("div");
            pointAllocationContainer.className = "list-stack";
            renderPointAllocationEditor(pointAllocationContainer, option);
            pointAllocationSection.append(pointAllocationLabel, pointAllocationHint, pointAllocationContainer);
            body.appendChild(pointAllocationSection);

            const sliderModifiersSection = document.createElement("div");
            sliderModifiersSection.className = "field";
            const sliderModifiersLabel = document.createElement("label");
            sliderModifiersLabel.textContent = "Slider modifiers";
            const sliderModifiersHint = document.createElement("div");
            sliderModifiersHint.className = "field-help";
            sliderModifiersHint.textContent = "Optional. Modify point values while this option is selected.";
            const sliderModifiersContainer = document.createElement("div");
            sliderModifiersContainer.className = "list-stack";
            renderSliderModifiersEditor(sliderModifiersContainer, option);
            sliderModifiersSection.append(sliderModifiersLabel, sliderModifiersHint, sliderModifiersContainer);
            body.appendChild(sliderModifiersSection);

            const prereqSection = document.createElement("div");
            prereqSection.className = "field";
            const prereqLabel = document.createElement("label");
            prereqLabel.textContent = "Prerequisites (optional)";
            const prereqHint = document.createElement("div");
            prereqHint.className = "field-help";
            prereqHint.textContent = "Use comma-separated IDs, expression syntax (&&, ||, !), or JSON (array/object).";
            const prereqInput = document.createElement("textarea");
            prereqInput.value = formatPrerequisiteValue(option.prerequisites);
            prereqInput.placeholder = "e.g. powerCore, focusTraining OR powerCore && !villainPath";
            let prereqParseError = null;
            const syncPrereqFromInput = () => {
                const parsed = parsePrerequisiteValue(prereqInput.value);
                prereqParseError = parsed.error;
                if (parsed.error) {
                    prereqInput.classList.add("field-error");
                } else {
                    prereqInput.classList.remove("field-error");
                    if (parsed.value == null) {
                        delete option.prerequisites;
                    } else {
                        option.prerequisites = parsed.value;
                    }
                }
                refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                schedulePreviewUpdate();
            };
            prereqInput.addEventListener("input", syncPrereqFromInput);
            prereqInput.addEventListener("blur", syncPrereqFromInput);
            prereqSection.appendChild(prereqLabel);
            prereqSection.appendChild(prereqHint);
            prereqSection.appendChild(prereqInput);
            dependenciesBody.appendChild(prereqSection);

            const conflictSection = document.createElement("div");
            conflictSection.className = "field";
            const conflictLabel = document.createElement("label");
            conflictLabel.textContent = "Incompatible with options";
            const conflictHint = document.createElement("div");
            conflictHint.className = "field-help";
            conflictHint.textContent = "If any selected option appears here, this option becomes unavailable (and vice versa).";
            const conflictContainer = document.createElement("div");
            const updateConflicts = (next) => {
                if (next.length) {
                    option.conflictsWith = next;
                } else {
                    delete option.conflictsWith;
                }
                mountIdListEditor(conflictContainer, {
                    ids: option.conflictsWith || [],
                    excludeIds: [option.id || ""],
                    emptyText: "No incompatible options set.",
                    onChange: updateConflicts
                });
                refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                schedulePreviewUpdate();
            };
            mountIdListEditor(conflictContainer, {
                ids: option.conflictsWith || [],
                excludeIds: [option.id || ""],
                emptyText: "No incompatible options set.",
                onChange: updateConflicts
            });
            conflictSection.appendChild(conflictLabel);
            conflictSection.appendChild(conflictHint);
            conflictSection.appendChild(conflictContainer);
            dependenciesBody.appendChild(conflictSection);

            const autoGrantSection = document.createElement("div");
            autoGrantSection.className = "field";
            const autoGrantLabel = document.createElement("label");
            autoGrantLabel.textContent = "Automatically grants options";
            const autoGrantHint = document.createElement("div");
            autoGrantHint.className = "field-help";
            autoGrantHint.textContent = "When this option is selected, the listed options are selected automatically at no extra point cost.";
            const autoGrantContainer = document.createElement("div");
            autoGrantContainer.className = "list-stack";

            const getAutoGrantRules = () => {
                if (!Array.isArray(option.autoGrants)) return [];
                return option.autoGrants
                    .map(rule => {
                        if (typeof rule === "string") {
                            return {
                                id: rule,
                                canDeselect: false
                            };
                        }
                        if (rule && typeof rule === "object" && typeof rule.id === "string") {
                            return {
                                id: rule.id,
                                canDeselect: rule.canDeselect === true
                            };
                        }
                        return null;
                    })
                    .filter(Boolean);
            };

            const setAutoGrantRules = (rules) => {
                const normalizedRules = rules
                    .map(rule => ({
                        id: String(rule.id || "").trim(),
                        canDeselect: rule.canDeselect === true
                    }))
                    .filter(rule => rule.id);
                if (normalizedRules.length) {
                    option.autoGrants = normalizedRules;
                } else {
                    delete option.autoGrants;
                }
            };

            function renderAutoGrantRulesEditor() {
                autoGrantContainer.innerHTML = "";
                const rules = getAutoGrantRules();

                if (!rules.length) {
                    const empty = document.createElement("div");
                    empty.className = "empty-state";
                    empty.textContent = "No automatic grants set.";
                    autoGrantContainer.appendChild(empty);
                }

                rules.forEach((rule, ruleIndex) => {
                    const row = document.createElement("div");
                    row.className = "option-rule-row";
                    row.style.gridTemplateColumns = "1fr auto auto";

                    const idInput = document.createElement("input");
                    idInput.type = "text";
                    idInput.value = rule.id;
                    const datalist = document.createElement("datalist");
                    const datalistId = `auto-grant-options-${++optionDatalistCounter}`;
                    datalist.id = datalistId;
                    getSortedOptionIds([option.id || ""]).forEach(id => {
                        const opt = document.createElement("option");
                        opt.value = id;
                        datalist.appendChild(opt);
                    });
                    idInput.setAttribute("list", datalistId);
                    idInput.addEventListener("input", () => {
                        const next = getAutoGrantRules();
                        next[ruleIndex] = {
                            ...next[ruleIndex],
                            id: idInput.value.trim()
                        };
                        setAutoGrantRules(next);
                        schedulePreviewUpdate();
                    });

                    const canDeselectLabel = document.createElement("label");
                    canDeselectLabel.className = "inline-checkbox";
                    const canDeselectInput = document.createElement("input");
                    canDeselectInput.type = "checkbox";
                    canDeselectInput.checked = rule.canDeselect === true;
                    canDeselectInput.addEventListener("change", () => {
                        const next = getAutoGrantRules();
                        next[ruleIndex] = {
                            ...next[ruleIndex],
                            canDeselect: canDeselectInput.checked
                        };
                        setAutoGrantRules(next);
                        schedulePreviewUpdate();
                    });
                    const canDeselectText = document.createElement("span");
                    canDeselectText.textContent = "Can be deselected";
                    canDeselectLabel.append(canDeselectInput, canDeselectText);

                    const removeBtn = document.createElement("button");
                    removeBtn.type = "button";
                    removeBtn.className = "button-icon danger";
                    removeBtn.title = "Remove grant";
                    removeBtn.textContent = "✕";
                    removeBtn.addEventListener("click", () => {
                        const next = getAutoGrantRules();
                        next.splice(ruleIndex, 1);
                        setAutoGrantRules(next);
                        renderAutoGrantRulesEditor();
                        schedulePreviewUpdate();
                    });

                    row.append(idInput, canDeselectLabel, removeBtn, datalist);
                    autoGrantContainer.appendChild(row);
                });

                const addBtn = document.createElement("button");
                addBtn.type = "button";
                addBtn.className = "button-subtle";
                addBtn.textContent = "Add automatic grant";
                addBtn.addEventListener("click", () => {
                    const availableIds = getSortedOptionIds([option.id || ""]);
                    if (!availableIds.length) {
                        showEditorMessage("No other option IDs are available to grant.", "warning", 3000);
                        return;
                    }
                    const next = getAutoGrantRules();
                    next.push({
                        id: availableIds[0],
                        canDeselect: false
                    });
                    setAutoGrantRules(next);
                    renderAutoGrantRulesEditor();
                    schedulePreviewUpdate();
                });
                autoGrantContainer.appendChild(addBtn);
            }

            renderAutoGrantRulesEditor();
            autoGrantSection.append(autoGrantLabel, autoGrantHint, autoGrantContainer);
            automationBody.appendChild(autoGrantSection);

            const modifiedCostSection = document.createElement("div");
            modifiedCostSection.className = "field";
            const modifiedCostLabel = document.createElement("label");
            modifiedCostLabel.textContent = "Conditional modified costs";
            const modifiedCostHint = document.createElement("div");
            modifiedCostHint.className = "field-help";
            modifiedCostHint.textContent = "Create rules that increase or decrease this option's cost when required option IDs are selected. If multiple cost rules match, the highest priority rule wins.";
            const modifiedCostContainer = document.createElement("div");
            modifiedCostContainer.className = "list-stack";
            renderModifiedCostRulesEditor(modifiedCostContainer, option, {
                emptyText: "No conditional modified cost rules yet.",
                addButtonText: "Add modified cost rule",
                includeSlotBehavior: true,
                onChange: () => {
                    refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                    schedulePreviewUpdate();
                }
            });
            modifiedCostSection.append(modifiedCostLabel, modifiedCostHint, modifiedCostContainer);
            pricingBody.appendChild(modifiedCostSection);

            const grantsSection = document.createElement("div");
            grantsSection.className = "field";
            const grantsLabel = document.createElement("label");
            grantsLabel.textContent = "Grants discounts (x of y)";
            const grantsHint = document.createElement("div");
            grantsHint.className = "field-help";
            grantsHint.textContent = "When this option is selected, grant discount slots that can be assigned across target options.";
            const grantsContainer = document.createElement("div");
            grantsContainer.className = "list-stack";

            function renderGrantRulesEditor() {
                grantsContainer.innerHTML = "";
                const grantRules = Array.isArray(option.discountGrants) ? option.discountGrants : [];
                if (!grantRules.length) {
                    const empty = document.createElement("div");
                    empty.className = "empty-state";
                    empty.textContent = "No grant rules yet.";
                    grantsContainer.appendChild(empty);
                }

                grantRules.forEach((rule, ruleIndex) => {
                    const card = document.createElement("div");
                    card.className = "discount-rule-card";

                    const header = document.createElement("div");
                    header.className = "discount-rule-header";
                    const title = document.createElement("strong");
                    title.textContent = `Grant Rule ${ruleIndex + 1}`;
                    const removeBtn = document.createElement("button");
                    removeBtn.type = "button";
                    removeBtn.className = "button-icon danger";
                    removeBtn.textContent = "✕";
                    removeBtn.title = "Delete grant rule";
                    removeBtn.addEventListener("click", () => {
                        grantRules.splice(ruleIndex, 1);
                        if (grantRules.length) {
                            option.discountGrants = grantRules;
                        } else {
                            delete option.discountGrants;
                        }
                        renderGrantRulesEditor();
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });
                    header.appendChild(title);
                    header.appendChild(removeBtn);
                    card.appendChild(header);

                    const settingsRow = document.createElement("div");
                    settingsRow.className = "field-inline field-inline-three";
                    const slotsLabel = document.createElement("label");
                    slotsLabel.textContent = "Slots (x)";
                    const slotsInput = document.createElement("input");
                    slotsInput.type = "number";
                    slotsInput.min = "1";
                    slotsInput.value = String(Math.max(1, Number(rule.slots) || 1));
                    const modeLabel = document.createElement("label");
                    modeLabel.textContent = "Discount mode";
                    const modeInput = document.createElement("select");
                    const halfMode = document.createElement("option");
                    halfMode.value = "half";
                    halfMode.textContent = "Half cost";
                    const freeMode = document.createElement("option");
                    freeMode.value = "free";
                    freeMode.textContent = "Free";
                    modeInput.appendChild(halfMode);
                    modeInput.appendChild(freeMode);
                    modeInput.value = rule.mode === "free" ? "free" : "half";

                    slotsInput.addEventListener("input", () => {
                        const parsed = Math.max(1, Number(slotsInput.value) || 1);
                        rule.slots = parsed;
                        slotsInput.value = String(parsed);
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });
                    modeInput.addEventListener("change", () => {
                        rule.mode = modeInput.value === "free" ? "free" : "half";
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });

                    settingsRow.appendChild(slotsLabel);
                    settingsRow.appendChild(slotsInput);
                    settingsRow.appendChild(modeLabel);
                    settingsRow.appendChild(modeInput);
                    card.appendChild(settingsRow);

                    const targetsField = document.createElement("div");
                    targetsField.className = "field";
                    const targetsLabel = document.createElement("label");
                    targetsLabel.textContent = "Target option IDs (y)";
                    const targetsContainer = document.createElement("div");
                    const setTargets = (nextIds) => {
                        rule.targetIds = nextIds;
                        delete rule.targets;
                        delete rule.targetId;
                        mountIdListEditor(targetsContainer, {
                            ids: rule.targetIds,
                            excludeIds: [option.id || ""],
                            emptyText: "No target IDs set.",
                            onChange: setTargets
                        });
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    };
                    const initialTargets = normalizeIdList(rule.targetIds || rule.targets || (rule.targetId ? [rule.targetId] : []));
                    rule.targetIds = initialTargets;
                    delete rule.targets;
                    delete rule.targetId;
                    mountIdListEditor(targetsContainer, {
                        ids: rule.targetIds,
                        excludeIds: [option.id || ""],
                        emptyText: "No target IDs set.",
                        onChange: setTargets
                    });
                    targetsField.appendChild(targetsLabel);
                    targetsField.appendChild(targetsContainer);
                    card.appendChild(targetsField);

                    grantsContainer.appendChild(card);
                });

                const addGrantBtn = document.createElement("button");
                addGrantBtn.type = "button";
                addGrantBtn.className = "button-subtle";
                addGrantBtn.textContent = "Add grant rule";
                addGrantBtn.addEventListener("click", () => {
                    const nextRule = {
                        slots: 1,
                        mode: "half",
                        targetIds: []
                    };
                    if (!Array.isArray(option.discountGrants)) {
                        option.discountGrants = [];
                    }
                    option.discountGrants.push(nextRule);
                    renderGrantRulesEditor();
                    refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                    schedulePreviewUpdate();
                });
                grantsContainer.appendChild(addGrantBtn);
            }

            renderGrantRulesEditor();
            grantsSection.appendChild(grantsLabel);
            grantsSection.appendChild(grantsHint);
            grantsSection.appendChild(grantsContainer);
            pricingBody.appendChild(grantsSection);
            refreshOptionWarnings();

            const alignmentSection = document.createElement("div");
            alignmentSection.className = "field";
            const alignmentLabel = document.createElement("label");
            alignmentLabel.textContent = "Text alignment";
            const alignmentHint = document.createElement("div");
            alignmentHint.className = "field-help";
            alignmentHint.textContent = "Optional. Overrides the CYOA-wide alignment for this option's title, detail blocks, or description.";
            const alignmentGrid = document.createElement("div");
            alignmentGrid.className = "field-inline field-inline-three";
            [
                ["titleAlignment", "Title"],
                ["metaAlignment", "Costs and prerequisites"],
                ["descriptionAlignment", "Description"]
            ].forEach(([key, labelText]) => {
                const label = document.createElement("label");
                label.textContent = labelText;
                const select = renderAlignmentSelect(option[key], "Use CYOA default", (value) => {
                    if (value) option[key] = value;
                    else delete option[key];
                    schedulePreviewUpdate();
                });
                alignmentGrid.append(label, select);
            });
            alignmentSection.append(alignmentLabel, alignmentHint, alignmentGrid);
            styleBody.appendChild(alignmentSection);

            const borderColorSection = document.createElement("div");
            borderColorSection.className = "field";
            const borderColorLabel = document.createElement("label");
            borderColorLabel.textContent = "Option border";
            const borderColorHint = document.createElement("div");
            borderColorHint.className = "field-help";
            borderColorHint.textContent = "Optional. Use a named CSS color, hex color, rgb(...), rgba(...), hsl(...), or hsla(...). Dark mode falls back to the light color when blank.";
            const borderColorGrid = document.createElement("div");
            borderColorGrid.style.display = "grid";
            borderColorGrid.style.gridTemplateColumns = "1fr 1fr";
            borderColorGrid.style.gap = "12px";

            const renderOptionColorInput = (key, labelText, placeholder) => {
                const field = document.createElement("div");
                field.className = "field";
                const label = document.createElement("label");
                label.textContent = labelText;
                const inputContainer = document.createElement("div");
                inputContainer.style.display = "flex";
                inputContainer.style.gap = "8px";

                const colorInput = document.createElement("input");
                colorInput.type = "color";
                colorInput.style.padding = "0";
                colorInput.style.width = "32px";
                colorInput.style.height = "32px";
                colorInput.style.border = "none";
                colorInput.style.cursor = "pointer";

                const textInput = document.createElement("input");
                textInput.type = "text";
                textInput.style.flex = "1";
                textInput.placeholder = placeholder;

                const syncColorPicker = (value) => {
                    const color = String(value || "").trim();
                    if (/^#[0-9a-f]{3}$/i.test(color)) {
                        colorInput.value = `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
                    } else if (/^#[0-9a-f]{6}$/i.test(color)) {
                        colorInput.value = color;
                    }
                };

                textInput.value = option[key] || "";
                syncColorPicker(textInput.value);

                const update = (nextValue) => {
                    const value = String(nextValue || "").trim();
                    if (value) {
                        option[key] = value;
                    } else {
                        delete option[key];
                    }
                    textInput.value = value;
                    syncColorPicker(value);
                    refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                    schedulePreviewUpdate();
                };

                colorInput.addEventListener("input", () => update(colorInput.value));
                textInput.addEventListener("input", () => update(textInput.value));

                inputContainer.append(colorInput, textInput);
                field.append(label, inputContainer);
                return field;
            };

            borderColorGrid.append(
                renderOptionColorInput("borderColor", "Light border color", "gold or #ffd700"),
                renderOptionColorInput("darkBorderColor", "Dark border color", "optional")
            );
            borderColorSection.append(borderColorLabel, borderColorHint, borderColorGrid);
            styleBody.appendChild(borderColorSection);

            const advancedKeys = Object.keys(option).filter(key => !BASE_OPTION_KEYS.has(key));
            const advancedSection = document.createElement("div");
            advancedSection.className = "field";
            const advancedLabel = document.createElement("label");
            advancedLabel.textContent = "Advanced fields (JSON)";
            const advancedTextarea = document.createElement("textarea");
            if (advancedKeys.length) {
                const advancedData = {};
                advancedKeys.forEach(key => {
                    advancedData[key] = option[key];
                });
                advancedTextarea.value = JSON.stringify(advancedData, null, 2);
            } else {
                advancedTextarea.placeholder = "{ }";
            }
            advancedTextarea.addEventListener("blur", () => {
                const raw = advancedTextarea.value.trim();
                if (!raw) {
                    advancedKeys.forEach(key => delete option[key]);
                    advancedTextarea.classList.remove("field-error");
                    schedulePreviewUpdate();
                    return;
                }
                try {
                    const parsed = JSON.parse(raw);
                    Object.keys(option).forEach(key => {
                        if (!BASE_OPTION_KEYS.has(key)) delete option[key];
                    });
                    Object.keys(parsed).forEach(key => {
                        option[key] = parsed[key];
                    });
                    advancedTextarea.classList.remove("field-error");
                    schedulePreviewUpdate();
                } catch (err) {
                    advancedTextarea.classList.add("field-error");
                    showEditorMessage(`Advanced JSON error: ${err.message}`, "error", 6000);
                }
            });
            advancedSection.appendChild(advancedLabel);
            advancedSection.appendChild(advancedTextarea);
            customJsonBody.appendChild(advancedSection);

            details.appendChild(body);
            container.appendChild(details);
        });
    }

    function renderCostEditor(container, option) {
        container.innerHTML = "";
        option.cost = option.cost || {};
        Object.entries(option.cost).forEach(([currency, amount]) => {
            const row = document.createElement("div");
            row.className = "cost-row";

            const pointTypeNames = getPointTypeNames();
            const availablePointTypes = pointTypeNames.includes(currency)
                ? pointTypeNames
                : [currency, ...pointTypeNames];

            const nameSelect = document.createElement("select");
            availablePointTypes.forEach((pointType) => {
                const opt = document.createElement("option");
                opt.value = pointType;
                opt.textContent = getPointTypeDisplayName(pointType);
                nameSelect.appendChild(opt);
            });
            nameSelect.value = currency;

            const valueInput = document.createElement("input");
            valueInput.type = "number";
            valueInput.value = typeof amount === "number" ? amount : 0;

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.textContent = "✕";
            removeBtn.title = "Remove cost entry";

            valueInput.addEventListener("input", () => {
                option.cost[currency] = Number(valueInput.value) || 0;
                schedulePreviewUpdate();
            });

            nameSelect.addEventListener("change", () => {
                const newName = nameSelect.value;
                if (!newName || newName === currency) {
                    nameSelect.value = currency;
                    return;
                }
                if (option.cost.hasOwnProperty(newName)) {
                    showEditorMessage(`Duplicate cost key "${newName}"`, "warning");
                    nameSelect.value = currency;
                    return;
                }
                option.cost = renameMapKeyPreservingOrder(option.cost, currency, newName);
                renderCostEditor(container, option);
                schedulePreviewUpdate();
            });

            removeBtn.addEventListener("click", () => {
                delete option.cost[currency];
                renderCostEditor(container, option);
                schedulePreviewUpdate();
            });

            row.appendChild(nameSelect);
            row.appendChild(valueInput);
            row.appendChild(removeBtn);
            container.appendChild(row);
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "button-subtle";
        addBtn.textContent = "Add cost";
        addBtn.addEventListener("click", () => {
            const candidate = getPointTypeNames().find((pointType) => !option.cost.hasOwnProperty(pointType));
            if (!candidate) {
                showEditorMessage("All available point types are already used for this cost.", "warning");
                return;
            }
            option.cost[candidate] = 0;
            renderCostEditor(container, option);
            schedulePreviewUpdate();
        });

        container.appendChild(addBtn);
    }

    function normalizeCostOptionsForEditor(owner, { allowEmpty = false } = {}) {
        if (!owner || typeof owner !== "object") return [];
        if (Array.isArray(owner.costOptions) && owner.costOptions.length > 0) {
            const hasMeaningfulCostOptions = owner.costOptions.some(entry =>
                entry?.cost && typeof entry.cost === "object" && Object.keys(entry.cost).length
                || Array.isArray(entry?.costBySelection) && entry.costBySelection.some(cost => cost && typeof cost === "object" && Object.keys(cost).length)
            );
            if (allowEmpty && !hasMeaningfulCostOptions) {
                delete owner.costOptions;
                return [];
            }
            owner.costOptions = owner.costOptions.map(entry => {
                const normalized = {
                    cost: entry?.cost && typeof entry.cost === "object" ? entry.cost : {}
                };
                if (Number.isFinite(Number(entry?.minSelected))) {
                    normalized.minSelected = Math.max(0, Math.floor(Number(entry.minSelected)));
                }
                if (Number.isFinite(Number(entry?.maxSelections))) {
                    normalized.maxSelections = Math.max(0, Math.floor(Number(entry.maxSelections)));
                }
                if (Number.isFinite(Number(entry?.requiresCostOption))) {
                    normalized.requiresCostOption = Math.max(0, Math.floor(Number(entry.requiresCostOption)));
                }
                if (entry?.prerequisites !== undefined) {
                    normalized.prerequisites = entry.prerequisites;
                }
                if (Array.isArray(entry?.costBySelection)) {
                    normalized.costBySelection = entry.costBySelection.map(cost =>
                        cost && typeof cost === "object" && !Array.isArray(cost) ? cost : {}
                    );
                }
                return normalized;
            });
            if (!allowEmpty) delete owner.cost;
            return owner.costOptions;
        }
        if (allowEmpty) {
            if (owner.cost && typeof owner.cost === "object" && Object.keys(owner.cost).length) {
                owner.costOptions = [{ cost: owner.cost }];
                delete owner.cost;
                return owner.costOptions;
            }
            if (Array.isArray(owner.costOptions)) owner.costOptions = [];
            return owner.costOptions || [];
        }
        ensurePaymentOptionsForEditor(owner);
        return owner.costOptions;
    }

    function renderCostOptionsEditor(container, option, {
        allowEmpty = false,
        emptyText = "No payment options configured.",
        includeSelectionCosts = false
    } = {}) {
        container.innerHTML = "";
        const costOptions = normalizeCostOptionsForEditor(option, { allowEmpty });

        if (allowEmpty && costOptions.length === 0) {
            const empty = document.createElement("div");
            empty.className = "field-note";
            empty.textContent = emptyText;
            container.appendChild(empty);
        }

        costOptions.forEach((costOption, index) => {
            if (!costOption || typeof costOption !== "object" || Array.isArray(costOption)) {
                if (!Array.isArray(option.costOptions)) option.costOptions = costOptions;
                option.costOptions[index] = { cost: {} };
                costOption = option.costOptions[index];
            }
            if (!costOption.cost || typeof costOption.cost !== "object") costOption.cost = {};

            const card = document.createElement("div");
            card.className = "cost-option-card";

            const header = document.createElement("div");
            header.className = "cost-option-card-header";

            const title = document.createElement("div");
            title.className = "cost-option-title";
            const titleText = document.createElement("strong");
            titleText.textContent = `Payment option ${index + 1}`;
            const titleHint = document.createElement("span");
            titleHint.textContent = costOptions.length > 1
                ? "Chosen per selection."
                : "Default payment choice.";
            title.append(titleText, titleHint);

            const costMapContainer = document.createElement("div");
            costMapContainer.className = "cost-list";
            renderPointMapEditor(costMapContainer, costOption.cost, (nextCost) => {
                costOption.cost = nextCost || {};
                schedulePreviewUpdate();
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.textContent = "✕";
            removeBtn.title = "Remove alternative cost";
            removeBtn.disabled = !allowEmpty && costOptions.length <= 1;
            removeBtn.addEventListener("click", () => {
                if (!Array.isArray(option.costOptions)) option.costOptions = costOptions;
                if (!allowEmpty && option.costOptions.length <= 1) return;
                option.costOptions.splice(index, 1);
                if (allowEmpty && option.costOptions.length === 0) delete option.costOptions;
                renderCostOptionsEditor(container, option, { allowEmpty, emptyText, includeSelectionCosts });
                schedulePreviewUpdate();
            });

            header.append(title, removeBtn);

            const costField = document.createElement("div");
            costField.className = "field";
            const costLabel = document.createElement("label");
            costLabel.textContent = "Cost map";
            costField.append(costLabel, costMapContainer);

            const availabilityField = document.createElement("div");
            availabilityField.className = "field";
            const availabilityLabel = document.createElement("label");
            availabilityLabel.textContent = "Selection availability";
            const availabilityHint = document.createElement("div");
            availabilityHint.className = "field-help";
            availabilityHint.textContent = "Optional. Use these to make repeatable payment choices unlock after base picks or expire after a set number of uses.";
            const availabilityRow = document.createElement("div");
            availabilityRow.className = "cost-row";

            const minSelectedInput = document.createElement("input");
            minSelectedInput.type = "number";
            minSelectedInput.min = "0";
            minSelectedInput.step = "1";
            minSelectedInput.placeholder = "Min selected";
            minSelectedInput.value = costOption.minSelected ?? "";
            minSelectedInput.title = "Minimum existing selections required before this payment option appears";
            minSelectedInput.addEventListener("input", () => {
                const raw = minSelectedInput.value.trim();
                if (!raw) {
                    delete costOption.minSelected;
                } else {
                    costOption.minSelected = Math.max(0, Math.floor(Number(raw) || 0));
                    minSelectedInput.value = String(costOption.minSelected);
                }
                schedulePreviewUpdate();
            });

            const maxSelectionsInput = document.createElement("input");
            maxSelectionsInput.type = "number";
            maxSelectionsInput.min = "0";
            maxSelectionsInput.step = "1";
            maxSelectionsInput.placeholder = "Max uses";
            maxSelectionsInput.value = costOption.maxSelections ?? "";
            maxSelectionsInput.title = "Maximum times this payment option can be used";
            maxSelectionsInput.addEventListener("input", () => {
                const raw = maxSelectionsInput.value.trim();
                if (!raw) {
                    delete costOption.maxSelections;
                } else {
                    costOption.maxSelections = Math.max(0, Math.floor(Number(raw) || 0));
                    maxSelectionsInput.value = String(costOption.maxSelections);
                }
                schedulePreviewUpdate();
            });

            const requiresCostOptionInput = document.createElement("input");
            requiresCostOptionInput.type = "number";
            requiresCostOptionInput.min = "0";
            requiresCostOptionInput.step = "1";
            requiresCostOptionInput.placeholder = "Requires option #";
            requiresCostOptionInput.value = costOption.requiresCostOption ?? "";
            requiresCostOptionInput.title = "Payment option index that must already be selected first. Use 0 for Payment option 1.";
            requiresCostOptionInput.addEventListener("input", () => {
                const raw = requiresCostOptionInput.value.trim();
                if (!raw) {
                    delete costOption.requiresCostOption;
                } else {
                    costOption.requiresCostOption = Math.max(0, Math.floor(Number(raw) || 0));
                    requiresCostOptionInput.value = String(costOption.requiresCostOption);
                }
                schedulePreviewUpdate();
            });

            availabilityRow.append(minSelectedInput, maxSelectionsInput, requiresCostOptionInput);
            availabilityField.append(availabilityLabel, availabilityHint, availabilityRow);

            const costPrereqField = document.createElement("div");
            costPrereqField.className = "field";
            const costPrereqLabel = document.createElement("label");
            costPrereqLabel.textContent = "Payment option prerequisites";
            const costPrereqHint = document.createElement("div");
            costPrereqHint.className = "field-help";
            costPrereqHint.textContent = "Optional. Gates only this payment choice, not the whole option. Works on any option or inherited subcategory payment option. Example: !originStoryYourTeamLoneWolf";
            const costPrereqInput = document.createElement("textarea");
            costPrereqInput.value = formatPrerequisiteValue(costOption.prerequisites);
            costPrereqInput.placeholder = "e.g. !originStoryYourTeamLoneWolf";
            const syncCostPrereq = () => {
                const parsed = parsePrerequisiteValue(costPrereqInput.value);
                if (parsed.error) {
                    costPrereqInput.classList.add("field-error");
                } else {
                    costPrereqInput.classList.remove("field-error");
                    if (parsed.value == null) {
                        delete costOption.prerequisites;
                    } else {
                        costOption.prerequisites = parsed.value;
                    }
                }
                schedulePreviewUpdate();
            };
            costPrereqInput.addEventListener("input", syncCostPrereq);
            costPrereqInput.addEventListener("blur", syncCostPrereq);
            costPrereqField.append(costPrereqLabel, costPrereqHint, costPrereqInput);

            const tierFields = [];
            const maxSelections = Math.max(1, Math.floor(Number(option.maxSelections) || 1));
            const hasSelectionCosts = Array.isArray(costOption.costBySelection) && costOption.costBySelection.length > 0;
            if (includeSelectionCosts || maxSelections > 1 || hasSelectionCosts) {
                const selectionCosts = Array.isArray(costOption.costBySelection) ? costOption.costBySelection : [];
                const tierSection = document.createElement("div");
                tierSection.className = "field";
                const tierLabel = document.createElement("label");
                tierLabel.textContent = "Selection-specific costs";
                const tierHint = document.createElement("div");
                tierHint.className = "field-help";
                tierHint.textContent = "Optional. Selection 1, selection 2, etc. override the base cost for repeatable options.";
                const tierList = document.createElement("div");
                tierList.className = "list-stack";
                selectionCosts.forEach((tierCost, tierIndex) => {
                    if (!Array.isArray(costOption.costBySelection)) costOption.costBySelection = selectionCosts;
                    if (!tierCost || typeof tierCost !== "object" || Array.isArray(tierCost)) {
                        costOption.costBySelection[tierIndex] = {};
                        tierCost = costOption.costBySelection[tierIndex];
                    }
                    const tierCard = document.createElement("div");
                    tierCard.className = "cost-option-card";
                    const tierHeader = document.createElement("div");
                    tierHeader.className = "cost-option-card-header";
                    const tierTitle = document.createElement("strong");
                    tierTitle.textContent = `Selection ${tierIndex + 1}`;
                    const removeTierBtn = document.createElement("button");
                    removeTierBtn.type = "button";
                    removeTierBtn.className = "button-icon danger";
                    removeTierBtn.textContent = "✕";
                    removeTierBtn.title = "Remove selection-specific cost";
                    removeTierBtn.addEventListener("click", () => {
                        costOption.costBySelection.splice(tierIndex, 1);
                        if (costOption.costBySelection.length === 0) delete costOption.costBySelection;
                        renderCostOptionsEditor(container, option, { allowEmpty, emptyText, includeSelectionCosts });
                        schedulePreviewUpdate();
                    });
                    tierHeader.append(tierTitle, removeTierBtn);
                    const tierCostContainer = document.createElement("div");
                    tierCostContainer.className = "cost-list";
                    renderPointMapEditor(tierCostContainer, tierCost, (nextCost) => {
                        costOption.costBySelection[tierIndex] = nextCost || {};
                        schedulePreviewUpdate();
                    });
                    tierCard.append(tierHeader, tierCostContainer);
                    tierList.appendChild(tierCard);
                });
                const addTierBtn = document.createElement("button");
                addTierBtn.type = "button";
                addTierBtn.className = "button-subtle";
                addTierBtn.textContent = "Add selection-specific cost";
                addTierBtn.addEventListener("click", () => {
                    if (!Array.isArray(costOption.costBySelection)) costOption.costBySelection = [];
                    costOption.costBySelection.push({ ...costOption.cost });
                    renderCostOptionsEditor(container, option, { allowEmpty, emptyText, includeSelectionCosts });
                    schedulePreviewUpdate();
                });
                tierSection.append(tierLabel, tierHint, tierList, addTierBtn);
                tierFields.push(tierSection);
            }

            card.append(header, costField, availabilityField, costPrereqField, ...tierFields);
            container.appendChild(card);
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "button-subtle";
        addBtn.textContent = "Add payment option";
        addBtn.addEventListener("click", () => {
            if (!Array.isArray(option.costOptions)) option.costOptions = [];
            const candidateType = getPointTypeNames()[0] || "Points";
            option.costOptions.push({
                cost: { [candidateType]: 0 }
            });
            renderCostOptionsEditor(container, option, { allowEmpty, emptyText, includeSelectionCosts });
            schedulePreviewUpdate();
        });
        container.appendChild(addBtn);
    }

    function normalizePointAllocationForEditor(option) {
        const allocation = option.pointAllocation && typeof option.pointAllocation === "object" && !Array.isArray(option.pointAllocation)
            ? option.pointAllocation
            : null;
        if (!allocation) return null;

        allocation.total = Math.max(1, Math.floor(Number(allocation.total) || 1));
        const types = Array.isArray(allocation.types)
            ? allocation.types.map(type => String(type || "").trim()).filter(Boolean)
            : [];
        allocation.types = [...new Set(types)];
        return allocation;
    }

    function renderPointAllocationEditor(container, option) {
        container.innerHTML = "";
        const pointTypes = getPointTypeNames();
        const allocation = normalizePointAllocationForEditor(option);

        if (!allocation) {
            const empty = document.createElement("div");
            empty.className = "field-note";
            empty.textContent = "No point allocation configured for this option.";

            const addBtn = document.createElement("button");
            addBtn.type = "button";
            addBtn.className = "button-subtle";
            addBtn.textContent = "Add point allocation";
            addBtn.disabled = pointTypes.length < 2;
            addBtn.title = pointTypes.length < 2
                ? "Add at least two point types before configuring point allocation."
                : "Add point allocation";
            addBtn.addEventListener("click", () => {
                if (pointTypes.length < 2) {
                    showEditorMessage("Point allocation requires at least two point types.", "warning", 4000);
                    return;
                }
                option.pointAllocation = {
                    total: 1,
                    types: pointTypes.slice(0, 2)
                };
                renderPointAllocationEditor(container, option);
                schedulePreviewUpdate();
            });

            container.append(empty, addBtn);
            return;
        }

        const totalField = document.createElement("div");
        totalField.className = "field";
        const totalLabel = document.createElement("label");
        totalLabel.textContent = "Total picks to allocate";
        const totalInput = document.createElement("input");
        totalInput.type = "number";
        totalInput.min = "1";
        totalInput.step = "1";
        totalInput.value = String(allocation.total);
        totalInput.addEventListener("input", () => {
            allocation.total = Math.max(1, Math.floor(Number(totalInput.value) || 1));
            totalInput.value = String(allocation.total);
            schedulePreviewUpdate();
        });
        totalField.append(totalLabel, totalInput);
        container.appendChild(totalField);

        const typeList = document.createElement("div");
        typeList.className = "list-stack";
        allocation.types.forEach((currentType, index) => {
            const row = document.createElement("div");
            row.className = "cost-row";

            const select = document.createElement("select");
            const availablePointTypes = pointTypes.includes(currentType)
                ? pointTypes
                : [currentType, ...pointTypes];
            availablePointTypes.forEach(pointType => {
                const opt = document.createElement("option");
                opt.value = pointType;
                opt.textContent = getPointTypeDisplayName(pointType);
                opt.disabled = pointType !== currentType && allocation.types.includes(pointType);
                select.appendChild(opt);
            });
            select.value = currentType;
            select.addEventListener("change", () => {
                const nextType = select.value;
                if (!nextType || allocation.types.includes(nextType)) {
                    select.value = currentType;
                    return;
                }
                allocation.types[index] = nextType;
                renderPointAllocationEditor(container, option);
                schedulePreviewUpdate();
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.textContent = "✕";
            removeBtn.title = "Remove allocation point type";
            removeBtn.disabled = allocation.types.length <= 2;
            removeBtn.addEventListener("click", () => {
                if (allocation.types.length <= 2) {
                    showEditorMessage("Point allocation requires at least two point types.", "warning", 4000);
                    return;
                }
                allocation.types.splice(index, 1);
                renderPointAllocationEditor(container, option);
                schedulePreviewUpdate();
            });

            row.append(select, removeBtn);
            typeList.appendChild(row);
        });
        container.appendChild(typeList);

        const actions = document.createElement("div");
        actions.className = "inline-actions";

        const addTypeBtn = document.createElement("button");
        addTypeBtn.type = "button";
        addTypeBtn.className = "button-subtle";
        addTypeBtn.textContent = "Add allocation point type";
        addTypeBtn.disabled = !pointTypes.some(pointType => !allocation.types.includes(pointType));
        addTypeBtn.addEventListener("click", () => {
            const nextType = pointTypes.find(pointType => !allocation.types.includes(pointType));
            if (!nextType) {
                showEditorMessage("All configured point types are already included.", "warning", 4000);
                return;
            }
            allocation.types.push(nextType);
            renderPointAllocationEditor(container, option);
            schedulePreviewUpdate();
        });

        const removeAllocationBtn = document.createElement("button");
        removeAllocationBtn.type = "button";
        removeAllocationBtn.className = "button-subtle danger";
        removeAllocationBtn.textContent = "Remove point allocation";
        removeAllocationBtn.addEventListener("click", () => {
            delete option.pointAllocation;
            renderPointAllocationEditor(container, option);
            schedulePreviewUpdate();
        });

        actions.append(addTypeBtn, removeAllocationBtn);
        container.appendChild(actions);
    }

    function getSliderModifierTargetNames() {
        return getPointTypeNames();
    }

    function normalizeSliderModifiersForEditor(option) {
        const targets = getSliderModifierTargetNames();
        const targetSet = new Set(targets);
        const raw = Array.isArray(option.sliderModifiers)
            ? option.sliderModifiers
            : Array.isArray(option.attributeEffects)
                ? option.attributeEffects
                : [];
        const normalized = raw
            .map(effect => {
                const type = ["multiply", "cap", "add", "subtract"].includes(effect?.type) ? effect.type : "multiply";
                const value = type === "multiply" ? Number(effect?.multiplier ?? effect?.value) : Number(effect?.value ?? effect?.multiplier);
                const choices = Array.isArray(effect?.choices)
                    ? [...new Set(effect.choices.map(choice => String(choice || "").trim()).filter(choice => targetSet.has(choice)))]
                    : [];
                return {
                    type,
                    attribute: String(effect?.attribute || "").trim(),
                    selectable: effect?.selectable === true || !String(effect?.attribute || "").trim(),
                    choices,
                    value: Number.isFinite(value) ? value : (type === "multiply" ? 2 : 8)
                };
            })
            .filter(effect => effect.selectable || targetSet.has(effect.attribute));
        if (normalized.length) {
            option.sliderModifiers = normalized.map(effect => {
                const saved = {
                    type: effect.type,
                    selectable: effect.selectable === true
                };
                if (!effect.selectable) saved.attribute = effect.attribute;
                if (effect.selectable && Array.isArray(effect.choices) && effect.choices.length) saved.choices = effect.choices;
                if (effect.type === "multiply") saved.multiplier = effect.value;
                else saved.value = effect.value;
                return saved;
            });
            delete option.attributeEffects;
        } else {
            delete option.sliderModifiers;
            delete option.attributeEffects;
        }
        return option.sliderModifiers || [];
    }

    function renderSliderModifiersEditor(container, option) {
        container.innerHTML = "";
        const targets = getSliderModifierTargetNames();
        const effects = normalizeSliderModifiersForEditor(option);

        if (!effects.length) {
            const empty = document.createElement("div");
            empty.className = "field-note";
            empty.textContent = "No slider modifiers configured.";
            container.appendChild(empty);
        }

        effects.forEach((effect, index) => {
            const row = document.createElement("div");
            row.className = "cost-row";

            const typeSelect = document.createElement("select");
            [
                ["multiply", "Multiply"],
                ["cap", "Set max"],
                ["add", "Add"],
                ["subtract", "Subtract"]
            ].forEach(([value, label]) => {
                const opt = document.createElement("option");
                opt.value = value;
                opt.textContent = label;
                typeSelect.appendChild(opt);
            });
            typeSelect.value = effect.type;
            typeSelect.addEventListener("change", () => {
                effect.type = typeSelect.value;
                if (effect.type === "multiply") effect.multiplier = Number(effect.value ?? effect.multiplier) || 2;
                else effect.value = Number(effect.value ?? effect.multiplier) || 8;
                option.sliderModifiers[index] = effect;
                normalizeSliderModifiersForEditor(option);
                renderSliderModifiersEditor(container, option);
                schedulePreviewUpdate();
            });

            const attributeSelect = document.createElement("select");
            const availableTargets = targets.includes(effect.attribute)
                ? targets
                : [effect.attribute, ...targets].filter(Boolean);
            availableTargets.forEach(attribute => {
                const opt = document.createElement("option");
                opt.value = attribute;
                opt.textContent = getPointTypeDisplayName(attribute);
                attributeSelect.appendChild(opt);
            });
            attributeSelect.value = effect.attribute;
            attributeSelect.disabled = effect.selectable === true;
            attributeSelect.addEventListener("change", () => {
                effect.attribute = attributeSelect.value;
                option.sliderModifiers[index] = effect;
                normalizeSliderModifiersForEditor(option);
                schedulePreviewUpdate();
            });

            const selectableLabel = document.createElement("label");
            selectableLabel.className = "checkbox-option compact";
            const selectableInput = document.createElement("input");
            selectableInput.type = "checkbox";
            selectableInput.checked = effect.selectable === true;
            selectableInput.addEventListener("change", () => {
                effect.selectable = selectableInput.checked;
                if (!effect.selectable && !effect.attribute) effect.attribute = targets[0] || "";
                option.sliderModifiers[index] = effect;
                normalizeSliderModifiersForEditor(option);
                renderSliderModifiersEditor(container, option);
                schedulePreviewUpdate();
            });
            const selectableText = document.createElement("span");
            selectableText.textContent = "Player chooses";
            selectableLabel.append(selectableInput, selectableText);

            const valueInput = document.createElement("input");
            valueInput.type = "number";
            valueInput.min = "0";
            valueInput.step = effect.type === "multiply" ? "0.1" : "1";
            valueInput.value = String(effect.multiplier ?? effect.value ?? (effect.type === "multiply" ? 2 : 8));
            valueInput.addEventListener("input", () => {
                if (effect.type === "multiply") effect.multiplier = Number(valueInput.value) || 1;
                else effect.value = Number(valueInput.value) || 0;
                option.sliderModifiers[index] = effect;
                normalizeSliderModifiersForEditor(option);
                schedulePreviewUpdate();
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Remove slider modifier";
            removeBtn.textContent = "✕";
            removeBtn.addEventListener("click", () => {
                option.sliderModifiers.splice(index, 1);
                normalizeSliderModifiersForEditor(option);
                renderSliderModifiersEditor(container, option);
                schedulePreviewUpdate();
            });

            row.append(typeSelect, attributeSelect, selectableLabel, valueInput, removeBtn);
            container.appendChild(row);

            if (effect.selectable === true) {
                const choicesWrap = document.createElement("div");
                choicesWrap.className = "checkbox-grid";
                const choiceTargets = [...new Set([...(effect.choices || []), ...targets].filter(Boolean))];
                choiceTargets.forEach(attribute => {
                    const choiceLabel = document.createElement("label");
                    choiceLabel.className = "checkbox-option";
                    const choiceInput = document.createElement("input");
                    choiceInput.type = "checkbox";
                    const hasExplicitChoices = Array.isArray(effect.choices) && effect.choices.length > 0;
                    choiceInput.checked = !hasExplicitChoices || effect.choices.includes(attribute);
                    choiceInput.addEventListener("change", () => {
                        const currentChoices = new Set(Array.isArray(effect.choices) && effect.choices.length ? effect.choices : choiceTargets);
                        if (choiceInput.checked) currentChoices.add(attribute);
                        else currentChoices.delete(attribute);
                        effect.choices = Array.from(currentChoices);
                        option.sliderModifiers[index] = effect;
                        normalizeSliderModifiersForEditor(option);
                        schedulePreviewUpdate();
                    });
                    const choiceText = document.createElement("span");
                    choiceText.textContent = getPointTypeDisplayName(attribute);
                    choiceLabel.append(choiceInput, choiceText);
                    choicesWrap.appendChild(choiceLabel);
                });
                container.appendChild(choicesWrap);
            }
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "button-subtle";
        addBtn.textContent = "Add slider modifier";
        addBtn.disabled = targets.length === 0;
        addBtn.addEventListener("click", () => {
            if (!Array.isArray(option.sliderModifiers)) option.sliderModifiers = [];
            option.sliderModifiers.push({
                type: "multiply",
                attribute: targets[0] || "Strength",
                multiplier: 2
            });
            renderSliderModifiersEditor(container, option);
            schedulePreviewUpdate();
        });
        container.appendChild(addBtn);
    }

    function renameMapKeyPreservingOrder(map, oldKey, newKey) {
        const next = {};
        Object.entries(map || {}).forEach(([key, value]) => {
            next[key === oldKey ? newKey : key] = value;
        });
        return next;
    }

    function getPointMapEditorOrder(container, valueMap) {
        const keys = Object.keys(valueMap || {});
        const existingOrder = Array.isArray(container.__pointMapOrder) ? container.__pointMapOrder : [];
        const ordered = existingOrder.filter(key => Object.prototype.hasOwnProperty.call(valueMap, key));
        keys.forEach(key => {
            if (!ordered.includes(key)) ordered.push(key);
        });
        container.__pointMapOrder = ordered;
        return ordered;
    }

    function orderPointMapByEditorRows(container, valueMap) {
        const ordered = {};
        getPointMapEditorOrder(container, valueMap).forEach(key => {
            if (Object.prototype.hasOwnProperty.call(valueMap, key)) ordered[key] = valueMap[key];
        });
        return ordered;
    }

    function renderPointMapEditor(container, map, onChange) {
        container.innerHTML = "";
        const valueMap = map && typeof map === "object" ? { ...map } : {};
        const orderedPointTypes = getPointMapEditorOrder(container, valueMap);

        orderedPointTypes.forEach(pointType => {
            let currentPointType = pointType;
            const amount = valueMap[currentPointType];
            const row = document.createElement("div");
            row.className = "cost-row";

            const nameSelect = document.createElement("select");
            const configuredPointTypes = getPointTypeNames();
            const availablePointTypes = configuredPointTypes.includes(currentPointType)
                ? configuredPointTypes
                : [currentPointType, ...configuredPointTypes];
            availablePointTypes.forEach(type => {
                const option = document.createElement("option");
                option.value = type;
                option.textContent = getPointTypeDisplayName(type);
                nameSelect.appendChild(option);
            });
            nameSelect.value = currentPointType;

            const valueInput = document.createElement("input");
            valueInput.type = "number";
            valueInput.value = typeof amount === "number" ? amount : Number(amount) || 0;

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.textContent = "✕";
            removeBtn.title = "Remove entry";

            valueInput.addEventListener("input", () => {
                valueMap[currentPointType] = Number(valueInput.value) || 0;
                const orderedMap = orderPointMapByEditorRows(container, valueMap);
                onChange(Object.keys(orderedMap).length ? orderedMap : null);
            });

            nameSelect.addEventListener("change", () => {
                const newName = nameSelect.value;
                if (!newName || newName === currentPointType) {
                    nameSelect.value = currentPointType;
                    return;
                }
                if (Object.prototype.hasOwnProperty.call(valueMap, newName)) {
                    showEditorMessage(`Duplicate key "${newName}"`, "warning", 4000);
                    nameSelect.value = currentPointType;
                    return;
                }
                const oldName = currentPointType;
                const nextValueMap = renameMapKeyPreservingOrder(valueMap, oldName, newName);
                container.__pointMapOrder = getPointMapEditorOrder(container, valueMap)
                    .map(key => key === oldName ? newName : key);
                const orderedMap = orderPointMapByEditorRows(container, nextValueMap);
                onChange(Object.keys(orderedMap).length ? orderedMap : null);
                Object.keys(valueMap).forEach(key => delete valueMap[key]);
                Object.assign(valueMap, orderedMap);
                currentPointType = newName;
            });

            removeBtn.addEventListener("click", () => {
                delete valueMap[currentPointType];
                container.__pointMapOrder = getPointMapEditorOrder(container, valueMap)
                    .filter(key => key !== currentPointType);
                const orderedMap = orderPointMapByEditorRows(container, valueMap);
                onChange(Object.keys(orderedMap).length ? orderedMap : null);
                renderPointMapEditor(container, orderedMap, onChange);
            });

            row.appendChild(nameSelect);
            row.appendChild(valueInput);
            row.appendChild(removeBtn);
            container.appendChild(row);
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "button-subtle";
        addBtn.textContent = "Add point type";
        addBtn.addEventListener("click", () => {
            const configuredPointTypes = getPointTypeNames();
            const preferredPointType = configuredPointTypes.find(type => !Object.prototype.hasOwnProperty.call(valueMap, type));
            let candidate = preferredPointType || configuredPointTypes[0] || "Points";
            let suffix = 1;
            while (Object.prototype.hasOwnProperty.call(valueMap, candidate)) {
                suffix += 1;
                candidate = `${preferredPointType || configuredPointTypes[0] || "Points"} ${suffix}`;
            }
            valueMap[candidate] = 0;
            container.__pointMapOrder = [...getPointMapEditorOrder(container, valueMap).filter(key => key !== candidate), candidate];
            const orderedMap = orderPointMapByEditorRows(container, valueMap);
            onChange(orderedMap);
            renderPointMapEditor(container, orderedMap, onChange);
        });
        container.appendChild(addBtn);
    }


    function exportJson() {
        const blob = new Blob([JSON.stringify(state.data, null, 2)], {
            type: "application/json"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "input.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showEditorMessage("Exported current configuration.", "success");
    }

    function handleImport(text) {
        try {
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed)) throw new Error("Imported JSON must be an array.");
            state.data = parsed;
            regenerateAllOptionIds();
            renderGlobalSettings();
            renderCategories();
            schedulePreviewUpdate();
            showEditorMessage("Imported configuration.", "success");
        } catch (err) {
            showEditorMessage(`Import failed: ${err.message}`, "error", 6000);
        }
    }

    async function loadInitialData() {
        if (!state.selectedFile) {
            showSelectionModal();
            return;
        }

        // Update preview iframe to load the correct CYOA
        if (previewFrame) {
            previewFrame.src = getPreviewUrl();
        }

        const config = await loadSelectedConfig();
        if (config.ok) {
            state.data = config.data;
            regenerateAllOptionIds();
            renderGlobalSettings();
            renderCategories();
            schedulePreviewUpdate();
            showEditorMessage(`Loaded ${state.selectedFile}`, "success");
            return;
        }

        showEditorMessage(`Failed to load ${state.selectedFile}: ${config.error}`, "error", 10000);
        // If it fails, maybe show the selection modal again after a delay
        setTimeout(() => showSelectionModal(), 3000);
    }

    async function fetchCyoaList() {
        try {
            const res = await fetch("/api/cyoas");
            if (res.ok) return await res.json();
        } catch (e) { }
        return [];
    }

    async function showSelectionModal() {
        const modal = document.getElementById("cyoaSelectionModal");
        const listContainer = document.getElementById("cyoaList");
        if (!modal || !listContainer) return;

        modal.style.display = "block";
        const cyoas = await fetchCyoaList();
        listContainer.innerHTML = "";

        if (cyoas.length === 0) {
            listContainer.innerHTML = "<p>No CYOAs found in CYOAs/ directory.</p>";
            return;
        }

        cyoas.forEach(cyoa => {
            const container = document.createElement("div");
            container.className = "cyoa-item-container";

            const item = document.createElement("div");
            item.className = "cyoa-item";
            item.textContent = cyoa.title || cyoa.filename;
            item.onclick = () => {
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('cyoa', cyoa.filename);
                window.location.href = newUrl.toString();
            };

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "delete-cyoa-btn";
            deleteBtn.innerHTML = "🗑️";
            deleteBtn.title = "Move to trash";
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                if (!confirm(`Move "${cyoa.title || cyoa.filename}" to trash?`)) return;
                try {
                    const res = await fetch(`/api/cyoas?file=${encodeURIComponent(cyoa.filename)}`, {
                        method: "DELETE"
                    });
                    const text = await res.text();
                    let result;
                    try {
                        result = JSON.parse(text);
                    } catch (parseErr) {
                        if (res.status === 404) throw new Error("API endpoint not found. Please restart server.js to enable management features.");
                        throw new Error(text.slice(0, 50) || `Server error ${res.status}`);
                    }
                    if (result.ok) {
                        showEditorMessage(`Moved ${cyoa.filename} to trash.`, "success");
                        // If we deleted the file we are currently editing, redirect to default
                        if (state.selectedFile === cyoa.filename) {
                            window.location.href = window.location.pathname; // Reload without query params
                        } else {
                            showSelectionModal(); // Refresh list
                        }
                    } else {
                        throw new Error(result.error || "Failed to delete");
                    }
                } catch (err) {
                    showEditorMessage(`Delete failed: ${err.message}`, "error");
                }
            };

            container.appendChild(item);
            container.appendChild(deleteBtn);
            listContainer.appendChild(container);
        });
    }

    async function handleCreateCyoa() {
        const titleInput = document.getElementById("newCyoaTitle");
        const title = titleInput.value.trim();
        if (!title) {
            showEditorMessage("Please enter a title for the new CYOA.", "warning");
            return;
        }

        // Generate filename from title
        const filename = title.toLowerCase().replace(/[^a-z0-9]/g, "_") + ".json";

        try {
            const res = await fetch("/api/cyoas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename, title })
            });
            const text = await res.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch (parseErr) {
                if (res.status === 404) throw new Error("API endpoint not found. Please restart server.js to enable management features.");
                throw new Error(text.slice(0, 50) || `Server error ${res.status}`);
            }
            if (result.ok) {
                showEditorMessage(`Created ${filename}!`, "success");
                titleInput.value = "";
                showSelectionModal(); // Refresh list
            } else {
                throw new Error(result.error || "Failed to create");
            }
        } catch (err) {
            showEditorMessage(`Create failed: ${err.message}`, "error");
        }
    }

    function setupEventListeners() {
        editorSearchInput?.addEventListener("input", () => {
            state.filterQuery = normalizeFilterText(editorSearchInput.value);
            renderCategories();
        });

        editorNavigatorEl?.addEventListener("click", (event) => {
            const button = event.target.closest(".nav-item");
            if (!button) return;
            revealEditorNode(button.dataset.targetId);
        });

        expandAllBtn?.addEventListener("click", () => {
            setAllEditorDetailsOpen(true);
        });

        collapseAllBtn?.addEventListener("click", () => {
            setAllEditorDetailsOpen(false);
        });

        editorThemeToggleBtn?.addEventListener("click", () => {
            const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
            const next = current === "dark" ? "light" : "dark";
            localStorage.setItem(EDITOR_THEME_STORAGE_KEY, next);
            applyEditorTheme(next);
        });

        openPreviewTabBtn?.addEventListener("click", () => {
            const opened = window.open(getPreviewUrl(), "_blank");
            if (!opened) {
                showEditorMessage("Could not open preview tab. Please allow pop-ups for this site.", "warning", 5000);
                return;
            }
            detachedPreviewWindow = opened;
            // Push current state to the detached preview once it has had time to initialize.
            setTimeout(() => {
                if (!detachedPreviewWindow || detachedPreviewWindow.closed) return;
                postPreviewUpdate(detachedPreviewWindow, cloneData(state.data));
            }, 450);
        });

        reloadPreviewBtn?.addEventListener("click", () => {
            state.previewReady = false;
            pendingPreviewData = cloneData(state.data);
            if (previewStatusEl) {
                previewStatusEl.textContent = "Reloading preview…";
                previewStatusEl.dataset.state = "pending";
            }
            if (previewFrame) {
                previewFrame.src = getPreviewUrl();
            }
        });

        selectCyoaBtn?.addEventListener("click", () => {
            showSelectionModal();
        });

        document.getElementById("closeSelectionModal")?.addEventListener("click", () => {
            const modal = document.getElementById("cyoaSelectionModal");
            if (modal) modal.style.display = "none";
        });

        document.getElementById("confirmCreateCyoaBtn")?.addEventListener("click", () => {
            handleCreateCyoa();
        });

        document.getElementById("newCyoaTitle")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") handleCreateCyoa();
        });

        addCategoryBtn?.addEventListener("click", () => {
            state.data.push(createDefaultCategory());
            renderCategories();
            schedulePreviewUpdate();
        });

        importJsonBtn?.addEventListener("click", () => {
            importFileInput?.click();
        });

        exportJsonBtn?.addEventListener("click", () => {
            exportJson();
        });

        importFileInput?.addEventListener("change", async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                handleImport(text);
            } finally {
                importFileInput.value = "";
            }
        });

        previewFrame?.addEventListener("load", () => {
            state.previewReady = true;
            if (previewStatusEl) {
                previewStatusEl.textContent = "Preview ready";
                previewStatusEl.dataset.state = "ready";
            }
            // Ensure the iframe gets the latest in-memory editor state after a hard reload.
            postPreviewUpdate(previewFrame.contentWindow, cloneData(state.data));
            flushPreviewUpdate();
        });

        window.addEventListener("message", (event) => {
            if (!event.data) return;
            if (event.data.type === "cyoa-data-update-result") {
                if (detachedPreviewWindow && detachedPreviewWindow.closed) {
                    detachedPreviewWindow = null;
                }
                if (event.data.success) {
                    state.lastPreviewError = null;
                    if (previewStatusEl) {
                        previewStatusEl.textContent = "Preview up to date";
                        previewStatusEl.dataset.state = "success";
                    }
                } else {
                    state.lastPreviewError = event.data.error || "Unknown error";
                    if (previewStatusEl) {
                        previewStatusEl.textContent = `Preview error: ${state.lastPreviewError}`;
                        previewStatusEl.dataset.state = "error";
                    }
                }
            }
        });
    }

    initializeEditorTheme();
    setupEventListeners();
    loadInitialData();
})();
