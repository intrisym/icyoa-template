(function () {
    const CORE_TYPES_ORDER = ["title", "description", "headerImage", "points"];
    const BASE_OPTION_KEYS = new Set(["id", "label", "description", "image", "inputType", "inputLabel", "cost", "maxSelections", "countsAsOneSelection", "prerequisites", "requiresPoints", "conflictsWith", "discounts", "discountGrants", "dynamicCost", "attributeMultipliers", "sliderPointType", "sliderBaseFormula", "sliderSoftCapFormula", "sliderUnlockGroup", "slotUnlockPricing"]);

    const state = {
        data: [],
        previewReady: false,
        lastPreviewError: null,
        selectedFile: new URLSearchParams(window.location.search).get('cyoa') || null
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

    function parseChoiceCsv(raw = "") {
        const parsed = String(raw)
            .split(",")
            .map(part => part.trim())
            .filter(Boolean);
        return parsed;
    }

    function parseAmountCsv(raw = "") {
        const values = String(raw)
            .split(",")
            .map(part => Number(part.trim()))
            .filter(num => Number.isFinite(num));
        return values;
    }

    function isPointDropdownDynamicCost(config) {
        if (!config || typeof config !== "object") return false;
        if (config.target !== "points") return false;
        if (!Array.isArray(config.choices) || !config.choices.length) return false;
        const types = Array.isArray(config.types) ? config.types : [];
        const values = Array.isArray(config.values) ? config.values : [];
        return types.length > 0 &&
            values.length > 0 &&
            types.length === values.length &&
            values.every(val => Number.isFinite(Number(val)));
    }

    function getAttributeMultiplierChoices() {
        const pointsEntry = state.data.find(entry => entry?.type === "points");
        const values = pointsEntry?.values && typeof pointsEntry.values === "object"
            ? Object.keys(pointsEntry.values)
            : [];
        return values;
    }

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
    const EDITOR_THEME_STORAGE_KEY = "cyoa-editor-theme";

    let previewUpdateHandle = null;
    let pendingPreviewData = null;
    let pendingPreviewDirty = false;
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
            if (!entry.type) {
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

    function normalizeLegacyRequiresFields() {
        state.data.forEach((entry) => {
            if (entry.type) return;

            // Legacy category-level "requires" -> "requiresOption"
            if (Object.prototype.hasOwnProperty.call(entry, "requires")) {
                if (!Object.prototype.hasOwnProperty.call(entry, "requiresOption")) {
                    entry.requiresOption = entry.requires;
                }
                delete entry.requires;
            }

            walkEditorSubcategories(entry.subcategories || [], (subcat) => {
                // Legacy subcategory-level "requires" -> "requiresOption"
                if (Object.prototype.hasOwnProperty.call(subcat, "requires")) {
                    if (!Object.prototype.hasOwnProperty.call(subcat, "requiresOption")) {
                        subcat.requiresOption = subcat.requires;
                    }
                    delete subcat.requires;
                }
            });
        });
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

    function getDefinedPointTypes(sourceData = state.data) {
        const pointsEntry = Array.isArray(sourceData)
            ? sourceData.find(entry => entry?.type === "points")
            : null;
        const values = pointsEntry?.values;
        if (!values || typeof values !== "object" || Array.isArray(values)) return [];
        return Object.keys(values);
    }

    function getDefinedSliderUnlockGroups(sourceData = state.data) {
        const pointsEntry = Array.isArray(sourceData)
            ? sourceData.find(entry => entry?.type === "points")
            : null;
        const groups = Array.isArray(pointsEntry?.sliderUnlockGroups) ? pointsEntry.sliderUnlockGroups : [];
        return groups
            .map((group, idx) => {
                const fallbackId = `sliderUnlockGroup${idx + 1}`;
                const id = String(group?.id || fallbackId).trim() || fallbackId;
                const name = String(group?.name || id).trim() || id;
                return { id, name };
            })
            .filter(group => group.id);
    }

    function forEachEditorOption(callback) {
        if (typeof callback !== "function") return;
        state.data.forEach((entry) => {
            if (!entry || entry.type) return;
            (entry.options || []).forEach((option, optionIndex) => {
                callback(option, { category: entry, subcategory: null, optionIndex });
            });
            walkEditorSubcategories(entry.subcategories || [], (subcat) => {
                (subcat.options || []).forEach((option, optionIndex) => {
                    callback(option, { category: entry, subcategory: subcat, optionIndex });
                });
            });
        });
    }

    function replaceSliderUnlockGroupReference(oldId, newId) {
        const prev = String(oldId || "").trim();
        const next = String(newId || "").trim();
        if (!prev || !next || prev === next) return;
        forEachEditorOption((option) => {
            if (String(option?.sliderUnlockGroup || "").trim() === prev) {
                option.sliderUnlockGroup = next;
            }
        });
    }

    function validateCostPointTypesOrThrow(sourceData) {
        const pointTypes = getDefinedPointTypes(sourceData);
        if (!pointTypes.length) {
            throw new Error('Missing or empty "type: points" values. Define point types before editing costs.');
        }
        const allowed = new Set(pointTypes);
        const invalid = [];

        const checkCostMap = (costMap, pathLabel) => {
            if (!costMap || typeof costMap !== "object" || Array.isArray(costMap)) return;
            Object.keys(costMap).forEach((key) => {
                if (!allowed.has(key)) {
                    invalid.push(`${pathLabel}: "${key}"`);
                }
            });
        };
        const checkPointRequirementsMap = (requirementsMap, pathLabel) => {
            if (!requirementsMap || typeof requirementsMap !== "object" || Array.isArray(requirementsMap)) return;
            Object.entries(requirementsMap).forEach(([key, value]) => {
                if (!allowed.has(key)) {
                    invalid.push(`${pathLabel}: "${key}"`);
                }
                const threshold = Number(value);
                if (!Number.isFinite(threshold)) {
                    invalid.push(`${pathLabel}: "${key}" has non-numeric threshold`);
                }
            });
        };

        const walkSubcats = (subcategories, parentPath) => {
            if (!Array.isArray(subcategories)) return;
            subcategories.forEach((subcat, subIdx) => {
                const subPath = `${parentPath} > Subcategory "${subcat?.name || `#${subIdx + 1}`}"`;
                checkCostMap(subcat?.discountAmount, `${subPath}.discountAmount`);
                checkCostMap(subcat?.defaultCost, `${subPath}.defaultCost`);

                (subcat?.options || []).forEach((opt, optIdx) => {
                    const optLabel = opt?.id || opt?.label || `#${optIdx + 1}`;
                    checkCostMap(opt?.cost, `${subPath} > Option "${optLabel}".cost`);
                    checkPointRequirementsMap(opt?.requiresPoints, `${subPath} > Option "${optLabel}".requiresPoints`);
                    (opt?.discounts || []).forEach((rule, ruleIdx) => {
                        checkCostMap(rule?.cost, `${subPath} > Option "${optLabel}".discounts[${ruleIdx + 1}].cost`);
                    });
                });

                walkSubcats(subcat?.subcategories || [], subPath);
            });
        };

        (sourceData || []).forEach((entry, catIdx) => {
            if (entry?.type) return;
            const catPath = `Category "${entry?.name || `#${catIdx + 1}`}"`;
            checkCostMap(entry?.discountAmount, `${catPath}.discountAmount`);
            checkCostMap(entry?.defaultCost, `${catPath}.defaultCost`);

            (entry?.options || []).forEach((opt, optIdx) => {
                const optLabel = opt?.id || opt?.label || `#${optIdx + 1}`;
                checkCostMap(opt?.cost, `${catPath} > Option "${optLabel}".cost`);
                checkPointRequirementsMap(opt?.requiresPoints, `${catPath} > Option "${optLabel}".requiresPoints`);
                (opt?.discounts || []).forEach((rule, ruleIdx) => {
                    checkCostMap(rule?.cost, `${catPath} > Option "${optLabel}".discounts[${ruleIdx + 1}].cost`);
                });
            });

            walkSubcats(entry?.subcategories || [], catPath);
        });

        if (invalid.length) {
            throw new Error(
                `Invalid point map entries (cost/requiresPoints) not found in "type: points" values:\n- ${invalid.join("\n- ")}`
            );
        }
    }

    function collectOptionIdsFromData(sourceData) {
        const ids = new Set();
        const walkSubcats = (subcategories) => {
            if (!Array.isArray(subcategories)) return;
            subcategories.forEach((subcat) => {
                (subcat?.options || []).forEach((opt) => {
                    const id = String(opt?.id || "").trim();
                    if (id) ids.add(id);
                });
                walkSubcats(subcat?.subcategories || []);
            });
        };

        (sourceData || []).forEach((entry) => {
            if (!entry || entry.type) return;
            (entry.options || []).forEach((opt) => {
                const id = String(opt?.id || "").trim();
                if (id) ids.add(id);
            });
            walkSubcats(entry.subcategories || []);
        });
        return ids;
    }

    function validateOptionReferencesOrThrow(sourceData) {
        const knownIds = collectOptionIdsFromData(sourceData);
        const invalidRefs = [];

        const addMissingIds = (value, pathLabel) => {
            const ids = Array.from(extractReferencedIds(value));
            ids.forEach((id) => {
                if (!knownIds.has(id)) {
                    invalidRefs.push(`${pathLabel}: "${id}"`);
                }
            });
        };

        const walkSubcats = (subcategories, parentPath) => {
            if (!Array.isArray(subcategories)) return;
            subcategories.forEach((subcat, subIdx) => {
                const subPath = `${parentPath} > Subcategory "${subcat?.name || `#${subIdx + 1}`}"`;
                addMissingIds(subcat?.requiresOption, `${subPath}.requiresOption`);

                (subcat?.options || []).forEach((opt, optIdx) => {
                    const optLabel = opt?.id || opt?.label || `#${optIdx + 1}`;
                    const optPath = `${subPath} > Option "${optLabel}"`;
                    addMissingIds(opt?.prerequisites, `${optPath}.prerequisites`);
                    addMissingIds(opt?.conflictsWith, `${optPath}.conflictsWith`);

                    (opt?.discounts || []).forEach((rule, ruleIdx) => {
                        const triggerIds = rule?.idsAny || rule?.ids || (rule?.id ? [rule.id] : []);
                        addMissingIds(triggerIds, `${optPath}.discounts[${ruleIdx + 1}] triggers`);
                    });
                    (opt?.discountGrants || []).forEach((rule, ruleIdx) => {
                        const targets = rule?.targetIds || rule?.targets || (rule?.targetId ? [rule.targetId] : []);
                        addMissingIds(targets, `${optPath}.discountGrants[${ruleIdx + 1}] targets`);
                    });
                });

                walkSubcats(subcat?.subcategories || [], subPath);
            });
        };

        (sourceData || []).forEach((entry, catIdx) => {
            if (!entry || entry.type) return;
            const catPath = `Category "${entry?.name || `#${catIdx + 1}`}"`;
            addMissingIds(entry?.requiresOption, `${catPath}.requiresOption`);

            (entry?.options || []).forEach((opt, optIdx) => {
                const optLabel = opt?.id || opt?.label || `#${optIdx + 1}`;
                const optPath = `${catPath} > Option "${optLabel}"`;
                addMissingIds(opt?.prerequisites, `${optPath}.prerequisites`);
                addMissingIds(opt?.conflictsWith, `${optPath}.conflictsWith`);

                (opt?.discounts || []).forEach((rule, ruleIdx) => {
                    const triggerIds = rule?.idsAny || rule?.ids || (rule?.id ? [rule.id] : []);
                    addMissingIds(triggerIds, `${optPath}.discounts[${ruleIdx + 1}] triggers`);
                });
                (opt?.discountGrants || []).forEach((rule, ruleIdx) => {
                    const targets = rule?.targetIds || rule?.targets || (rule?.targetId ? [rule.targetId] : []);
                    addMissingIds(targets, `${optPath}.discountGrants[${ruleIdx + 1}] targets`);
                });
            });

            walkSubcats(entry?.subcategories || [], catPath);
        });

        if (invalidRefs.length) {
            throw new Error(
                `Unknown option ID reference(s) after ID normalization:\n- ${invalidRefs.join("\n- ")}`
            );
        }
    }

    function validateSliderUnlockGroupsOrThrow(sourceData) {
        const pointsEntry = Array.isArray(sourceData)
            ? sourceData.find(entry => entry?.type === "points")
            : null;
        const groups = Array.isArray(pointsEntry?.sliderUnlockGroups) ? pointsEntry.sliderUnlockGroups : [];
        const knownGroupIds = new Set(
            groups.map((group, idx) => String(group?.id || `sliderUnlockGroup${idx + 1}`).trim()).filter(Boolean)
        );

        const invalidRefs = [];
        const checkOption = (opt, pathLabel) => {
            const groupId = String(opt?.sliderUnlockGroup || "").trim();
            if (!groupId) return;
            if (!knownGroupIds.has(groupId)) {
                invalidRefs.push(`${pathLabel}: "${groupId}"`);
            }
        };

        const walkSubcats = (subcategories, parentPath) => {
            if (!Array.isArray(subcategories)) return;
            subcategories.forEach((subcat, subIdx) => {
                const subPath = `${parentPath} > Subcategory "${subcat?.name || `#${subIdx + 1}`}"`;
                (subcat?.options || []).forEach((opt, optIdx) => {
                    const optLabel = opt?.id || opt?.label || `#${optIdx + 1}`;
                    checkOption(opt, `${subPath} > Option "${optLabel}".sliderUnlockGroup`);
                });
                walkSubcats(subcat?.subcategories || [], subPath);
            });
        };

        (sourceData || []).forEach((entry, catIdx) => {
            if (!entry || entry.type) return;
            const catPath = `Category "${entry?.name || `#${catIdx + 1}`}"`;
            (entry?.options || []).forEach((opt, optIdx) => {
                const optLabel = opt?.id || opt?.label || `#${optIdx + 1}`;
                checkOption(opt, `${catPath} > Option "${optLabel}".sliderUnlockGroup`);
            });
            walkSubcats(entry?.subcategories || [], catPath);
        });

        if (invalidRefs.length) {
            throw new Error(
                `Unknown slider unlock group reference(s):\n- ${invalidRefs.join("\n- ")}`
            );
        }
    }

    function normalizeIdList(value) {
        if (!value) return [];
        const raw = Array.isArray(value) ? value : String(value).split(/[,\n]/g);
        return Array.from(new Set(raw.map(id => String(id || "").trim()).filter(Boolean)));
    }

    const RESERVED_EXPR_IDENTIFIERS = new Set([
        "true", "false", "null", "undefined", "if", "else", "return", "let", "var", "const",
        "function", "while", "for", "do", "switch", "case", "break", "continue", "default",
        "new", "this", "typeof", "instanceof", "void", "delete", "in", "of", "with", "try",
        "catch", "finally", "throw", "class", "extends", "super", "import", "export", "from",
        "as", "await", "async", "yield"
    ]);

    function prerequisiteValueToExpression(value) {
        if (value == null || value === "") return "";
        if (typeof value === "string") return value.trim();
        if (Array.isArray(value)) {
            const list = normalizeIdList(value);
            if (!list.length) return "";
            if (list.length === 1) return list[0];
            return `(${list.join(" && ")})`;
        }
        if (typeof value === "object") {
            const andList = normalizeIdList(value.and || []);
            const orList = normalizeIdList(value.or || []);
            const parts = [];
            if (andList.length) {
                parts.push(andList.length === 1 ? andList[0] : `(${andList.join(" && ")})`);
            }
            if (orList.length) {
                parts.push(orList.length === 1 ? orList[0] : `(${orList.join(" || ")})`);
            }
            return parts.join(" && ");
        }
        return String(value).trim();
    }

    function formatPrerequisiteValue(value) {
        return prerequisiteValueToExpression(value);
    }

    function validatePrerequisiteExpression(expr) {
        if (!expr) return { error: null };
        const replaced = expr.replace(/!?[A-Za-z_][A-Za-z0-9_]*(?:__\d+)?/g, "true");
        const scrubbed = replaced.replace(/true|false/g, "");
        if (/[^()&|! \t\r\n]/.test(scrubbed)) {
            return { error: "Prerequisite expression contains invalid characters." };
        }
        try {
            // eslint-disable-next-line no-new-func
            Function(`return (${replaced});`)();
        } catch (err) {
            return { error: `Prerequisite expression is invalid: ${err.message}` };
        }
        return { error: null };
    }

    function parsePrerequisiteValue(raw) {
        const text = String(raw || "").trim();
        if (!text) return { value: null, error: null };

        if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
            return { value: null, error: "Use expression syntax only (&&, ||, !). JSON is not supported in this field." };
        }
        if (text.includes(",")) {
            return { value: null, error: "Use expression syntax only (e.g. idA && idB). Comma-separated IDs are not supported." };
        }
        const tokenMatches = text.match(/[A-Za-z_][A-Za-z0-9_]*(?:__\d+)?/g) || [];
        if (!tokenMatches.length) {
            return { value: null, error: "Prerequisite expression must include at least one option ID." };
        }
        const validation = validatePrerequisiteExpression(text);
        if (validation.error) {
            return { value: null, error: validation.error };
        }
        return { value: text, error: null };
    }

    function extractReferencedIds(value) {
        const ids = new Set();
        if (!value) return ids;

        if (typeof value === "string") {
            const tokens = value.match(/!?[A-Za-z_][A-Za-z0-9_]*(?:__\d+)?/g) || [];
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

    function getOptionValidationWarnings(option) {
        const warnings = [];
        const allIds = collectOptionIds();
        const selfId = String(option?.id || "").trim();

        const prereqIds = Array.from(extractReferencedIds(option?.prerequisites));
        prereqIds.forEach(id => {
            if (id === selfId && selfId) warnings.push("Prerequisite references this option itself.");
            if (!allIds.has(id)) warnings.push(`Prerequisite references unknown option ID "${id}".`);
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

        if (option?.requiresPoints && typeof option.requiresPoints === "object" && !Array.isArray(option.requiresPoints)) {
            const knownPointTypes = new Set(getDefinedPointTypes());
            Object.entries(option.requiresPoints).forEach(([pointType, thresholdRaw]) => {
                if (!knownPointTypes.has(pointType)) {
                    warnings.push(`Point requirement references unknown point type "${pointType}".`);
                }
                const threshold = Number(thresholdRaw);
                if (!Number.isFinite(threshold)) {
                    warnings.push(`Point requirement for "${pointType}" must be a number.`);
                }
            });
        }

        if (option?.slotUnlockPricing && typeof option.slotUnlockPricing === "object" && !Array.isArray(option.slotUnlockPricing)) {
            const knownPointTypes = new Set(getDefinedPointTypes());
            const picksPerSlot = Number(option.slotUnlockPricing.picksPerSlot);
            const freeSlots = Number(option.slotUnlockPricing.freeSlots);
            if (!Number.isFinite(picksPerSlot) || picksPerSlot < 1) {
                warnings.push("Slot unlock pricing: picks per slot must be >= 1.");
            }
            if (!Number.isFinite(freeSlots) || freeSlots < 0) {
                warnings.push("Slot unlock pricing: free slots must be >= 0.");
            }
            const unlockCost = option.slotUnlockPricing.unlockCost;
            if (unlockCost && typeof unlockCost === "object" && !Array.isArray(unlockCost)) {
                Object.entries(unlockCost).forEach(([pointType, amountRaw]) => {
                    if (!knownPointTypes.has(pointType)) {
                        warnings.push(`Slot unlock pricing uses unknown point type "${pointType}".`);
                    }
                    const amount = Number(amountRaw);
                    if (!Number.isFinite(amount)) {
                        warnings.push(`Slot unlock pricing amount for "${pointType}" must be numeric.`);
                    }
                });
            }
        }

        if (String(option?.inputType || "").trim().toLowerCase() === "slider") {
            const knownUnlockGroups = new Set(getDefinedSliderUnlockGroups().map(group => group.id));
            const unlockGroupId = String(option?.sliderUnlockGroup || "").trim();
            if (unlockGroupId && !knownUnlockGroups.has(unlockGroupId)) {
                warnings.push(`Slider unlock group "${unlockGroupId}" does not exist.`);
            }
        }

        const rules = Array.isArray(option?.discounts) ? option.discounts : [];
        rules.forEach((rule, index) => {
            const ruleNo = index + 1;
            const ids = normalizeIdList(rule?.idsAny || rule?.ids || (rule?.id ? [rule.id] : []));
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
            if (!rule?.cost || !Object.keys(rule.cost).length) {
                warnings.push(`Rule ${ruleNo}: discounted cost map is empty.`);
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

    function syncOptionIdsWithMap(path, options = [], idMap = new Map()) {
        if (!Array.isArray(options)) return idMap;
        options.forEach(opt => {
            const previousId = String(opt?.id || "").trim();
            optionIdAutoMap.set(opt, true);
            const nextId = generateOptionId(opt?.label, { path, skipOption: opt });
            opt.id = nextId;
            if (previousId && previousId !== nextId && !idMap.has(previousId)) {
                idMap.set(previousId, nextId);
            }
        });
        return idMap;
    }

    function syncSubcategoryTreeOptionIds(basePath, subcategories = []) {
        if (!Array.isArray(subcategories)) return;
        subcategories.forEach(subcat => {
            const nextPath = [...basePath, subcat?.name || ""].filter(Boolean);
            syncOptionIds(nextPath, subcat?.options || []);
            syncSubcategoryTreeOptionIds(nextPath, subcat?.subcategories || []);
        });
    }

    function syncSubcategoryTreeOptionIdsWithMap(basePath, subcategories = [], idMap = new Map()) {
        if (!Array.isArray(subcategories)) return idMap;
        subcategories.forEach(subcat => {
            const nextPath = [...basePath, subcat?.name || ""].filter(Boolean);
            syncOptionIdsWithMap(nextPath, subcat?.options || [], idMap);
            syncSubcategoryTreeOptionIdsWithMap(nextPath, subcat?.subcategories || [], idMap);
        });
        return idMap;
    }

    function remapIdToken(raw, idMap) {
        if (!raw || typeof raw !== "string" || !(idMap instanceof Map) || !idMap.size) return raw;
        const negated = raw.startsWith("!");
        const token = negated ? raw.slice(1) : raw;
        const suffixIndex = token.indexOf("__");
        const baseId = suffixIndex === -1 ? token : token.slice(0, suffixIndex);
        if (!baseId) return raw;
        const mappedBase = idMap.get(baseId);
        if (!mappedBase) return raw;
        const suffix = suffixIndex === -1 ? "" : token.slice(suffixIndex);
        return `${negated ? "!" : ""}${mappedBase}${suffix}`;
    }

    function remapLogicalReferenceValue(value, idMap) {
        if (!value || !(idMap instanceof Map) || !idMap.size) return value;

        if (typeof value === "string") {
            return value.replace(/!?[A-Za-z_][A-Za-z0-9_]*(?:__\d+)?/g, (token) => {
                const probe = token.startsWith("!") ? token.slice(1) : token;
                const [base] = probe.split("__");
                if (!base || RESERVED_EXPR_IDENTIFIERS.has(base)) return token;
                return remapIdToken(token, idMap);
            });
        }

        if (Array.isArray(value)) {
            return value.map((item) => {
                if (typeof item !== "string") return item;
                return remapIdToken(item, idMap);
            });
        }

        if (typeof value === "object") {
            const next = { ...value };
            if (Object.prototype.hasOwnProperty.call(next, "and")) {
                next.and = remapLogicalReferenceValue(next.and, idMap);
            }
            if (Object.prototype.hasOwnProperty.call(next, "or")) {
                next.or = remapLogicalReferenceValue(next.or, idMap);
            }
            return next;
        }

        return value;
    }

    function remapOptionIdReferences(idMap) {
        if (!(idMap instanceof Map) || !idMap.size) return;

        const remapDiscountRule = (rule) => {
            if (!rule || typeof rule !== "object") return;
            if (Array.isArray(rule.idsAny)) {
                rule.idsAny = remapLogicalReferenceValue(rule.idsAny, idMap);
            }
            if (Array.isArray(rule.ids)) {
                rule.ids = remapLogicalReferenceValue(rule.ids, idMap);
            }
            if (typeof rule.id === "string") {
                rule.id = remapIdToken(rule.id, idMap);
            }
        };

        const remapGrantRule = (rule) => {
            if (!rule || typeof rule !== "object") return;
            if (Array.isArray(rule.targetIds)) {
                rule.targetIds = remapLogicalReferenceValue(rule.targetIds, idMap);
            }
            if (Array.isArray(rule.targets)) {
                rule.targets = remapLogicalReferenceValue(rule.targets, idMap);
            }
            if (typeof rule.targetId === "string") {
                rule.targetId = remapIdToken(rule.targetId, idMap);
            }
        };

        const remapOption = (option) => {
            if (!option || typeof option !== "object") return;
            if (Object.prototype.hasOwnProperty.call(option, "prerequisites")) {
                option.prerequisites = remapLogicalReferenceValue(option.prerequisites, idMap);
            }
            if (Array.isArray(option.conflictsWith)) {
                option.conflictsWith = remapLogicalReferenceValue(option.conflictsWith, idMap);
            }
            if (Array.isArray(option.discounts)) {
                option.discounts.forEach(remapDiscountRule);
            }
            if (Array.isArray(option.discountGrants)) {
                option.discountGrants.forEach(remapGrantRule);
            }
        };

        state.data.forEach((entry) => {
            if (!entry || entry.type) return;
            if (Object.prototype.hasOwnProperty.call(entry, "requiresOption")) {
                entry.requiresOption = remapLogicalReferenceValue(entry.requiresOption, idMap);
            }
            (entry.options || []).forEach(remapOption);
            walkEditorSubcategories(entry.subcategories || [], (subcat) => {
                if (Object.prototype.hasOwnProperty.call(subcat, "requiresOption")) {
                    subcat.requiresOption = remapLogicalReferenceValue(subcat.requiresOption, idMap);
                }
                (subcat.options || []).forEach(remapOption);
            });
        });
    }

    function regenerateAllOptionIdsAndReferences() {
        const categories = getCategorySnapshots();
        const idMap = new Map();
        categories.forEach(({ entry: category }) => {
            const basePath = [category?.name || ""].filter(Boolean);
            syncOptionIdsWithMap(basePath, category?.options || [], idMap);
            syncSubcategoryTreeOptionIdsWithMap(basePath, category?.subcategories || [], idMap);
        });
        remapOptionIdReferences(idMap);
    }

    function regenerateAllOptionIds() {
        const categories = getCategorySnapshots();
        categories.forEach(({ entry: category }) => {
            const basePath = [category?.name || ""].filter(Boolean);
            syncOptionIds(basePath, category?.options || []);
            syncSubcategoryTreeOptionIds(basePath, category?.subcategories || []);
        });
    }

    function schedulePreviewUpdate() {
        pendingPreviewDirty = true;
        pendingPreviewData = null;
        if (previewUpdateHandle) return;
        previewUpdateHandle = setTimeout(() => {
            previewUpdateHandle = null;
            flushPreviewUpdate();
        }, 90);
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
        if (!pendingPreviewDirty && !pendingPreviewData) return;
        const hasDetachedPreview = !!(detachedPreviewWindow && !detachedPreviewWindow.closed);
        if (!state.previewReady && !hasDetachedPreview) return;
        const payload = pendingPreviewData || cloneData(state.data);
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
        pendingPreviewDirty = false;
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
        stateKey = title
    } = {}) {
        const details = document.createElement("details");
        details.className = "section-block";
        const key = stateKey || title;
        const stored = sectionOpenState.has(key) ? sectionOpenState.get(key) : defaultOpen;
        if (stored) {
            details.open = true;
        }
        const summary = document.createElement("summary");
        summary.textContent = title;
        const body = document.createElement("div");
        body.className = "section-body";
        details.append(summary, body);
        details.addEventListener("toggle", () => {
            sectionOpenState.set(key, details.open);
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
            cost: {}
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
        descriptionTextarea.placeholder = "World overview shown under the header.";
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
            attributeRanges: {},
            formulas: {},
            trackerGroups: [],
            sliderUnlockGroups: []
        })).entry;
        if (!pointsEntry.values) pointsEntry.values = {};
        if (!Array.isArray(pointsEntry.allowNegative)) pointsEntry.allowNegative = [];
        if (!pointsEntry.attributeRanges) pointsEntry.attributeRanges = {};
        if (!pointsEntry.formulas || typeof pointsEntry.formulas !== "object") pointsEntry.formulas = {};
        if (!Array.isArray(pointsEntry.trackerGroups)) pointsEntry.trackerGroups = [];
        if (!Array.isArray(pointsEntry.sliderUnlockGroups)) pointsEntry.sliderUnlockGroups = [];
        fragment.appendChild(renderPointsSection(pointsEntry));

        const backpackEntry = ensureEntry("backpack", () => ({
            type: "backpack",
            enabled: false
        })).entry;
        fragment.appendChild(renderBackpackSection(backpackEntry));

        const themeEntry = ensureEntry("theme", () => ({
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
        }), {
            mergeDefaults: true
        }).entry;
        fragment.appendChild(renderThemeSection(themeEntry));
        fragment.appendChild(renderTypographySection(themeEntry));

        globalSettingsEl.innerHTML = "";
        globalSettingsEl.appendChild(fragment);
    }

    function renderPointsSection(pointsEntry) {
        const {
            container,
            body
        } = createSectionContainer("Point Pools");

        const valuesContainer = document.createElement("div");
        valuesContainer.className = "list-stack";

        Object.entries(pointsEntry.values).forEach(([currency, amount]) => {
            const row = document.createElement("div");
            row.className = "list-row";

            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.value = currency;
            nameInput.placeholder = "Currency";

            const valueInput = document.createElement("input");
            valueInput.type = "number";
            valueInput.value = typeof amount === "number" ? amount : 0;

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Remove currency";
            removeBtn.textContent = "✕";

            valueInput.addEventListener("input", () => {
                pointsEntry.values[currency] = Number(valueInput.value) || 0;
                schedulePreviewUpdate();
            });

            nameInput.addEventListener("blur", () => {
                const newName = nameInput.value.trim();
                if (!newName || newName === currency) {
                    nameInput.value = currency;
                    return;
                }
                if (pointsEntry.values.hasOwnProperty(newName)) {
                    showEditorMessage(`Currency "${newName}" already exists.`, "warning");
                    nameInput.value = currency;
                    return;
                }
                const existingValue = pointsEntry.values[currency];
                delete pointsEntry.values[currency];
                pointsEntry.values[newName] = existingValue;
                if (Object.prototype.hasOwnProperty.call(pointsEntry.formulas, currency)) {
                    pointsEntry.formulas[newName] = pointsEntry.formulas[currency];
                    delete pointsEntry.formulas[currency];
                }
                (pointsEntry.trackerGroups || []).forEach((group) => {
                    if (!group || !Array.isArray(group.pointTypes)) return;
                    group.pointTypes = group.pointTypes.map((type) => type === currency ? newName : type);
                });

                const allowIdx = pointsEntry.allowNegative.indexOf(currency);
                if (allowIdx !== -1) {
                    pointsEntry.allowNegative[allowIdx] = newName;
                }
                renderGlobalSettings();
                schedulePreviewUpdate();
            });

            removeBtn.addEventListener("click", () => {
                delete pointsEntry.values[currency];
                pointsEntry.allowNegative = pointsEntry.allowNegative.filter(t => t !== currency);
                if (Object.prototype.hasOwnProperty.call(pointsEntry.formulas, currency)) {
                    delete pointsEntry.formulas[currency];
                }
                (pointsEntry.trackerGroups || []).forEach((group) => {
                    if (!group || !Array.isArray(group.pointTypes)) return;
                    group.pointTypes = group.pointTypes.filter((type) => type !== currency);
                });
                renderGlobalSettings();
                schedulePreviewUpdate();
            });

            row.appendChild(nameInput);
            row.appendChild(valueInput);
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
            schedulePreviewUpdate();
        });

        body.appendChild(valuesContainer);
        body.appendChild(addCurrencyBtn);

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

        const formulasHeading = document.createElement("div");
        formulasHeading.className = "subheading";
        formulasHeading.textContent = "Derived point formulas";
        body.appendChild(formulasHeading);

        const formulasHelp = document.createElement("div");
        formulasHelp.className = "field-help";
        formulasHelp.textContent = "Recalculates the point pool from the formula while preserving spent deltas. Example: ((STR+DEX+CON+INT+WIS+CHA)-60)*8";
        body.appendChild(formulasHelp);

        const formulasContainer = document.createElement("div");
        formulasContainer.className = "list-stack";
        Object.entries(pointsEntry.formulas || {}).forEach(([pointType, formula]) => {
            const row = document.createElement("div");
            row.className = "list-row";

            const typeSelect = document.createElement("select");
            const pointTypes = Object.keys(pointsEntry.values || {});
            pointTypes.forEach((name) => {
                const opt = document.createElement("option");
                opt.value = name;
                opt.textContent = name;
                typeSelect.appendChild(opt);
            });
            if (pointType && !pointTypes.includes(pointType)) {
                const invalidOpt = document.createElement("option");
                invalidOpt.value = pointType;
                invalidOpt.textContent = `${pointType} (invalid)`;
                typeSelect.appendChild(invalidOpt);
            }
            typeSelect.value = pointType;

            const formulaInput = document.createElement("input");
            formulaInput.type = "text";
            formulaInput.value = typeof formula === "string" ? formula : "";
            formulaInput.placeholder = "e.g. ((STR+DEX+CON)-30)*2";

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Remove formula";
            removeBtn.textContent = "✕";

            typeSelect.addEventListener("change", () => {
                const nextType = typeSelect.value.trim();
                if (!nextType || nextType === pointType) return;
                if (Object.prototype.hasOwnProperty.call(pointsEntry.formulas, nextType)) {
                    showEditorMessage(`Formula for "${nextType}" already exists.`, "warning");
                    typeSelect.value = pointType;
                    return;
                }
                const existingFormula = pointsEntry.formulas[pointType];
                delete pointsEntry.formulas[pointType];
                pointsEntry.formulas[nextType] = existingFormula;
                renderGlobalSettings();
                schedulePreviewUpdate();
            });

            formulaInput.addEventListener("input", () => {
                const nextFormula = formulaInput.value.trim();
                if (nextFormula) {
                    pointsEntry.formulas[pointType] = nextFormula;
                } else {
                    delete pointsEntry.formulas[pointType];
                }
                schedulePreviewUpdate();
            });

            removeBtn.addEventListener("click", () => {
                delete pointsEntry.formulas[pointType];
                renderGlobalSettings();
                schedulePreviewUpdate();
            });

            row.appendChild(typeSelect);
            row.appendChild(formulaInput);
            row.appendChild(removeBtn);
            formulasContainer.appendChild(row);
        });
        body.appendChild(formulasContainer);

        const addFormulaBtn = document.createElement("button");
        addFormulaBtn.type = "button";
        addFormulaBtn.className = "button-subtle";
        addFormulaBtn.textContent = "Add formula";
        addFormulaBtn.addEventListener("click", () => {
            const pointTypes = Object.keys(pointsEntry.values || {});
            const candidate = pointTypes.find(name => !Object.prototype.hasOwnProperty.call(pointsEntry.formulas, name));
            if (!candidate) {
                showEditorMessage("No point type available for a new formula.", "warning", 3500);
                return;
            }
            pointsEntry.formulas[candidate] = "";
            renderGlobalSettings();
            schedulePreviewUpdate();
        });
        body.appendChild(addFormulaBtn);

        const sliderUnlockGroupsHeading = document.createElement("div");
        sliderUnlockGroupsHeading.className = "subheading";
        sliderUnlockGroupsHeading.textContent = "Slider unlock groups";
        body.appendChild(sliderUnlockGroupsHeading);

        const sliderUnlockGroupsHelp = document.createElement("div");
        sliderUnlockGroupsHelp.className = "field-help";
        sliderUnlockGroupsHelp.textContent = "Use these groups to limit how many sliders can bypass a soft cap. Slot formulas can use point names (e.g. floor(CON/5)+1).";
        body.appendChild(sliderUnlockGroupsHelp);

        const sliderUnlockGroupsContainer = document.createElement("div");
        sliderUnlockGroupsContainer.className = "list-stack";
        const usedGroupIds = new Set();
        (pointsEntry.sliderUnlockGroups || []).forEach((group, groupIndex) => {
            if (!group || typeof group !== "object") {
                group = {};
                pointsEntry.sliderUnlockGroups[groupIndex] = group;
            }

            const defaultId = `sliderUnlockGroup${groupIndex + 1}`;
            let normalizedId = String(group.id || defaultId).trim() || defaultId;
            while (usedGroupIds.has(normalizedId)) {
                normalizedId = `${normalizedId}_copy`;
            }
            usedGroupIds.add(normalizedId);
            group.id = normalizedId;
            if (typeof group.name !== "string") group.name = "";
            if (typeof group.slotsFormula !== "string" || !group.slotsFormula.trim()) {
                group.slotsFormula = "0";
            }

            const card = document.createElement("div");
            card.className = "discount-rule-card";

            const header = document.createElement("div");
            header.className = "discount-rule-header";
            const title = document.createElement("strong");
            title.textContent = group.name?.trim() ? group.name.trim() : group.id;
            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.textContent = "✕";
            removeBtn.title = "Delete unlock group";
            removeBtn.addEventListener("click", () => {
                const removedId = group.id;
                pointsEntry.sliderUnlockGroups.splice(groupIndex, 1);
                forEachEditorOption((option) => {
                    if (String(option?.sliderUnlockGroup || "").trim() === removedId) {
                        delete option.sliderUnlockGroup;
                    }
                });
                renderGlobalSettings();
                renderCategories();
                schedulePreviewUpdate();
            });
            header.appendChild(title);
            header.appendChild(removeBtn);
            card.appendChild(header);

            const idRow = document.createElement("div");
            idRow.className = "field";
            const idLabel = document.createElement("label");
            idLabel.textContent = "Group ID";
            const idInput = document.createElement("input");
            idInput.type = "text";
            idInput.value = group.id;
            idInput.placeholder = "sliderUnlockGroup1";
            idInput.addEventListener("input", () => {
                const oldId = group.id;
                const nextId = idInput.value.trim();
                if (!nextId) return;
                const duplicate = (pointsEntry.sliderUnlockGroups || []).some((candidate, idx) =>
                    idx !== groupIndex && String(candidate?.id || "").trim() === nextId
                );
                if (duplicate) {
                    idInput.classList.add("field-error");
                    return;
                }
                idInput.classList.remove("field-error");
                group.id = nextId;
                title.textContent = group.name?.trim() ? group.name.trim() : group.id;
                replaceSliderUnlockGroupReference(oldId, nextId);
                renderCategories();
                schedulePreviewUpdate();
            });
            idRow.appendChild(idLabel);
            idRow.appendChild(idInput);
            card.appendChild(idRow);

            const nameRow = document.createElement("div");
            nameRow.className = "field";
            const nameLabel = document.createElement("label");
            nameLabel.textContent = "Group name";
            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.value = group.name || "";
            nameInput.placeholder = "e.g. Craft Skills";
            nameInput.addEventListener("input", () => {
                group.name = nameInput.value;
                title.textContent = group.name?.trim() ? group.name.trim() : group.id;
                schedulePreviewUpdate();
            });
            nameRow.appendChild(nameLabel);
            nameRow.appendChild(nameInput);
            card.appendChild(nameRow);

            const slotsRow = document.createElement("div");
            slotsRow.className = "field";
            const slotsLabel = document.createElement("label");
            slotsLabel.textContent = "Unlock slots formula";
            const slotsInput = document.createElement("input");
            slotsInput.type = "text";
            slotsInput.value = group.slotsFormula || "0";
            slotsInput.placeholder = "e.g. floor(CON/5)+1";
            slotsInput.addEventListener("input", () => {
                const nextFormula = slotsInput.value.trim();
                group.slotsFormula = nextFormula || "0";
                schedulePreviewUpdate();
            });
            const slotsHelp = document.createElement("div");
            slotsHelp.className = "field-help";
            slotsHelp.textContent = "Result is rounded down and clamped to 0.";
            slotsRow.appendChild(slotsLabel);
            slotsRow.appendChild(slotsInput);
            slotsRow.appendChild(slotsHelp);
            card.appendChild(slotsRow);

            sliderUnlockGroupsContainer.appendChild(card);
        });
        body.appendChild(sliderUnlockGroupsContainer);

        const addSliderUnlockGroupBtn = document.createElement("button");
        addSliderUnlockGroupBtn.type = "button";
        addSliderUnlockGroupBtn.className = "button-subtle";
        addSliderUnlockGroupBtn.textContent = "Add slider unlock group";
        addSliderUnlockGroupBtn.addEventListener("click", () => {
            if (!Array.isArray(pointsEntry.sliderUnlockGroups)) {
                pointsEntry.sliderUnlockGroups = [];
            }
            let suffix = pointsEntry.sliderUnlockGroups.length + 1;
            let candidate = `sliderUnlockGroup${suffix}`;
            const existingIds = new Set(pointsEntry.sliderUnlockGroups.map(group => String(group?.id || "").trim()).filter(Boolean));
            while (existingIds.has(candidate)) {
                suffix += 1;
                candidate = `sliderUnlockGroup${suffix}`;
            }
            pointsEntry.sliderUnlockGroups.push({
                id: candidate,
                name: "",
                slotsFormula: "0"
            });
            renderGlobalSettings();
            schedulePreviewUpdate();
        });
        body.appendChild(addSliderUnlockGroupBtn);

        const trackerGroupsHeading = document.createElement("div");
        trackerGroupsHeading.className = "subheading";
        trackerGroupsHeading.textContent = "Points tracker groups";
        body.appendChild(trackerGroupsHeading);

        const trackerGroupsHelp = document.createElement("div");
        trackerGroupsHelp.className = "field-help";
        trackerGroupsHelp.textContent = "Create groups that end users can show/hide in the points tracker.";
        body.appendChild(trackerGroupsHelp);

        const trackerGroupsContainer = document.createElement("div");
        trackerGroupsContainer.className = "list-stack";
        const pointTypes = Object.keys(pointsEntry.values || {});
        (pointsEntry.trackerGroups || []).forEach((group, groupIndex) => {
            if (!group || typeof group !== "object") {
                group = {};
                pointsEntry.trackerGroups[groupIndex] = group;
            }
            if (!Array.isArray(group.pointTypes)) {
                group.pointTypes = [];
            }
            const groupCard = document.createElement("div");
            groupCard.className = "discount-rule-card";

            const groupHeader = document.createElement("div");
            groupHeader.className = "discount-rule-header";
            const groupTitle = document.createElement("strong");
            groupTitle.textContent = group.name?.trim() ? group.name.trim() : `Group ${groupIndex + 1}`;
            const removeGroupBtn = document.createElement("button");
            removeGroupBtn.type = "button";
            removeGroupBtn.className = "button-icon danger";
            removeGroupBtn.textContent = "✕";
            removeGroupBtn.title = "Delete group";
            removeGroupBtn.addEventListener("click", () => {
                pointsEntry.trackerGroups.splice(groupIndex, 1);
                renderGlobalSettings();
                schedulePreviewUpdate();
            });
            groupHeader.appendChild(groupTitle);
            groupHeader.appendChild(removeGroupBtn);
            groupCard.appendChild(groupHeader);

            const groupNameRow = document.createElement("div");
            groupNameRow.className = "field";
            const groupNameLabel = document.createElement("label");
            groupNameLabel.textContent = "Group name";
            const groupNameInput = document.createElement("input");
            groupNameInput.type = "text";
            groupNameInput.value = group.name || "";
            groupNameInput.placeholder = "e.g. Attributes";
            groupNameInput.addEventListener("input", () => {
                group.name = groupNameInput.value;
                groupTitle.textContent = group.name?.trim() ? group.name.trim() : `Group ${groupIndex + 1}`;
                schedulePreviewUpdate();
            });
            groupNameRow.appendChild(groupNameLabel);
            groupNameRow.appendChild(groupNameInput);
            groupCard.appendChild(groupNameRow);

            const defaultVisibleRow = document.createElement("label");
            defaultVisibleRow.className = "checkbox-option";
            const defaultVisibleInput = document.createElement("input");
            defaultVisibleInput.type = "checkbox";
            defaultVisibleInput.checked = group.defaultVisible !== false;
            const defaultVisibleText = document.createElement("span");
            defaultVisibleText.textContent = "Visible by default";
            defaultVisibleInput.addEventListener("change", () => {
                group.defaultVisible = defaultVisibleInput.checked;
                schedulePreviewUpdate();
            });
            defaultVisibleRow.appendChild(defaultVisibleInput);
            defaultVisibleRow.appendChild(defaultVisibleText);
            groupCard.appendChild(defaultVisibleRow);

            const pointsLabel = document.createElement("label");
            pointsLabel.textContent = "Point types in this group";
            groupCard.appendChild(pointsLabel);

            const pointList = document.createElement("div");
            pointList.className = "point-type-checkbox-list";
            const availableTypes = Array.from(new Set([...pointTypes, ...(group.pointTypes || [])]));
            availableTypes.forEach((typeName) => {
                const optionRow = document.createElement("label");
                optionRow.className = "checkbox-option";
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.checked = group.pointTypes.includes(typeName);
                const text = document.createElement("span");
                text.textContent = pointTypes.includes(typeName) ? typeName : `${typeName} (invalid)`;
                checkbox.addEventListener("change", () => {
                    if (checkbox.checked) {
                        if (!group.pointTypes.includes(typeName)) {
                            group.pointTypes.push(typeName);
                        }
                    } else {
                        group.pointTypes = group.pointTypes.filter((type) => type !== typeName);
                    }
                    schedulePreviewUpdate();
                });
                optionRow.appendChild(checkbox);
                optionRow.appendChild(text);
                pointList.appendChild(optionRow);
            });
            groupCard.appendChild(pointList);

            trackerGroupsContainer.appendChild(groupCard);
        });
        body.appendChild(trackerGroupsContainer);

        const addTrackerGroupBtn = document.createElement("button");
        addTrackerGroupBtn.type = "button";
        addTrackerGroupBtn.className = "button-subtle";
        addTrackerGroupBtn.textContent = "Add tracker group";
        addTrackerGroupBtn.addEventListener("click", () => {
            if (!Array.isArray(pointsEntry.trackerGroups)) {
                pointsEntry.trackerGroups = [];
            }
            pointsEntry.trackerGroups.push({
                name: "",
                pointTypes: [],
                defaultVisible: true
            });
            renderGlobalSettings();
            schedulePreviewUpdate();
        });
        body.appendChild(addTrackerGroupBtn);

        return container;
    }

    function renderBackpackSection(backpackEntry) {
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
        checkbox.checked = backpackEntry.enabled || false;
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

    function renderThemeSection(themeEntry) {
        const {
            container,
            body
        } = createSectionContainer("Theme Settings", {
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
            "shadow-color": "Shadow Color"
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

    function renderTypographySection(themeEntry) {
        const {
            container,
            body
        } = createSectionContainer("Typography Settings", {
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
                label.textContent = `${labelPrefix} (${type})`;

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
                removeBtn.title = `Remove ${type}`;
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
                opt.textContent = type;
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


        if (!categories.length) {
            const emptyState = document.createElement("div");
            emptyState.className = "empty-state";
            emptyState.textContent = "No categories yet. Add one to start structuring your CYOA.";
            categoryListEl.appendChild(emptyState);
            return;
        }

        const categoryIndices = categories.map(cat => cat.index);

        categories.forEach(({ entry: category, index: dataIndex }, position) => {
            const details = document.createElement("details");
            details.className = "category-card";
            const storedOpen = categoryOpenState.has(category) ? categoryOpenState.get(category) : position === 0;
            if (storedOpen) {
                details.open = true;
            }
            details.addEventListener("toggle", () => {
                categoryOpenState.set(category, details.open);
            });

            const summary = document.createElement("summary");
            const summaryLabel = document.createElement("span");
            summaryLabel.className = "summary-label";
            summaryLabel.textContent = category.name?.trim() ? category.name : `Category ${position + 1}`;
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
                summaryLabel.textContent = nameInput.value.trim() ? nameInput.value : `Category ${position + 1}`;

                // Sync all options in this category
                syncSubcategoryTreeOptionIds([category.name], category.subcategories || []);

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
            descriptionInput.placeholder = "Shown below the category tab title.";
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
            body.appendChild(requiresField);

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
            body.appendChild(categoryMaxRow);

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
            body.appendChild(categorySubviewField);

            const renderSubcategoryEditor = (parentArray, subcat, subIndex, container, namePath = []) => {
                ensureSubcategoryDefaults(subcat);

                const subDetails = document.createElement("details");
                subDetails.className = "subcategory-item";
                const storedSubOpen = subcategoryOpenState.has(subcat) ? subcategoryOpenState.get(subcat) : false;
                if (storedSubOpen) subDetails.open = true;

                const subSummary = document.createElement("summary");
                const subSummaryLabel = document.createElement("span");
                subSummaryLabel.className = "summary-label";
                subSummaryLabel.textContent = subcat.name || `Subcategory ${subIndex + 1}`;
                subSummary.appendChild(subSummaryLabel);
                subDetails.appendChild(subSummary);
                subDetails.addEventListener("toggle", () => {
                    subcategoryOpenState.set(subcat, subDetails.open);
                });

                const subBody = document.createElement("div");
                subBody.className = "subcategory-body";
                const subPathParts = [category.name, ...namePath, subcat.name || `Subcategory${subIndex + 1}`].filter(Boolean);
                const subSectionKeyPrefix = `${subPathParts.join("/") || "subcategory"}:${subIndex}`;
                const subCommonSection = createSectionContainer("Common Fields", {
                    defaultOpen: true,
                    stateKey: `${subSectionKeyPrefix}:common`
                });
                const subAdvancedSection = createSectionContainer("Advanced Settings", {
                    defaultOpen: false,
                    stateKey: `${subSectionKeyPrefix}:advanced`
                });
                subBody.appendChild(subCommonSection.container);
                subBody.appendChild(subAdvancedSection.container);
                const subCommonBody = subCommonSection.body;
                const subAdvancedBody = subAdvancedSection.body;

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
                    subSummaryLabel.textContent = subcat.name || `Subcategory ${subIndex + 1}`;
                    syncSubcategoryTreeOptionIds([category.name], [subcat]);
                    schedulePreviewUpdate();
                });
                subNameField.appendChild(subNameLabel);
                subNameField.appendChild(subNameInput);
                subCommonBody.appendChild(subNameField);

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
                const defaultOptionMaxLabel = document.createElement("label");
                defaultOptionMaxLabel.textContent = "Default option max";
                const defaultOptionMaxInput = document.createElement("input");
                defaultOptionMaxInput.type = "number";
                defaultOptionMaxInput.min = "1";
                defaultOptionMaxInput.value = subcat.defaultOptionMaxSelections ?? "";
                defaultOptionMaxInput.placeholder = "Default: 1";
                defaultOptionMaxInput.title = "Applies to options under this subcategory unless an option defines its own max selections.";
                defaultOptionMaxInput.addEventListener("input", () => {
                    const value = defaultOptionMaxInput.value.trim();
                    if (value === "") {
                        delete subcat.defaultOptionMaxSelections;
                    } else {
                        const parsed = Math.max(1, Number(value) || 1);
                        subcat.defaultOptionMaxSelections = parsed;
                        defaultOptionMaxInput.value = String(parsed);
                    }
                    schedulePreviewUpdate();
                });
                maxRow.appendChild(maxLabel);
                maxRow.appendChild(maxInput);
                maxRow.appendChild(minLabel);
                maxRow.appendChild(minInput);
                maxRow.appendChild(defaultOptionMaxLabel);
                maxRow.appendChild(defaultOptionMaxInput);
                subAdvancedBody.appendChild(maxRow);

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

                renderPointTypeAmountControls(subAdvancedBody, {
                    labelPrefix: "Default cost",
                    getMap: () => subcat.defaultCost,
                    setMap: (next) => {
                        if (next) subcat.defaultCost = next;
                        else delete subcat.defaultCost;
                    }
                });

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
                subAdvancedBody.appendChild(columnsRow);

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
                subCommonBody.appendChild(textField);

                const subActions = document.createElement("div");
                subActions.className = "inline-actions";
                const subUpBtn = document.createElement("button");
                subUpBtn.type = "button";
                subUpBtn.className = "button-icon";
                subUpBtn.disabled = subIndex === 0;
                subUpBtn.title = "Move section up";
                subUpBtn.textContent = "↑";
                subUpBtn.addEventListener("click", () => {
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
                subDownBtn.addEventListener("click", () => {
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
                subRemoveBtn.addEventListener("click", () => {
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
                subCommonBody.appendChild(subActions);

                const optionsHeading = document.createElement("div");
                optionsHeading.className = "subheading";
                optionsHeading.textContent = "Options";
                subCommonBody.appendChild(optionsHeading);

                const optionsContainer = document.createElement("div");
                optionsContainer.className = "option-list";
                const optionPath = [category.name, ...namePath, subcat.name];
                renderOptionsList(
                    optionsContainer,
                    category,
                    subcat,
                    subIndex,
                    optionPath
                );
                subCommonBody.appendChild(optionsContainer);

                const addOptionBtn = document.createElement("button");
                addOptionBtn.type = "button";
                addOptionBtn.className = "button-subtle";
                addOptionBtn.textContent = "Add option";
                addOptionBtn.addEventListener("click", () => {
                    subcat.options = subcat.options || [];
                    const newOption = createDefaultOption(optionPath);
                    subcat.options.push(newOption);
                    optionOpenState.set(newOption, true);
                    keepPanelOpen(category, subcat);
                    renderOptionsList(optionsContainer, category, subcat, subIndex, optionPath);
                    schedulePreviewUpdate();
                });
                subCommonBody.appendChild(addOptionBtn);

                const nestedContainer = document.createElement("div");
                nestedContainer.className = "subcategory-list";
                (subcat.subcategories || []).forEach((childSubcat, childIdx) => {
                    renderSubcategoryEditor(subcat.subcategories, childSubcat, childIdx, nestedContainer, [...namePath, subcat.name || `Subcategory${subIndex + 1}`]);
                });
                subCommonBody.appendChild(nestedContainer);

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
                subCommonBody.appendChild(addNestedBtn);

                subDetails.appendChild(subBody);
                container.appendChild(subDetails);
            };

            const subcategoriesContainer = document.createElement("div");
            subcategoriesContainer.className = "subcategory-list";
            (category.subcategories || []).forEach((subcat, subIndex) => {
                renderSubcategoryEditor(category.subcategories, subcat, subIndex, subcategoriesContainer);
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

    function renderOptionsList(container, category, subcategory, subIndex, fullPathParts = []) {
        container.innerHTML = "";
        subcategory.options = subcategory.options || [];
        const normalizedPath = Array.isArray(fullPathParts) && fullPathParts.length
            ? fullPathParts.filter(Boolean)
            : [category.name, subcategory.name].filter(Boolean);
        subcategory.options.forEach((option, optionIndex) => {
            const details = document.createElement("details");
            details.className = "option-item";

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
            summaryLabel.textContent = formatOptionSummary(option);
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

            const optionSectionKeyPrefix = `${normalizedPath.join("/") || "option"}:${option.id || optionIndex}`;
            const commonSection = createSectionContainer("Common Fields", {
                defaultOpen: true,
                stateKey: `${optionSectionKeyPrefix}:common`
            });
            const advancedSettingsSection = createSectionContainer("Advanced Settings", {
                defaultOpen: false,
                stateKey: `${optionSectionKeyPrefix}:advanced`
            });
            body.appendChild(commonSection.container);
            body.appendChild(advancedSettingsSection.container);
            const commonBody = commonSection.body;
            const advancedBody = advancedSettingsSection.body;

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
            commonBody.appendChild(idField);

            const labelField = document.createElement("div");
            labelField.className = "field";
            const labelLabel = document.createElement("label");
            labelLabel.textContent = "Label";
            const labelInput = document.createElement("input");
            labelInput.type = "text";
            labelInput.value = option.label || "";
            labelInput.placeholder = "Displayed choice text";
            labelInput.addEventListener("input", () => {
                option.label = labelInput.value;
                const newId = generateOptionId(option.label, {
                    path: normalizedPath,
                    skipOption: option
                });
                option.id = newId;
                optionIdAutoMap.set(option, true);
                idInput.value = newId;
                summaryLabel.textContent = formatOptionSummary(option);
                refreshOptionWarnings();
                schedulePreviewUpdate();
            });
            labelField.appendChild(labelLabel);
            labelField.appendChild(labelInput);
            commonBody.appendChild(labelField);

            const descField = document.createElement("div");
            descField.className = "field";
            const descLabel = document.createElement("label");
            descLabel.textContent = "Description";
            const descTextarea = document.createElement("textarea");
            descTextarea.value = option.description || "";
            descTextarea.placeholder = "Explain what this choice does.";
            descTextarea.addEventListener("input", () => {
                option.description = descTextarea.value;
                schedulePreviewUpdate();
            });
            descField.appendChild(descLabel);
            descField.appendChild(descTextarea);
            commonBody.appendChild(descField);

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
            advancedBody.appendChild(imageField);

            const inputTypeField = document.createElement("div");
            inputTypeField.className = "field";
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
                if (typeof syncSliderFormulaInputEnabled === "function") {
                    syncSliderFormulaInputEnabled();
                }
                schedulePreviewUpdate();
            });
            inputTypeField.appendChild(inputTypeLabel);
            inputTypeField.appendChild(inputTypeInput);
            advancedBody.appendChild(inputTypeField);

            const inputLabelField = document.createElement("div");
            inputLabelField.className = "field";
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
            inputLabelField.appendChild(inputLabelLabel);
            inputLabelField.appendChild(inputLabelInput);
            advancedBody.appendChild(inputLabelField);

            const sliderPointTypeField = document.createElement("div");
            sliderPointTypeField.className = "field";
            const sliderPointTypeLabel = document.createElement("label");
            sliderPointTypeLabel.textContent = "Slider point type (optional)";
            const sliderPointTypeSelect = document.createElement("select");
            const sliderPointTypeAuto = document.createElement("option");
            sliderPointTypeAuto.value = "";
            sliderPointTypeAuto.textContent = "Auto (from costPerPoint)";
            sliderPointTypeSelect.appendChild(sliderPointTypeAuto);
            const sliderPointTypeChoices = getDefinedPointTypes();
            sliderPointTypeChoices.forEach((typeName) => {
                const optEl = document.createElement("option");
                optEl.value = typeName;
                optEl.textContent = typeName;
                sliderPointTypeSelect.appendChild(optEl);
            });
            if (option.sliderPointType && !sliderPointTypeChoices.includes(option.sliderPointType)) {
                const invalidOpt = document.createElement("option");
                invalidOpt.value = option.sliderPointType;
                invalidOpt.textContent = `${option.sliderPointType} (invalid)`;
                sliderPointTypeSelect.appendChild(invalidOpt);
            }
            sliderPointTypeSelect.value = option.sliderPointType || "";
            sliderPointTypeSelect.addEventListener("change", () => {
                const nextType = sliderPointTypeSelect.value.trim();
                if (nextType) {
                    option.sliderPointType = nextType;
                } else {
                    delete option.sliderPointType;
                }
                schedulePreviewUpdate();
            });
            sliderPointTypeField.appendChild(sliderPointTypeLabel);
            sliderPointTypeField.appendChild(sliderPointTypeSelect);
            advancedBody.appendChild(sliderPointTypeField);

            const sliderBaseFormulaField = document.createElement("div");
            sliderBaseFormulaField.className = "field";
            const sliderBaseFormulaLabel = document.createElement("label");
            sliderBaseFormulaLabel.textContent = "Slider base formula (optional)";
            const sliderBaseFormulaInput = document.createElement("input");
            sliderBaseFormulaInput.type = "text";
            sliderBaseFormulaInput.value = option.sliderBaseFormula || "";
            sliderBaseFormulaInput.placeholder = "e.g. STR + DEX + CON - 20";
            sliderBaseFormulaInput.addEventListener("input", () => {
                const nextFormula = sliderBaseFormulaInput.value.trim();
                if (nextFormula) {
                    option.sliderBaseFormula = nextFormula;
                } else {
                    delete option.sliderBaseFormula;
                }
                schedulePreviewUpdate();
            });
            const sliderBaseFormulaHelp = document.createElement("div");
            sliderBaseFormulaHelp.className = "field-help";
            sliderBaseFormulaHelp.textContent = "Formula evaluates against point values (e.g., STR, DEX). Slider stores purchased bonus above this base.";
            sliderBaseFormulaField.appendChild(sliderBaseFormulaLabel);
            sliderBaseFormulaField.appendChild(sliderBaseFormulaInput);
            sliderBaseFormulaField.appendChild(sliderBaseFormulaHelp);
            advancedBody.appendChild(sliderBaseFormulaField);

            const sliderSoftCapFormulaField = document.createElement("div");
            sliderSoftCapFormulaField.className = "field";
            const sliderSoftCapFormulaLabel = document.createElement("label");
            sliderSoftCapFormulaLabel.textContent = "Slider soft cap formula (optional)";
            const sliderSoftCapFormulaInput = document.createElement("input");
            sliderSoftCapFormulaInput.type = "text";
            sliderSoftCapFormulaInput.value = option.sliderSoftCapFormula || "";
            sliderSoftCapFormulaInput.placeholder = "e.g. 10 + CON";
            sliderSoftCapFormulaInput.addEventListener("input", () => {
                const nextFormula = sliderSoftCapFormulaInput.value.trim();
                if (nextFormula) {
                    option.sliderSoftCapFormula = nextFormula;
                } else {
                    delete option.sliderSoftCapFormula;
                }
                schedulePreviewUpdate();
            });
            const sliderSoftCapFormulaHelp = document.createElement("div");
            sliderSoftCapFormulaHelp.className = "field-help";
            sliderSoftCapFormulaHelp.textContent = "Sets a dynamic max value. If an unlock group is selected, this cap is ignored only when unlocked.";
            sliderSoftCapFormulaField.appendChild(sliderSoftCapFormulaLabel);
            sliderSoftCapFormulaField.appendChild(sliderSoftCapFormulaInput);
            sliderSoftCapFormulaField.appendChild(sliderSoftCapFormulaHelp);
            advancedBody.appendChild(sliderSoftCapFormulaField);

            const sliderUnlockGroupField = document.createElement("div");
            sliderUnlockGroupField.className = "field";
            const sliderUnlockGroupLabel = document.createElement("label");
            sliderUnlockGroupLabel.textContent = "Slider unlock group (optional)";
            const sliderUnlockGroupSelect = document.createElement("select");
            const sliderUnlockGroupNone = document.createElement("option");
            sliderUnlockGroupNone.value = "";
            sliderUnlockGroupNone.textContent = "None";
            sliderUnlockGroupSelect.appendChild(sliderUnlockGroupNone);
            const sliderUnlockGroups = getDefinedSliderUnlockGroups();
            sliderUnlockGroups.forEach((group) => {
                const optEl = document.createElement("option");
                optEl.value = group.id;
                optEl.textContent = `${group.name} (${group.id})`;
                sliderUnlockGroupSelect.appendChild(optEl);
            });
            if (option.sliderUnlockGroup && !sliderUnlockGroups.some(group => group.id === option.sliderUnlockGroup)) {
                const invalidOpt = document.createElement("option");
                invalidOpt.value = option.sliderUnlockGroup;
                invalidOpt.textContent = `${option.sliderUnlockGroup} (invalid)`;
                sliderUnlockGroupSelect.appendChild(invalidOpt);
            }
            sliderUnlockGroupSelect.value = option.sliderUnlockGroup || "";
            sliderUnlockGroupSelect.addEventListener("change", () => {
                const nextGroup = sliderUnlockGroupSelect.value.trim();
                if (nextGroup) {
                    option.sliderUnlockGroup = nextGroup;
                } else {
                    delete option.sliderUnlockGroup;
                }
                schedulePreviewUpdate();
            });
            const sliderUnlockGroupHelp = document.createElement("div");
            sliderUnlockGroupHelp.className = "field-help";
            sliderUnlockGroupHelp.textContent = "Choose a global unlock group to limit how many sliders can bypass their soft cap.";
            sliderUnlockGroupField.appendChild(sliderUnlockGroupLabel);
            sliderUnlockGroupField.appendChild(sliderUnlockGroupSelect);
            sliderUnlockGroupField.appendChild(sliderUnlockGroupHelp);
            advancedBody.appendChild(sliderUnlockGroupField);

            const syncSliderFormulaInputEnabled = () => {
                const isSlider = inputTypeInput.value.trim().toLowerCase() === "slider";
                sliderPointTypeSelect.disabled = !isSlider;
                sliderBaseFormulaInput.disabled = !isSlider;
                sliderSoftCapFormulaInput.disabled = !isSlider;
                sliderUnlockGroupSelect.disabled = !isSlider;
            };
            syncSliderFormulaInputEnabled();

            const pointDropdownField = document.createElement("div");
            pointDropdownField.className = "field";
            const pointDropdownToggle = document.createElement("label");
            pointDropdownToggle.className = "checkbox-option";
            const pointDropdownCheckbox = document.createElement("input");
            pointDropdownCheckbox.type = "checkbox";
            const pointDropdownLabel = document.createElement("span");
            pointDropdownLabel.textContent = "Point Dropdown (optional)";
            pointDropdownToggle.appendChild(pointDropdownCheckbox);
            pointDropdownToggle.appendChild(pointDropdownLabel);

            const pointChoicesLabel = document.createElement("label");
            pointChoicesLabel.textContent = "Selectable point types";
            const pointChoicesInput = document.createElement("div");
            pointChoicesInput.className = "point-type-checkbox-list";

            const pointAmountsLabel = document.createElement("label");
            pointAmountsLabel.textContent = "Adjustment amounts (comma-separated)";
            const pointAmountsInput = document.createElement("input");
            pointAmountsInput.type = "text";
            pointAmountsInput.placeholder = "e.g. 100, -100";

            const requireUniqueToggle = document.createElement("label");
            requireUniqueToggle.className = "checkbox-option";
            const requireUniqueInput = document.createElement("input");
            requireUniqueInput.type = "checkbox";
            const requireUniqueText = document.createElement("span");
            requireUniqueText.textContent = "Require unique dropdown selections";
            requireUniqueToggle.appendChild(requireUniqueInput);
            requireUniqueToggle.appendChild(requireUniqueText);

            const hasPointDropdownConfig = isPointDropdownDynamicCost(option.dynamicCost);
            const existingChoices = Array.isArray(option.dynamicCost?.choices) && option.dynamicCost.choices.length
                ? option.dynamicCost.choices
                : [];
            const availablePointTypes = getDefinedPointTypes();
            const selectableChoices = existingChoices.length
                ? [...new Set([...availablePointTypes, ...existingChoices])]
                : availablePointTypes;
            const pointChoiceCheckboxes = [];
            selectableChoices.forEach((choice) => {
                const row = document.createElement("label");
                row.className = "checkbox-option";
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.value = choice;
                checkbox.checked = existingChoices.includes(choice);
                const text = document.createElement("span");
                text.textContent = availablePointTypes.includes(choice) ? choice : `${choice} (invalid)`;
                row.appendChild(checkbox);
                row.appendChild(text);
                pointChoicesInput.appendChild(row);
                pointChoiceCheckboxes.push(checkbox);
            });
            const existingValues = hasPointDropdownConfig
                ? option.dynamicCost.values.map(val => Number(val))
                : [];
            const existingUnique = option.dynamicCost?.requireUnique !== false;
            pointDropdownCheckbox.checked = hasPointDropdownConfig;
            pointAmountsInput.value = existingValues.join(", ");
            requireUniqueInput.checked = existingUnique;

            const pointDropdownHelp = document.createElement("div");
            pointDropdownHelp.className = "field-help";
            pointDropdownHelp.textContent = "Adds one dropdown per amount. Positive amounts add points, negatives remove points.";

            const customDynamicCostHelp = document.createElement("div");
            customDynamicCostHelp.className = "field-help";
            if (option.dynamicCost && !hasPointDropdownConfig) {
                customDynamicCostHelp.textContent = "This option already has custom dynamic dropdown data. Enabling this setting will replace it.";
            }

            const syncPointDropdownInputsEnabled = () => {
                const enabled = pointDropdownCheckbox.checked;
                pointChoiceCheckboxes.forEach((checkbox) => {
                    checkbox.disabled = !enabled;
                });
                pointAmountsInput.disabled = !enabled;
                requireUniqueInput.disabled = !enabled;
            };

            const applyPointDropdownConfig = (normalizeInputs = false) => {
                if (!pointDropdownCheckbox.checked) {
                    if (isPointDropdownDynamicCost(option.dynamicCost)) {
                        delete option.dynamicCost;
                    }
                    syncPointDropdownInputsEnabled();
                    schedulePreviewUpdate();
                    return;
                }

                syncPointDropdownInputsEnabled();
                const choices = pointChoiceCheckboxes
                    .filter((checkbox) => checkbox.checked)
                    .map((checkbox) => checkbox.value.trim())
                    .filter(Boolean);
                const values = parseAmountCsv(pointAmountsInput.value);
                if (normalizeInputs) {
                    pointAmountsInput.value = values.join(", ");
                }
                if (!choices.length || !values.length) {
                    delete option.dynamicCost;
                } else {
                    option.dynamicCost = {
                        target: "points",
                        choices,
                        types: values.map((_, index) => `Adjustment ${index + 1}`),
                        values,
                        requireUnique: requireUniqueInput.checked
                    };
                }
                schedulePreviewUpdate();
            };

            pointDropdownCheckbox.addEventListener("change", applyPointDropdownConfig);
            pointChoiceCheckboxes.forEach((checkbox) => {
                checkbox.addEventListener("change", () => {
                    if (!pointDropdownCheckbox.checked) return;
                    applyPointDropdownConfig(false);
                });
            });
            pointAmountsInput.addEventListener("input", () => {
                if (!pointDropdownCheckbox.checked) return;
                applyPointDropdownConfig(false);
            });
            requireUniqueInput.addEventListener("change", () => {
                if (!pointDropdownCheckbox.checked) return;
                applyPointDropdownConfig(false);
            });
            pointChoicesInput.addEventListener("blur", () => {
                if (!pointDropdownCheckbox.checked) return;
                applyPointDropdownConfig(true);
            });
            pointAmountsInput.addEventListener("blur", () => {
                if (!pointDropdownCheckbox.checked) return;
                applyPointDropdownConfig(true);
            });

            pointDropdownField.appendChild(pointDropdownToggle);
            pointDropdownField.appendChild(pointChoicesLabel);
            pointDropdownField.appendChild(pointChoicesInput);
            pointDropdownField.appendChild(pointAmountsLabel);
            pointDropdownField.appendChild(pointAmountsInput);
            pointDropdownField.appendChild(requireUniqueToggle);
            pointDropdownField.appendChild(pointDropdownHelp);
            if (customDynamicCostHelp.textContent) {
                pointDropdownField.appendChild(customDynamicCostHelp);
            }
            advancedBody.appendChild(pointDropdownField);
            syncPointDropdownInputsEnabled();

            const attributeMultiplierField = document.createElement("div");
            attributeMultiplierField.className = "field";
            const attributeMultiplierToggle = document.createElement("label");
            attributeMultiplierToggle.className = "checkbox-option";
            const attributeMultiplierCheckbox = document.createElement("input");
            attributeMultiplierCheckbox.type = "checkbox";
            const attributeMultiplierText = document.createElement("span");
            attributeMultiplierText.textContent = "Attribute multipliers (optional)";
            attributeMultiplierToggle.appendChild(attributeMultiplierCheckbox);
            attributeMultiplierToggle.appendChild(attributeMultiplierText);

            const attributeMultiplierLabel = document.createElement("label");
            attributeMultiplierLabel.textContent = "Attribute and multiplier factor";
            const attributeMultiplierContainer = document.createElement("div");
            attributeMultiplierContainer.className = "cost-list";

            const hasAttributeMultipliers = option.attributeMultipliers &&
                typeof option.attributeMultipliers === "object" &&
                Object.keys(option.attributeMultipliers).length > 0;
            attributeMultiplierCheckbox.checked = hasAttributeMultipliers;

            const attributeMultiplierHelp = document.createElement("div");
            attributeMultiplierHelp.className = "field-help";
            attributeMultiplierHelp.textContent = "When selected, this option multiplies effective values. Attribute dropdown values come from type: points.";

            const syncAttributeMultiplierInputEnabled = () => {
                const enabled = attributeMultiplierCheckbox.checked;
                const controls = attributeMultiplierContainer.querySelectorAll("select, input, button");
                controls.forEach((el) => {
                    el.disabled = !enabled;
                });
            };

            const applyAttributeMultipliers = (nextMap) => {
                if (!attributeMultiplierCheckbox.checked) {
                    delete option.attributeMultipliers;
                    syncAttributeMultiplierInputEnabled();
                    schedulePreviewUpdate();
                    return;
                }
                const map = nextMap && typeof nextMap === "object" ? nextMap : {};
                if (Object.keys(map).length) {
                    option.attributeMultipliers = map;
                } else {
                    delete option.attributeMultipliers;
                }
                syncAttributeMultiplierInputEnabled();
                schedulePreviewUpdate();
            };

            const renderAttributeMultiplierEditor = () => {
                attributeMultiplierContainer.innerHTML = "";
                const currentMap = option.attributeMultipliers && typeof option.attributeMultipliers === "object"
                    ? { ...option.attributeMultipliers }
                    : {};
                const availableChoices = getAttributeMultiplierChoices();
                const baseChoices = availableChoices.length ? availableChoices : Object.keys(currentMap);

                Object.entries(currentMap).forEach(([attrName, factor]) => {
                    const row = document.createElement("div");
                    row.className = "cost-row";

                    const attrSelect = document.createElement("select");
                    const allChoices = [...new Set([...baseChoices, attrName])];
                    allChoices.forEach((name) => {
                        const optEl = document.createElement("option");
                        optEl.value = name;
                        optEl.textContent = name;
                        attrSelect.appendChild(optEl);
                    });
                    attrSelect.value = attrName;

                    const factorInput = document.createElement("input");
                    factorInput.type = "number";
                    factorInput.step = "0.1";
                    factorInput.min = "0.1";
                    factorInput.value = String(Number(factor) || 1);

                    const removeBtn = document.createElement("button");
                    removeBtn.type = "button";
                    removeBtn.className = "button-icon danger";
                    removeBtn.textContent = "✕";
                    removeBtn.title = "Remove multiplier";

                    attrSelect.addEventListener("change", () => {
                        const nextName = attrSelect.value;
                        if (!nextName || nextName === attrName) return;
                        if (Object.prototype.hasOwnProperty.call(currentMap, nextName)) {
                            showEditorMessage(`Duplicate attribute "${nextName}"`, "warning", 3500);
                            attrSelect.value = attrName;
                            return;
                        }
                        const currentFactor = Number(currentMap[attrName]) || 1;
                        delete currentMap[attrName];
                        currentMap[nextName] = currentFactor;
                        applyAttributeMultipliers(currentMap);
                        renderAttributeMultiplierEditor();
                    });

                    factorInput.addEventListener("input", () => {
                        const nextFactor = Number(factorInput.value);
                        currentMap[attrName] = Number.isFinite(nextFactor) && nextFactor > 0 ? nextFactor : 1;
                        applyAttributeMultipliers(currentMap);
                    });

                    removeBtn.addEventListener("click", () => {
                        delete currentMap[attrName];
                        applyAttributeMultipliers(currentMap);
                        renderAttributeMultiplierEditor();
                    });

                    row.appendChild(attrSelect);
                    row.appendChild(factorInput);
                    row.appendChild(removeBtn);
                    attributeMultiplierContainer.appendChild(row);
                });

                const addBtn = document.createElement("button");
                addBtn.type = "button";
                addBtn.className = "button-subtle";
                addBtn.textContent = "Add multiplier";
                addBtn.addEventListener("click", () => {
                    const current = option.attributeMultipliers && typeof option.attributeMultipliers === "object"
                        ? { ...option.attributeMultipliers }
                        : {};
                    const choices = getAttributeMultiplierChoices();
                    const nextName = choices.find(name => !Object.prototype.hasOwnProperty.call(current, name));
                    if (!nextName) {
                        showEditorMessage("No point types available from type: points (or all are already used).", "warning", 3500);
                        return;
                    }
                    current[nextName] = 1;
                    applyAttributeMultipliers(current);
                    renderAttributeMultiplierEditor();
                });
                attributeMultiplierContainer.appendChild(addBtn);
                syncAttributeMultiplierInputEnabled();
            };

            attributeMultiplierCheckbox.addEventListener("change", () => {
                if (!attributeMultiplierCheckbox.checked) {
                    applyAttributeMultipliers({});
                    renderAttributeMultiplierEditor();
                    return;
                }
                if (option.attributeMultipliers && Object.keys(option.attributeMultipliers).length) {
                    applyAttributeMultipliers(option.attributeMultipliers);
                } else {
                    applyAttributeMultipliers({});
                }
                renderAttributeMultiplierEditor();
            });
            renderAttributeMultiplierEditor();

            attributeMultiplierField.appendChild(attributeMultiplierToggle);
            attributeMultiplierField.appendChild(attributeMultiplierLabel);
            attributeMultiplierField.appendChild(attributeMultiplierContainer);
            attributeMultiplierField.appendChild(attributeMultiplierHelp);
            advancedBody.appendChild(attributeMultiplierField);
            syncAttributeMultiplierInputEnabled();

            const optionLimitField = document.createElement("div");
            optionLimitField.className = "field-inline";
            const optionLimitLabel = document.createElement("label");
            optionLimitLabel.textContent = "Max selections";
            const optionLimitInput = document.createElement("input");
            optionLimitInput.type = "number";
            optionLimitInput.min = "1";
            optionLimitInput.value = option.maxSelections ?? "";
            const inheritedOptionMax = Number(subcategory?.defaultOptionMaxSelections);
            optionLimitInput.placeholder = Number.isFinite(inheritedOptionMax) && inheritedOptionMax > 0
                ? `Default: ${inheritedOptionMax}`
                : "Default: 1";
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
            advancedBody.appendChild(optionLimitField);

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
            advancedBody.appendChild(countAsOneField);

            const slotUnlockField = document.createElement("div");
            slotUnlockField.className = "field";
            const slotUnlockToggle = document.createElement("label");
            slotUnlockToggle.className = "checkbox-option";
            const slotUnlockCheckbox = document.createElement("input");
            slotUnlockCheckbox.type = "checkbox";
            const slotUnlockText = document.createElement("span");
            slotUnlockText.textContent = "Slot unlock pricing (optional)";
            slotUnlockToggle.appendChild(slotUnlockCheckbox);
            slotUnlockToggle.appendChild(slotUnlockText);

            const slotUnlockBody = document.createElement("div");
            slotUnlockBody.className = "list-stack";

            const slotCountsRow = document.createElement("div");
            slotCountsRow.className = "field-inline";
            const picksPerSlotLabel = document.createElement("label");
            picksPerSlotLabel.textContent = "Picks per slot";
            const picksPerSlotInput = document.createElement("input");
            picksPerSlotInput.type = "number";
            picksPerSlotInput.min = "1";
            picksPerSlotInput.placeholder = "e.g. 15";

            const freeSlotsLabel = document.createElement("label");
            freeSlotsLabel.textContent = "Free slots";
            const freeSlotsInput = document.createElement("input");
            freeSlotsInput.type = "number";
            freeSlotsInput.min = "0";
            freeSlotsInput.placeholder = "e.g. 3";

            slotCountsRow.appendChild(picksPerSlotLabel);
            slotCountsRow.appendChild(picksPerSlotInput);
            slotCountsRow.appendChild(freeSlotsLabel);
            slotCountsRow.appendChild(freeSlotsInput);
            slotUnlockBody.appendChild(slotCountsRow);

            const unlockCostField = document.createElement("div");
            unlockCostField.className = "field";
            const unlockCostLabel = document.createElement("label");
            unlockCostLabel.textContent = "Slot unlock cost";
            const unlockCostContainer = document.createElement("div");
            unlockCostContainer.className = "cost-list";
            unlockCostField.appendChild(unlockCostLabel);
            unlockCostField.appendChild(unlockCostContainer);
            slotUnlockBody.appendChild(unlockCostField);

            const slotUnlockHelp = document.createElement("div");
            slotUnlockHelp.className = "field-help";
            slotUnlockHelp.textContent = "Applies additional one-time cost when opening a new slot beyond free slots.";
            slotUnlockBody.appendChild(slotUnlockHelp);

            const getSlotConfig = () => {
                if (!option.slotUnlockPricing || typeof option.slotUnlockPricing !== "object" || Array.isArray(option.slotUnlockPricing)) {
                    option.slotUnlockPricing = {
                        picksPerSlot: 15,
                        freeSlots: 3,
                        unlockCost: {}
                    };
                }
                if (!option.slotUnlockPricing.unlockCost || typeof option.slotUnlockPricing.unlockCost !== "object" || Array.isArray(option.slotUnlockPricing.unlockCost)) {
                    option.slotUnlockPricing.unlockCost = {};
                }
                return option.slotUnlockPricing;
            };

            const renderSlotUnlockPricingEditor = () => {
                const enabled = !!slotUnlockCheckbox.checked;
                slotUnlockBody.style.display = enabled ? "block" : "none";
                if (!enabled) return;
                const cfg = getSlotConfig();
                picksPerSlotInput.value = cfg.picksPerSlot ?? 15;
                freeSlotsInput.value = cfg.freeSlots ?? 3;
                renderPointMapEditor(unlockCostContainer, cfg.unlockCost || {}, (nextMap) => {
                    const current = getSlotConfig();
                    current.unlockCost = nextMap || {};
                    schedulePreviewUpdate();
                });
            };

            const hasSlotPricing = !!(option.slotUnlockPricing && typeof option.slotUnlockPricing === "object" && !Array.isArray(option.slotUnlockPricing));
            slotUnlockCheckbox.checked = hasSlotPricing;
            if (hasSlotPricing) {
                getSlotConfig();
            }

            slotUnlockCheckbox.addEventListener("change", () => {
                if (slotUnlockCheckbox.checked) {
                    getSlotConfig();
                } else {
                    delete option.slotUnlockPricing;
                }
                renderSlotUnlockPricingEditor();
                refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                schedulePreviewUpdate();
            });

            picksPerSlotInput.addEventListener("input", () => {
                if (!slotUnlockCheckbox.checked) return;
                const cfg = getSlotConfig();
                const value = Math.max(1, Number(picksPerSlotInput.value) || 1);
                cfg.picksPerSlot = value;
                picksPerSlotInput.value = String(value);
                refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                schedulePreviewUpdate();
            });

            freeSlotsInput.addEventListener("input", () => {
                if (!slotUnlockCheckbox.checked) return;
                const cfg = getSlotConfig();
                const value = Math.max(0, Number(freeSlotsInput.value) || 0);
                cfg.freeSlots = value;
                freeSlotsInput.value = String(value);
                refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                schedulePreviewUpdate();
            });

            slotUnlockField.appendChild(slotUnlockToggle);
            slotUnlockField.appendChild(slotUnlockBody);
            advancedBody.appendChild(slotUnlockField);
            renderSlotUnlockPricingEditor();

            const costSection = document.createElement("div");
            costSection.className = "field";
            const costLabel = document.createElement("label");
            costLabel.textContent = "Cost";
            const costContainer = document.createElement("div");
            costContainer.className = "cost-list";
            renderCostEditor(costContainer, option);
            costSection.appendChild(costLabel);
            costSection.appendChild(costContainer);
            commonBody.appendChild(costSection);

            const pointReqSection = document.createElement("div");
            pointReqSection.className = "field";
            const pointReqLabel = document.createElement("label");
            pointReqLabel.textContent = "Point Requirements (optional)";
            const pointReqHint = document.createElement("div");
            pointReqHint.className = "field-help";
            pointReqHint.textContent = "Require minimum point values to select this option (e.g., STR: 15).";
            const pointReqContainer = document.createElement("div");
            pointReqContainer.className = "cost-list";
            const syncPointRequirements = (nextMap) => {
                if (nextMap && Object.keys(nextMap).length) {
                    option.requiresPoints = nextMap;
                } else {
                    delete option.requiresPoints;
                }
                renderPointMapEditor(pointReqContainer, option.requiresPoints || {}, syncPointRequirements);
                refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                schedulePreviewUpdate();
            };
            renderPointMapEditor(pointReqContainer, option.requiresPoints || {}, syncPointRequirements);
            pointReqSection.appendChild(pointReqLabel);
            pointReqSection.appendChild(pointReqHint);
            pointReqSection.appendChild(pointReqContainer);
            commonBody.appendChild(pointReqSection);

            const prereqSection = document.createElement("div");
            prereqSection.className = "field";
            const prereqLabel = document.createElement("label");
            prereqLabel.textContent = "Prerequisites (optional)";
            const prereqHint = document.createElement("div");
            prereqHint.className = "field-help";
            prereqHint.textContent = "Use expression syntax only: && (and), || (or), ! (not), and parentheses.";
            const prereqInput = document.createElement("textarea");
            prereqInput.value = formatPrerequisiteValue(option.prerequisites);
            prereqInput.placeholder = "e.g. powerCore && (focusTraining || !villainPath)";
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
            commonBody.appendChild(prereqSection);

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
            advancedBody.appendChild(conflictSection);

            const discountSection = document.createElement("div");
            discountSection.className = "field";
            const discountLabel = document.createElement("label");
            discountLabel.textContent = "Conditional discounts";
            const discountHint = document.createElement("div");
            discountHint.className = "field-help";
            discountHint.textContent = "Create rules that change this option's cost when required option IDs are selected.";
            const discountContainer = document.createElement("div");
            discountContainer.className = "list-stack";

            function renderDiscountRulesEditor() {
                discountContainer.innerHTML = "";
                const rules = Array.isArray(option.discounts) ? option.discounts : [];
                if (!rules.length) {
                    const empty = document.createElement("div");
                    empty.className = "empty-state";
                    empty.textContent = "No conditional discount rules yet.";
                    discountContainer.appendChild(empty);
                }

                rules.forEach((rule, ruleIndex) => {
                    const ruleCard = document.createElement("div");
                    ruleCard.className = "discount-rule-card";

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
                        if (rules.length) {
                            option.discounts = rules;
                        } else {
                            delete option.discounts;
                        }
                        renderDiscountRulesEditor();
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });
                    header.appendChild(title);
                    header.appendChild(removeBtn);
                    ruleCard.appendChild(header);

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
                    modeInput.appendChild(modeAll);
                    modeInput.appendChild(modeAny);

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
                        minInput.disabled = modeInput.value !== "any";
                        renderDiscountRulesEditor();
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });

                    minInput.addEventListener("input", () => {
                        const parsed = Math.max(1, Number(minInput.value) || 1);
                        rule.minSelected = parsed;
                        minInput.value = String(parsed);
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });

                    modeRow.appendChild(modeLabel);
                    modeRow.appendChild(modeInput);
                    modeRow.appendChild(minLabel);
                    modeRow.appendChild(minInput);
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
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    };
                    mountIdListEditor(idsContainer, {
                        ids: modeInput.value === "any" ? rule.idsAny : rule.ids,
                        emptyText: "No trigger IDs added yet.",
                        onChange: setTriggerIds
                    });
                    idsField.appendChild(idsLabel);
                    idsField.appendChild(idsContainer);
                    ruleCard.appendChild(idsField);

                    const ruleCostField = document.createElement("div");
                    ruleCostField.className = "field";
                    const ruleCostLabel = document.createElement("label");
                    ruleCostLabel.textContent = "Discounted cost when triggered";
                    const ruleCostContainer = document.createElement("div");
                    ruleCostContainer.className = "cost-list";
                    renderPointMapEditor(ruleCostContainer, rule.cost || {}, (nextCost) => {
                        if (nextCost) {
                            rule.cost = nextCost;
                        } else {
                            delete rule.cost;
                        }
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });
                    ruleCostField.appendChild(ruleCostLabel);
                    ruleCostField.appendChild(ruleCostContainer);
                    ruleCard.appendChild(ruleCostField);

                    discountContainer.appendChild(ruleCard);
                });

                const addRuleBtn = document.createElement("button");
                addRuleBtn.type = "button";
                addRuleBtn.className = "button-subtle";
                addRuleBtn.textContent = "Add discount rule";
                addRuleBtn.addEventListener("click", () => {
                    const nextRule = {
                        ids: [],
                        cost: {}
                    };
                    if (!Array.isArray(option.discounts)) {
                        option.discounts = [];
                    }
                    option.discounts.push(nextRule);
                    renderDiscountRulesEditor();
                    refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                    schedulePreviewUpdate();
                });
                discountContainer.appendChild(addRuleBtn);
            }

            renderDiscountRulesEditor();
            discountSection.appendChild(discountLabel);
            discountSection.appendChild(discountHint);
            discountSection.appendChild(discountContainer);
            advancedBody.appendChild(discountSection);

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
            advancedBody.appendChild(grantsSection);
            refreshOptionWarnings();

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
            advancedBody.appendChild(advancedSection);

            details.appendChild(body);
            container.appendChild(details);
        });
    }

    function renderCostEditor(container, option) {
        container.innerHTML = "";
        option.cost = option.cost || {};
        const pointTypes = getDefinedPointTypes();
        Object.entries(option.cost).forEach(([currency, amount]) => {
            const row = document.createElement("div");
            row.className = "cost-row";

            const nameSelect = document.createElement("select");
            const selectChoices = pointTypes.includes(currency)
                ? pointTypes
                : [...pointTypes, currency];
            selectChoices.forEach((name) => {
                const optionEl = document.createElement("option");
                optionEl.value = name;
                optionEl.textContent = pointTypes.includes(name) ? name : `${name} (invalid)`;
                nameSelect.appendChild(optionEl);
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
                const newName = nameSelect.value.trim();
                if (!newName || newName === currency) {
                    return;
                }
                if (option.cost.hasOwnProperty(newName)) {
                    showEditorMessage(`Duplicate cost key "${newName}"`, "warning");
                    nameSelect.value = currency;
                    return;
                }
                const existing = option.cost[currency];
                delete option.cost[currency];
                option.cost[newName] = existing;
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
            const candidate = pointTypes.find(name => !Object.prototype.hasOwnProperty.call(option.cost, name));
            if (!candidate) {
                showEditorMessage("No available point types to add. Define more under type: points or remove an existing cost row.", "warning", 4000);
                return;
            }
            option.cost[candidate] = 0;
            renderCostEditor(container, option);
            schedulePreviewUpdate();
        });

        container.appendChild(addBtn);
    }

    function renderPointMapEditor(container, map, onChange) {
        container.innerHTML = "";
        const valueMap = map && typeof map === "object" ? { ...map } : {};
        const pointTypes = getDefinedPointTypes();

        Object.entries(valueMap).forEach(([pointType, amount]) => {
            const row = document.createElement("div");
            row.className = "cost-row";

            const typeSelect = document.createElement("select");
            const selectChoices = pointTypes.includes(pointType)
                ? pointTypes
                : [...pointTypes, pointType];
            selectChoices.forEach((name) => {
                const option = document.createElement("option");
                option.value = name;
                option.textContent = pointTypes.includes(name) ? name : `${name} (invalid)`;
                typeSelect.appendChild(option);
            });
            typeSelect.value = pointType;

            const valueInput = document.createElement("input");
            valueInput.type = "number";
            valueInput.value = typeof amount === "number" ? amount : Number(amount) || 0;

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.textContent = "✕";
            removeBtn.title = "Remove entry";

            valueInput.addEventListener("input", () => {
                valueMap[pointType] = Number(valueInput.value) || 0;
                onChange(Object.keys(valueMap).length ? { ...valueMap } : null);
            });

            typeSelect.addEventListener("change", () => {
                const newName = typeSelect.value.trim();
                if (!newName || newName === pointType) {
                    return;
                }
                if (Object.prototype.hasOwnProperty.call(valueMap, newName)) {
                    showEditorMessage(`Duplicate key "${newName}"`, "warning", 4000);
                    typeSelect.value = pointType;
                    return;
                }
                const existingValue = valueMap[pointType];
                delete valueMap[pointType];
                valueMap[newName] = existingValue;
                onChange(Object.keys(valueMap).length ? { ...valueMap } : null);
                renderPointMapEditor(container, valueMap, onChange);
            });

            removeBtn.addEventListener("click", () => {
                delete valueMap[pointType];
                onChange(Object.keys(valueMap).length ? { ...valueMap } : null);
                renderPointMapEditor(container, valueMap, onChange);
            });

            row.appendChild(typeSelect);
            row.appendChild(valueInput);
            row.appendChild(removeBtn);
            container.appendChild(row);
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "button-subtle";
        addBtn.textContent = "Add point type";
        addBtn.addEventListener("click", () => {
            const candidate = pointTypes.find(name => !Object.prototype.hasOwnProperty.call(valueMap, name));
            if (!candidate) {
                showEditorMessage("No available point types to add. Define more under type: points or remove an existing entry.", "warning", 4000);
                return;
            }
            valueMap[candidate] = 0;
            onChange({ ...valueMap });
            renderPointMapEditor(container, valueMap, onChange);
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
            validateCostPointTypesOrThrow(parsed);
            state.data = parsed;
            normalizeLegacyRequiresFields();
            regenerateAllOptionIdsAndReferences();
            validateOptionReferencesOrThrow(state.data);
            validateSliderUnlockGroupsOrThrow(state.data);
            renderGlobalSettings();
            renderCategories();
            schedulePreviewUpdate();
            showEditorMessage("Imported configuration.", "success");
        } catch (err) {
            alert(`Import failed:\n\n${err.message}`);
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
            try {
                validateCostPointTypesOrThrow(config.data);
                state.data = config.data;
                normalizeLegacyRequiresFields();
                regenerateAllOptionIdsAndReferences();
                validateOptionReferencesOrThrow(state.data);
                validateSliderUnlockGroupsOrThrow(state.data);
                renderGlobalSettings();
                renderCategories();
                schedulePreviewUpdate();
                showEditorMessage(`Loaded ${state.selectedFile}`, "success");
                return;
            } catch (validationErr) {
                alert(`Failed to load ${state.selectedFile}:\n\n${validationErr.message}`);
                showEditorMessage(`Failed to load ${state.selectedFile}: ${validationErr.message}`, "error", 12000);
                setTimeout(() => showSelectionModal(), 1500);
                return;
            }
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
            pendingPreviewDirty = true;
            pendingPreviewData = null;
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
            if (pendingPreviewDirty || pendingPreviewData) {
                flushPreviewUpdate();
            } else {
                postPreviewUpdate(previewFrame.contentWindow, cloneData(state.data));
            }
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
