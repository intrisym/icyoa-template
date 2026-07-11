let categories = [];
let points = {};
const selectedOptions = {};
const discountedSelections = {};
const selectedCostOptionIndexes = {};
const selectedCostOptionHistory = {};
const openCategories = new Set();
const storyInputs = {};
let currentTab = null; // Track current active tab
let backpackEnabled = false; // Track if backpack is enabled
let themeMode = "toggle";
let optionTitleAlignment = "center";
let optionMetaAlignment = "center";
let optionDescriptionAlignment = "center";
let optionTitleAlignmentExplicit = false;
let optionMetaAlignmentExplicit = false;
let optionDescriptionAlignmentExplicit = false;

const openSubcategories = new Set();
let animateMainTab = false;
const subcategoriesToAnimate = new Set();
const attributeSliderValues = {};
let originalPoints = {};
let allowNegativeTypes = new Set();
let pointTooltips = {};
let pointCategories = {};
let pointCategoryDefaultVisibility = {};
let visiblePointCategories = new Set();
let pointEnablementSets = [];
const enabledPointTypeSelections = {};
const openPointEnablementGroups = new Set();
const dynamicSelections = {};
const sliderModifierSelections = {};
const activeSliderModifierPointBaselines = {};
const pointAllocationSelections = {};
let derivedValueConfigs = [];
const derivedPointBaselines = {};
let attributeRanges = {}; // Will be updated by dynamic effects
let originalAttributeRanges = {}; // Stores the initial, base ranges from input.json
const subcategoryDiscountSelections = {};
const categoryDiscountSelections = {};
const optionGrantDiscountSelections = {};
const autoGrantedSelections = {};
const randomRollResults = {};
const selectionHistory = [];
const optionGridLayouts = new Set();
const OPTION_CARD_MIN_WIDTH = 280;
const MOBILE_SINGLE_COLUMN_BREAKPOINT = 768;
const IMAGE_PRELOAD_TIMEOUT_MS = 10000;
const preloadedImageCache = new Map();
let optionGridResizeListenerBound = false;
let optionGridResizeQueued = false;

// Theme State
let isDarkMode = localStorage.getItem('cyoa-dark-mode') === 'true';
const DARK_THEME_VARS = {
    "bg-color": "#111827", /* Dark Slate */
    "container-bg": "#1f2937",
    "text-color": "#f3f4f6",
    "text-muted": "#9ca3af",
    "accent-color": "#b91c1c", /* Brighter Red for Dark Mode */
    "accent-text": "#ffffff",
    "border-color": "#374151",
    "item-bg": "#1f2937",
    "item-header-bg": "#374151",
    "points-bg": "rgba(185, 28, 28, 0.95)",
    "points-border": "#fbbf24", /* Bright Yellow */
    "points-text": "#000000",
    "shadow-color": "rgba(0, 0, 0, 0.5)",
    "selection-glow-color": "#2563eb",
    "option-meta-bg": "#111827",
    "option-meta-heading-bg": "rgba(185, 28, 28, 0.18)",
    "option-meta-heading-text": "#f3f4f6",
    "option-meta-points-color": "#fbbf24",
    "option-meta-conditional-color": "#38bdf8",
    "option-meta-auto-grants-color": "#22c55e",
    "option-meta-slider-modifiers-color": "#a78bfa",
    "option-meta-random-results-color": "#f472b6",
    "option-meta-prerequisites-color": "#f59e0b",
    "option-meta-conflicts-color": "#f87171"
};

function makeGlowShadow(color, blurPx, alpha) {
    const raw = String(color || "").trim();
    const hex = raw.replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `0 0 ${blurPx}px rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        const r = parseInt(`${hex[0]}${hex[0]}`, 16);
        const g = parseInt(`${hex[1]}${hex[1]}`, 16);
        const b = parseInt(`${hex[2]}${hex[2]}`, 16);
        return `0 0 ${blurPx}px rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return `0 0 ${blurPx}px ${raw || "#2563eb"}`;
}


function clearObject(obj) {
    if (!obj) return;
    Object.keys(obj).forEach(key => delete obj[key]);
}

function normalizeThemeMode(settingsEntry = {}) {
    if (settingsEntry.themeMode === "light" || settingsEntry.themeMode === "dark" || settingsEntry.themeMode === "toggle") {
        return settingsEntry.themeMode;
    }
    if (settingsEntry.darkModeEnabled === false) {
        return "light";
    }
    return "toggle";
}

function normalizeOptionAlignment(value, fallback = "center") {
    const alignment = String(value || "").trim().toLowerCase();
    if (alignment === "left" || alignment === "center" || alignment === "right" || alignment === "justify") {
        return alignment;
    }
    return fallback;
}

function isOptionAlignmentValue(value) {
    return value === "left" || value === "center" || value === "right" || value === "justify";
}

function getOptionComponentAlignment(option, optionKey, globalAlignment, globalExplicit) {
    if (isOptionAlignmentValue(option?.[optionKey])) return option[optionKey];
    if (!globalExplicit && isOptionAlignmentValue(option?.alignment)) return option.alignment;
    return globalAlignment;
}

function getEffectiveDarkMode() {
    if (themeMode === "dark") return true;
    if (themeMode === "light") return false;
    return isDarkMode;
}

function normalizeAssetUrl(url) {
    if (!url || typeof url !== "string") return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    try {
        return new URL(trimmed, window.location.href).href;
    } catch (_) {
        return null;
    }
}

function sanitizeStoryInputValue(value, maxLength = 200) {
    let normalized = "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        normalized = String(value);
    }
    const lengthLimit = Number.isFinite(Number(maxLength)) && Number(maxLength) > 0 ? Math.floor(Number(maxLength)) : 200;
    return normalized.slice(0, lengthLimit);
}

function getStoryInputConfigById(inputId) {
    for (const cat of categories) {
        let found = null;

        walkSubcategoryTree(cat.subcategories || [], subcat => {
            if (found) return;
            if (subcat?.input?.id === inputId) {
                found = {
                    id: subcat.input.id,
                    maxLength: subcat.input.maxLength || 20,
                    type: "subcategory"
                };
                return;
            }
            for (const opt of subcat?.options || []) {
                if (opt?.id === inputId && opt.inputType === "text") {
                    found = {
                        id: opt.id,
                        maxLength: opt.maxLength || 200,
                        type: "option"
                    };
                    return;
                }
            }
        });

        if (found) return found;

        for (const opt of cat.options || []) {
            if (opt?.id === inputId && opt.inputType === "text") {
                return {
                    id: opt.id,
                    maxLength: opt.maxLength || 200,
                    type: "option"
                };
            }
        }
    }
    return null;
}

function walkSubcategoryTree(subcategories, callback, path = []) {
    if (!Array.isArray(subcategories)) return;
    subcategories.forEach((subcat, index) => {
        const nextPath = path.concat([{ index, name: subcat?.name || "" }]);
        callback(subcat, nextPath);
        if (Array.isArray(subcat?.subcategories) && subcat.subcategories.length) {
            walkSubcategoryTree(subcat.subcategories, callback, nextPath);
        }
    });
}

function forEachCategoryOption(category, callback) {
    (category?.options || []).forEach(opt => callback(opt, null));
    walkSubcategoryTree(category?.subcategories || [], subcat => {
        (subcat?.options || []).forEach(opt => callback(opt, subcat));
    });
}

function collectImageAssetUrls(rawData) {
    if (!Array.isArray(rawData)) return [];
    const urls = new Set();

    rawData.forEach(entry => {
        if (entry?.type === "headerImage") {
            const headerUrl = normalizeAssetUrl(entry.url);
            if (headerUrl) urls.add(headerUrl);
        }

        forEachCategoryOption(entry, opt => {
            const imageUrl = normalizeAssetUrl(opt?.image || opt?.img);
            if (imageUrl) urls.add(imageUrl);
        });
    });

    return Array.from(urls);
}

function preloadImage(url, timeoutMs = IMAGE_PRELOAD_TIMEOUT_MS) {
    return new Promise(resolve => {
        const img = new Image();
        let settled = false;

        const settle = () => {
            if (settled) return;
            settled = true;
            img.onload = null;
            img.onerror = null;
            resolve(img);
        };

        const timer = setTimeout(settle, timeoutMs);
        img.onload = () => {
            clearTimeout(timer);
            if (typeof img.decode === "function") {
                img.decode().catch(() => { }).finally(settle);
            } else {
                settle();
            }
        };
        img.onerror = () => {
            clearTimeout(timer);
            settle();
        };
        img.loading = "eager";
        img.decoding = "sync";
        img.src = url;
    });
}

async function preloadCyoaAssets(rawData, {
    onProgress
} = {}) {
    const urls = collectImageAssetUrls(rawData);
    preloadedImageCache.clear();
    if (!urls.length) {
        if (onProgress) onProgress(100, "No image assets to cache.");
        return;
    }

    if (onProgress) onProgress(0, `Caching image assets (0/${urls.length})...`);
    let loadedCount = 0;

    await Promise.allSettled(urls.map(url =>
        preloadImage(url)
            .then(img => {
                if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
                    preloadedImageCache.set(url, img);
                }
            })
            .finally(() => {
                loadedCount += 1;
                const pct = (loadedCount / urls.length) * 100;
                if (onProgress) onProgress(pct, `Caching image assets (${loadedCount}/${urls.length})...`);
            })
    ));

    if (onProgress) onProgress(100, "Image cache primed. Finalizing...");
}

function calculateResponsiveColumnCount(containerWidth, requestedColumns, minCardWidth, columnGap, minColumns = 1) {
    const requested = Math.max(1, requestedColumns);
    const floor = Math.max(1, Math.min(minColumns, requested));
    for (let cols = requested; cols >= floor; cols--) {
        const perColumnWidth = (containerWidth - (columnGap * (cols - 1))) / cols;
        if (perColumnWidth >= minCardWidth) return cols;
    }
    return floor;
}

function updateOptionGridColumns(grid) {
    if (!grid || !grid.isConnected) return;
    const requested = Number.parseInt(grid.dataset.maxColumns || "2", 10);
    const requestedColumns = Number.isFinite(requested) && requested > 0 ? requested : 2;
    const width = grid.clientWidth;
    if (width <= 0) return;

    const styles = window.getComputedStyle(grid);
    const gap = Number.parseFloat(styles.columnGap || styles.gap || "0") || 0;
    const isMobile = window.matchMedia(`(max-width: ${MOBILE_SINGLE_COLUMN_BREAKPOINT}px)`).matches;
    if (isMobile) {
        grid.style.setProperty("--columns-per-row-effective", "1");
        return;
    }
    const minColumns = 1;
    const effectiveColumns = calculateResponsiveColumnCount(width, requestedColumns, OPTION_CARD_MIN_WIDTH, gap, minColumns);
    grid.style.setProperty("--columns-per-row-effective", String(effectiveColumns));
}

function updateAllOptionGridColumns() {
    optionGridLayouts.forEach(grid => {
        if (!grid.isConnected) {
            optionGridLayouts.delete(grid);
            return;
        }
        updateOptionGridColumns(grid);
    });
}

function queueOptionGridResize() {
    if (optionGridResizeQueued) return;
    optionGridResizeQueued = true;
    window.requestAnimationFrame(() => {
        optionGridResizeQueued = false;
        updateAllOptionGridColumns();
    });
}

function registerOptionGrid(grid, maxColumns) {
    const normalizedMax = Number.isFinite(maxColumns) && maxColumns > 0 ? Math.floor(maxColumns) : 2;
    grid.dataset.maxColumns = String(normalizedMax);
    grid.style.setProperty("--columns-per-row", String(normalizedMax));
    optionGridLayouts.add(grid);
    updateOptionGridColumns(grid);

    if (!optionGridResizeListenerBound) {
        window.addEventListener("resize", queueOptionGridResize);
        optionGridResizeListenerBound = true;
    }
}

function resetGlobalState() {
    clearObject(selectedOptions);
    clearObject(discountedSelections);
    clearObject(selectedCostOptionIndexes);
    clearObject(selectedCostOptionHistory);
    clearObject(storyInputs);
    clearObject(attributeSliderValues);
    clearObject(dynamicSelections);
    clearObject(sliderModifierSelections);
    clearObject(activeSliderModifierPointBaselines);
    clearObject(pointAllocationSelections);
    clearObject(enabledPointTypeSelections);
    applyDefaultPointCategoryVisibility();
    applyDefaultPointEnablementGroups();
    clearObject(derivedPointBaselines);
    clearObject(subcategoryDiscountSelections);
    clearObject(categoryDiscountSelections);
    clearObject(optionGrantDiscountSelections);
    clearObject(autoGrantedSelections);
    clearObject(randomRollResults);
    openCategories.clear();
    openSubcategories.clear();
    animateMainTab = false;
    subcategoriesToAnimate.clear();
    points = {};
    categories = [];
    selectionHistory.length = 0;

    originalPoints = {};
    derivedValueConfigs = [];
    attributeRanges = {};
    originalAttributeRanges = {};
    allowNegativeTypes = new Set();
    pointTooltips = {};
    pointCategories = {};
    pointCategoryDefaultVisibility = {};
    visiblePointCategories = new Set();
    pointEnablementSets = [];
    optionTitleAlignment = "center";
    optionMetaAlignment = "center";
    optionDescriptionAlignment = "center";
    optionTitleAlignmentExplicit = false;
    optionMetaAlignmentExplicit = false;
    optionDescriptionAlignmentExplicit = false;
}

function meetsCountRequirement(rawId) {
    if (typeof rawId !== 'string') return false;
    let id = rawId;
    let required = 1;
    if (rawId.includes('__')) {
        const [base, suffix] = rawId.split('__');
        id = base;
        required = Number(suffix) || 1;
    }
    return (selectedOptions[id] || 0) >= required;
}

// Returns the direct base cost for an option. Subcategory defaults are represented by costOptions.
function getOptionBaseCost(option) {
    if (!option) return {};
    const optionCost = option.cost || {};
    return { ...optionCost };
}

function getNextSelectionNumber(option) {
    if (!option?.id) return 1;
    return (selectedOptions[option.id] || 0) + 1;
}

function getCostOptionCostForSelection(entry, selectionNumber = 1) {
    const tiers = Array.isArray(entry?.costBySelection) ? entry.costBySelection : [];
    const tierIndex = Math.max(0, Number(selectionNumber || 1) - 1);
    const tierCost = tiers[tierIndex] || tiers[tiers.length - 1];
    if (tierCost && typeof tierCost === "object" && !Array.isArray(tierCost)) return tierCost;
    return entry?.cost && typeof entry.cost === "object" ? entry.cost : null;
}

function getCostOptionSelectionCount(optionId, costOptionIndex) {
    return (selectedCostOptionHistory[optionId] || []).filter(index => Number(index) === Number(costOptionIndex)).length;
}

function getEffectiveCostOptionSelectionCount(optionId, costOptionIndex) {
    const history = selectedCostOptionHistory[optionId] || [];
    const historyCount = history.filter(index => Number(index) === Number(costOptionIndex)).length;
    if (history.length || Number(costOptionIndex) !== 0) return historyCount;
    return selectedOptions[optionId] || 0;
}

function hasExplicitCostOptionAvailability(entry) {
    return Object.prototype.hasOwnProperty.call(entry, "prerequisites")
        || Object.prototype.hasOwnProperty.call(entry, "minSelected")
        || Object.prototype.hasOwnProperty.call(entry, "requiresCostOption");
}

function shouldAutoRequireBaseCostOption(option, entry, index, costOptions = []) {
    if (!option?.id || !entry || typeof entry !== "object") return false;
    if (index <= 0 || !Array.isArray(costOptions) || costOptions.length <= 1) return false;
    const optionMaxSelections = getOptionMaxSelections(option);
    if (optionMaxSelections <= 1) return false;
    if (hasExplicitCostOptionAvailability(entry)) return false;
    if (costOptions.some(costOption => Array.isArray(costOption?.costBySelection) && costOption.costBySelection.length > 0)) return false;

    const baseCost = costOptions[0]?.cost;
    const modifierCost = entry.cost;
    if (!baseCost || !modifierCost || typeof baseCost !== "object" || typeof modifierCost !== "object") return false;
    const baseTypes = Object.keys(baseCost);
    const modifierTypes = Object.keys(modifierCost);
    return baseTypes.length === 1
        && ["Powers", "Skills", "Equipment"].includes(baseTypes[0])
        && modifierTypes.length > 0
        && modifierTypes.every(type => type === "Boons");
}

function costOptionAvailabilityMet(option, entry, index, costOptions = []) {
    if (!option?.id || !entry || typeof entry !== "object") return true;
    if (!requirementMet(entry.prerequisites)) return false;
    const currentOptionCount = selectedOptions[option.id] || 0;
    const minSelected = Number(entry.minSelected);
    if (Number.isFinite(minSelected) && currentOptionCount < minSelected) return false;
    if (entry.requiresCostOption !== undefined) {
        const requiredIndex = Number(entry.requiresCostOption);
        if (!Number.isInteger(requiredIndex) || getEffectiveCostOptionSelectionCount(option.id, requiredIndex) <= 0) {
            return false;
        }
    }
    if (shouldAutoRequireBaseCostOption(option, entry, index, costOptions) && getEffectiveCostOptionSelectionCount(option.id, 0) <= 0) {
        return false;
    }
    const hasSelectionTiers = Array.isArray(entry.costBySelection) && entry.costBySelection.length > 0;
    const totalCostOptions = Array.isArray(costOptions) ? costOptions.length : 1;
    const maxSelections = entry.maxSelections === undefined && totalCostOptions > 1 && !hasSelectionTiers
        ? 1
        : Number(entry.maxSelections);
    if (Number.isFinite(maxSelections) && maxSelections >= 0 && getEffectiveCostOptionSelectionCount(option.id, index) >= maxSelections) {
        return false;
    }
    return true;
}

function costOptionsHaveMeaningfulCost(costOptions = []) {
    return costOptions.some(entry =>
        entry?.cost && typeof entry.cost === "object" && Object.keys(entry.cost).length
        || Array.isArray(entry?.costBySelection) && entry.costBySelection.some(cost => cost && typeof cost === "object" && Object.keys(cost).length)
    );
}

function addPointCostMaps(...maps) {
    const merged = {};
    maps.forEach(map => {
        if (!map || typeof map !== "object" || Array.isArray(map)) return;
        Object.entries(map).forEach(([type, value]) => {
            merged[type] = (Number(merged[type]) || 0) + (Number(value) || 0);
        });
    });
    return merged;
}

function normalizeDerivedValues(pointsEntry = {}) {
    const raw = Array.isArray(pointsEntry.derivedValues) ? pointsEntry.derivedValues : [];
    return raw
        .map(entry => ({
            pointType: String(entry?.pointType || "").trim(),
            formula: String(entry?.formula || "").trim(),
            round: ["none", "floor", "ceil", "round"].includes(entry?.round) ? entry.round : "none",
            min: entry?.min === undefined || entry?.min === null || entry?.min === "" ? null : String(entry.min).trim(),
            max: entry?.max === undefined || entry?.max === null || entry?.max === "" ? null : String(entry.max).trim()
        }))
        .filter(entry => entry.pointType && entry.formula);
}

function normalizePointEnablementSets(pointsEntry = {}) {
    const pointTypes = new Set(Object.keys(pointsEntry.values || {}));
    const seenSubtypes = new Set();
    const raw = Array.isArray(pointsEntry.enableablePointSets) ? pointsEntry.enableablePointSets : [];
    return raw
        .map(entry => {
            const pointType = String(entry?.pointType || "").trim();
            const subtypes = Array.isArray(entry?.subtypes)
                ? [...new Set(entry.subtypes.map(type => String(type || "").trim()).filter(type =>
                    pointTypes.has(type) && type !== pointType && !seenSubtypes.has(type)
                ))]
                : [];
            subtypes.forEach(type => seenSubtypes.add(type));
            return {
                pointType,
                subtypes,
                limitFormula: String(entry?.limitFormula ?? entry?.limit ?? "0").trim(),
                expandedByDefault: entry?.expandedByDefault === true
            };
        })
        .filter(entry => pointTypes.has(entry.pointType) && entry.subtypes.length);
}

function normalizePointCategoryDefaults(rawDefaults = {}, categoryNames = []) {
    const validCategories = new Set(categoryNames);
    const normalized = {};
    if (!rawDefaults || typeof rawDefaults !== "object" || Array.isArray(rawDefaults)) return normalized;
    Object.entries(rawDefaults).forEach(([category, isVisible]) => {
        if (validCategories.has(category)) normalized[category] = isVisible !== false;
    });
    return normalized;
}

function normalizePointTooltips(rawTooltips = {}, pointNames = []) {
    const validPointNames = new Set(pointNames);
    const normalized = {};
    if (!rawTooltips || typeof rawTooltips !== "object" || Array.isArray(rawTooltips)) return normalized;
    Object.entries(rawTooltips).forEach(([type, tooltip]) => {
        const text = String(tooltip || "").trim();
        if (validPointNames.has(type) && text) normalized[type] = text;
    });
    return normalized;
}

function getPointCategoryNamesForCurrentPoints() {
    const assignedPointTypes = new Set(Object.values(pointCategories).flat());
    const categoryNames = new Set(Object.keys(pointCategories));
    if (Object.keys(originalPoints).some(type => !assignedPointTypes.has(type))) {
        categoryNames.add(UNCATEGORIZED_POINT_CATEGORY);
    }
    return categoryNames;
}

function applyDefaultPointCategoryVisibility() {
    const categoryNames = getPointCategoryNamesForCurrentPoints();
    visiblePointCategories = new Set(Array.from(categoryNames).filter(category => pointCategoryDefaultVisibility[category] !== false));
}

function tokenizeDerivedFormula(formula) {
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

function evaluateDerivedFormula(formula, pointLookupFn, selectedLookupFn = () => 0) {
    const tokens = tokenizeDerivedFormula(formula);
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
            const op = consume();
            const next = parseTerm();
            value = op === "+" ? value + next : value - next;
        }
        return value;
    };
    const parseTerm = () => {
        let value = parseFactor();
        while (peek() === "*" || peek() === "/") {
            const op = consume();
            const next = parseFactor();
            value = op === "*" ? value * next : value / next;
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
            return -parseFactor();
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
                consume(")");
                return Number(selectedLookupFn(optionToken.value)) || 0;
            }
            return Number(pointLookupFn(token.value)) || 0;
        }
        throw new Error("Expected a number, point type, or expression");
    };
    const result = parseExpression();
    if (index < tokens.length) throw new Error("Unexpected token after formula");
    if (!Number.isFinite(result)) throw new Error("Formula result must be finite");
    return result;
}

function evaluateDerivedBound(bound, pointLookupFn, selectedLookupFn) {
    if (bound === null || bound === undefined || bound === "") return null;
    const value = evaluateDerivedFormula(String(bound), pointLookupFn, selectedLookupFn);
    return Number.isFinite(value) ? value : null;
}

function finalizeDerivedValue(value, config, pointLookupFn = () => 0, selectedLookupFn = () => 0) {
    let result = Number(value) || 0;
    if (config.round === "floor") result = Math.floor(result);
    if (config.round === "ceil") result = Math.ceil(result);
    if (config.round === "round") result = Math.round(result);
    const min = evaluateDerivedBound(config.min, pointLookupFn, selectedLookupFn);
    const max = evaluateDerivedBound(config.max, pointLookupFn, selectedLookupFn);
    if (min !== null) result = Math.max(min, result);
    if (max !== null) result = Math.min(max, result);
    return result;
}

function applyDerivedValues() {
    const activeTypes = new Set();
    derivedValueConfigs.forEach(config => {
        activeTypes.add(config.pointType);
        try {
            const pointLookupFn = pointType => points.hasOwnProperty(pointType) ? points[pointType] : originalPoints[pointType];
            const selectedLookupFn = optionId => selectedOptions[optionId] || 0;
            const nextBase = finalizeDerivedValue(
                evaluateDerivedFormula(config.formula, pointLookupFn, selectedLookupFn),
                config,
                pointLookupFn,
                selectedLookupFn
            );
            const previousBase = Object.prototype.hasOwnProperty.call(derivedPointBaselines, config.pointType)
                ? Number(derivedPointBaselines[config.pointType]) || 0
                : Number(points[config.pointType] ?? originalPoints[config.pointType]) || 0;
            if (!points.hasOwnProperty(config.pointType)) points[config.pointType] = previousBase;
            points[config.pointType] += nextBase - previousBase;
            derivedPointBaselines[config.pointType] = nextBase;
        } catch (err) {
            console.warn(`Failed to evaluate derived value for ${config.pointType}:`, err);
        }
    });
    Object.keys(derivedPointBaselines).forEach(type => {
        if (!activeTypes.has(type)) delete derivedPointBaselines[type];
    });
}

function getPointEnablementSetKey(set) {
    return set?.pointType || "";
}

function isPointTypeEnableable(type) {
    return pointEnablementSets.some(set => set.subtypes.includes(type));
}

function isPointTypeEnabled(type) {
    if (!isPointTypeEnableable(type)) return true;
    return pointEnablementSets.some(set => {
        const key = getPointEnablementSetKey(set);
        return (enabledPointTypeSelections[key] || []).includes(type);
    });
}

function getPointEnablementLimit(set) {
    const raw = String(set?.limitFormula || "0").trim();
    if (!raw) return 0;
    try {
        return Math.max(0, Math.floor(evaluateDerivedFormula(
            raw,
            pointType => points.hasOwnProperty(pointType) ? points[pointType] : originalPoints[pointType],
            optionId => selectedOptions[optionId] || 0
        )));
    } catch (err) {
        console.warn(`Failed to evaluate point enablement limit for ${set?.pointType || "point set"}:`, err);
        return 0;
    }
}

function normalizeEnabledPointTypeSelections() {
    const validSetKeys = new Set(pointEnablementSets.map(getPointEnablementSetKey));
    Object.keys(enabledPointTypeSelections).forEach(key => {
        if (!validSetKeys.has(key)) delete enabledPointTypeSelections[key];
    });
    Array.from(openPointEnablementGroups).forEach(key => {
        if (!validSetKeys.has(key)) openPointEnablementGroups.delete(key);
    });
    pointEnablementSets.forEach(set => {
        const key = getPointEnablementSetKey(set);
        const limit = getPointEnablementLimit(set);
        const current = Array.isArray(enabledPointTypeSelections[key]) ? enabledPointTypeSelections[key] : [];
        enabledPointTypeSelections[key] = current
            .filter(type => set.subtypes.includes(type))
            .slice(0, limit);
    });
}

function applyDefaultPointEnablementGroups() {
    openPointEnablementGroups.clear();
    pointEnablementSets.forEach(set => {
        if (set.expandedByDefault) openPointEnablementGroups.add(getPointEnablementSetKey(set));
    });
}

function getMergedDefaultCostForSelection(costOptions = [], selectionNumber = 1) {
    return costOptions.reduce((merged, entry) => {
        const rawCost = getCostOptionCostForSelection(entry, selectionNumber);
        return addPointCostMaps(merged, rawCost);
    }, {});
}

function getMergedDefaultCostForOption(option, selectionNumber = null) {
    const info = option?.id ? findSubcategoryInfo(option.id) : {};
    const subcategoryOptions = Array.isArray(info.subcat?.costOptions) ? info.subcat.costOptions : [];
    if (info.subcat?.mergeDefaultCostOptions !== true || !subcategoryOptions.length) return {};
    return getMergedDefaultCostForSelection(subcategoryOptions, selectionNumber || getNextSelectionNumber(option));
}

function getConfiguredCostOptions(option) {
    const info = option?.id ? findSubcategoryInfo(option.id) : {};
    const ownOptions = Array.isArray(option?.costOptions) ? option.costOptions : [];
    const subcategoryOptions = Array.isArray(info.subcat?.costOptions) ? info.subcat.costOptions : [];
    const hasDirectOptionCost = option?.cost && typeof option.cost === "object" && Object.keys(option.cost).length > 0;
    const hasOwnCostOptions = costOptionsHaveMeaningfulCost(ownOptions);
    return hasOwnCostOptions ? ownOptions : (hasDirectOptionCost ? [] : subcategoryOptions);
}

function getOptionMaxSelections(option) {
    const ownMax = Number(option?.maxSelections);
    if (Number.isFinite(ownMax) && ownMax >= 1) return Math.floor(ownMax);
    const info = option?.id ? findSubcategoryInfo(option.id) : {};
    const inheritedMax = Number(info.subcat?.defaultOptionMaxSelections);
    if (Number.isFinite(inheritedMax) && inheritedMax >= 1) return Math.floor(inheritedMax);
    return 1;
}

function selectedCostOptionStillValid(option, costOptionIndex) {
    const options = getConfiguredCostOptions(option);
    if (!options.length || costOptionIndex === null || costOptionIndex === undefined) return true;
    const entry = options[Number(costOptionIndex)];
    if (!entry || typeof entry !== "object") return false;
    if (!requirementMet(entry.prerequisites)) return false;
    const currentOptionCount = selectedOptions[option.id] || 0;
    const minSelected = Number(entry.minSelected);
    if (Number.isFinite(minSelected) && currentOptionCount < minSelected) return false;
    if (entry.requiresCostOption !== undefined) {
        const requiredIndex = Number(entry.requiresCostOption);
        if (!Number.isInteger(requiredIndex) || getEffectiveCostOptionSelectionCount(option.id, requiredIndex) <= 0) return false;
    }
    if (shouldAutoRequireBaseCostOption(option, entry, Number(costOptionIndex), options) && getEffectiveCostOptionSelectionCount(option.id, 0) <= 0) return false;
    return true;
}

function selectedCostOptionsStillValid(option) {
    const history = selectedCostOptionHistory[option.id] || [];
    return history.every(costOptionIndex => selectedCostOptionStillValid(option, costOptionIndex));
}

function normalizeOptionCostOptions(option, { selectionNumber = null, includeUnavailable = false } = {}) {
    const options = getConfiguredCostOptions(option);
    const effectiveSelectionNumber = selectionNumber || getNextSelectionNumber(option);
    const info = option?.id ? findSubcategoryInfo(option.id) : {};
    const ownOptions = Array.isArray(option?.costOptions) ? option.costOptions : [];
    const subcategoryOptions = Array.isArray(info.subcat?.costOptions) ? info.subcat.costOptions : [];
    const shouldMergeDefaults = costOptionsHaveMeaningfulCost(ownOptions)
        && info.subcat?.mergeDefaultCostOptions === true
        && subcategoryOptions.length > 0;
    const defaultCost = shouldMergeDefaults
        ? getMergedDefaultCostForSelection(subcategoryOptions, effectiveSelectionNumber)
        : {};
    return options
        .map((entry, index) => {
            const available = costOptionAvailabilityMet(option, entry, index, options);
            if (!available && !includeUnavailable) return null;
            const rawCost = getCostOptionCostForSelection(entry, effectiveSelectionNumber)
                || (entry?.cost && typeof entry.cost === "object"
                    ? entry.cost
                : entry && typeof entry === "object" && !Array.isArray(entry)
                    ? entry
                        : null);
            if (!rawCost) return null;
            const cost = shouldMergeDefaults ? addPointCostMaps(defaultCost, rawCost) : { ...rawCost };
            return {
                index,
                available,
                cost
            };
        })
        .filter(Boolean);
}

function getOptionBaseCostByChoice(option, costOptionIndex = null, { selectionNumber = null, includeUnavailable = false } = {}) {
    const options = normalizeOptionCostOptions(option, { selectionNumber, includeUnavailable });
    if (!options.length) {
        const directCost = getOptionBaseCost(option);
        return addPointCostMaps(getMergedDefaultCostForOption(option, selectionNumber), directCost);
    }
    if (costOptionIndex === null || costOptionIndex === undefined) {
        return { ...options[0].cost };
    }
    const selected = options.find(entry => entry.index === Number(costOptionIndex));
    if (!selected || Object.keys(selected.cost || {}).length === 0) {
        const directCost = getOptionBaseCost(option);
        return addPointCostMaps(getMergedDefaultCostForOption(option, selectionNumber), directCost);
    }
    return { ...selected.cost };
}

function normalizePointAllocationConfig(option) {
    const config = option?.pointAllocation;
    if (!config || typeof config !== "object") return null;
    const types = Array.isArray(config.types)
        ? config.types.map(type => String(type || "").trim()).filter(Boolean)
        : [];
    const total = Math.max(0, Math.floor(Number(config.total) || 0));
    if (!types.length || total <= 0) return null;
    return {
        total,
        types: [...new Set(types)]
    };
}

function normalizePointAllocationValues(option, rawValues = null) {
    const config = normalizePointAllocationConfig(option);
    if (!config) return {};
    const values = {};
    let remaining = config.total;
    const source = rawValues && typeof rawValues === "object" ? rawValues : {};
    config.types.forEach((type, index) => {
        let value = Math.max(0, Math.floor(Number(source[type]) || 0));
        if (index === config.types.length - 1) {
            value = remaining;
        } else {
            value = Math.min(value, remaining);
        }
        values[type] = value;
        remaining -= value;
    });
    if (remaining > 0 && config.types.length) {
        values[config.types[0]] = (values[config.types[0]] || 0) + remaining;
    }
    return values;
}

function getPointAllocationValues(option) {
    const config = normalizePointAllocationConfig(option);
    if (!config) return {};
    if (!pointAllocationSelections[option.id]) {
        const defaults = {};
        defaults[config.types[0]] = config.total;
        pointAllocationSelections[option.id] = normalizePointAllocationValues(option, defaults);
    } else {
        pointAllocationSelections[option.id] = normalizePointAllocationValues(option, pointAllocationSelections[option.id]);
    }
    return { ...pointAllocationSelections[option.id] };
}

function getPointAllocationCost(option) {
    const values = getPointAllocationValues(option);
    const cost = {};
    Object.entries(values).forEach(([type, value]) => {
        const numeric = Number(value) || 0;
        if (numeric > 0) cost[type] = -numeric;
    });
    return cost;
}

function getAllOptions() {
    const options = [];
    categories.forEach(cat => {
        options.push(...(cat.options || []));
        walkSubcategoryTree(cat.subcategories || [], subcat => {
            options.push(...(subcat.options || []));
        });
    });
    return options;
}

function getSliderOptionForAttribute(attribute) {
    return getAllOptions().find(option => {
        if (option?.inputType !== "slider") return false;
        const { attributeType } = getSliderTypes(option.costPerPoint || {});
        return attributeType === attribute;
    }) || null;
}

function getSliderModifierTargetNames() {
    return Object.keys(originalPoints || {});
}

function getSliderBaseValue(attribute) {
    const directValue = Number(attributeSliderValues[attribute]);
    if (Number.isFinite(directValue)) return directValue;
    const sliderOption = getSliderOptionForAttribute(attribute);
    const optionValue = Number(sliderOption ? attributeSliderValues[sliderOption.id] : undefined);
    if (Number.isFinite(optionValue)) return optionValue;
    return Number(originalPoints[attribute]) || 0;
}

function setSliderBaseValue(attribute, value) {
    const nextValue = Number(value) || 0;
    attributeSliderValues[attribute] = nextValue;
    const sliderOption = getSliderOptionForAttribute(attribute);
    if (sliderOption) attributeSliderValues[sliderOption.id] = nextValue;
    if (points.hasOwnProperty(attribute)) points[attribute] = nextValue;
}

function refundSliderDecrease(attribute, oldValue, newValue) {
    const decrease = Math.max(0, (Number(oldValue) || 0) - (Number(newValue) || 0));
    if (decrease <= 0) return;
    const sliderOption = getSliderOptionForAttribute(attribute);
    const { currencyType } = getSliderTypes(sliderOption?.costPerPoint || {});
    const costPerPoint = Number(sliderOption?.costPerPoint?.[currencyType]) || 0;
    if (costPerPoint > 0 && currencyType) {
        points[currencyType] = (Number(points[currencyType]) || 0) + (costPerPoint * decrease);
    }
}

function resetSliderAttributePointValues() {
    Object.keys(originalAttributeRanges || {}).forEach(attribute => {
        if (points.hasOwnProperty(attribute)) {
            points[attribute] = getSliderBaseValue(attribute);
        }
    });
}

function restoreActiveSliderModifierPointValues() {
    Object.entries(activeSliderModifierPointBaselines).forEach(([type, baseline]) => {
        if (baseline?.existed) {
            points[type] = baseline.value;
        } else {
            delete points[type];
        }
    });
    clearObject(activeSliderModifierPointBaselines);
}

function rememberSliderModifierPointBaseline(type) {
    if (Object.prototype.hasOwnProperty.call(activeSliderModifierPointBaselines, type)) return;
    activeSliderModifierPointBaselines[type] = {
        existed: Object.prototype.hasOwnProperty.call(points, type),
        value: points[type]
    };
}

function normalizeSliderModifiers(option) {
    const targets = getSliderModifierTargetNames();
    const targetSet = new Set(targets);
    const rawEffects = Array.isArray(option?.sliderModifiers)
        ? option.sliderModifiers
        : Array.isArray(option?.attributeEffects)
            ? option.attributeEffects
            : [];
    return rawEffects
        .map(effect => {
            if (!effect || typeof effect !== "object") return null;
            const type = ["multiply", "cap", "add", "subtract"].includes(effect.type) ? effect.type : "multiply";
            const value = type === "multiply" ? Number(effect.multiplier) : Number(effect.value);
            return {
                type,
                attribute: String(effect.attribute || "").trim(),
                selectable: effect.selectable === true || !String(effect.attribute || "").trim(),
                retroactive: effect.retroactive !== false,
                choices: Array.isArray(effect.choices)
                    ? effect.choices.filter(choice => targetSet.has(choice))
                    : targets,
                value
            };
        })
        .filter(effect => effect && Number.isFinite(effect.value) && (effect.selectable || targetSet.has(effect.attribute)));
}

function getSliderModifierSelectionRows(optionId) {
    const raw = sliderModifierSelections[optionId];
    if (!Array.isArray(raw)) return [];
    if (raw.every(entry => Array.isArray(entry))) return raw.map(row => [...row]);
    return [raw];
}

function setSliderModifierSelectionRows(optionId, rows) {
    const normalized = Array.isArray(rows)
        ? rows.map(row => Array.isArray(row) ? [...row] : []).filter(row => row.some(Boolean))
        : [];
    if (normalized.length) {
        sliderModifierSelections[optionId] = normalized;
    } else {
        delete sliderModifierSelections[optionId];
    }
}

function getSelectedSliderModifierAttribute(optionId, effect, index, selectionIndex = 0) {
    if (!effect.selectable) return effect.attribute;
    return getSliderModifierSelectionRows(optionId)[selectionIndex]?.[index] || "";
}

function clampSliderAttribute(attribute, cap) {
    const currentMax = Number(attributeRanges[attribute]?.max ?? originalAttributeRanges[attribute]?.max ?? cap);
    const nextMax = Number.isFinite(currentMax) ? Math.min(currentMax, cap) : cap;
    if (!attributeRanges[attribute]) attributeRanges[attribute] = {};
    attributeRanges[attribute].max = nextMax;
    const currentValue = getSliderBaseValue(attribute);
    if (currentValue > nextMax) {
        refundSliderDecrease(attribute, currentValue, nextMax);
        setSliderBaseValue(attribute, nextMax);
    }
}

function applySelectedSliderModifiers() {
    const selectedEffects = [];
    Object.entries(selectedOptions).forEach(([optionId, count]) => {
        if (!count) return;
        const option = findOptionById(optionId);
        const effects = normalizeSliderModifiers(option);
        const selectionCount = Math.max(1, Number(count) || 1);
        for (let selectionIndex = 0; selectionIndex < selectionCount; selectionIndex += 1) {
            effects.forEach((effect, index) => {
                const attribute = getSelectedSliderModifierAttribute(optionId, effect, index, selectionIndex);
                if (!attribute) return;
                selectedEffects.push({ ...effect, attribute });
            });
        }
    });

    selectedEffects
        .filter(effect => effect.type === "cap")
        .forEach(effect => clampSliderAttribute(effect.attribute, effect.value));

    resetSliderAttributePointValues();

    selectedEffects
        .filter(effect => effect.type !== "cap")
        .forEach(effect => {
            rememberSliderModifierPointBaseline(effect.attribute);
            if (!points.hasOwnProperty(effect.attribute)) points[effect.attribute] = getSliderBaseValue(effect.attribute);
            const currentValue = Number(points[effect.attribute]) || 0;
            if (effect.type === "multiply") {
                if (effect.retroactive === false) {
                    const baseValue = getSliderBaseValue(effect.attribute);
                    points[effect.attribute] = currentValue + (baseValue * (effect.value - 1));
                } else {
                    points[effect.attribute] = currentValue * effect.value;
                }
            } else if (effect.type === "add") {
                points[effect.attribute] = currentValue + effect.value;
            } else if (effect.type === "subtract") {
                points[effect.attribute] = currentValue - effect.value;
            }
        });

    applyDerivedValues();
}

function mergeCostMaps(...maps) {
    const result = {};
    maps.forEach(map => {
        Object.entries(map || {}).forEach(([type, value]) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return;
            result[type] = (Number(result[type]) || 0) + numeric;
        });
    });
    return result;
}

function getSelectedCostOptionIndex(option, selectionNumber = null) {
    const options = normalizeOptionCostOptions(option, { selectionNumber });
    if (!options.length) return null;
    const selected = selectedCostOptionIndexes[option.id];
    return options.some(entry => entry.index === Number(selected)) ? Number(selected) : options[0].index;
}

function getInitialCostOptionIndex(option, selectionNumber = null) {
    const options = normalizeOptionCostOptions(option, { selectionNumber });
    if (!options.length) return null;
    const selected = getSelectedCostOptionIndex(option, selectionNumber);
    const selectedCost = getOptionEffectiveCost(option, { costOptionIndex: selected, selectionNumber });
    if (canAffordCost(selectedCost)) return selected;
    const affordable = options.find(choice => canAffordCost(getOptionEffectiveCost(option, { costOptionIndex: choice.index, selectionNumber })));
    return affordable ? affordable.index : selected;
}

function getOptionEffectiveCost(option, {
    includeFirstNPreview = true,
    costOptionIndex = null,
    selectionNumber = null,
    includeUnavailable = false
} = {}) {
    const baseCost = mergeCostMaps(
        getOptionBaseCostByChoice(option, costOptionIndex, { selectionNumber, includeUnavailable }),
        getPointAllocationCost(option)
    );
    const info = findSubcategoryInfo(option.id);
    let bestCost = baseCost;
    let bestTotal = Object.entries(baseCost).reduce((sum, [_, val]) => val > 0 ? sum + val : sum, 0);

    const winningRule = getWinningModifiedCostRule(option, info.subcat);
    if (winningRule) {
        bestCost = applyModifiedCostRule(baseCost, winningRule.rule);
    }
    bestTotal = Object.entries(bestCost).reduce((sum, [_, val]) => val > 0 ? sum + val : sum, 0);

    const grantContexts = getActiveOptionGrantContexts(option.id);
    const alreadySelectedThis = selectedOptions[option.id] || 0;
    grantContexts.forEach(ctx => {
        const assignedForThis = ctx.map[option.id] || 0;
        const totalAssigned = getDiscountTotalCount(ctx.map);
        const totalOthers = totalAssigned - assignedForThis;
        const allowedForThis = Math.max(0, Math.min(assignedForThis, ctx.limit - totalOthers));
        if (allowedForThis <= alreadySelectedThis) return;

        const candidate = applyDiscountCost(bestCost, ctx.mode);
        const candidateTotal = Object.entries(candidate).reduce((sum, [_, val]) => val > 0 ? sum + val : sum, 0);
        if (candidateTotal < bestTotal) {
            bestTotal = candidateTotal;
            bestCost = candidate;
        }
    });

    let discountApplied = false;
    const allowSubcatDiscount = option.disableSubcategoryDiscount !== true;
    const allowCatDiscount = option.disableCategoryDiscount !== true;
    const subcatHasDiscountAmount = hasDiscountAmount(info.subcat);
    const catHasDiscountAmount = hasDiscountAmount(info.cat);
    const subcatModeTypes = getModeDiscountTypes(info.subcat);
    const catModeTypes = getModeDiscountTypes(info.cat);

    if (!allowSubcatDiscount && info.key) {
        const subMap = getSubcategoryDiscountMap(info.key);
        if (subMap[option.id]) delete subMap[option.id];
    }
    if (!allowCatDiscount && info.catKey) {
        const catMap = getCategoryDiscountMap(info.catKey);
        if (catMap[option.id]) delete catMap[option.id];
    }

    if (includeFirstNPreview) {
        // Support "first N" discount display even when discount config flags aren't present.
        // This mirrors selection behavior where subcat.discountFirstN directly affects the next selections.
        if (!discountApplied && info.subcat && typeof info.subcat.discountFirstN === 'number' && info.subcat.discountFirstN > 0) {
            const subcatSelectionsCount = (info.subcat.options || []).reduce((sum, o) => sum + (selectedOptions[o.id] || 0), 0);
            const remaining = Math.max(0, info.subcat.discountFirstN - subcatSelectionsCount);
            if (remaining > 0) {
                const alreadySelectedThis = selectedOptions[option.id] || 0;
                if (alreadySelectedThis === 0) {
                    if (info.subcat.discountAmount && typeof info.subcat.discountAmount === 'object') {
                        const result = applyDiscountAmount(bestCost, info.subcat.discountAmount);
                        if (result.applied) {
                            bestCost = result.cost;
                            discountApplied = true;
                        }
                    } else {
                        bestCost = applyDiscountCost(bestCost, info.subcat.discountMode || 'half', subcatModeTypes);
                        discountApplied = true;
                    }
                }
            }
        }
    }

    const subcatDiscountActive = allowSubcatDiscount && info.subcat && info.key && canUseDiscount(info.subcat);
    const subcatAutoApplyAll = subcatDiscountActive && shouldAutoApplyDiscount(info.subcat);
    if (subcatDiscountActive) {
        // Determine primary currency and cost for eligibility checks
        const {
            value: primaryCost
        } = getDiscountEligibleCost(baseCost, info.subcat);
        const eligibleUnder = info.subcat.discountEligibleUnder ?? Infinity;

        if (primaryCost !== null && primaryCost > 0 && primaryCost <= eligibleUnder) {
            if (subcatAutoApplyAll) {
                if (subcatHasDiscountAmount) {
                    const result = applyDiscountAmount(bestCost, info.subcat.discountAmount);
                    if (result.applied) {
                        bestCost = result.cost;
                        discountApplied = true;
                    }
                } else {
                    bestCost = applyDiscountCost(bestCost, info.subcat.discountMode, subcatModeTypes);
                    discountApplied = true;
                }
            } else {
                const map = getSubcategoryDiscountMap(info.key);
                const assigned = map[option.id] || 0;
                const alreadySelected = selectedOptions[option.id] || 0;
                if (assigned > alreadySelected) {
                    if (subcatHasDiscountAmount) {
                        const result = applyDiscountAmount(bestCost, info.subcat.discountAmount);
                        if (result.applied) {
                            bestCost = result.cost;
                            discountApplied = true;
                        }
                    } else {
                        bestCost = applyDiscountCost(bestCost, info.subcat.discountMode, subcatModeTypes);
                        discountApplied = true;
                    }
                }
            }
        }

        if (includeFirstNPreview) {
            // If no explicit assignment/auto-apply, consider "first N" display behavior so users see which items would be discounted
            if (!discountApplied && typeof info.subcat.discountFirstN === 'number' && info.subcat.discountFirstN > 0) {
                const subcatSelectionsCount = (info.subcat.options || []).reduce((sum, o) => sum + (selectedOptions[o.id] || 0), 0);
                const remaining = Math.max(0, info.subcat.discountFirstN - subcatSelectionsCount);
                if (remaining > 0) {
                    // If there are remaining discount slots, unselected items should display as discounted
                    const alreadySelectedThis = selectedOptions[option.id] || 0;
                    // Only show the discounted price for an option that hasn't yet been selected (next-instance price)
                    if (alreadySelectedThis === 0) {
                        // Apply discountAmount if present, otherwise fall back to discountMode
                        if (info.subcat.discountAmount && typeof info.subcat.discountAmount === 'object') {
                            const result = applyDiscountAmount(bestCost, info.subcat.discountAmount);
                            if (result.applied) {
                                bestCost = result.cost;
                                discountApplied = true;
                            }
                        } else {
                            bestCost = applyDiscountCost(bestCost, info.subcat.discountMode, subcatModeTypes);
                            discountApplied = true;
                        }
                    }
                }
            }
        }
    }

    const getCategoryOptionSelectionCount = (category) => {
        if (!category) return 0;
        let total = 0;
        forEachCategoryOption(category, opt => {
            total += selectedOptions[opt.id] || 0;
        });
        return total;
    };

    if (includeFirstNPreview) {
        // Support category-level "first N" display even when discount config flags aren't present
        if (!discountApplied && info.cat && typeof info.cat.discountFirstN === 'number' && info.cat.discountFirstN > 0) {
            const catSelectionsCount = getCategoryOptionSelectionCount(info.cat);
            const remaining = Math.max(0, info.cat.discountFirstN - catSelectionsCount);
            if (remaining > 0) {
                const alreadySelectedThis = selectedOptions[option.id] || 0;
                if (alreadySelectedThis === 0) {
                    if (info.cat.discountAmount && typeof info.cat.discountAmount === 'object') {
                        const result = applyDiscountAmount(bestCost, info.cat.discountAmount);
                        if (result.applied) {
                            bestCost = result.cost;
                            discountApplied = true;
                        }
                    } else {
                        bestCost = applyDiscountCost(bestCost, info.cat.discountMode || 'half', catModeTypes);
                        discountApplied = true;
                    }
                }
            }
        }
    }

    const catDiscountActive = !discountApplied && allowCatDiscount && info.cat && info.catKey && canUseDiscount(info.cat);
    const catAutoApplyAll = catDiscountActive && shouldAutoApplyDiscount(info.cat);
    if (catDiscountActive) {
        const {
            value: primaryCost
        } = getDiscountEligibleCost(baseCost, info.cat);
        const eligibleUnder = info.cat.discountEligibleUnder ?? Infinity;

        if (primaryCost !== null && primaryCost > 0 && primaryCost <= eligibleUnder) {
            if (catAutoApplyAll) {
                if (catHasDiscountAmount) {
                    const result = applyDiscountAmount(bestCost, info.cat.discountAmount);
                    if (result.applied) {
                        bestCost = result.cost;
                        discountApplied = true;
                    }
                } else {
                    bestCost = applyDiscountCost(bestCost, info.cat.discountMode, catModeTypes);
                    discountApplied = true;
                }
            } else {
                const map = getCategoryDiscountMap(info.catKey);
                const assigned = map[option.id] || 0;
                const alreadySelected = selectedOptions[option.id] || 0;
                if (assigned > alreadySelected) {
                    if (catHasDiscountAmount) {
                        const result = applyDiscountAmount(bestCost, info.cat.discountAmount);
                        if (result.applied) {
                            bestCost = result.cost;
                            discountApplied = true;
                        }
                    } else {
                        bestCost = applyDiscountCost(bestCost, info.cat.discountMode, catModeTypes);
                        discountApplied = true;
                    }
                }
            }
        }

        // Category-level first-N display behavior (if not already applied)
        if (!discountApplied && typeof info.cat.discountFirstN === 'number' && info.cat.discountFirstN > 0) {
            const catSelectionsCount = getCategoryOptionSelectionCount(info.cat);
            const remaining = Math.max(0, info.cat.discountFirstN - catSelectionsCount);
            if (remaining > 0) {
                const alreadySelectedThis = selectedOptions[option.id] || 0;
                if (alreadySelectedThis === 0) {
                    if (info.cat.discountAmount && typeof info.cat.discountAmount === 'object') {
                        const result = applyDiscountAmount(bestCost, info.cat.discountAmount);
                        if (result.applied) {
                            bestCost = result.cost;
                            discountApplied = true;
                        }
                    } else {
                        bestCost = applyDiscountCost(bestCost, info.cat.discountMode, catModeTypes);
                        discountApplied = true;
                    }
                }
            }
        }
    }

    return bestCost;
}

function withSelectedOptionsSnapshot(snapshot, callback) {
    const current = { ...selectedOptions };
    clearObject(selectedOptions);
    Object.assign(selectedOptions, snapshot || {});
    try {
        return callback();
    } finally {
        clearObject(selectedOptions);
        Object.assign(selectedOptions, current);
    }
}

function costMapsEqual(a = {}, b = {}) {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const key of keys) {
        if ((Number(a?.[key]) || 0) !== (Number(b?.[key]) || 0)) return false;
    }
    return true;
}

function getSelectedOptionCostForSnapshot(option, snapshot, selectionNumber) {
    return withSelectedOptionsSnapshot(snapshot, () => getOptionEffectiveCost(option, {
        includeFirstNPreview: false,
        costOptionIndex: getSelectedCostOptionIndex(option),
        selectionNumber
    }));
}

function getOptionsAffectedBySelectionCountChange(changingOption, nextCount) {
    if (!changingOption?.id) return [];

    const beforeSnapshot = { ...selectedOptions };
    const afterSnapshot = { ...selectedOptions };
    if (nextCount > 0) {
        afterSnapshot[changingOption.id] = nextCount;
    } else {
        delete afterSnapshot[changingOption.id];
    }

    const affected = [];
    Object.entries(beforeSnapshot).forEach(([optionId, count]) => {
        if (optionId === changingOption.id) return;
        if (isCostModifierTriggerOption(optionId)) return;
        const option = findOptionById(optionId);
        const selectedCount = Number(count) || 0;
        if (!option || selectedCount <= 0) return;

        for (let index = 0; index < selectedCount; index += 1) {
            const selectionNumber = index + 1;
            const beforeCost = getSelectedOptionCostForSnapshot(option, beforeSnapshot, selectionNumber);
            const afterCost = getSelectedOptionCostForSnapshot(option, afterSnapshot, selectionNumber);
            if (!costMapsEqual(beforeCost, afterCost)) {
                affected.push(option);
                break;
            }
        }
    });
    return affected;
}

function isCostModifierTriggerOption(optionId) {
    const baseOptionId = String(optionId || "").split("__")[0];
    let isTrigger = false;
    const inspectRules = rules => {
        (rules || []).forEach(rule => {
            getDiscountRuleTriggerIds(rule).forEach(triggerId => {
                if (String(triggerId).split("__")[0] === baseOptionId) {
                    isTrigger = true;
                }
            });
        });
    };

    categories.forEach(cat => {
        inspectRules(getModifiedCostRules(cat));
        walkSubcategoryTree(cat.subcategories || [], subcat => inspectRules(getModifiedCostRules(subcat)));
        forEachCategoryOption(cat, option => inspectRules(getModifiedCostRules(option)));
    });
    return isTrigger;
}

function confirmCostModifierRemoval(triggerOption, removedOptions) {
    if (!removedOptions.length) return true;
    const triggerLabel = triggerOption?.label || triggerOption?.id || "this option";
    const labels = [...new Set(removedOptions.map(option => option.label || option.id).filter(Boolean))];
    const visibleLabels = labels.slice(0, 6).join(", ");
    const remainingCount = Math.max(0, labels.length - 6);
    const suffix = remainingCount ? `, and ${remainingCount} more` : "";
    const message = `Changing "${triggerLabel}" will remove selected options whose costs would change: ${visibleLabels}${suffix}.\n\nPress OK to continue and remove them, or Cancel to keep your current selections.`;
    if (typeof confirm === "function") return confirm(message);
    if (typeof alert === "function") alert(message);
    return true;
}

function removeSelectionsAffectedByCostModifierChange(changingOption, nextCount, options = {}) {
    if (options.skipCostModifierAffectedRemoval) return true;
    const affectedOptions = getOptionsAffectedBySelectionCountChange(changingOption, nextCount);
    if (!affectedOptions.length) return true;

    if (!options.suppressCostModifierWarning) {
        const confirmed = confirmCostModifierRemoval(changingOption, affectedOptions);
        if (!confirmed) return false;
    }

    affectedOptions.forEach(option => {
        while (selectedOptions[option.id] > 0) {
            removeSelection(option, {
                force: true,
                skipRender: true,
                skipCostModifierAffectedRemoval: true,
                suppressCostModifierWarning: true
            });
        }
    });

    return true;
}

function getOptionEffectiveCostChoices(option, options = {}) {
    const costOptions = normalizeOptionCostOptions(option, options);
    if (!costOptions.length) {
        const info = option?.id ? findSubcategoryInfo(option.id) : {};
        const hasDirectOptionCost = option?.cost && typeof option.cost === "object" && Object.keys(option.cost).length > 0;
        const hasConfiguredCostOptions = (Array.isArray(option?.costOptions) && option.costOptions.length > 0)
            || (!hasDirectOptionCost && Array.isArray(info.subcat?.costOptions) && info.subcat.costOptions.length > 0);
        if (hasConfiguredCostOptions) return [];
        return [{
            index: null,
            label: "Cost",
            cost: getOptionEffectiveCost(option, options)
        }];
    }
    return costOptions.map(choice => ({
        index: choice.index,
        cost: getOptionEffectiveCost(option, {
            ...options,
            costOptionIndex: choice.index,
            includeUnavailable: options.includeUnavailable === true
        })
    }));
}

function shouldRenderSelectionControls(option) {
    if (!option) return false;
    return option.inputType === "text"
        || getOptionMaxSelections(option) !== 1
        || normalizeOptionCostOptions(option).length > 1;
}

function canAffordCost(cost = {}) {
    return Object.entries(cost || {}).every(([type, cost]) => {
        const numeric = Number(cost);
        if (!Number.isFinite(numeric) || numeric === 0) return true;
        if (!isPointTypeEnabled(type)) return false;
        if (numeric < 0) return true;
        const current = Number(points[type]);
        const projected = (Number.isFinite(current) ? current : 0) - numeric;
        return projected >= 0 || allowNegativeTypes.has(type);
    });
}

function getSliderTypes(costPerPoint = {}) {
    let currencyType = null;
    let attributeType = null;

    Object.entries(costPerPoint).forEach(([type, val]) => {
        if (val > 0 && !currencyType) currencyType = type;
        if (val < 0 && !attributeType) attributeType = type;
    });

    if (!currencyType) currencyType = Object.keys(costPerPoint).find(key => key === "Attribute Points") || Object.keys(costPerPoint)[0] || "Attribute Points";
    if (!attributeType) attributeType = Object.keys(costPerPoint).find(key => key !== currencyType) || null;

    return {
        currencyType,
        attributeType
    };
}

const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalTextarea = document.getElementById("modalTextarea");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");
const modalClose = document.getElementById("modalClose");
let modalMode = null;
const pointsTrackerEl = document.getElementById("pointsTracker");
const assetLoadingOverlay = document.getElementById("assetLoadingOverlay");
const assetLoadingMessage = document.getElementById("assetLoadingMessage");
const assetLoadingBar = document.getElementById("assetLoadingBar");
const assetLoadingPercent = document.getElementById("assetLoadingPercent");
const initialTitleText = document.getElementById("cyoaTitle")?.textContent || "";
const initialDescriptionHTML = document.getElementById("cyoaDescription")?.innerHTML || "";
const initialHeaderImageHTML = document.getElementById("headerImageContainer")?.innerHTML || "";
const SHARE_CODE_PREFIX_GZIP = "cyoa1:";
const SHARE_CODE_PREFIX_RAW = "cyoa0:";
const UNCATEGORIZED_POINT_CATEGORY = "Uncategorized";

function escapeHtml(text = "") {
    return String(text).replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[ch]);
}

function isSafeTextColor(value = "") {
    const color = String(value).trim();
    return /^#[0-9a-f]{3,8}$/i.test(color)
        || /^rgba?\(\s*(\d{1,3}%?\s*,\s*){2}\d{1,3}%?(\s*,\s*(0|1|0?\.\d+|[1-9]\d*%))?\s*\)$/i.test(color)
        || /^hsla?\(\s*-?\d+(\.\d+)?(deg|rad|turn)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(\s*,\s*(0|1|0?\.\d+|[1-9]\d*%))?\s*\)$/i.test(color)
        || /^[a-z]+$/i.test(color);
}

function isSafeTextSize(value = "") {
    const size = String(value).trim();
    return /^[+-]?(\d+(\.\d+)?)(px|em|rem|%)$/i.test(size);
}

function normalizePointCategories(rawCategories = {}, pointNames = []) {
    const validPointNames = new Set(pointNames);
    const normalized = {};
    if (!rawCategories || typeof rawCategories !== "object" || Array.isArray(rawCategories)) {
        return normalized;
    }

    Object.entries(rawCategories).forEach(([category, types]) => {
        const cleanCategory = String(category || "").trim();
        if (!cleanCategory || !Array.isArray(types)) return;
        const uniqueTypes = [];
        types.forEach(type => {
            if (typeof type !== "string" || !validPointNames.has(type) || uniqueTypes.includes(type)) return;
            uniqueTypes.push(type);
        });
        if (uniqueTypes.length) normalized[cleanCategory] = uniqueTypes;
    });
    return normalized;
}

function getPointCategoryForType(type) {
    return Object.entries(pointCategories).find(([, types]) => types.includes(type))?.[0] || UNCATEGORIZED_POINT_CATEGORY;
}

function getVisiblePointEntries() {
    return Object.entries(points).filter(([type]) =>
        isPointTypeEnabled(type) && visiblePointCategories.has(getPointCategoryForType(type))
    );
}

function isSafeTextWeight(value = "") {
    const weight = String(value).trim();
    return /^[1-9]00$/.test(weight) && Number(weight) <= 900;
}

function buildTextSizeStyle(value = "") {
    const size = String(value).trim();
    const match = size.match(/^([+-])(\d+(\.\d+)?)(px|em|rem|%)$/i);
    if (!match) return `font-size: ${size};`;

    const sign = match[1];
    const amount = match[2];
    const unit = match[4];
    const operator = sign === "-" ? "-" : "+";
    return `font-size: calc(1em ${operator} ${amount}${unit});`;
}

function isSafeMarkdownUrl(value = "") {
    const url = String(value).trim();
    if (!url) return false;
    if (/[\u0000-\u001f\u007f\s]/.test(url)) return false;
    return /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(url);
}

// Supports Markdown-style formatting plus legacy CYOA color/size/weight tags.
function renderInlineMarkdown(text = "") {
    const source = String(text);
    const tagPattern = /`([^`]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*|__|\*|_|\[\/(color|size|weight)\]|\[(color|size|weight)=([^\]\s]+)\]/gi;
    let html = "";
    let lastIndex = 0;
    const openTags = [];
    let match;

    while ((match = tagPattern.exec(source)) !== null) {
        html += escapeHtml(source.slice(lastIndex, match.index));

        if (match[1] !== undefined) {
            html += `<code>${escapeHtml(match[1])}</code>`;
        } else if (match[2] !== undefined) {
            const linkText = renderInlineMarkdown(match[2]);
            const url = match[3].trim();
            if (isSafeMarkdownUrl(url)) {
                html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
            } else {
                html += escapeHtml(match[0]);
            }
        } else if (match[0] === "**" || match[0] === "__") {
            if (openTags[openTags.length - 1] === "bold") {
                html += "</strong>";
                openTags.pop();
            } else {
                html += "<strong>";
                openTags.push("bold");
            }
        } else if (match[0] === "*" || match[0] === "_") {
            if (openTags[openTags.length - 1] === "italic") {
                html += "</em>";
                openTags.pop();
            } else {
                html += "<em>";
                openTags.push("italic");
            }
        } else if (match[4]) {
            const closingTag = match[4].toLowerCase();
            if (openTags[openTags.length - 1] === closingTag) {
                html += "</span>";
                openTags.pop();
            } else {
                html += escapeHtml(match[0]);
            }
        } else {
            const openingTag = match[5].toLowerCase();
            const value = match[6].trim();
            if (openingTag === "color" && isSafeTextColor(value)) {
                html += `<span style="color: ${value};">`;
                openTags.push(openingTag);
            } else if (openingTag === "size" && isSafeTextSize(value)) {
                html += `<span style="${buildTextSizeStyle(value)}">`;
                openTags.push(openingTag);
            } else if (openingTag === "weight" && isSafeTextWeight(value)) {
                html += `<span style="font-weight: ${value};">`;
                openTags.push(openingTag);
            } else {
                html += escapeHtml(match[0]);
            }
        }

        lastIndex = tagPattern.lastIndex;
    }

    html += escapeHtml(source.slice(lastIndex));

    while (openTags.length > 0) {
        const tag = openTags.pop();
        html += tag === "bold" ? "</strong>" : tag === "italic" ? "</em>" : "</span>";
    }

    return html;
}

function renderFormattedText(text = "") {
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    let paragraph = [];
    let listType = null;
    let quote = [];

    const flushParagraph = () => {
        if (!paragraph.length) return;
        html.push(`<p>${renderInlineMarkdown(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
        paragraph = [];
    };
    const flushList = () => {
        if (!listType) return;
        html.push(`</${listType}>`);
        listType = null;
    };
    const flushQuote = () => {
        if (!quote.length) return;
        html.push(`<blockquote>${renderInlineMarkdown(quote.join("\n")).replace(/\n/g, "<br>")}</blockquote>`);
        quote = [];
    };

    lines.forEach(line => {
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
        const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
        const blockquote = line.match(/^\s*>\s?(.*)$/);

        if (!line.trim()) {
            flushParagraph();
            flushList();
            flushQuote();
            return;
        }

        if (heading) {
            flushParagraph();
            flushList();
            flushQuote();
            const level = heading[1].length;
            html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
            return;
        }

        if (blockquote) {
            flushParagraph();
            flushList();
            quote.push(blockquote[1]);
            return;
        }

        if (unordered || ordered) {
            flushParagraph();
            flushQuote();
            const nextType = unordered ? "ul" : "ol";
            if (listType !== nextType) {
                flushList();
                html.push(`<${nextType}>`);
                listType = nextType;
            }
            html.push(`<li>${renderInlineMarkdown((unordered || ordered)[1])}</li>`);
            return;
        }

        flushList();
        flushQuote();
        paragraph.push(line);
    });

    flushParagraph();
    flushList();
    flushQuote();
    return html.join("");
}

function renderFormattedInlineText(text = "") {
    return renderInlineMarkdown(String(text).replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>");
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

function setMultilineText(element, text = "") {
    if (!element) return;
    element.classList.add("formatted-text");
    element.innerHTML = element.tagName === "STRONG" ? renderFormattedInlineText(text) : renderFormattedText(text);
}

function getPointTypeMarkup(type = "") {
    return renderFormattedInlineText(type);
}

function getPointAmountMarkup(type, value) {
    return `${getPointTypeMarkup(type)} ${escapeHtml(String(value))}`;
}

function buildExportState() {
    restoreActiveSliderModifierPointValues();
    const state = {
        selectedOptions,
        points: { ...points },
        discountedSelections,
        selectedCostOptionHistory,
        storyInputs,
        attributeSliderValues,
        dynamicSelections,
        sliderModifierSelections,
        derivedPointBaselines,
        enabledPointTypeSelections,
        pointAllocationSelections,
        subcategoryDiscountSelections,
        categoryDiscountSelections,
        optionGrantDiscountSelections,
        autoGrantedSelections,
        randomRollResults
    };
    applyDynamicCosts();
    return state;
}

function clonePlayerState() {
    return {
        ...JSON.parse(JSON.stringify(buildExportState())),
        selectedCostOptionIndexes: JSON.parse(JSON.stringify(selectedCostOptionIndexes)),
        selectedCostOptionHistory: JSON.parse(JSON.stringify(selectedCostOptionHistory)),
        selectionHistory: [...selectionHistory]
    };
}

function restorePlayerState(state) {
    if (!state || typeof state !== "object") return;
    clearObject(selectedOptions);
    clearObject(discountedSelections);
    clearObject(selectedCostOptionIndexes);
    clearObject(selectedCostOptionHistory);
    clearObject(storyInputs);
    clearObject(attributeSliderValues);
    clearObject(dynamicSelections);
    clearObject(sliderModifierSelections);
    clearObject(activeSliderModifierPointBaselines);
    clearObject(derivedPointBaselines);
    clearObject(enabledPointTypeSelections);
    clearObject(pointAllocationSelections);
    clearObject(subcategoryDiscountSelections);
    clearObject(categoryDiscountSelections);
    clearObject(optionGrantDiscountSelections);
    clearObject(autoGrantedSelections);
    clearObject(randomRollResults);

    points = { ...(state.points || {}) };
    Object.assign(selectedOptions, state.selectedOptions || {});
    Object.assign(discountedSelections, state.discountedSelections || {});
    Object.assign(selectedCostOptionIndexes, state.selectedCostOptionIndexes || {});
    Object.assign(selectedCostOptionHistory, state.selectedCostOptionHistory || {});
    Object.assign(storyInputs, state.storyInputs || {});
    Object.assign(attributeSliderValues, state.attributeSliderValues || {});
    Object.assign(dynamicSelections, state.dynamicSelections || {});
    Object.assign(sliderModifierSelections, state.sliderModifierSelections || {});
    Object.assign(derivedPointBaselines, state.derivedPointBaselines || {});
    Object.assign(enabledPointTypeSelections, state.enabledPointTypeSelections || {});
    Object.assign(pointAllocationSelections, state.pointAllocationSelections || {});
    Object.assign(subcategoryDiscountSelections, state.subcategoryDiscountSelections || {});
    Object.assign(categoryDiscountSelections, state.categoryDiscountSelections || {});
    Object.assign(optionGrantDiscountSelections, state.optionGrantDiscountSelections || {});
    Object.assign(autoGrantedSelections, state.autoGrantedSelections || {});
    Object.assign(randomRollResults, state.randomRollResults || {});
    selectionHistory.length = 0;
    (state.selectionHistory || []).forEach(id => selectionHistory.push(id));
}

function hasOwnEntries(obj) {
    return !!obj && typeof obj === "object" && Object.keys(obj).length > 0;
}

function buildPackedExportState() {
    const full = buildExportState();
    const packed = {
        v: 1,
        s: full.selectedOptions,
        p: full.points
    };

    if (hasOwnEntries(full.discountedSelections)) packed.d = full.discountedSelections;
    if (hasOwnEntries(full.selectedCostOptionHistory)) packed.h = full.selectedCostOptionHistory;
    if (hasOwnEntries(full.storyInputs)) packed.t = full.storyInputs;
    if (hasOwnEntries(full.attributeSliderValues)) packed.a = full.attributeSliderValues;
    if (hasOwnEntries(full.dynamicSelections)) packed.y = full.dynamicSelections;
    if (hasOwnEntries(full.sliderModifierSelections)) packed.m = full.sliderModifierSelections;
    if (hasOwnEntries(full.derivedPointBaselines)) packed.b = full.derivedPointBaselines;
    if (hasOwnEntries(full.enabledPointTypeSelections)) packed.e = full.enabledPointTypeSelections;
    if (hasOwnEntries(full.pointAllocationSelections)) packed.l = full.pointAllocationSelections;
    if (hasOwnEntries(full.subcategoryDiscountSelections)) packed.u = full.subcategoryDiscountSelections;
    if (hasOwnEntries(full.categoryDiscountSelections)) packed.c = full.categoryDiscountSelections;
    if (hasOwnEntries(full.optionGrantDiscountSelections)) packed.g = full.optionGrantDiscountSelections;
    if (hasOwnEntries(full.autoGrantedSelections)) packed.r = full.autoGrantedSelections;
    if (hasOwnEntries(full.randomRollResults)) packed.o = full.randomRollResults;

    return packed;
}

function unpackImportedState(importedData) {
    if (!importedData || typeof importedData !== "object") return importedData;
    if (!Object.prototype.hasOwnProperty.call(importedData, "v")) return importedData;

    return {
        selectedOptions: importedData.s || {},
        points: importedData.p || {},
        discountedSelections: importedData.d || {},
        selectedCostOptionHistory: importedData.h || {},
        storyInputs: importedData.t || {},
        attributeSliderValues: importedData.a || {},
        dynamicSelections: importedData.y || {},
        sliderModifierSelections: importedData.m || {},
        derivedPointBaselines: importedData.b || {},
        enabledPointTypeSelections: importedData.e || {},
        pointAllocationSelections: importedData.l || {},
        subcategoryDiscountSelections: importedData.u || {},
        categoryDiscountSelections: importedData.c || {},
        optionGrantDiscountSelections: importedData.g || {},
        autoGrantedSelections: importedData.r || {},
        randomRollResults: importedData.o || {}
    };
}

function toBase64Url(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(str) {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4 || 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function gzipBytes(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    const compressedBuffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(compressedBuffer);
}

async function gunzipBytes(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const decompressedBuffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(decompressedBuffer);
}

async function encodeShareCode(data) {
    const json = JSON.stringify(buildPackedExportState());
    const jsonBytes = new TextEncoder().encode(json);

    if (typeof CompressionStream === "function") {
        const compressedBytes = await gzipBytes(jsonBytes);
        return `${SHARE_CODE_PREFIX_GZIP}${toBase64Url(compressedBytes)}`;
    }

    return `${SHARE_CODE_PREFIX_RAW}${toBase64Url(jsonBytes)}`;
}

async function decodeShareCode(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed.startsWith(SHARE_CODE_PREFIX_GZIP) && !trimmed.startsWith(SHARE_CODE_PREFIX_RAW)) {
        return unpackImportedState(JSON.parse(trimmed));
    }

    if (trimmed.startsWith(SHARE_CODE_PREFIX_GZIP)) {
        const encoded = trimmed.slice(SHARE_CODE_PREFIX_GZIP.length);
        const compressedBytes = fromBase64Url(encoded);
        const jsonBytes = await gunzipBytes(compressedBytes);
        return unpackImportedState(JSON.parse(new TextDecoder().decode(jsonBytes)));
    }

    const encoded = trimmed.slice(SHARE_CODE_PREFIX_RAW.length);
    const jsonBytes = fromBase64Url(encoded);
    return unpackImportedState(JSON.parse(new TextDecoder().decode(jsonBytes)));
}

function syncPointsTrackerHeight() {
    if (!pointsTrackerEl) return;
    const trackerHeight = Math.max(0, Math.ceil(pointsTrackerEl.getBoundingClientRect().height));
    document.documentElement.style.setProperty("--points-tracker-height", `${trackerHeight}px`);
}

if (pointsTrackerEl) {
    syncPointsTrackerHeight();
    window.addEventListener("resize", syncPointsTrackerHeight, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
        const pointsTrackerObserver = new ResizeObserver(() => {
            syncPointsTrackerHeight();
        });
        pointsTrackerObserver.observe(pointsTrackerEl);
    }
}

// Event Listeners
document.getElementById("exportBtn").onclick = () => openModal("export");
document.getElementById("importBtn").onclick = () => openModal("import");
document.getElementById("modalClose").onclick = () => closeModal();

document.getElementById("backpackBtn").onclick = () => openBackpackModal();
document.getElementById("backpackModalClose").onclick = () => closeBackpackModal();

document.getElementById("resetBtn").onclick = () => {
    if (!confirm("Are you sure you want to reset all selections?")) return;

    // Refund slider costs
    for (let id in attributeSliderValues) {
        const value = attributeSliderValues[id];
        const option = findOptionById(id);
        if (option && option.costPerPoint) {
            const attrName = Object.keys(option.costPerPoint).find(t => t !== "Attribute Points");
            const costPerPoint = option.costPerPoint["Attribute Points"] || 0;

            let freeBoostAmount = 0;
            // Check if this specific attribute is boosted by a dynamic selection (e.g., Nephilim)
            for (const dynOptId in dynamicSelections) {
                const dynOpt = findOptionById(dynOptId);
                if (dynOpt && dynOpt.dynamicCost) {
                    dynOpt.dynamicCost.choices.forEach((choice, i) => {
                        if (dynamicSelections[dynOptId][i] === attrName && dynOpt.dynamicCost.types[i] === "Boost Attribute") {
                            freeBoostAmount = parseInt(dynOpt.dynamicCost.values[i]);
                        }
                    });
                }
            }

            // Calculate the "paid" portion of the current value
            // Only refund if the value is above the free boost amount
            const paidValue = Math.max(0, value - freeBoostAmount);

            if (costPerPoint > 0 && paidValue > 0) {
                points["Attribute Points"] += costPerPoint * paidValue;
            }
        }
    }

    // Refund selected option costs
    for (let id in selectedOptions) {
        const option = findOptionById(id);
        if (option) {
            const count = selectedOptions[id];
            for (let i = 0; i < count; i++) {
                const refundCost = discountedSelections[id]?.shift() || getOptionBaseCost(option); // Use shift to get the correct instance cost
                Object.entries(refundCost).forEach(([type, cost]) => {
                    points[type] += cost;
                });
            }
        }
    }

    // Clear all tracking objects
    for (let key in selectedOptions) delete selectedOptions[key];
    for (let key in attributeSliderValues) delete attributeSliderValues[key];
    for (let key in discountedSelections) delete discountedSelections[key];
    for (let key in storyInputs) delete storyInputs[key];
    for (let key in selectedCostOptionHistory) delete selectedCostOptionHistory[key];
    for (let key in dynamicSelections) delete dynamicSelections[key];
    for (let key in sliderModifierSelections) delete sliderModifierSelections[key];
    for (let key in activeSliderModifierPointBaselines) delete activeSliderModifierPointBaselines[key];
    for (let key in derivedPointBaselines) delete derivedPointBaselines[key];
    for (let key in enabledPointTypeSelections) delete enabledPointTypeSelections[key];
    openPointEnablementGroups.clear();
    for (let key in pointAllocationSelections) delete pointAllocationSelections[key];
    for (let key in subcategoryDiscountSelections) delete subcategoryDiscountSelections[key];
    for (let key in categoryDiscountSelections) delete categoryDiscountSelections[key];
    for (let key in optionGrantDiscountSelections) delete optionGrantDiscountSelections[key];
    for (let key in autoGrantedSelections) delete autoGrantedSelections[key];
    for (let key in randomRollResults) delete randomRollResults[key];


    // Reset points and attribute ranges to their original states from input.json
    points = {
        ...originalPoints
    };
    attributeRanges = JSON.parse(JSON.stringify(originalAttributeRanges)); // Reset ranges to original

    // Re-evaluate formulas to ensure all derived points are correctly reset
    applyDynamicCosts();
    updatePointsDisplay();
    renderAccordion(); // Re-render to show reset state
};


window.onclick = (e) => {
    if (e.target === modal) closeModal();
};

modalConfirmBtn.onclick = async () => {
    try {
        const importedData = await decodeShareCode(modalTextarea.value);

        if (typeof importedData !== 'object' || !importedData.points || !importedData.selectedOptions) {
            throw new Error("Invalid format");
        }

        // Clear current states
        for (let key in selectedOptions) delete selectedOptions[key];
        for (let key in attributeSliderValues) delete attributeSliderValues[key];
        for (let key in discountedSelections) delete discountedSelections[key];
        for (let key in selectedCostOptionHistory) delete selectedCostOptionHistory[key];
        for (let key in storyInputs) delete storyInputs[key];
        for (let key in dynamicSelections) delete dynamicSelections[key];
        for (let key in sliderModifierSelections) delete sliderModifierSelections[key];
        for (let key in activeSliderModifierPointBaselines) delete activeSliderModifierPointBaselines[key];
        for (let key in derivedPointBaselines) delete derivedPointBaselines[key];
        for (let key in enabledPointTypeSelections) delete enabledPointTypeSelections[key];
        applyDefaultPointCategoryVisibility();
        applyDefaultPointEnablementGroups();
        for (let key in pointAllocationSelections) delete pointAllocationSelections[key];
        for (let key in subcategoryDiscountSelections) delete subcategoryDiscountSelections[key];
        for (let key in categoryDiscountSelections) delete categoryDiscountSelections[key];
        for (let key in optionGrantDiscountSelections) delete optionGrantDiscountSelections[key];
        for (let key in autoGrantedSelections) delete autoGrantedSelections[key];
        for (let key in randomRollResults) delete randomRollResults[key];

        // Apply imported states
        points = {
            ...importedData.points
        };
        Object.entries(importedData.selectedOptions).forEach(([key, val]) => {
            selectedOptions[key] = val
        });
        Object.entries(importedData.discountedSelections || {}).forEach(([key, val]) => {
            discountedSelections[key] = val
        });
        Object.entries(importedData.selectedCostOptionHistory || {}).forEach(([key, val]) => {
            selectedCostOptionHistory[key] = Array.isArray(val) ? val : []
        });
        Object.entries(importedData.storyInputs || {}).forEach(([key, val]) => {
            const config = getStoryInputConfigById(key);
            if (!config) return;
            if (config.type === "option" && !selectedOptions[key]) return;
            const safeValue = sanitizeStoryInputValue(val, config.maxLength);
            if (safeValue) {
                storyInputs[key] = safeValue;
            }
        });
        Object.entries(importedData.attributeSliderValues || {}).forEach(([key, val]) => {
            attributeSliderValues[key] = val
        });
        Object.entries(importedData.dynamicSelections || {}).forEach(([key, val]) => {
            dynamicSelections[key] = val
        });
        Object.entries(importedData.sliderModifierSelections || {}).forEach(([key, val]) => {
            sliderModifierSelections[key] = Array.isArray(val) ? val : [];
        });
        Object.entries(importedData.derivedPointBaselines || {}).forEach(([key, val]) => {
            const numeric = Number(val);
            if (Number.isFinite(numeric)) derivedPointBaselines[key] = numeric;
        });
        Object.entries(importedData.enabledPointTypeSelections || {}).forEach(([key, val]) => {
            enabledPointTypeSelections[key] = Array.isArray(val) ? val : [];
        });
        Object.entries(importedData.pointAllocationSelections || {}).forEach(([key, val]) => {
            pointAllocationSelections[key] = val
        });
        Object.entries(importedData.subcategoryDiscountSelections || {}).forEach(([key, val]) => {
            if (Array.isArray(val)) {
                const map = {};
                val.forEach(id => {
                    map[id] = (map[id] || 0) + 1;
                });
                subcategoryDiscountSelections[key] = map;
            } else if (val && typeof val === 'object') {
                const map = {};
                Object.entries(val).forEach(([id, count]) => {
                    const num = Number(count) || 0;
                    if (num > 0) map[id] = num;
                });
                subcategoryDiscountSelections[key] = map;
            }
        });
        Object.entries(importedData.categoryDiscountSelections || {}).forEach(([key, val]) => {
            if (Array.isArray(val)) {
                const map = {};
                val.forEach(id => {
                    map[id] = (map[id] || 0) + 1;
                });
                categoryDiscountSelections[key] = map;
            } else if (val && typeof val === 'object') {
                const map = {};
                Object.entries(val).forEach(([id, count]) => {
                    const num = Number(count) || 0;
                    if (num > 0) map[id] = num;
                });
                categoryDiscountSelections[key] = map;
            }
        });
        Object.entries(importedData.optionGrantDiscountSelections || {}).forEach(([key, val]) => {
            if (val && typeof val === 'object') {
                const map = {};
                Object.entries(val).forEach(([id, count]) => {
                    const num = Number(count) || 0;
                    if (num > 0) map[id] = num;
                });
                optionGrantDiscountSelections[key] = map;
            }
        });
        Object.entries(importedData.autoGrantedSelections || {}).forEach(([key, val]) => {
            if (val && typeof val === 'object') {
                autoGrantedSelections[key] = {
                    sourceId: val.sourceId,
                    canDeselect: val.canDeselect === true
                };
            }
        });
        Object.entries(importedData.randomRollResults || {}).forEach(([key, val]) => {
            if (Array.isArray(val)) {
                randomRollResults[key] = val.filter(entry => entry && typeof entry === "object");
            }
        });

        // Reset attribute ranges to original before re-applying dynamic effects
        attributeRanges = JSON.parse(JSON.stringify(originalAttributeRanges));

        applyDynamicCosts(); // Evaluate formulas after initial points are set and ranges reset
        updatePointsDisplay();
        renderAccordion();
        closeModal();
        alert("Choices imported successfully.");

    } catch (err) {
        alert("Import failed: " + err.message);
    }
};

function openModal(mode) {
    modalMode = mode;
    modal.style.display = "block";
    if (mode === "export") {
        modalTitle.textContent = "Export Your Choices";
        modalTextarea.value = "Generating share code...";
        modalConfirmBtn.style.display = "none";
        encodeShareCode(buildExportState())
            .then(code => {
                if (modalMode === "export") {
                    modalTextarea.value = code;
                }
            })
            .catch(err => {
                if (modalMode === "export") {
                    modalTextarea.value = "";
                    alert("Export failed: " + err.message);
                    closeModal();
                }
            });
    } else {
        modalTitle.textContent = "Import Your Choices";
        modalTextarea.value = "";
        modalConfirmBtn.style.display = "inline-block";
    }
}

function closeModal() {
    modal.style.display = "none";
    modalTextarea.value = "";
    modalMode = null;
}

function setLoadingOverlayVisible(visible) {
    if (!assetLoadingOverlay) return;
    assetLoadingOverlay.classList.toggle("is-visible", !!visible);
}

function updateLoadingOverlay(percent, message) {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    if (assetLoadingBar) {
        assetLoadingBar.style.width = `${clamped}%`;
    }
    if (assetLoadingPercent) {
        assetLoadingPercent.textContent = `${clamped}%`;
    }
    if (assetLoadingMessage && message) {
        assetLoadingMessage.textContent = message;
    }
}


/**
 * Validates the structure and dependencies within the input JSON data.
 * @param {Array<Object>} data - The parsed JSON data from input.json.
 * @param {Object} pointsEntry - The points configuration from input.json.
 * @throws {Error} If any validation error is found.
 */
function validateInputJson(data, pointsEntry) {
    const optionMap = new Map(); // Stores all options by ID for quick lookup
    const dependencyGraph = new Map(); // Stores prerequisites and conflicts for each option
    const errors = [];
    const collectSubcategoryTreeOptions = (subcat) => {
        const list = [];
        walkSubcategoryTree([subcat], node => {
            (node.options || []).forEach(opt => list.push(opt));
        });
        return list;
    };

    // Populate optionMap and dependencyGraph
    data.forEach(entry => {
        forEachCategoryOption(entry, (opt) => {
            if (optionMap.has(opt.id)) {
                errors.push(`Duplicate option ID found: "${opt.id}"`);
            }
            optionMap.set(opt.id, opt);
            // Fix: Only use Set for array/object prerequisites, not for strings
            let prereqSet;
            if (typeof opt.prerequisites === 'string') {
                prereqSet = new Set(); // Handled separately in validation
            } else if (Array.isArray(opt.prerequisites)) {
                prereqSet = new Set(opt.prerequisites);
            } else if (typeof opt.prerequisites === 'object' && opt.prerequisites !== null) {
                // For AND/OR object style, flatten all values into a set
                prereqSet = new Set([
                    ...(opt.prerequisites.and || []),
                    ...(opt.prerequisites.or || [])
                ]);
            } else {
                prereqSet = new Set();
            }
            dependencyGraph.set(opt.id, {
                prerequisites: prereqSet,
                conflicts: new Set(opt.conflictsWith || [])
            });

            (opt.discountGrants || []).forEach((rule, idx) => {
                const targets = Array.isArray(rule?.targetIds)
                    ? rule.targetIds
                    : (Array.isArray(rule?.targets) ? rule.targets : (rule?.targetId ? [rule.targetId] : []));
                if (!Array.isArray(targets) || targets.length === 0) {
                    errors.push(`Option "${opt.id}" has discountGrants[${idx}] with no target option IDs.`);
                }
                const slots = Number(rule?.slots) || 0;
                if (slots <= 0) {
                    errors.push(`Option "${opt.id}" has discountGrants[${idx}] with invalid slots value.`);
                }
            });
        });

        walkSubcategoryTree(entry.subcategories || [], (subcat) => {
            // Handle subcategory-level requiresOption applying to all options in this subcategory tree
            if (subcat?.requiresOption) {
                const requiredItems = Array.isArray(subcat.requiresOption) ? subcat.requiresOption : [subcat.requiresOption];
                collectSubcategoryTreeOptions(subcat).forEach(opt => {
                    const node = dependencyGraph.get(opt.id);
                    if (!node) return;
                    requiredItems.forEach(req => {
                        const looksLikeExpr = (typeof req === 'string') && /[()!&|\s]/.test(req);
                        if (looksLikeExpr) {
                            const existing = node.prerequisites;
                            if (typeof existing === 'string') {
                                node.prerequisites = `(${existing}) && (${req})`;
                            } else {
                                const arr = Array.from(existing || []);
                                if (arr.length === 0) {
                                    node.prerequisites = req;
                                } else {
                                    node.prerequisites = `(${arr.join(' && ')}) && (${req})`;
                                }
                            }
                        } else {
                            if (typeof node.prerequisites === 'string') {
                                node.prerequisites = `(${node.prerequisites}) && (${req})`;
                            } else {
                                node.prerequisites.add(req);
                            }
                        }
                    });
                });
            }
        });

        // Handle category-level requiresOption applying to all its options
        if (entry.requiresOption) {
            const requiredItems = Array.isArray(entry.requiresOption) ? entry.requiresOption : [entry.requiresOption];
            forEachCategoryOption(entry, opt => {
                const node = dependencyGraph.get(opt.id);
                if (!node) return;
                requiredItems.forEach(req => {
                    // If the requiresOption looks like a logical expression (contains operators or parentheses),
                    // treat it as a string prerequisite expression for the node so validation can parse it.
                    const looksLikeExpr = (typeof req === 'string') && /[()!&|\s]/.test(req);
                    if (looksLikeExpr) {
                        const existing = node.prerequisites;
                        if (typeof existing === 'string') {
                            node.prerequisites = `(${existing}) && (${req})`;
                        } else {
                            const arr = Array.from(existing || []);
                            if (arr.length === 0) {
                                node.prerequisites = req;
                            } else {
                                node.prerequisites = `(${arr.join(' && ')}) && (${req})`;
                            }
                        }
                    } else {
                        // simple id; add to set (or combine with existing string)
                        if (typeof node.prerequisites === 'string') {
                            node.prerequisites = `(${node.prerequisites}) && (${req})`;
                        } else {
                            node.prerequisites.add(req);
                        }
                    }
                });
            });
        }
    });

    // Ensure conflicts are reciprocal
    for (let [id, node] of dependencyGraph.entries()) {
        for (let conflictId of node.conflicts) {
            if (!dependencyGraph.has(conflictId)) {
                // If a conflicting option doesn't exist, this is an error
                errors.push(`Option "${id}" conflicts with non-existent option "${conflictId}"`);
                continue;
            }
            // Ensure the conflict is reciprocal
            dependencyGraph.get(conflictId).conflicts.add(id);
        }
    }

    // Validate prerequisites and detect circular dependencies
    function validateOption(id, path = new Set()) {
        if (path.has(id)) {
            errors.push(`Circular prerequisite detected involving "${id}"`);
            return;
        }

        path.add(id);
        const current = dependencyGraph.get(id);

        if (!current) {
            return; // Already reported as missing prerequisite
        }

        // Check for conflicts with its own prerequisites in the current path
        for (let otherId of path) {
            if (otherId === id) continue; // Don't check against itself
            const other = dependencyGraph.get(otherId);
            if (other?.conflicts.has(id) || current.conflicts.has(otherId)) {
                errors.push(`Option "${id}" cannot be selected due to conflict with its prerequisite "${otherId}"`);
            }
        }

        // Handle string-based JS-style prerequisites
        if (typeof current.prerequisites === 'string') {
            // Extract all variable names (option IDs) from the expression
            const ids = current.prerequisites.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
            // Remove JS reserved words and boolean literals
            const reserved = new Set(['true', 'false', 'null', 'undefined', 'if', 'else', 'return', 'let', 'var', 'const', 'function', 'while', 'for', 'do', 'switch', 'case', 'break', 'continue', 'default', 'new', 'this', 'typeof', 'instanceof', 'void', 'delete', 'in', 'of', 'with', 'try', 'catch', 'finally', 'throw', 'class', 'extends', 'super', 'import', 'export', 'from', 'as', 'await', 'async', 'yield']);
            for (let idRef of ids) {
                if (!reserved.has(idRef) && !optionMap.has(idRef)) {
                    errors.push(`Missing prerequisite option ID "${idRef}" for option "${id}"`);
                }
            }
            return; // Do not iterate as array
        }
        // If prerequisites is an array, validate as before
        if (Array.isArray(current.prerequisites)) {
            for (let pre of current.prerequisites) {
                if (!optionMap.has(pre)) {
                    errors.push(`Missing prerequisite "${pre}" for option "${id}"`);
                    continue;
                }
                validateOption(pre, new Set(path)); // Pass a new set for each recursive call
            }
            return;
        }

        for (let pre of current.prerequisites) {
            if (!optionMap.has(pre)) {
                errors.push(`Missing prerequisite "${pre}" for option "${id}"`);
                continue;
            }
            validateOption(pre, new Set(path)); // Pass a new set for each recursive call
        }
    }

    for (let id of optionMap.keys()) {
        validateOption(id);
    }

    for (let [id, opt] of optionMap.entries()) {
        (opt.discountGrants || []).forEach((rule, idx) => {
            const targets = Array.isArray(rule?.targetIds)
                ? rule.targetIds
                : (Array.isArray(rule?.targets) ? rule.targets : (rule?.targetId ? [rule.targetId] : []));
            targets.forEach(targetId => {
                if (!optionMap.has(targetId)) {
                    errors.push(`Option "${id}" has discountGrants[${idx}] target "${targetId}" that does not exist.`);
                }
            });
        });
    }

    if (errors.length > 0) {
        throw new Error("Validation Errors:\n\n" + errors.map(err => `• ${err}`).join("\n\n"));
    }

    // Validate slider attributes against defined points
    const knownAttributes = Object.keys(pointsEntry?.values || {});
    for (const cat of data.filter(e => e.name)) { // Filter for actual categories
        forEachCategoryOption(cat, opt => {
            if (opt.inputType === "slider") {
                // Find the attribute name that is not "Attribute Points" (if it exists)
                const attr = Object.keys(opt.costPerPoint || {}).find(t => t !== "Attribute Points");
                if (attr && !knownAttributes.includes(attr)) {
                    errors.push(`Slider option "${opt.id}" references unknown attribute "${attr}" in its costPerPoint.`);
                }
            }
        });
    }

    if (errors.length > 0) {
        throw new Error("Validation Errors:\n\n" + errors.map(err => `• ${err}`).join("\n\n"));
    }
}

function applyCyoaData(rawData, {
    silent = false,
    notifyParent = false,
    preservePlayerState = false
} = {}) {
    try {
        if (!Array.isArray(rawData)) {
            throw new Error("CYOA data must be an array.");
        }

        const preservedPlayerState = preservePlayerState ? clonePlayerState() : null;
        const data = JSON.parse(JSON.stringify(rawData));
        window._lastCyoaData = rawData; // Cache for theme toggle
        const pointsEntry = data.find(entry => entry.type === "points");
        validateInputJson(data, pointsEntry);

        // Apply theme if present
        const settingsEntry = data.find(entry => entry.type === "settings") || {};
        themeMode = normalizeThemeMode(settingsEntry);
        const effectiveDarkMode = getEffectiveDarkMode();
        const themeEntry = data.find(entry => entry.type === "theme");
        const darkThemeEntry = data.find(entry => entry.type === "darkTheme");
        const root = document.documentElement;

        function updateRootProperty(key, value) {
            root.style.setProperty(`--${key}`, value);
        }

        const TYPOGRAPHY_KEYS = new Set([
            "font-base",
            "font-title",
            "font-description",
            "font-tab",
            "font-accordion",
            "font-subcategory",
            "font-option-title",
            "font-option-req",
            "font-option-desc",
            "font-story",
            "font-story-input",
            "font-points",
            "font-points-value",
            "font-prereq-help",
            "font-label",
            "font-heading",
            "font-body"
        ]);

        // Default theme variables - Aligned with MHA/Heroic Aesthetic
        const defaults = {
            "bg-color": "#fdf6e3",
            "container-bg": "#ffffff",
            "text-color": "#2b2b2b",
            "text-muted": "#5e5e5e",
            "accent-color": "#8b0000",
            "accent-text": "#ffffff",
            "border-color": "#d1cfc7",
            "item-bg": "#f5f1e4",
            "item-header-bg": "#e5e0d0",
            "points-bg": "rgba(139, 0, 0, 0.9)",
            "points-border": "#ffd700",
            "points-text": "#000000",
            "shadow-color": "rgba(0, 0, 0, 0.15)",
            "selection-glow-color": "#2563eb",
            "selection-glow": "0 0 15px rgba(37, 99, 235, 0.6)",
            "selection-glow-hover": "0 0 20px rgba(37, 99, 235, 0.8)",
            "option-meta-bg": "#f8fafc",
            "option-meta-heading-bg": "rgba(139, 0, 0, 0.14)",
            "option-meta-heading-text": "#2b2b2b",
            "option-meta-points-color": "#ffd700",
            "option-meta-conditional-color": "#0ea5e9",
            "option-meta-auto-grants-color": "#16a34a",
            "option-meta-slider-modifiers-color": "#7c3aed",
            "option-meta-prerequisites-color": "#f59e0b",
            "option-meta-conflicts-color": "#dc2626",
            "font-base": "18px",
            "font-title": "48px",
            "font-description": "22px",
            "font-tab": "22px",
            "font-accordion": "24px",
            "font-subcategory": "26px",
            "font-option-title": "24px",
            "font-option-req": "19px",
            "font-option-desc": "23px",
            "font-story": "20px",
            "font-story-input": "19px",
            "font-points": "22px",
            "font-points-value": "24px",
            "font-prereq-help": "17px",
            "font-label": "19px",
            "font-heading": "Verdana, sans-serif",
            "font-body": "'Quicksand', sans-serif"
        };

        if (effectiveDarkMode) {
            Object.entries(DARK_THEME_VARS).forEach(([key, value]) => updateRootProperty(key, value));
            if (themeEntry) {
                Object.entries(themeEntry).forEach(([key, value]) => {
                    if (key === "type" || !TYPOGRAPHY_KEYS.has(key)) return;
                    updateRootProperty(key, value);
                });
            }
            if (darkThemeEntry) {
                Object.entries(darkThemeEntry).forEach(([key, value]) => {
                    if (key === "type") return;
                    updateRootProperty(key, value);
                });
            }
        } else {
            Object.entries(defaults).forEach(([key, value]) => updateRootProperty(key, value));
            if (themeEntry) {
                Object.entries(themeEntry).forEach(([key, value]) => {
                    if (key === "type") return;
                    updateRootProperty(key, value);
                });
            }
        }

        const activeThemeEntry = effectiveDarkMode ? (darkThemeEntry || themeEntry) : themeEntry;
        const glowColor = activeThemeEntry?.["selection-glow-color"] || (effectiveDarkMode ? DARK_THEME_VARS["selection-glow-color"] : defaults["selection-glow-color"]) || "#2563eb";
        const hasExplicitGlow = !!(activeThemeEntry && (Object.prototype.hasOwnProperty.call(activeThemeEntry, "selection-glow") || Object.prototype.hasOwnProperty.call(activeThemeEntry, "selection-glow-hover")));
        if (!hasExplicitGlow) {
            updateRootProperty("selection-glow", makeGlowShadow(glowColor, 15, 0.6));
            updateRootProperty("selection-glow-hover", makeGlowShadow(glowColor, 20, 0.8));
        }

        updateThemeToggleButton();

        const preservedCategoryOpen = new Set(openCategories);
        const preservedSubcategoryOpen = new Set(openSubcategories);

        resetGlobalState();
        const legacyOptionAlignment = normalizeOptionAlignment(settingsEntry.optionAlignment);
        optionTitleAlignmentExplicit = isOptionAlignmentValue(settingsEntry.optionTitleAlignment);
        optionMetaAlignmentExplicit = isOptionAlignmentValue(settingsEntry.optionMetaAlignment);
        optionDescriptionAlignmentExplicit = isOptionAlignmentValue(settingsEntry.optionDescriptionAlignment);
        optionTitleAlignment = normalizeOptionAlignment(settingsEntry.optionTitleAlignment, legacyOptionAlignment);
        optionMetaAlignment = normalizeOptionAlignment(settingsEntry.optionMetaAlignment, legacyOptionAlignment);
        optionDescriptionAlignment = normalizeOptionAlignment(settingsEntry.optionDescriptionAlignment, legacyOptionAlignment);

        preservedCategoryOpen.forEach(name => openCategories.add(name));
        preservedSubcategoryOpen.forEach(key => openSubcategories.add(key));

        const titleEntry = data.find(entry => entry.type === "title");
        const titleEl = document.getElementById("cyoaTitle");
        if (titleEl) {
            titleEl.textContent = titleEntry?.text || initialTitleText;
        }

        const descriptionEntry = data.find(entry => entry.type === "description");
        const descEl = document.getElementById("cyoaDescription");
        if (descEl) {
            if (descriptionEntry?.text) {
                setMultilineText(descEl, descriptionEntry.text);
            } else {
                descEl.innerHTML = initialDescriptionHTML;
            }
        }

        const headerImageEntry = data.find(entry => entry.type === "headerImage");
        const headerContainer = document.getElementById("headerImageContainer");
        if (headerContainer) {
            if (headerImageEntry?.url) {
                const noUpscaleClass = headerImageEntry.preventUpscale ? ' no-upscale' : '';
                headerContainer.innerHTML = `<img src="${headerImageEntry.url}" alt="Header Image" class="header-image${noUpscaleClass}" />`;
                const imgEl = headerContainer.querySelector('img');
                if (imgEl && imgEl.complete) {
                    imgEl.decode?.().catch(() => { });
                }
            } else {
                headerContainer.innerHTML = initialHeaderImageHTML;
            }
        }

        originalAttributeRanges = pointsEntry?.attributeRanges ? JSON.parse(JSON.stringify(pointsEntry.attributeRanges)) : {};
        attributeRanges = JSON.parse(JSON.stringify(originalAttributeRanges));

        allowNegativeTypes = new Set(pointsEntry?.allowNegative || []);
        originalPoints = pointsEntry?.values ? {
            ...pointsEntry.values
        } : {};
        pointTooltips = normalizePointTooltips(pointsEntry?.pointTooltips, Object.keys(originalPoints));
        derivedValueConfigs = normalizeDerivedValues(pointsEntry);
        pointEnablementSets = normalizePointEnablementSets(pointsEntry);
        applyDefaultPointEnablementGroups();
        points = {
            ...originalPoints
        };
        pointCategories = normalizePointCategories(pointsEntry?.pointCategories, Object.keys(originalPoints));
        pointCategoryDefaultVisibility = normalizePointCategoryDefaults(pointsEntry?.pointCategoryDefaults, Array.from(getPointCategoryNamesForCurrentPoints()));
        applyDefaultPointCategoryVisibility();

        categories = data.filter(entry => !entry.type || entry.name);

        if (preservedPlayerState) {
            restorePlayerState(preservedPlayerState);
        }
        normalizeEnabledPointTypeSelections();

        // Handle backpack feature
        const backpackEntry = data.find(entry => entry.type === "backpack");
        backpackEnabled = backpackEntry ? backpackEntry.enabled !== false : false;
        const backpackBtn = document.getElementById("backpackBtn");
        if (backpackBtn) {
            backpackBtn.style.display = backpackEnabled ? "inline-block" : "none";
        }

        renderAccordion();
        applyDynamicCosts();
        if (preservedPlayerState) {
            points = { ...(preservedPlayerState.points || {}) };
        }
        updatePointsDisplay();

        if (notifyParent && window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: "cyoa-data-update-result",
                success: true
            }, "*");
        }

        return true;
    } catch (error) {
        console.error("Failed to apply CYOA data:", error);
        if (!silent) {
            alert("Failed to load CYOA data: " + error.message);
        }
        if (notifyParent && window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: "cyoa-data-update-result",
                success: false,
                error: error?.message || String(error)
            }, "*");
        }
        return false;
    }
}


// Load and parse the input configuration
async function loadConfiguration() {
    const urlParams = new URLSearchParams(window.location.search);
    const selectedCyoa = urlParams.get('cyoa');

    if (selectedCyoa) {
        setLoadingOverlayVisible(true);
        updateLoadingOverlay(5, "Loading CYOA configuration...");
        let loadedSuccessfully = false;
        try {
            const res = await fetch(`CYOAs/${selectedCyoa}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            updateLoadingOverlay(20, "Configuration loaded. Preparing assets...");
            await preloadCyoaAssets(data, {
                onProgress: (pct, message) => {
                    const mapped = 20 + Math.round((pct / 100) * 70);
                    updateLoadingOverlay(mapped, message);
                }
            });
            updateLoadingOverlay(95, "Rendering CYOA interface...");
            if (applyCyoaData(data)) {
                loadedSuccessfully = true;
                updateLoadingOverlay(100, "Ready.");
                setTimeout(() => setLoadingOverlayVisible(false), 150);
                return;
            }
        } catch (err) {
            console.error(`Failed to load CYOA ${selectedCyoa}:`, err);
        } finally {
            if (!loadedSuccessfully) {
                setLoadingOverlayVisible(false);
            }
        }
    }

    // If no CYOA selected or failed to load, show selection modal
    showCyoaSelectionModal();
}

async function fetchCyoaList() {
    try {
        // 1. Try local API first
        const res = await fetch("/api/cyoas");
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {
        // Ignore API errors
    }

    try {
        // 2. Fallback to manifest.json for static sites
        const res = await fetch("CYOAs/manifest.json");
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {
        console.error("Failed to fetch CYOA list:", e);
    }
    return [];
}

async function showCyoaSelectionModal() {
    const modal = document.getElementById("cyoaSelectionModal");
    const listContainer = document.getElementById("cyoaList");
    modal.style.display = "block";

    const cyoas = await fetchCyoaList();
    listContainer.innerHTML = "";

    if (cyoas.length === 0) {
        listContainer.innerHTML = "<p>No CYOAs found in CYOAs/ directory.</p>";
        return;
    }

    cyoas.forEach(cyoa => {
        const item = document.createElement("div");
        item.className = "cyoa-item";
        item.textContent = cyoa.title || cyoa.filename;
        item.onclick = () => {
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('cyoa', cyoa.filename);
            window.location.href = newUrl.toString();
        };
        listContainer.appendChild(item);
    });
}

loadConfiguration().catch(err => {
    console.error("Initialization error:", err);
});

window.addEventListener("message", (event) => {
    if (!event || !event.data || event.data.type !== "cyoa-data-update") return;

    let payload = event.data.payload;
    if (typeof payload === "string") {
        try {
            payload = JSON.parse(payload);
        } catch (parseError) {
            console.error("Failed to parse CYOA payload from message:", parseError);
            if (event.source && typeof event.source.postMessage === "function") {
                event.source.postMessage({
                    type: "cyoa-data-update-result",
                    success: false,
                    error: "Invalid JSON payload"
                }, "*");
            }
            return;
        }
    }

    applyCyoaData(payload, {
        silent: true,
        notifyParent: true
    });
});

window.loadCyoaData = (data, options = {}) => applyCyoaData(data, options);


/**
 * Recursively removes dependent options when a prerequisite is deselected.
 * @param {string} deselectedId - The ID of the option that was deselected.
 */
function removeDependentOptions(deselectedId) {
    for (const cat of categories) {
        forEachCategoryOption(cat, opt => {
            const selectionRequirements = Array.isArray(opt.prerequisitesBySelection) ? opt.prerequisitesBySelection : [];
            const referencesDeselected = prereqReferencesId(opt.prerequisites, deselectedId)
                || selectionRequirements.some(requirement => prereqReferencesId(requirement, deselectedId));
            if (referencesDeselected && selectedOptions[opt.id]) {
                removeSelection(opt, { force: true });
                removeDependentOptions(opt.id); // Recursively remove dependents
            }
        });
    }
}

/**
 * Removes all selected options from categories that no longer meet their requirements.
 * This handles the case where a conditional category becomes inactive.
 */
function removeOptionsFromInactiveCategoriesAndSubcategories() {
    const isRequirementMet = (requirement) => {
        if (typeof requirement === 'string' && /[()!&|\s]/.test(requirement)) {
            try {
                return !!evaluateRequirementExpression(requirement);
            } catch (e) {
                return false;
            }
        }
        return !!selectedOptions[requirement];
    };

    const removeSelectionsInSubtree = (subcat) => {
        walkSubcategoryTree([subcat], node => {
            (node.options || []).forEach(opt => {
                if (selectedOptions[opt.id]) {
                    removeSelection(opt, { force: true });
                }
            });
        });
    };

    const enforceSubcategoryRequirements = (subcat) => {
        const subcatRequires = subcat.requiresOption;
        const subcatRequiredItems = Array.isArray(subcatRequires) ? subcatRequires : subcatRequires ? [subcatRequires] : [];
        const subcategoryUnlocked = subcatRequiredItems.every(isRequirementMet);
        if (!subcategoryUnlocked) {
            removeSelectionsInSubtree(subcat);
            return;
        }
        (subcat.subcategories || []).forEach(child => enforceSubcategoryRequirements(child));
    };

    for (const cat of categories) {
        // Check if category-level requirements are met
        const requires = cat.requiresOption;
        const requiredItems = Array.isArray(requires) ? requires : requires ? [requires] : [];
        const categoryUnlocked = requiredItems.every(isRequirementMet);

        // If category is locked, remove all selected options from it
        if (!categoryUnlocked) {
            forEachCategoryOption(cat, opt => {
                if (selectedOptions[opt.id]) {
                    removeSelection(opt, { force: true });
                }
            });
        } else {
            (cat.subcategories || []).forEach(subcat => enforceSubcategoryRequirements(subcat));
        }
    }
}

function isOptionSelectionLocked(option) {
    return option?.lockSelection === true || option?.cannotDeselect === true;
}

function normalizeRandomTables(option) {
    const tables = Array.isArray(option?.randomTables) ? option.randomTables : [];
    return tables
        .map(table => ({
            label: String(table?.label || "Roll").trim() || "Roll",
            die: Math.max(1, Math.floor(Number(table?.die) || 100)),
            outcomes: Array.isArray(table?.outcomes) ? table.outcomes
                .map(outcome => ({
                    min: Math.floor(Number(outcome?.min)),
                    max: Math.floor(Number(outcome?.max)),
                    label: String(outcome?.label || "").trim(),
                    table: outcome?.table && typeof outcome.table === "object" ? outcome.table : null
                }))
                .filter(outcome => Number.isFinite(outcome.min) && Number.isFinite(outcome.max) && outcome.min <= outcome.max && outcome.label)
                : []
        }))
        .filter(table => table.outcomes.length > 0);
}

function rollDie(sides) {
    const die = Math.max(1, Math.floor(Number(sides) || 1));
    return Math.floor(Math.random() * die) + 1;
}

function rollRandomTable(table) {
    const normalizedTable = {
        label: String(table?.label || "Roll").trim() || "Roll",
        die: Math.max(1, Math.floor(Number(table?.die) || 100)),
        outcomes: Array.isArray(table?.outcomes) ? table.outcomes : []
    };
    const roll = rollDie(normalizedTable.die);
    const outcome = normalizedTable.outcomes.find(entry => {
        const min = Math.floor(Number(entry?.min));
        const max = Math.floor(Number(entry?.max));
        return Number.isFinite(min) && Number.isFinite(max) && roll >= min && roll <= max;
    }) || null;
    const result = {
        table: normalizedTable.label,
        die: normalizedTable.die,
        roll,
        outcome: outcome?.label || "No matching outcome"
    };
    if (outcome?.table && typeof outcome.table === "object") {
        result.subroll = rollRandomTable(outcome.table);
    }
    return result;
}

function rollOptionRandomTables(option) {
    const tables = normalizeRandomTables(option);
    if (!tables.length || !option?.id) return;
    if (!Array.isArray(randomRollResults[option.id])) randomRollResults[option.id] = [];
    randomRollResults[option.id].push({
        selection: selectedOptions[option.id] || 1,
        results: tables.map(rollRandomTable)
    });
}

function formatRandomRollResult(result) {
    if (!result || typeof result !== "object") return "";
    let line = `${escapeHtml(result.table || "Roll")}: d${escapeHtml(String(result.die || ""))} = ${escapeHtml(String(result.roll || ""))} -> ${escapeHtml(result.outcome || "")}`;
    if (result.subroll) {
        line += `; ${formatRandomRollResult(result.subroll)}`;
    }
    return line;
}

function getRandomRollDisplayRows(option) {
    const entries = Array.isArray(randomRollResults[option?.id]) ? randomRollResults[option.id] : [];
    return entries.map((entry, index) => {
        const selection = Number(entry?.selection) || index + 1;
        const results = Array.isArray(entry?.results) ? entry.results : [];
        const text = results.map(formatRandomRollResult).filter(Boolean).join(" | ");
        return `Roll ${selection}: ${text || "No result"}`;
    });
}


/**
 * Removes an option from selectedOptions and refunds its cost.
 * @param {Object} option - The option object to remove.
 */
function removeSelection(option, options = {}) {
    const scrollY = window.scrollY; // Preserve scroll position

    const count = typeof selectedOptions[option.id] === 'number' ? selectedOptions[option.id] : 1;
    if (!selectedOptions[option.id]) return; // Option not selected
    if (!options.force && isAutoGrantedLocked(option.id)) return;
    if (!options.force && isOptionSelectionLocked(option)) return;
    restoreActiveSliderModifierPointValues();

    if (!removeSelectionsAffectedByCostModifierChange(option, count - 1, options)) {
        applyDynamicCosts();
        return false;
    }

    // Update selection history
    const historyIndex = selectionHistory.indexOf(option.id);
    if (historyIndex !== -1) {
        selectionHistory.splice(historyIndex, 1);
    }

    // Generalized dynamic cost refund for any option with dynamicCost (e.g., attribute cap/boost)
    if (option.dynamicCost && option.dynamicCost.types && option.dynamicCost.values && dynamicSelections[option.id]) {
        // Create a copy to iterate, as dynamicSelections[option.id] might be modified
        const currentDynamicSelections = [...dynamicSelections[option.id]];
        currentDynamicSelections.forEach((choice, i) => {
            if (!choice) return; // Skip if no choice was made for this slot

            const value = option.dynamicCost.values[i];
            const type = option.dynamicCost.types[i];

            if (type === "Cap Attribute") {
                // Revert the cap for the chosen attribute back to its original default max
                const originalDefaultMax = originalAttributeRanges[choice]?.max ?? 40; // Use originalAttributeRanges
                if (attributeRanges[choice]) {
                    attributeRanges[choice].max = originalDefaultMax;
                }
            } else if (type === "Boost Attribute") {
                // When a boost is removed, we need to subtract the boost amount.
                // However, we must ensure the attribute doesn't go below its natural minimum.
                const boostAmount = parseInt(value);
                if (attributeSliderValues.hasOwnProperty(choice)) {
                    attributeSliderValues[choice] -= boostAmount;
                    const min = originalAttributeRanges[choice]?.min ?? 0; // Use original min for natural floor
                    if (attributeSliderValues[choice] < min) {
                        attributeSliderValues[choice] = min;
                    }
                }
            }
        });
        // Clear all dynamic selections for this option
        delete dynamicSelections[option.id];
        // Remove any dynamic point types added by Formula Cost if not in originalPoints
        option.dynamicCost.types.forEach((type, i) => {
            if (type === "Formula Cost") {
                const pointType = option.dynamicCost.choices[i];
                if (!originalPoints.hasOwnProperty(pointType)) {
                    delete points[pointType];
                }
            }
        });
    }


    // Refund the exact cost paid for this selection instance.
    const refundCost = (discountedSelections[option.id]?.pop()) ?? getOptionBaseCost(option);
    if (selectedCostOptionHistory[option.id]) {
        selectedCostOptionHistory[option.id].pop();
        if (selectedCostOptionHistory[option.id].length === 0) delete selectedCostOptionHistory[option.id];
    }
    Object.entries(refundCost).forEach(([type, cost]) => {
        points[type] += cost;
    });

    if (getOptionMaxSelections(option) > 1 && count > 1) {
        selectedOptions[option.id] = count - 1;
        if (Array.isArray(sliderModifierSelections[option.id])) {
            const rows = getSliderModifierSelectionRows(option.id);
            rows.splice(count - 1, 1);
            setSliderModifierSelectionRows(option.id, rows);
        }
        if (Array.isArray(randomRollResults[option.id])) {
            randomRollResults[option.id].pop();
            if (randomRollResults[option.id].length === 0) delete randomRollResults[option.id];
        }
    } else {
        delete selectedOptions[option.id];
        delete discountedSelections[option.id]; // Clear all recorded discounts for this option
        delete autoGrantedSelections[option.id];
        delete randomRollResults[option.id];
        if (option.inputType === "text") {
            delete storyInputs[option.id];
        }
        if (option.pointAllocation) {
            delete pointAllocationSelections[option.id];
        }
        if (option.sliderModifiers || option.attributeEffects) {
            delete sliderModifierSelections[option.id];
        }
        delete selectedCostOptionHistory[option.id];
        removeAutoGrantsFromSource(option.id, {
            skipRender: true,
            force: true
        });
        removeDependentOptions(option.id); // Remove any options that depended on this one
    }

    removeOptionsFromInactiveCategoriesAndSubcategories(); // Clear options from categories that no longer meet requirements
    applyDynamicCosts(); // Re-evaluate formulas to reflect changes
    updatePointsDisplay();
    if (!options.skipRender) {
        renderAccordion(); // Re-render to update UI elements (sliders, etc.)
        window.scrollTo(0, scrollY); // Restore scroll position
    }
    return true;
}

/**
 * Evaluates dynamic cost effects like attribute capping and boosting.
 */
function applyDynamicCosts() {
    restoreActiveSliderModifierPointValues();
    // IMPORTANT: Reset attribute ranges to their original defaults first
    // This ensures that previous dynamic caps are removed before new ones are applied.
    attributeRanges = JSON.parse(JSON.stringify(originalAttributeRanges));
    resetSliderAttributePointValues();

    // --- Reset all dynamic resistance/weakness points to their original values before applying new effects ---
    // Find all point types affected by dynamicCost (e.g., Fire, Frost, etc.)
    const dynamicPointTypes = new Set();
    Object.entries(dynamicSelections).forEach(([optionId, selectedChoices]) => {
        const opt = findOptionById(optionId);
        const config = opt?.dynamicCost;
        if (!config || config.target !== "points") return;
        config.choices.forEach(choice => {
            if (originalPoints.hasOwnProperty(choice)) {
                dynamicPointTypes.add(choice);
            }
        });
    });
    // Reset these points to their original values
    dynamicPointTypes.forEach(type => {
        points[type] = originalPoints[type];
    });

    // Then, apply dynamic selections (like Nephilim's boosts/caps)
    // These modifications should happen *after* base formula evaluation but before final display.
    Object.entries(dynamicSelections).forEach(([optionId, selectedChoices]) => {
        const opt = findOptionById(optionId);
        const config = opt?.dynamicCost;
        if (!config) return;

        const isAttributeTarget = config.target === "attributes";
        const isPointTarget = config.target === "points";

        selectedChoices.forEach((choiceName, i) => {
            if (!choiceName) return; // Skip if no choice is made for this slot

            const value = config.values[i];
            const type = config.types[i];

            // Handle Cap Attribute
            if (type === "Cap Attribute") {
                // Support both static and relative caps
                let cap;
                if (typeof value === "string" && value.startsWith("cap:")) {
                    const capVal = value.slice(4);
                    if (capVal.startsWith("-")) {
                        // Relative reduction: lower the current cap by this amount
                        const reduction = parseInt(capVal);
                        const currentMax = attributeRanges[choiceName]?.max ?? originalAttributeRanges[choiceName]?.max ?? 40;
                        cap = currentMax + reduction;
                    } else {
                        // Static cap
                        cap = parseInt(capVal);
                    }
                } else if (typeof value === "number" && value < 0) {
                    // Relative reduction: lower the current cap by this amount
                    const currentMax = attributeRanges[choiceName]?.max ?? originalAttributeRanges[choiceName]?.max ?? 40;
                    cap = currentMax + value;
                } else {
                    // Static cap
                    cap = parseInt(value);
                }
                if (!attributeRanges[choiceName]) attributeRanges[choiceName] = {};
                attributeRanges[choiceName].max = cap;
                if ((attributeSliderValues[choiceName] ?? 0) > cap) {
                    attributeSliderValues[choiceName] = cap;
                }
            }
            // Handle Boost Attribute
            else if (type === "Boost Attribute" && isAttributeTarget) {
                const boostAmount = parseInt(value);
                if (isNaN(boostAmount)) return;
                if (!attributeSliderValues.hasOwnProperty(choiceName)) {
                    attributeSliderValues[choiceName] = 0;
                }
                if (attributeSliderValues[choiceName] < boostAmount) {
                    attributeSliderValues[choiceName] = boostAmount;
                }
            }
            // Handle Resistance/Weakness for points
            else if (isPointTarget && (type === "Resistance" || type === "Weakness")) {
                if (!points.hasOwnProperty(choiceName)) {
                    points[choiceName] = 0;
                }
                points[choiceName] += parseInt(value);
            }
            // Handle Multiply Attribute
            else if (type === "Multiply Attribute" && isAttributeTarget) {
                const multiplier = parseFloat(value);
                if (isNaN(multiplier)) return;
                // Find the slider value for the attribute (if present)
                // The attributeSliderValues key is usually the lowercased attribute name + 'Attribute'
                // We'll try both the slider and points object
                let baseValue = 0;
                // Try to find the slider key for this attribute
                const sliderKey = Object.keys(attributeSliderValues).find(k => k.toLowerCase().includes(choiceName.toLowerCase()));
                if (sliderKey && attributeSliderValues.hasOwnProperty(sliderKey)) {
                    baseValue = attributeSliderValues[sliderKey];
                } else if (points.hasOwnProperty(choiceName)) {
                    baseValue = points[choiceName];
                }
                // Set the points value to the multiplied value
                points[choiceName] = baseValue * multiplier;
            }
            // Handle Formula Cost for dynamic points (e.g., COIDL)
            else if (isPointTarget && type === "Formula Cost") {
                try {
                    // If the point type doesn't exist, add it
                    if (!points.hasOwnProperty(choiceName)) {
                        points[choiceName] = 0;
                    }
                    // Evaluate the formula in the context of points
                    const evalFunc = new Function("points", `return ${value}`);
                    const result = evalFunc(points);
                    // Add to the current value instead of setting
                    points[choiceName] += result;
                } catch (err) {
                    console.warn(`Failed to evaluate dynamic formula for ${choiceName}:`, err);
                }
            }
        });
    });

    applySelectedSliderModifiers();
}


/**
 * Adds an option to selectedOptions and deducts its cost.
 * Handles maxSelections, subcategory limits, and discounts.
 * @param {Object} option - The option object to add.
 */
function addSelection(option, options = {}) {
    const scrollY = window.scrollY; // Preserve scroll position
    const current = selectedOptions[option.id] || 0;
    const isAutoGrant = !!options.autoGrantSourceId;
    restoreActiveSliderModifierPointValues();

    if (!isAutoGrant) {
        if (!removeSelectionsAffectedByCostModifierChange(option, current + 1, options)) {
            applyDynamicCosts();
            return false;
        }
    }

    const subcat = findSubcategoryOfOption(option.id);
    const subcatOptions = subcat?.options || [];
    const subcatCount = subcatOptions.reduce((sum, o) => sum + (selectedOptions[o.id] || 0), 0);

    // Determine if this selection is discounted
    let discounted = false;
    if (subcat) {
        if (typeof subcat.discountStartsAfter === 'number') {
            discounted = subcatCount >= subcat.discountStartsAfter;
        } else if (typeof subcat.discountFirstN === 'number') {
            discounted = subcatCount < subcat.discountFirstN;
        } else if (subcat.discountFirstN) { // Fallback for truthy non-number values
            discounted = subcatCount < subcat.discountFirstN;
        }
    }

    const actualCost = {};
    if (!isAutoGrant) {
        const effectiveCost = getOptionEffectiveCost(option, {
            includeFirstNPreview: false,
            costOptionIndex: options.costOptionIndex ?? getSelectedCostOptionIndex(option, current + 1),
            selectionNumber: current + 1
        });
        Object.entries(effectiveCost).forEach(([type, cost]) => {
            let finalCost;
            if (cost < 0) { // If cost is negative (a gain), it's never discounted
                finalCost = cost;
                points[type] -= cost; // Direct addition for gains
            } else {
                const discount = discounted ? (subcat?.discountAmount?.[type] || 0) : 0;
                finalCost = Math.max(0, cost - discount);
                points[type] -= finalCost;
            }
            actualCost[type] = finalCost;
        });
    }

    if (!discountedSelections[option.id]) {
        discountedSelections[option.id] = [];
    }
    discountedSelections[option.id].push(actualCost); // Store the actual cost paid for this instance
    if (!isAutoGrant) {
        const selectedCostOptionIndex = options.costOptionIndex ?? getSelectedCostOptionIndex(option, current + 1);
        if (selectedCostOptionIndex !== null && selectedCostOptionIndex !== undefined) {
            if (!selectedCostOptionHistory[option.id]) selectedCostOptionHistory[option.id] = [];
            selectedCostOptionHistory[option.id].push(Number(selectedCostOptionIndex));
        }
    }

    selectedOptions[option.id] = current + 1;
    selectionHistory.push(option.id);
    if (!isAutoGrant) {
        rollOptionRandomTables(option);
    }
    if (isAutoGrant) {
        autoGrantedSelections[option.id] = {
            sourceId: options.autoGrantSourceId,
            canDeselect: options.grantCanDeselect === true
        };
    }

    removeOptionsFromInactiveCategoriesAndSubcategories(); // Clear options from categories that no longer meet requirements
    applyAutoGrants(option, options.visited || new Set());
    removeOptionsWithUnmetPrerequisites();
    applyDynamicCosts();
    updatePointsDisplay();
    if (!options.skipRender) {
        renderAccordion();
        window.scrollTo(0, scrollY); // Restore scroll position
    }
    return true;
}

/**
 * Updates the displayed point values in the points tracker.
 */
function updatePointsDisplay() {
    const display = document.getElementById("pointsDisplay");
    const tracker = document.getElementById("pointsTracker");
    if (!display) return;

    tracker?.querySelector(".point-category-toggles")?.remove();
    tracker?.querySelector(".point-enablement-controls")?.remove();
    normalizeEnabledPointTypeSelections();
    const categoryNames = Array.from(new Set(Object.keys(points).map(type => getPointCategoryForType(type))));
    if (tracker && categoryNames.length > 1) {
        const toggleWrap = document.createElement("div");
        toggleWrap.className = "point-category-toggles";
        toggleWrap.setAttribute("aria-label", "Point category filters");
        categoryNames.forEach(category => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "point-category-toggle";
            const isVisible = visiblePointCategories.has(category);
            button.setAttribute("aria-pressed", String(isVisible));
            button.textContent = category;
            button.addEventListener("click", () => {
                if (visiblePointCategories.has(category)) {
                    visiblePointCategories.delete(category);
                } else {
                    visiblePointCategories.add(category);
                }
                updatePointsDisplay();
            });
            toggleWrap.appendChild(button);
        });
        tracker.insertBefore(toggleWrap, display);
    }

    const visibleEntries = getVisiblePointEntries();
    display.innerHTML = "";
    if (visibleEntries.length) {
        visibleEntries.forEach(([type, val]) => {
            const entry = document.createElement("span");
            const label = document.createElement("strong");
            label.innerHTML = `${getPointTypeMarkup(type)}:`;
            entry.append(label, document.createTextNode(` ${String(val)}`));
            const tooltip = pointTooltips[type] || "";
            if (tooltip) {
                entry.title = tooltip;
                entry.dataset.tooltip = tooltip;
            }
            display.appendChild(entry);
        });
    } else {
        display.innerHTML = `<span class="points-empty-state">No point categories selected</span>`;
    }

    if (tracker && pointEnablementSets.length) {
        const enableWrap = document.createElement("div");
        enableWrap.className = "point-enablement-controls";
        const tabsWrap = document.createElement("div");
        tabsWrap.className = "point-enablement-tabs";
        const panelsWrap = document.createElement("div");
        panelsWrap.className = "point-enablement-panels";
        pointEnablementSets.forEach((set, index) => {
            const key = getPointEnablementSetKey(set);
            const selected = enabledPointTypeSelections[key] || [];
            const limit = getPointEnablementLimit(set);
            const expanded = openPointEnablementGroups.has(key);

            const label = document.createElement("button");
            label.type = "button";
            label.className = "point-category-toggle point-enablement-label";
            label.setAttribute("aria-expanded", String(expanded));
            label.setAttribute("aria-pressed", String(expanded));
            const panelId = `point-enablement-${index}`;
            label.setAttribute("aria-controls", panelId);
            label.textContent = `${set.pointType}: ${selected.length}/${limit}`;
            label.addEventListener("click", () => {
                if (openPointEnablementGroups.has(key)) openPointEnablementGroups.delete(key);
                else openPointEnablementGroups.add(key);
                updatePointsDisplay();
            });
            tabsWrap.appendChild(label);

            const buttons = document.createElement("div");
            buttons.id = panelId;
            buttons.className = "point-enablement-buttons";
            buttons.classList.toggle("is-open", expanded);
            set.subtypes.forEach(type => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "point-enablement-toggle";
                const enabled = selected.includes(type);
                button.setAttribute("aria-pressed", String(enabled));
                button.textContent = type;
                const tooltip = pointTooltips[type] || "";
                if (tooltip) {
                    button.title = tooltip;
                    button.setAttribute("aria-label", `${type}: ${tooltip}`);
                    button.dataset.tooltip = tooltip;
                }
                button.disabled = !enabled && selected.length >= limit;
                button.addEventListener("click", () => {
                    const current = enabledPointTypeSelections[key] || [];
                    if (current.includes(type)) {
                        enabledPointTypeSelections[key] = current.filter(entry => entry !== type);
                    } else if (current.length < getPointEnablementLimit(set)) {
                        enabledPointTypeSelections[key] = [...current, type];
                    }
                    updatePointsDisplay();
                    renderAccordion();
                });
                buttons.appendChild(button);
            });
            if (expanded) {
                const panel = document.createElement("div");
                panel.className = "point-enablement-panel";
                panel.appendChild(buttons);
                panelsWrap.appendChild(panel);
            }
        });
        enableWrap.appendChild(tabsWrap);
        if (panelsWrap.children.length) enableWrap.appendChild(panelsWrap);
        display.insertAdjacentElement("afterend", enableWrap);
    }
    syncPointsTrackerHeight();
}

/**
 * Checks if an option can be selected based on its prerequisites, costs, and conflicts.
 * @param {Object} option - The option object to check.
 * @returns {boolean} True if the option can be selected, false otherwise.
 */
function canSelect(option, { costOptionIndex = null } = {}) {
    const currentOptionCount = selectedOptions[option.id] || 0;
    const meetsPrereq = optionPrerequisitesMet(option, currentOptionCount + 1);

    // Check outgoing conflicts (option conflicts with an already selected option)
    const hasNoOutgoingConflicts = !option.conflictsWith || option.conflictsWith.every(id => !selectedOptions[id]);

    // Check incoming conflicts (an already selected option conflicts with this option)
    const hasNoIncomingConflicts = Object.keys(selectedOptions).every(id => {
        const selected = findOptionById(id);
        return !selected?.conflictsWith || !selected.conflictsWith.includes(option.id);
    });

    // Check subcategory limits
    const subcat = findSubcategoryOfOption(option.id);
    const subcatOptions = subcat?.options || [];
    const subcatCount = getSubcategorySelectionCount(subcat, option.id);
    const subcatMax = subcat?.maxSelections || Infinity; // Default to no limit
    // Allow selecting even if at limit, provided there IS a limit (so we can auto-unselect)
    const underSubcatLimit = (subcatCount <= subcatMax) || (subcatMax !== Infinity && hasRemovableSelectionInSubcategory(subcat));

    // Check option-specific max selections
    const maxPerOption = getOptionMaxSelections(option);
    const underOptionLimit = currentOptionCount < maxPerOption;
    const categoryMaxSelections = getCategorySelectionLimit(option.id);
    const categorySelectionCount = getCategorySelectionCount(option.id);
    const underCategoryLimit = categorySelectionCount < categoryMaxSelections;

    // Check if enough points (only for positive costs)
    const nextSelectionNumber = currentOptionCount + 1;
    const availableCostOptions = normalizeOptionCostOptions(option, { selectionNumber: nextSelectionNumber });
    const info = findSubcategoryInfo(option.id);
    const hasDirectOptionCost = option?.cost && typeof option.cost === "object" && Object.keys(option.cost).length > 0;
    const hasConfiguredCostOptions = (Array.isArray(option.costOptions) && option.costOptions.length > 0)
        || (!hasDirectOptionCost && Array.isArray(info.subcat?.costOptions) && info.subcat.costOptions.length > 0);
    const selectedCostOptionIndex = costOptionIndex ?? getInitialCostOptionIndex(option, nextSelectionNumber);
    const selectedCostOption = selectedCostOptionIndex === null || selectedCostOptionIndex === undefined
        ? availableCostOptions[0]
        : availableCostOptions.find(choice => choice.index === Number(selectedCostOptionIndex));
    const hasAvailableCostOption = !hasConfiguredCostOptions || !!selectedCostOption;
    const costChoices = getOptionEffectiveCostChoices(option, {
        costOptionIndex: selectedCostOption?.index ?? selectedCostOptionIndex,
        selectionNumber: nextSelectionNumber
    });
    const selectedChoice = costChoices.find(choice => choice.index === selectedCostOption?.index) || costChoices[0];
    const hasPoints = availableCostOptions.length
        ? canAffordCost(selectedChoice?.cost || {})
        : canAffordCost(getOptionEffectiveCost(option, { selectionNumber: nextSelectionNumber }));

    return meetsPrereq && hasAvailableCostOption && hasPoints && hasNoOutgoingConflicts && hasNoIncomingConflicts && underOptionLimit && underSubcatLimit && underCategoryLimit;
}

function requirementMet(requirement) {
    if (!requirement) return true;
    if (typeof requirement === 'string') {
        try {
            return !!evaluateRequirementExpression(requirement);
        } catch (e) {
            console.error('Invalid prerequisite expression:', requirement, e);
            return false;
        }
    }
    if (Array.isArray(requirement)) {
        return requirement.every(id => meetsCountRequirement(id));
    }
    if (typeof requirement === 'object') {
        const andList = requirement.and || [];
        const orList = requirement.or || [];
        const notList = requirement.not ? [requirement.not] : [];
        const andMet = andList.every(id => meetsCountRequirement(id));
        const orMet = orList.length === 0 || orList.some(id => meetsCountRequirement(id));
        const notMet = notList.every(id => !meetsCountRequirement(id));
        return andMet && orMet && notMet;
    }
    return true;
}

function getPointRequirementValue(pointType) {
    if (!isPointTypeEnabled(pointType)) return 0;
    if (Object.prototype.hasOwnProperty.call(points, pointType)) return Number(points[pointType]) || 0;
    return Number(originalPoints?.[pointType]) || 0;
}

function categoryHasSelectedOption(category) {
    if (!category) return false;
    let found = (category.options || []).some(option => (selectedOptions[option.id] || 0) > 0);
    if (found) return true;
    walkSubcategoryTree(category.subcategories || [], subcat => {
        if (found) return;
        found = (subcat.options || []).some(option => (selectedOptions[option.id] || 0) > 0);
    });
    return found;
}

function subcategoryHasSelectedOption(subcat) {
    if (!subcat) return false;
    if ((subcat.options || []).some(option => (selectedOptions[option.id] || 0) > 0)) return true;
    let found = false;
    walkSubcategoryTree(subcat.subcategories || [], child => {
        if (found) return;
        found = (child.options || []).some(option => (selectedOptions[option.id] || 0) > 0);
    });
    return found;
}

function getSubcategoryPathLabel(category, path = []) {
    return [category?.name, ...path.map(part => part.name)].filter(Boolean).join(" > ");
}

function findCategoryByRequirementName(name) {
    const target = String(name || "").trim();
    return categories.find((category, index) =>
        category?.name === target || buildCategoryKey(index, category?.name) === target
    ) || null;
}

function findSubcategoryByRequirementName(name) {
    const target = String(name || "").trim();
    let found = null;
    categories.some((category, categoryIndex) => {
        return walkSubcategoryTree(category.subcategories || [], (subcat, path) => {
            if (found) return;
            const pathLabel = getSubcategoryPathLabel(category, path);
            const key = buildSubcategoryKey(categoryIndex, category?.name, null, null, path);
            if (subcat?.name === target || pathLabel === target || key === target) found = subcat;
        }), !!found;
    });
    return found;
}

function scopeRequirementMet(scopeType, scopeName) {
    if (scopeType === "category") return categoryHasSelectedOption(findCategoryByRequirementName(scopeName));
    if (scopeType === "subcategory") return subcategoryHasSelectedOption(findSubcategoryByRequirementName(scopeName));
    return false;
}

function evaluateRequirementExpression(expression) {
    return window.evaluatePrereqExpr(
        expression,
        id => selectedOptions[id] || 0,
        pointType => getPointRequirementValue(pointType),
        (scopeType, scopeName) => scopeRequirementMet(scopeType, scopeName)
    );
}

function optionPrerequisitesMet(option, selectionNumber = null) {
    if (!option) return true;
    if (!requirementMet(option.prerequisites)) return false;
    const nextSelectionNumber = Number(selectionNumber) || (selectedOptions[option.id] || 0);
    const selectionRequirements = Array.isArray(option.prerequisitesBySelection) ? option.prerequisitesBySelection : [];
    for (let index = 0; index < nextSelectionNumber; index += 1) {
        if (!requirementMet(selectionRequirements[index])) return false;
    }
    return true;
}

function removeOptionsWithUnmetPrerequisites() {
    let removedAny = true;
    while (removedAny) {
        removedAny = false;
        for (const cat of categories) {
            forEachCategoryOption(cat, opt => {
                if (!removedAny && selectedOptions[opt.id] && (!optionPrerequisitesMet(opt) || !selectedCostOptionsStillValid(opt))) {
                    removeSelection(opt, {
                        force: true,
                        skipRender: true
                    });
                    removedAny = true;
                }
            });
            if (removedAny) break;
        }
    }
}


/**
 * Finds the subcategory object that contains a given option.
 * @param {string} optionId - The ID of the option to find.
 * @returns {Object|null} The subcategory object, or null if not found.
 */
function findSubcategoryOfOption(optionId) {
    for (const cat of categories) {
        // If options are directly in the category (no subcategories defined)
        if (cat.options && cat.options.some(opt => opt.id === optionId)) {
            return {
                options: cat.options,
                name: cat.name,
                discountFirstN: cat.discountFirstN,
                discountStartsAfter: cat.discountStartsAfter,
                discountAmount: cat.discountAmount,
                maxSelections: cat.maxSelections
            }; // Return a mock subcategory object
        }
        let foundSubcategory = null;
        walkSubcategoryTree(cat.subcategories || [], subcat => {
            if (foundSubcategory) return;
            if ((subcat.options || []).some(opt => opt.id === optionId)) {
                foundSubcategory = subcat;
            }
        });
        if (foundSubcategory) return foundSubcategory;
    }
    return null;
}

function getOptionCountForSubcategoryLimit(option, rawCount) {
    const count = Number(rawCount) || 0;
    if (count <= 0) return 0;
    if (option?.bypassSubcategoryMaxSelections === true) return 0;
    if (option?.countsAsOneSelection === true) return 1;
    return count;
}

function getSubcategorySelectionCount(subcat, optionIdToIncrement = null) {
    const subcatOptions = subcat?.options || [];
    let total = 0;
    subcatOptions.forEach(opt => {
        const current = selectedOptions[opt.id] || 0;
        const adjustedCount = optionIdToIncrement && opt.id === optionIdToIncrement ? current + 1 : current;
        total += getOptionCountForSubcategoryLimit(opt, adjustedCount);
    });
    return total;
}

function hasRemovableSelectionInSubcategory(subcat) {
    const subcatOptionIds = new Set((subcat?.options || []).map(opt => opt.id));
    return selectionHistory.some(id => subcatOptionIds.has(id) && selectedOptions[id] > 0 && !isAutoGrantedLocked(id));
}

function getCategorySelectionCount(optionId) {
    const info = findSubcategoryInfo(optionId);
    const cat = info?.cat;
    if (!cat) return 0;

    let total = 0;
    (cat.options || []).forEach(opt => {
        total += selectedOptions[opt.id] || 0;
    });
    walkSubcategoryTree(cat.subcategories || [], subcat => {
        (subcat.options || []).forEach(opt => {
            total += selectedOptions[opt.id] || 0;
        });
    });
    return total;
}

function getCategorySelectionLimit(optionId) {
    const info = findSubcategoryInfo(optionId);
    const categoryLimit = Number(info?.cat?.maxSelections);
    if (Number.isFinite(categoryLimit) && categoryLimit > 0) {
        return Math.floor(categoryLimit);
    }
    if (info?.cat?.singleSelectionOnly === true) {
        return 1;
    }
    return Infinity;
}


/**
 * Finds an option object by its ID across all categories.
 * @param {string} id - The ID of the option to find.
 * @returns {Object|null} The option object, or null if not found.
 */
function findOptionById(id) {
    for (const cat of categories) {
        // Check options directly within the category
        for (const opt of cat.options || []) {
            if (opt.id === id) return opt;
        }
        // Check options recursively within subcategories
        let found = null;
        walkSubcategoryTree(cat.subcategories || [], subcat => {
            if (found) return;
            for (const opt of subcat.options || []) {
                if (opt.id === id) {
                    found = opt;
                    return;
                }
            }
        });
        if (found) return found;
    }
    return null;
}

function normalizeAutoGrantRules(option) {
    const rules = Array.isArray(option?.autoGrants) ? option.autoGrants : [];
    return rules
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
        .filter(rule => rule && rule.id);
}

function getAutoGrantDisplayRows(option) {
    return normalizeAutoGrantRules(option).map(rule => ({
        id: rule.id,
        label: getOptionLabelMarkup(rule.id) || rule.id,
        selected: !!selectedOptions[rule.id],
        canDeselect: rule.canDeselect === true
    }));
}

function isAutoGrantedLocked(optionId) {
    const grant = autoGrantedSelections[optionId];
    return !!grant && grant.canDeselect !== true;
}

function removeAutoGrantsFromSource(sourceId, options = {}) {
    Object.entries(autoGrantedSelections).forEach(([targetId, grant]) => {
        if (grant?.sourceId !== sourceId) return;
        const target = findOptionById(targetId);
        if (target && selectedOptions[targetId]) {
            removeSelection(target, {
                ...options,
                force: true
            });
        } else {
            delete autoGrantedSelections[targetId];
        }
    });
}

function applyAutoGrants(option, visited = new Set()) {
    if (!option?.id || visited.has(option.id)) return;
    visited.add(option.id);

    normalizeAutoGrantRules(option).forEach(rule => {
        if (visited.has(rule.id) || selectedOptions[rule.id]) return;
        const grantedOption = findOptionById(rule.id);
        if (!grantedOption) {
            console.warn(`Auto-grant target not found: ${rule.id}`);
            return;
        }

        ensureSubcategoryLimit(grantedOption);
        addSelection(grantedOption, {
            autoGrantSourceId: option.id,
            grantCanDeselect: rule.canDeselect,
            skipRender: true,
            visited
        });
    });
}

/**
 * Ensures a subcategory's selection limit is not exceeded by auto-removing the oldest selection.
 * @param {Object} option - The option being selected.
 */
function ensureSubcategoryLimit(option) {
    const subcat = findSubcategoryOfOption(option.id);
    if (!subcat || subcat.maxSelections === Infinity) return;

    const subcatOptions = subcat.options || [];
    let subcatCount = getSubcategorySelectionCount(subcat, option.id);
    const subcatMax = subcat.maxSelections;
    const subcatOptionIds = new Set(subcatOptions.map(o => o.id));

    while (subcatCount > subcatMax) {
        let removed = false;

        // Prefer removing an instance that immediately reduces subcategory usage.
        for (let i = 0; i < selectionHistory.length; i++) {
            const id = selectionHistory[i];
            if (!subcatOptionIds.has(id)) continue;
            if (isAutoGrantedLocked(id)) continue;

            const oldestOption = findOptionById(id);
            const currentCount = selectedOptions[id] || 0;
            if (!oldestOption || currentCount <= 0) continue;

            const before = getOptionCountForSubcategoryLimit(oldestOption, currentCount);
            const after = getOptionCountForSubcategoryLimit(oldestOption, currentCount - 1);
            if (after >= before) continue;

            removeSelection(oldestOption);
            removed = true;
            break;
        }

        // Fallback: remove oldest in subcategory even if this step doesn't immediately reduce usage.
        if (!removed) {
            for (let i = 0; i < selectionHistory.length; i++) {
                const id = selectionHistory[i];
                if (!subcatOptionIds.has(id)) continue;
                if (isAutoGrantedLocked(id)) continue;
                const oldestOption = findOptionById(id);
                if (!oldestOption) continue;
                if (oldestOption.bypassSubcategoryMaxSelections === true) continue;
                removeSelection(oldestOption);
                removed = true;
                break;
            }
        }

        if (!removed) {
            break;
        }

        subcatCount = getSubcategorySelectionCount(subcat, option.id);
    }
}

/**
 * Gets the label for a given option ID.
 * @param {string} id - The ID of the option.
 * @returns {string} The label of the option, or the ID if not found.
 */
function getOptionLabel(id) {
    const match = findOptionById(id);
    return match ? match.label : id;
}

function getOptionLabelMarkup(id) {
    return renderFormattedInlineText(getOptionLabel(id) || id);
}

function getOptionLabelPlainText(id) {
    return stripFormattingMarkup(getOptionLabel(id) || id);
}

// Redundant function, can be removed or alias getOptionLabel
function getSubcategoryOptionLabel(id) {
    return getOptionLabel(id);
}

function buildCategoryKey(catIndex, catName) {
    return `${catIndex}-${slugifyKey(catName || `Category${catIndex}`)}`;
}

function slugifyKey(str) {
    return String(str || "").replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '');
}

function buildSubcategoryKey(catIndex, catName, subIndex, subName, subPath = null) {
    const catPart = `${catIndex}-${slugifyKey(catName || `Category${catIndex}`)}`;
    if (Array.isArray(subPath)) {
        if (!subPath.length) return `${catPart}__-1-root`;
        const pathPart = subPath.map(({ index, name }, depth) => {
            const idx = Number.isFinite(index) ? index : depth;
            return `${idx}-${slugifyKey(name || `Sub${idx}`)}`;
        }).join("__");
        return `${catPart}__${pathPart}`;
    }
    const subPart = `${subIndex}-${slugifyKey(subName || `Sub${subIndex}`)}`;
    return `${catPart}__${subPart}`;
}

function findSubcategoryInfo(optionId) {
    for (let c = 0; c < categories.length; c++) {
        const cat = categories[c];
        const directOptions = cat.options || [];
        if (directOptions.some(opt => opt.id === optionId)) {
            return {
                cat,
                subcat: null,
                key: buildSubcategoryKey(c, cat.name, -1, 'root'),
                catKey: buildCategoryKey(c, cat.name)
            };
        }
        let result = null;
        walkSubcategoryTree(cat.subcategories || [], (sub, path) => {
            if (result) return;
            if ((sub.options || []).some(opt => opt.id === optionId)) {
                result = {
                    cat,
                    subcat: sub,
                    key: buildSubcategoryKey(c, cat.name, null, null, path),
                    catKey: buildCategoryKey(c, cat.name)
                };
            }
        });
        if (result) return result;
    }
    return {
        cat: null,
        subcat: null,
        key: null,
        catKey: null
    };
}

function getDiscountMap(store, key) {
    if (!key) return null;
    if (!store[key]) store[key] = {};
    return store[key];
}

function getSubcategoryDiscountMap(key) {
    return getDiscountMap(subcategoryDiscountSelections, key) || {};
}

function getCategoryDiscountMap(key) {
    return getDiscountMap(categoryDiscountSelections, key) || {};
}

function getDiscountTotalCount(map) {
    return Object.values(map || {}).reduce((sum, val) => sum + (Number(val) || 0), 0);
}

function buildOptionGrantKey(providerId, ruleIndex) {
    return `${providerId}::${ruleIndex}`;
}

function buildConditionalGrantKey(targetOptionId, ruleIndex) {
    return `conditional::${targetOptionId}::${ruleIndex}`;
}

function getOptionGrantMap(key) {
    return getDiscountMap(optionGrantDiscountSelections, key) || {};
}

function getGrantTargetIds(rule) {
    if (!rule) return [];
    if (Array.isArray(rule.targetIds)) return rule.targetIds.filter(Boolean);
    if (Array.isArray(rule.targets)) return rule.targets.filter(Boolean);
    if (rule.targetId) return [rule.targetId];
    return [];
}

function getAllOptions() {
    const all = [];
    categories.forEach(cat => {
        forEachCategoryOption(cat, opt => all.push(opt));
    });
    return all;
}

function getOptionById(optionId) {
    return getAllOptions().find(opt => opt.id === optionId) || null;
}

function getDiscountRuleTriggerIds(rule) {
    if (!rule) return [];
    if (Array.isArray(rule.idsAny)) return rule.idsAny.filter(Boolean);
    if (Array.isArray(rule.ids)) return rule.ids.filter(Boolean);
    if (rule.id) return [rule.id];
    return [];
}

function getModifiedCostRules(entity) {
    if (!entity || typeof entity !== 'object') return [];
    if (Array.isArray(entity.modifiedCosts)) return entity.modifiedCosts;
    if (Array.isArray(entity.discounts)) return entity.discounts;
    return [];
}

function getDiscountRulePriority(rule, index = 0) {
    const priority = Number(rule?.priority);
    return Number.isFinite(priority) ? priority : index + 1;
}

function getModifiedCostRulePriority(rule, index = 0) {
    return getDiscountRulePriority(rule, index);
}

function getHighestPriorityModifiedCostRule(rules = []) {
    return rules
        .filter(({ rule }) => !isConditionalGrantRule(rule) && doesDiscountRuleQualify(rule))
        .sort((a, b) =>
            getModifiedCostRulePriority(b.rule, b.index) - getModifiedCostRulePriority(a.rule, a.index)
            || b.index - a.index
        )[0] || null;
}

function getWinningModifiedCostRule(option, subcat) {
    const optionRule = getHighestPriorityModifiedCostRule(
        getModifiedCostRules(option).map((rule, index) => ({ rule, index }))
    );
    if (optionRule) return optionRule;

    return getHighestPriorityModifiedCostRule(
        getModifiedCostRules(subcat).map((rule, index) => ({ rule, index }))
    );
}

function applyModifiedCostRule(currentCost = {}, rule = {}) {
    const nextCost = { ...currentCost, ...(rule.cost || {}) };
    if (rule.costDelta && typeof rule.costDelta === 'object') {
        Object.entries(rule.costDelta).forEach(([type, delta]) => {
            const deltaValue = Number(delta);
            if (!Number.isFinite(deltaValue)) return;
            const currentValue = Number(nextCost[type]);
            nextCost[type] = (Number.isFinite(currentValue) ? currentValue : 0) + deltaValue;
        });
    }
    if (rule.costPercent && typeof rule.costPercent === 'object') {
        Object.entries(rule.costPercent).forEach(([type, percent]) => {
            const percentValue = Number(percent);
            const currentValue = Number(nextCost[type]);
            if (!Number.isFinite(percentValue) || !Number.isFinite(currentValue)) return;
            if (currentValue <= 0) return;
            nextCost[type] = Math.max(0, Math.ceil(currentValue * (1 + percentValue / 100)));
        });
    }
    return clampCostMap(nextCost, rule.minCost, rule.maxCost);
}

function clampCostMap(cost = {}, minCost, maxCost) {
    const result = { ...cost };
    Object.keys(result).forEach(type => {
        const value = Number(result[type]);
        if (!Number.isFinite(value)) return;
        let nextValue = value;
        const minValue = Number(minCost?.[type]);
        const maxValue = Number(maxCost?.[type]);
        if (Number.isFinite(minValue)) nextValue = Math.max(nextValue, minValue);
        if (Number.isFinite(maxValue)) nextValue = Math.min(nextValue, maxValue);
        result[type] = nextValue;
    });
    return result;
}

function isConditionalGrantRule(rule) {
    if (!rule || typeof rule !== 'object') return false;
    const slots = Number(rule.slots) || 0;
    return slots > 0 && (rule.mode === 'free' || rule.mode === 'half');
}

function doesDiscountRuleQualify(rule) {
    if (!rule) return false;

    if (rule.id || rule.ids) {
        const requiredIds = getDiscountRuleTriggerIds(rule);
        if (requiredIds.length && requiredIds.every(req => meetsCountRequirement(req))) {
            return true;
        }
    }

    if (rule.idsAny && Number.isInteger(rule.minSelected)) {
        const chosenCount = rule.idsAny.reduce((n, depId) => n + (meetsCountRequirement(depId) ? 1 : 0), 0);
        if (chosenCount >= rule.minSelected) {
            return true;
        }
    }

    return false;
}

function formatConditionalCostResult(cost = {}) {
    return Object.entries(cost || {})
        .filter(([_, value]) => Number.isFinite(Number(value)))
        .map(([type, value]) => {
            const numeric = Number(value);
            return numeric < 0
                ? `Gain: ${getPointAmountMarkup(type, Math.abs(numeric))}`
                : `Cost: ${getPointAmountMarkup(type, numeric)}`;
        })
        .join("; ");
}

function formatCostMapDisplay(cost = {}) {
    return Object.entries(cost || {})
        .filter(([_, value]) => Number.isFinite(Number(value)))
        .map(([type, value]) => {
            const numeric = Number(value);
            return numeric < 0
                ? `Gain: ${getPointAmountMarkup(type, Math.abs(numeric))}`
                : `Cost: ${getPointAmountMarkup(type, numeric)}`;
        })
        .join("; ");
}

function formatCostMapPlainText(cost = {}) {
    return Object.entries(cost || {})
        .filter(([_, value]) => Number.isFinite(Number(value)))
        .map(([type, value]) => {
            const numeric = Number(value);
            const pointLabel = stripFormattingMarkup(type);
            return numeric < 0
                ? `Gain: ${pointLabel} ${Math.abs(numeric)}`
                : `Cost: ${pointLabel} ${numeric}`;
        })
        .join("; ");
}

function formatModifiedCostRuleCondition(rule = {}) {
    if (Array.isArray(rule.idsAny) && rule.idsAny.length > 0) {
        const minSelected = Number.isInteger(rule.minSelected) ? rule.minSelected : 1;
        const labels = rule.idsAny.map(id => getOptionLabelMarkup(String(id).split('__')[0]) || id);
        return `at least ${minSelected} of ${labels.join(", ")}`;
    }
    const triggerIds = getDiscountRuleTriggerIds(rule);
    if (triggerIds.length > 0) {
        return triggerIds
            .map(id => {
                const [baseId, countSuffix] = String(id).split('__');
                const label = getOptionLabelMarkup(baseId) || baseId;
                return countSuffix ? `${label} (x${countSuffix})` : label;
            })
            .join(" + ");
    }
    return "condition met";
}

function getModifiedCostRuleConditionKey(rule = {}) {
    if (Array.isArray(rule.idsAny) && rule.idsAny.length > 0) {
        const minSelected = Number.isInteger(rule.minSelected) ? rule.minSelected : 1;
        return `any:${minSelected}:${rule.idsAny.join('|')}`;
    }
    const triggerIds = getDiscountRuleTriggerIds(rule);
    if (triggerIds.length > 0) {
        return `all:${triggerIds.join('|')}`;
    }
    return "conditionless";
}

function tokenizePrerequisiteExpression(expression = "") {
    const tokens = [];
    const tokenPattern = /\s*(&&|\|\||!|\(|\)|>=|<=|==|=|>|<|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|-?\d+(?:\.\d+)?\+?|[a-zA-Z_][a-zA-Z0-9_]*(?:__\d+)?)\s*/g;
    let match;
    let consumed = 0;
    while ((match = tokenPattern.exec(expression)) !== null) {
        if (match.index !== consumed && expression.slice(consumed, match.index).trim()) return [];
        tokens.push(match[1]);
        consumed = tokenPattern.lastIndex;
    }
    return expression.slice(consumed).trim() ? [] : tokens;
}

function unquotePrerequisitePointName(token = "") {
    const text = String(token).trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        return text.slice(1, -1).replace(/\\(["'\\])/g, "$1");
    }
    return text;
}

function evaluatePointRequirement(pointType, operator, requiredValue) {
    const actual = getPointRequirementValue(pointType);
    const required = Number(requiredValue);
    if (!Number.isFinite(required)) return false;
    if (operator === ">=") return actual >= required;
    if (operator === ">") return actual > required;
    if (operator === "<=") return actual <= required;
    if (operator === "<") return actual < required;
    return actual === required;
}

function parsePrerequisiteExpression(expression = "") {
    const tokens = tokenizePrerequisiteExpression(expression);
    let index = 0;
    const peek = () => tokens[index];
    const consume = expected => {
        if (expected && tokens[index] !== expected) throw new Error(`Expected ${expected}`);
        return tokens[index++];
    };
    const parsePrimary = () => {
        const token = peek();
        if (token === "!") {
            consume("!");
            return { type: "not", child: parsePrimary() };
        }
        if (token === "(") {
            consume("(");
            const node = parseOr();
            consume(")");
            return node;
        }
        const isIdentifier = /^[a-zA-Z_][a-zA-Z0-9_]*(?:__\d+)?$/.test(token || "");
        const isQuotedPointType = /^"(?:\\.|[^"\\])*"$|^'(?:\\.|[^'\\])*'$/.test(token || "");
        if (isIdentifier || isQuotedPointType) {
            consume();
            const next = peek();
            if ((token === "category" || token === "subcategory") && next === "(") {
                consume("(");
                const nameToken = consume();
                if (!/^"(?:\\.|[^"\\])*"$|^'(?:\\.|[^'\\])*'$/.test(nameToken || "")) {
                    throw new Error("Scope prerequisites must use a quoted name");
                }
                consume(")");
                return {
                    type: "scope",
                    scopeType: token,
                    name: unquotePrerequisitePointName(nameToken)
                };
            }
            if ([">=", "<=", ">", "<", "==", "="].includes(next)) {
                const operator = consume();
                const valueToken = consume();
                if (!/^-?\d+(?:\.\d+)?$/.test(valueToken || "")) throw new Error("Invalid point prerequisite value");
                return {
                    type: "point",
                    pointType: unquotePrerequisitePointName(token),
                    operator,
                    value: Number(valueToken)
                };
            }
            if (/^-?\d+(?:\.\d+)?\+$/.test(next || "")) {
                const valueToken = consume();
                return {
                    type: "point",
                    pointType: unquotePrerequisitePointName(token),
                    operator: ">=",
                    value: Number(valueToken.slice(0, -1))
                };
            }
            if (isQuotedPointType) throw new Error("Quoted point prerequisites must include a comparison");
            return { type: "atom", id: token };
        }
        throw new Error("Invalid prerequisite token");
    };
    const parseAnd = () => {
        const children = [parsePrimary()];
        while (peek() === "&&") {
            consume("&&");
            children.push(parsePrimary());
        }
        return children.length === 1 ? children[0] : { type: "and", children };
    };
    const parseOr = () => {
        const children = [parseAnd()];
        while (peek() === "||") {
            consume("||");
            children.push(parseAnd());
        }
        return children.length === 1 ? children[0] : { type: "or", children };
    };
    try {
        const ast = parseOr();
        if (index !== tokens.length) return null;
        return ast;
    } catch (_) {
        return null;
    }
}

function evaluatePrerequisiteNode(node) {
    if (!node) return false;
    if (node.type === "atom") return meetsCountRequirement(node.id);
    if (node.type === "point") return evaluatePointRequirement(node.pointType, node.operator, node.value);
    if (node.type === "scope") return scopeRequirementMet(node.scopeType, node.name);
    if (node.type === "not") return !evaluatePrerequisiteNode(node.child);
    if (node.type === "and") return node.children.every(evaluatePrerequisiteNode);
    if (node.type === "or") return node.children.some(evaluatePrerequisiteNode);
    return false;
}

function buildPrerequisiteDisplayLines(expression = "") {
    const ast = parsePrerequisiteExpression(expression);
    if (!ast) return null;
    const atomText = (rawId, negated, inheritedSatisfiedOr = false) => {
        const [id, minSuffix] = rawId.split("__");
        if (!findOptionById(id)) return "";
        const atomSatisfied = negated ? !meetsCountRequirement(rawId) : meetsCountRequirement(rawId);
        const requiredCount = minSuffix ? Number(minSuffix) : 1;
        const label = getOptionLabelMarkup(id) + (requiredCount > 1 ? ` (x${requiredCount})` : "");
        const satisfied = inheritedSatisfiedOr || atomSatisfied;
        return `${satisfied ? "✅" : "❌"} ${negated ? "NOT " : ""}${label}`;
    };
    const pointText = (node, negated, inheritedSatisfiedOr = false) => {
        const pointSatisfied = evaluatePointRequirement(node.pointType, node.operator, node.value);
        const satisfied = inheritedSatisfiedOr || (negated ? !pointSatisfied : pointSatisfied);
        const operator = node.operator === "==" ? "=" : node.operator;
        return `${satisfied ? "✅" : "❌"} ${negated ? "NOT " : ""}${getPointTypeMarkup(node.pointType)} ${escapeHtml(operator)} ${escapeHtml(String(node.value))}`;
    };
    const scopeText = (node, negated, inheritedSatisfiedOr = false) => {
        const scopeSatisfied = scopeRequirementMet(node.scopeType, node.name);
        const satisfied = inheritedSatisfiedOr || (negated ? !scopeSatisfied : scopeSatisfied);
        const label = `${node.scopeType === "category" ? "Category" : "Subcategory"} ${node.name}`;
        return `${satisfied ? "✅" : "❌"} ${negated ? "NOT " : ""}${escapeHtml(label)}`;
    };
    const inline = (node, inheritedSatisfiedOr = false, negated = false) => {
        if (!node) return "";
        if (node.type === "atom") {
            return atomText(node.id, negated, inheritedSatisfiedOr);
        }
        if (node.type === "point") {
            return pointText(node, negated, inheritedSatisfiedOr);
        }
        if (node.type === "scope") {
            return scopeText(node, negated, inheritedSatisfiedOr);
        }
        if (node.type === "not") {
            if (node.child?.type === "atom" || node.child?.type === "point" || node.child?.type === "scope") return inline(node.child, inheritedSatisfiedOr, !negated);
            const childText = inline(node.child, inheritedSatisfiedOr, false);
            return childText ? `NOT (${childText})` : "";
        }
        if (node.type === "or") {
            const orSatisfied = inheritedSatisfiedOr || evaluatePrerequisiteNode(node);
            return node.children.map(child => inline(child, orSatisfied, negated)).filter(Boolean).join(" OR ");
        }
        if (node.type === "and") {
            const parts = node.children.map(child => inline(child, inheritedSatisfiedOr, negated)).filter(Boolean);
            const text = parts.join(" AND ");
            if (!text) return "";
            return node.children.length > 1 ? `(${text})` : text;
        }
        return "";
    };
    const lines = (node, inheritedSatisfiedOr = false, negated = false) => {
        if (!node) return [];
        if (node.type === "and") {
            return node.children.flatMap(child => lines(child, inheritedSatisfiedOr, negated));
        }
        return [inline(node, inheritedSatisfiedOr, negated)].filter(Boolean);
    };
    return lines(ast);
}

function buildRequirementDisplayLines(requirement) {
    if (!requirement) return [];
    if (typeof requirement === 'string') {
        const parsedLines = buildPrerequisiteDisplayLines(requirement);
        if (parsedLines) return parsedLines;

        const prereqLines = [];
        const tokens = requirement.match(/!?[a-zA-Z_][a-zA-Z0-9_]*(?:__\d+)?/g) || [];
        const reserved = new Set(['true', 'false', 'null', 'undefined', 'if', 'else', 'return', 'let', 'var', 'const', 'function', 'while', 'for', 'do', 'switch', 'case', 'break', 'continue', 'default', 'new', 'this', 'typeof', 'instanceof', 'void', 'delete', 'in', 'of', 'with', 'try', 'catch', 'finally', 'throw', 'class', 'extends', 'super', 'import', 'export', 'from', 'as', 'await', 'async', 'yield']);
        const seen = new Set();
        let exprTrue = false;
        try {
            exprTrue = !!evaluateRequirementExpression(requirement);
        } catch (e) {
            exprTrue = false;
        }
        tokens.forEach(token => {
            const negated = token.startsWith('!');
            const core = negated ? token.slice(1) : token;
            const [id, minSuffix] = core.split('__');
            if (reserved.has(id) || seen.has(core)) return;
            if (!findOptionById(id)) return;
            seen.add(core);
            const requiredCount = minSuffix ? Number(minSuffix) : 1;
            const actual = selectedOptions[id] || 0;
            const satisfied = exprTrue || (negated ? actual < requiredCount : actual >= requiredCount);
            const label = getOptionLabelMarkup(id) + (requiredCount > 1 ? ` (x${requiredCount})` : "");
            prereqLines.push(`${satisfied ? "✅" : "❌"} ${negated ? "NOT " : ""}${label}`);
        });
        return prereqLines;
    }
    if (Array.isArray(requirement)) {
        return requirement.map(rawId => {
            const [id, minSuffix] = String(rawId).split('__');
            if (!findOptionById(id)) return "";
            const requiredCount = minSuffix ? Number(minSuffix) : 1;
            const label = getOptionLabelMarkup(id) + (requiredCount > 1 ? ` (x${requiredCount})` : "");
            const isSelected = meetsCountRequirement(String(rawId));
            const symbol = isSelected ? "✅" : "❌";
            return `${symbol} ${label}`;
        }).filter(Boolean);
    }
    if (typeof requirement === 'object' && requirement !== null) {
        const prereqLines = [];
        const andList = requirement.and || [];
        const orList = requirement.or || [];
        const orAccepted = orList.some(id => meetsCountRequirement(String(id)));
        if (andList.length) {
            prereqLines.push(...andList.map(rawId => {
                const [id, minSuffix] = String(rawId).split('__');
                if (!findOptionById(id)) return "";
                const requiredCount = minSuffix ? Number(minSuffix) : 1;
                const label = getOptionLabelMarkup(id) + (requiredCount > 1 ? ` (x${requiredCount})` : "");
                const isSelected = meetsCountRequirement(String(rawId));
                return `${isSelected ? "✅" : "❌"} ${label}`;
            }).filter(Boolean));
        }
        if (orList.length) {
            const orLine = orList.map(rawId => {
                const [id, minSuffix] = String(rawId).split('__');
                if (!findOptionById(id)) return "";
                const requiredCount = minSuffix ? Number(minSuffix) : 1;
                const label = getOptionLabelMarkup(id) + (requiredCount > 1 ? ` (x${requiredCount})` : "");
                const symbol = orAccepted ? "✅" : (meetsCountRequirement(String(rawId)) ? "✅" : "❌");
                return `${symbol} ${label}`;
            }).filter(Boolean).join(" OR ");
            if (orLine) prereqLines.push(orLine);
        }
        return prereqLines;
    }
    return [];
}

function buildRequirementHelpText(requirement) {
    const defaultText = "Prerequisites are checked against selected options. String expressions support &&, ||, and !. When the overall expression evaluates true the UI marks referenced prerequisites as satisfied for clarity.";
    if (typeof requirement !== 'string') return defaultText;

    const rawExpr = requirement;
    const tokens = rawExpr.match(/\b[a-zA-Z_][a-zA-Z0-9_]*(?:__\d+)?\b/g) || [];
    let human = rawExpr;
    const seenIds = new Set();
    tokens.forEach(tok => {
        const [id] = tok.split('__');
        if (seenIds.has(tok)) return;
        seenIds.add(tok);
        const label = getOptionLabelPlainText(id) || id;
        const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        human = human.replace(new RegExp('\\b' + esc + '\\b', 'g'), `"${label}"`);
    });
    human = human.replace(/\|\|/g, ' OR ').replace(/&&/g, ' AND ').replace(/!/g, 'NOT ');
    return `${human}\n\nExpression: ${rawExpr}`;
}

function getOptionDisplayRequirements(option, selectionNumber = null) {
    const requirements = [];
    if (option?.prerequisites) requirements.push(option.prerequisites);
    const effectiveSelectionNumber = Number(selectionNumber);
    const selectionRequirements = Array.isArray(option?.prerequisitesBySelection) ? option.prerequisitesBySelection : [];
    if (Number.isFinite(effectiveSelectionNumber) && effectiveSelectionNumber > 0) {
        const selectionRequirement = selectionRequirements[effectiveSelectionNumber - 1];
        if (selectionRequirement) requirements.push(selectionRequirement);
    }
    return requirements;
}

function getModifiedCostDisplayRows(option, subcat) {
    const rowsByCondition = new Map();
    const baseCost = getOptionBaseCost(option);
    const rules = [
        ...getModifiedCostRules(subcat).map((rule, index) => ({ rule, index, scopeOrder: 0 })),
        ...getModifiedCostRules(option).map((rule, index) => ({ rule, index, scopeOrder: 1 }))
    ]
        .filter(({ rule }) => !isConditionalGrantRule(rule))
        .sort((a, b) =>
            a.scopeOrder - b.scopeOrder
            || getModifiedCostRulePriority(a.rule, a.index) - getModifiedCostRulePriority(b.rule, b.index)
            || a.index - b.index
        );

    rules.forEach(({ rule }) => {
        const condition = formatModifiedCostRuleCondition(rule);
        if (!condition) return;
        const conditionKey = getModifiedCostRuleConditionKey(rule);
        const previous = rowsByCondition.get(conditionKey);
        const resolvedCost = applyModifiedCostRule(previous?.resolvedCost || baseCost, rule);
        const result = formatConditionalCostResult(resolvedCost);
        if (!result) return;
        rowsByCondition.set(conditionKey, {
            active: doesDiscountRuleQualify(rule),
            condition,
            result,
            resolvedCost
        });
    });

    return Array.from(rowsByCondition.values()).map(({ active, condition, result }) => ({
        active,
        condition,
        result
    }));
}

function getConditionalGrantProviderLabel(rule, ruleIndex) {
    const ids = getDiscountRuleTriggerIds(rule);
    if (!ids.length) return `Conditional Rule ${ruleIndex + 1}`;
    const labels = ids.map(id => getOptionById(String(id).split('__')[0])?.label || id);
    if (labels.length === 1) return labels[0];
    return `${labels[0]} +${labels.length - 1}`;
}

function getActiveOptionGrantContexts(targetOptionId) {
    const contexts = [];
    getAllOptions().forEach(provider => {
        const providerSelections = selectedOptions[provider.id] || 0;
        if (providerSelections <= 0) return;
        (provider.discountGrants || []).forEach((rule, ruleIndex) => {
            const slotsPerSelection = Math.max(0, Number(rule?.slots) || 0);
            if (slotsPerSelection <= 0) return;
            const targetIds = getGrantTargetIds(rule);
            if (!targetIds.includes(targetOptionId)) return;
            const key = buildOptionGrantKey(provider.id, ruleIndex);
            const map = getOptionGrantMap(key);
            contexts.push({
                provider,
                rule,
                ruleIndex,
                key,
                map,
                targetIds,
                limit: providerSelections * slotsPerSelection,
                mode: rule.mode === 'free' ? 'free' : 'half'
            });
        });
    });
    const targetOption = getOptionById(targetOptionId);
    getModifiedCostRules(targetOption).forEach((rule, ruleIndex) => {
        if (!isConditionalGrantRule(rule)) return;
        if (!doesDiscountRuleQualify(rule)) return;
        const slots = Math.max(0, Number(rule?.slots) || 0);
        if (slots <= 0) return;
        const key = buildConditionalGrantKey(targetOptionId, ruleIndex);
        const map = getOptionGrantMap(key);
        contexts.push({
            provider: {
                id: key,
                label: getConditionalGrantProviderLabel(rule, ruleIndex)
            },
            rule,
            ruleIndex,
            key,
            map,
            targetIds: [targetOptionId],
            limit: slots,
            mode: rule.mode === 'free' ? 'free' : 'half'
        });
    });
    return contexts;
}

function hasDiscountAmount(entity) {
    return !!(entity && entity.discountAmount && typeof entity.discountAmount === 'object' && Object.keys(entity.discountAmount).length > 0);
}

function getDiscountTypes(entity) {
    if (!entity) return [];
    if (Array.isArray(entity.discountTypes) && entity.discountTypes.length) return entity.discountTypes;
    if (hasDiscountAmount(entity)) return Object.keys(entity.discountAmount);
    return [];
}

function getModeDiscountTypes(entity) {
    if (!entity) return null;
    if (Array.isArray(entity.discountTypes) && entity.discountTypes.length) return entity.discountTypes;
    return null;
}

function getDiscountEligibleCost(baseCost = {}, entity) {
    const types = getDiscountTypes(entity);
    if (types.length) {
        for (const type of types) {
            const val = baseCost[type];
            if (typeof val === 'number' && val > 0) {
                return { type, value: val };
            }
        }
        return { type: null, value: null };
    }
    const entry = Object.entries(baseCost).find(([_, val]) => val > 0);
    return entry ? { type: entry[0], value: entry[1] } : { type: null, value: null };
}

function getDiscountTypeLabel(entity, fallback = 'IP') {
    const types = getDiscountTypes(entity);
    if (types.length === 1) return types[0];
    if (types.length > 1) return 'matching points';
    return fallback;
}

function applyDiscountAmount(cost = {}, discountAmount) {
    if (!discountAmount || typeof discountAmount !== 'object') {
        return { cost, applied: false };
    }
    let applied = false;
    const updated = { ...cost };
    Object.entries(discountAmount).forEach(([type, amt]) => {
        if (typeof updated[type] === 'number' && updated[type] > 0 && typeof amt === 'number') {
            const next = Math.max(0, updated[type] - amt);
            if (next !== updated[type]) applied = true;
            updated[type] = next;
        }
    });
    return { cost: updated, applied };
}

function applyDiscountCost(cost = {}, mode = 'half', allowedTypes = null) {
    const updated = { ...cost };
    const typeSet = Array.isArray(allowedTypes) && allowedTypes.length ? new Set(allowedTypes) : null;
    Object.entries(updated).forEach(([type, val]) => {
        if (val > 0 && (!typeSet || typeSet.has(type))) {
            updated[type] = mode === 'free' ? 0 : Math.ceil(val / 2);
        }
    });
    return updated;
}

function evaluateDiscountRequirementNode(node) {
    if (node === null || node === undefined || node === '') return true;

    if (Array.isArray(node)) {
        if (node.length === 0) return true;
        return node.every(evaluateDiscountRequirementNode);
    }

    if (typeof node === 'string') {
        const trimmed = node.trim();
        if (!trimmed) return true;
        const hasLogicalOperators = /[()!&|]/.test(trimmed);
        if (hasLogicalOperators && typeof window !== 'undefined' && typeof window.evaluatePrereqExpr === 'function') {
            try {
                return evaluateRequirementExpression(trimmed);
            } catch (err) {
                console.warn('Failed to evaluate discount requirement expression:', trimmed, err);
                return false;
            }
        }
        return meetsCountRequirement(trimmed);
    }

    if (typeof node === 'object') {
        const {
            all,
            any,
            none
        } = node;

        if (all !== undefined) {
            const list = Array.isArray(all) ? all : [all];
            if (!list.every(evaluateDiscountRequirementNode)) return false;
        }

        if (any !== undefined) {
            const list = Array.isArray(any) ? any : [any];
            if (!list.some(evaluateDiscountRequirementNode)) return false;
        }

        if (none !== undefined) {
            const list = Array.isArray(none) ? none : [none];
            if (list.some(evaluateDiscountRequirementNode)) return false;
        }

        return true;
    }

    return true;
}

function evaluateDiscountRequirement(requirement) {
    return evaluateDiscountRequirementNode(requirement);
}

function hasDiscountConfig(entity) {
    return !!(entity && entity.discountSelectionLimit && entity.discountEligibleUnder);
}

function isDiscountUnlocked(entity) {
    if (!entity) return false;
    return evaluateDiscountRequirement(entity.discountRequires);
}

function canUseDiscount(entity) {
    return hasDiscountConfig(entity) && isDiscountUnlocked(entity);
}

function shouldAutoApplyDiscount(entity) {
    return !!(entity && entity.discountAutoApplyAll && canUseDiscount(entity));
}


/**
 * Renders the accordion structure based on the categories data.
 * It creates collapsible sections for categories and subcategories,
 * and displays options within them.
 */
function renderAccordion() {
    const tabNav = document.getElementById("tabNavigation");
    const tabContentContainer = document.getElementById("tabContent");
    tabNav.innerHTML = "";
    tabContentContainer.innerHTML = "";
    optionGridLayouts.clear();

    // Get all non-special categories
    const visibleCategories = categories.filter(cat => !["points", "headerImage", "title", "description", "formulas"].includes(cat.type));

    const visibleCategoryNames = new Set(visibleCategories.map(cat => cat.name));

    // If selected/open categories no longer exist, clear them.
    if (currentTab && !visibleCategories.some(cat => cat.name === currentTab)) {
        currentTab = null;
    }
    Array.from(openCategories).forEach(name => {
        if (!visibleCategoryNames.has(name)) {
            openCategories.delete(name);
        }
    });

    const visibleSubcategoryKeys = visibleCategories.flatMap(cat => {
        const catIndex = categories.indexOf(cat);
        return collectOpenableSubcategoryKeys(cat, catIndex, cat.subcategories || []);
    });
    const allCategoriesOpen = visibleCategories.length > 0 && visibleCategories.every(cat => openCategories.has(cat.name));
    const allVisibleSubcategoriesOpen = visibleSubcategoryKeys.every(key => openSubcategories.has(key));
    const allCategoryPanelsOpen = allCategoriesOpen && allVisibleSubcategoriesOpen;

    const openCategoryAndSubcategories = (cat) => {
        openCategories.add(cat.name);
        const catIndex = categories.indexOf(cat);
        collectOpenableSubcategoryKeys(cat, catIndex, cat.subcategories || []).forEach(key => {
            openSubcategories.add(key);
            subcategoriesToAnimate.add(key);
        });
    };

    if (visibleCategories.length > 0) {
        const openAllButton = document.createElement("button");
        openAllButton.className = "tab-button category-bulk-button";
        openAllButton.textContent = "Open All";
        openAllButton.disabled = allCategoryPanelsOpen;
        openAllButton.onclick = () => {
            visibleCategories.forEach(cat => openCategoryAndSubcategories(cat));
            currentTab = visibleCategories[visibleCategories.length - 1]?.name || null;
            animateMainTab = true;
            renderAccordion();
        };
        tabNav.appendChild(openAllButton);

        const closeAllButton = document.createElement("button");
        closeAllButton.className = "tab-button category-bulk-button";
        closeAllButton.textContent = "Close All";
        closeAllButton.disabled = openCategories.size === 0 && openSubcategories.size === 0;
        closeAllButton.onclick = () => {
            openCategories.clear();
            openSubcategories.clear();
            subcategoriesToAnimate.clear();
            currentTab = null;
            animateMainTab = false;
            renderAccordion();
        };
        tabNav.appendChild(closeAllButton);
    }

    // Create tabs
    visibleCategories.forEach((cat) => {
        const tab = document.createElement("button");
        tab.className = "tab-button";
        if (openCategories.has(cat.name)) {
            tab.classList.add("active");
        }
        tab.textContent = cat.name;
        tab.onclick = () => {
            if (openCategories.has(cat.name)) {
                openCategories.delete(cat.name);
                currentTab = null;
                animateMainTab = false;
            } else {
                openCategories.add(cat.name);
                currentTab = cat.name;
                animateMainTab = true; // Trigger animation on tab switch
            }
            renderAccordion();
        };
        tabNav.appendChild(tab);
    });

    // Render content for every open tab.
    const activeCategories = visibleCategories.filter(cat => openCategories.has(cat.name));
    if (activeCategories.length > 0) {
        if (animateMainTab) {
            tabContentContainer.classList.add("animate-fade-in");
            // Remove the class after animation finishes so it doesn't re-trigger on state changes
            tabContentContainer.addEventListener("animationend", () => {
                tabContentContainer.classList.remove("animate-fade-in");
            }, { once: true });
            animateMainTab = false;
        }
        activeCategories.forEach(cat => renderCategoryContent(cat, {
            showTitle: activeCategories.length > 1
        }));
    }
}

function evaluateRequirementList(requiredItems = []) {
    return requiredItems.every(req => {
        if (typeof req === 'string' && /[()!&|\s]/.test(req)) {
            try {
                return !!evaluateRequirementExpression(req);
            } catch (e) {
                return false;
            }
        }
        return !!selectedOptions[req];
    });
}

function buildRequirementsMarkup(requiredItems = []) {
    const lines = [];
    requiredItems.forEach(req => {
        if (typeof req === 'string' && /[()!&|\s]/.test(req)) {
            const rawExpr = req;
            const tokens = rawExpr.match(/\b[a-zA-Z_][a-zA-Z0-9_]*(?:__\d+)?\b/g) || [];
            let human = rawExpr;
            const seen = new Set();
            tokens.forEach(tok => {
                if (seen.has(tok)) return;
                seen.add(tok);
                const [id] = tok.split('__');
                const label = getOptionLabelPlainText(id) || id;
                const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                human = human.replace(new RegExp('\\b' + esc + '\\b', 'g'), `"${label}"`);
            });
            human = human.replace(/\|\|/g, ' OR ').replace(/&&/g, ' AND ').replace(/!/g, 'NOT ');
            const satisfied = (() => { try { return !!evaluateRequirementExpression(rawExpr); } catch (_) { return false; } })();
            lines.push(`${satisfied ? '✅' : '❌'} ${human}`);
        } else {
            const id = req;
            const label = getOptionLabelMarkup(id);
            lines.push(`${selectedOptions[id] ? "✅" : "❌"} ${label}`);
        }
    });
    return `🔒 Requires:<br>${lines.join("<br>")}`;
}

function getSubcategoryDisplayMode(entity) {
    return entity?.subcategoryDisplayMode === "all" ? "all" : "tabs";
}

function applySubcategoryColorStyles(element, subcat, target = "content") {
    if (!element || !subcat) return;
    const useDarkColors = getEffectiveDarkMode();
    const backgroundColor = useDarkColors
        ? (subcat.darkBackgroundColor || subcat.darkStyle?.backgroundColor || subcat.backgroundColor || subcat.style?.backgroundColor)
        : (subcat.backgroundColor || subcat.style?.backgroundColor);
    const textColor = useDarkColors
        ? (subcat.darkTextColor || subcat.darkStyle?.textColor || subcat.textColor || subcat.style?.textColor)
        : (subcat.textColor || subcat.style?.textColor);
    const accentColor = useDarkColors
        ? (subcat.darkAccentColor || subcat.darkStyle?.accentColor || subcat.accentColor || subcat.style?.accentColor)
        : (subcat.accentColor || subcat.style?.accentColor);

    if (target === "tab") {
        if (accentColor && isSafeTextColor(accentColor)) element.style.borderColor = accentColor;
        if (backgroundColor && isSafeTextColor(backgroundColor) && element.classList.contains("active")) {
            element.style.background = backgroundColor;
        }
        if (textColor && isSafeTextColor(textColor) && element.classList.contains("active")) {
            element.style.color = textColor;
        }
        return;
    }

    if (target === "title") {
        if (accentColor && isSafeTextColor(accentColor)) element.style.backgroundColor = accentColor;
        if (textColor && isSafeTextColor(textColor)) element.style.color = textColor;
        return;
    }

    if (backgroundColor && isSafeTextColor(backgroundColor)) {
        element.style.background = backgroundColor;
        element.classList.add("subcategory-content-styled");
    }
    if (textColor && isSafeTextColor(textColor)) element.style.color = textColor;
    if (accentColor && isSafeTextColor(accentColor)) element.style.borderColor = accentColor;
}

function getSubcategoryPathKey(catIndex, catName, path, subcat) {
    return buildSubcategoryKey(catIndex, catName, null, null, path.concat([{ index: path.length ? path[path.length - 1].index : 0, name: subcat?.name || "" }]));
}

function buildChildPath(path, index, child) {
    return path.concat([{ index, name: child?.name || "" }]);
}

function collectOpenableSubcategoryKeys(cat, catIndex, children, parentPath = []) {
    if (!Array.isArray(children) || children.length === 0) return [];
    const keys = [];

    children.forEach((child, idx) => {
        const path = buildChildPath(parentPath, idx, child);
        const key = buildSubcategoryKey(catIndex, cat.name, null, null, path);
        const subcatRequires = child?.requiresOption;
        const reqItems = Array.isArray(subcatRequires) ? subcatRequires : subcatRequires ? [subcatRequires] : [];
        const unlocked = evaluateRequirementList(reqItems);
        if (!unlocked) return;

        keys.push(key);
        keys.push(...collectOpenableSubcategoryKeys(cat, catIndex, child?.subcategories || [], path));
    });

    return keys;
}

function renderSubcategoryTreeNode(subcat, parentContainer, {
    cat,
    catIndex,
    catKey,
    catDiscountUnlocked,
    catAutoApplyAll,
    path
}) {
    const subcatKey = buildSubcategoryKey(catIndex, cat.name, null, null, path);
    const subcatItem = document.createElement("div");
    subcatItem.className = "subcategory-item";

    const subcatContent = document.createElement("div");
    subcatContent.className = "subcategory-content tab-active";
    applySubcategoryColorStyles(subcatContent, subcat, "content");

    const subcatTitle = document.createElement("h3");
    subcatTitle.className = "subcategory-content-title";
    subcatTitle.textContent = subcat.name || `Options ${path[path.length - 1]?.index + 1 || 1}`;
    applySubcategoryColorStyles(subcatTitle, subcat, "title");
    subcatContent.appendChild(subcatTitle);
    subcatItem.appendChild(subcatContent);
    parentContainer.appendChild(subcatItem);

    const subcatRequires = subcat.requiresOption;
    const subcatReqItems = Array.isArray(subcatRequires) ? subcatRequires : subcatRequires ? [subcatRequires] : [];
    const subcatUnlocked = evaluateRequirementList(subcatReqItems);

    if (!subcatUnlocked) {
        const lockMsg = document.createElement("div");
        lockMsg.style.padding = "8px";
        lockMsg.style.color = "#666";
        lockMsg.innerHTML = buildRequirementsMarkup(subcatReqItems);
        subcatContent.appendChild(lockMsg);
        return;
    }

    if (subcat.type === "storyBlock" && subcat.text && subcat.text.trim() !== "") {
        const storyText = document.createElement("div");
        storyText.className = "story-block";
        setMultilineText(storyText, subcat.text);
        subcatContent.appendChild(storyText);
    }

    const subcatHasDiscounts = hasDiscountConfig(subcat);
    const subcatDiscountUnlocked = subcatHasDiscounts && isDiscountUnlocked(subcat);
    const subcatAutoApplyAll = subcatDiscountUnlocked && shouldAutoApplyDiscount(subcat);

    if (subcatHasDiscounts && subcat.discountRequiresMessage) {
        const note = document.createElement("div");
        note.className = "subcategory-discount-requirement";
        note.textContent = `${subcatDiscountUnlocked ? '✅' : '🔒'} ${subcat.discountRequiresMessage}`;
        subcatContent.appendChild(note);
    }

    if (subcatDiscountUnlocked && !subcatAutoApplyAll) {
        const discountInfo = document.createElement("div");
        discountInfo.className = "subcategory-discount-info";
        const subMap = getSubcategoryDiscountMap(subcatKey);
        const usedSlots = getDiscountTotalCount(subMap);
        const subModeLabel = subcat.discountMode === 'free' ? 'free' : 'half-cost';
        discountInfo.textContent = `Discount slots used: ${usedSlots}/${subcat.discountSelectionLimit} (${subModeLabel})`;
        subcatContent.appendChild(discountInfo);
    } else if (subcatDiscountUnlocked && subcatAutoApplyAll) {
        const discountInfo = document.createElement("div");
        discountInfo.className = "subcategory-discount-info";
        const subModeLabel = subcat.discountMode === 'free' ? 'free' : 'half-cost';
        discountInfo.textContent = `Discount auto-applies to eligible items (${subModeLabel}).`;
        subcatContent.appendChild(discountInfo);
    }

    if (subcat.input) {
        const inputWrapper = document.createElement("div");
        inputWrapper.className = "story-input-wrapper";

        if (subcat.input.label) {
            const label = document.createElement("label");
            label.textContent = subcat.input.label;
            label.setAttribute("for", subcat.input.id);
            inputWrapper.appendChild(label);
        }

        const input = document.createElement("input");
        input.type = "text";
        input.id = subcat.input.id;
        input.placeholder = subcat.input.placeholder || "";
        input.maxLength = subcat.input.maxLength || 20;
        input.value = sanitizeStoryInputValue(storyInputs[subcat.input.id] || "", input.maxLength);
        input.addEventListener("input", (e) => {
            const safeValue = sanitizeStoryInputValue(e.target.value, input.maxLength);
            e.target.value = safeValue;
            storyInputs[subcat.input.id] = safeValue;
        });
        inputWrapper.appendChild(input);
        subcatContent.appendChild(inputWrapper);
    }

    renderSubcategoryOptions(subcat, subcatContent, subcatKey, cat, catIndex, catKey, catDiscountUnlocked, catAutoApplyAll);

    renderSubcategoryLevel(subcat, subcat.subcategories || [], subcatContent, {
        cat,
        catIndex,
        catKey,
        catDiscountUnlocked,
        catAutoApplyAll,
        parentPath: path
    });
}

function renderSubcategoryLevel(parentEntity, children, container, {
    cat,
    catIndex,
    catKey,
    catDiscountUnlocked,
    catAutoApplyAll,
    parentPath = []
}) {
    if (!Array.isArray(children) || children.length === 0) return;

    const mode = getSubcategoryDisplayMode(parentEntity);
    const childMeta = children.map((child, idx) => {
        const path = buildChildPath(parentPath, idx, child);
        const key = buildSubcategoryKey(catIndex, cat.name, null, null, path);
        const subcatRequires = child?.requiresOption;
        const reqItems = Array.isArray(subcatRequires) ? subcatRequires : subcatRequires ? [subcatRequires] : [];
        const unlocked = evaluateRequirementList(reqItems);
        return { child, idx, path, key, unlocked };
    });

    const hasTabbedNav = mode === "tabs" && children.length > 1;
    if (hasTabbedNav) {
        const nav = document.createElement("div");
        nav.className = "subcategory-navigation";
        const openableKeys = collectOpenableSubcategoryKeys(cat, catIndex, children, parentPath);
        if (openableKeys.length > 1) {
            const allOpen = openableKeys.every(key => openSubcategories.has(key));
            const bulkButton = document.createElement("button");
            bulkButton.className = "subcategory-tab-button subcategory-bulk-button";
            bulkButton.textContent = allOpen ? "Close all" : "Open all";
            bulkButton.onclick = () => {
                if (allOpen) {
                    openableKeys.forEach(key => openSubcategories.delete(key));
                } else {
                    openableKeys.forEach(key => {
                        openSubcategories.add(key);
                        subcategoriesToAnimate.add(key);
                    });
                }
                renderAccordion();
            };
            nav.appendChild(bulkButton);
        }
        childMeta.forEach((meta) => {
            const subButton = document.createElement("button");
            subButton.className = "subcategory-tab-button";
            if (openSubcategories.has(meta.key)) {
                subButton.classList.add("active");
            }
            subButton.textContent = meta.child?.name || `Options ${meta.idx + 1}`;
            if (!meta.unlocked) {
                subButton.classList.add("locked");
                subButton.textContent = `🔒 ${meta.child?.name || `Options ${meta.idx + 1}`}`;
            }
            subButton.onclick = () => {
                if (openSubcategories.has(meta.key)) {
                    openSubcategories.delete(meta.key);
                } else {
                    openSubcategories.add(meta.key);
                    subcategoriesToAnimate.add(meta.key);
                }
                renderAccordion();
            };
            applySubcategoryColorStyles(subButton, meta.child, "tab");
            nav.appendChild(subButton);
        });
        container.appendChild(nav);
    }

    const toRender = mode === "all"
        ? childMeta
        : hasTabbedNav
            ? childMeta.filter(meta => openSubcategories.has(meta.key))
            : childMeta;

    toRender.forEach((meta) => {
        renderSubcategoryTreeNode(meta.child, container, {
            cat,
            catIndex,
            catKey,
            catDiscountUnlocked,
            catAutoApplyAll,
            path: meta.path
        });
    });
}

function renderCategoryContent(cat, {
    showTitle = false
} = {}) {
    const tabContentContainer = document.getElementById("tabContent");
    const catIndex = categories.indexOf(cat);

    const content = document.createElement("div");
    content.className = "category-content";

    if (showTitle) {
        const categoryTitle = document.createElement("h2");
        categoryTitle.className = "category-content-title";
        categoryTitle.textContent = cat.name || "Category";
        content.appendChild(categoryTitle);
    }

    if (typeof cat.description === "string" && cat.description.trim() !== "") {
        const catDescription = document.createElement("div");
        catDescription.className = "category-description";
        setMultilineText(catDescription, cat.description);
        content.appendChild(catDescription);
    }

    const requires = cat.requiresOption;
    const requiredItems = Array.isArray(requires) ? requires : requires ? [requires] : [];
    const categoryUnlocked = evaluateRequirementList(requiredItems);

    if (!categoryUnlocked) {
        const lockMsg = document.createElement("div");
        lockMsg.style.padding = "8px";
        lockMsg.style.color = "#666";
        lockMsg.innerHTML = buildRequirementsMarkup(requiredItems);
        content.appendChild(lockMsg);
        tabContentContainer.appendChild(content);
        return;
    }

    const catKey = buildCategoryKey(catIndex, cat.name);
    const catHasDiscounts = hasDiscountConfig(cat);
    const catDiscountUnlocked = catHasDiscounts && isDiscountUnlocked(cat);
    const catAutoApplyAll = catDiscountUnlocked && shouldAutoApplyDiscount(cat);

    if (catHasDiscounts && cat.discountRequiresMessage) {
        const note = document.createElement("div");
        note.className = "category-discount-requirement";
        note.textContent = `${catDiscountUnlocked ? '✅' : '🔒'} ${cat.discountRequiresMessage}`;
        content.appendChild(note);
    }

    if (catDiscountUnlocked) {
        const catInfo = document.createElement("div");
        catInfo.className = "category-discount-info";
        if (catAutoApplyAll) {
            const catModeLabel = cat.discountMode === 'free' ? 'free' : 'half-cost';
            catInfo.textContent = `Category discount auto-applies to eligible items (${catModeLabel}).`;
        } else {
            const catMap = getCategoryDiscountMap(catKey);
            const used = getDiscountTotalCount(catMap);
            const catModeLabel = cat.discountMode === 'free' ? 'free' : 'half-cost';
            const eligibleLabel = getDiscountTypeLabel(cat, 'IP');
            catInfo.textContent = `Category discount slots used: ${used}/${cat.discountSelectionLimit} (eligible items ≤ ${cat.discountEligibleUnder} ${eligibleLabel}, ${catModeLabel})`;
        }
        content.appendChild(catInfo);
    }

    const topLevelSubcats = Array.isArray(cat.subcategories) && cat.subcategories.length
        ? cat.subcategories
        : [{ options: cat.options || [], name: "" }];
    renderSubcategoryLevel(cat, topLevelSubcats, content, {
        cat,
        catIndex,
        catKey,
        catDiscountUnlocked,
        catAutoApplyAll,
        parentPath: []
    });

    tabContentContainer.appendChild(content);
}

function renderSubcategoryOptions(subcat, subcatContent, subcatKey, cat, catIndex, catKey, catDiscountUnlocked, catAutoApplyAll) {
    const subcatHasDiscounts = hasDiscountConfig(subcat);
    const subcatDiscountUnlocked = subcatHasDiscounts && isDiscountUnlocked(subcat);
    const subcatAutoApplyAll = subcatDiscountUnlocked && shouldAutoApplyDiscount(subcat);
    const isDiscountableSubcat = subcatDiscountUnlocked && !subcatAutoApplyAll;

    const grid = document.createElement("div");
    grid.className = "options-grid";
    const rawColumns = Number.parseInt(subcat.columnsPerRow, 10);
    const columnsPerRow = Number.isFinite(rawColumns) && rawColumns > 0 ? rawColumns : 2;
    registerOptionGrid(grid, columnsPerRow);
    subcatContent.appendChild(grid);

    (subcat.options || []).forEach((opt, optionIndex) => {
        renderOption(opt, grid, subcat, subcatKey, cat, catIndex, catKey, catDiscountUnlocked, catAutoApplyAll, isDiscountableSubcat);
    });
}

function appendOptionMetaSection(container, titleHtml, lines = [], className = "") {
    if (!container || !titleHtml || !lines.length) return;
    const section = document.createElement("div");
    section.className = `option-meta-section${className ? ` ${className}` : ""}`;

    const heading = document.createElement("div");
    heading.className = "option-meta-heading";
    heading.innerHTML = titleHtml;
    section.appendChild(heading);

    const body = document.createElement("div");
    body.className = "option-meta-lines";
    lines.forEach(line => {
        const item = document.createElement("div");
        item.className = "option-meta-line";
        item.innerHTML = line;
        body.appendChild(item);
    });
    section.appendChild(body);
    container.appendChild(section);
}

function formatSliderModifierDelta(amount) {
    const numeric = Number(amount) || 0;
    return `${numeric >= 0 ? "+" : "-"}${escapeHtml(String(Math.abs(numeric)))}`;
}

function formatSliderModifierDisplayValue(effect) {
    if (effect.type === "multiply") return `x${escapeHtml(String(effect.value))}`;
    if (effect.type === "cap") return `max ${escapeHtml(String(effect.value))}`;
    if (effect.type === "subtract") return formatSliderModifierDelta(-effect.value);
    return formatSliderModifierDelta(effect.value);
}

function getSliderModifierDisplayRows(option) {
    return normalizeSliderModifiers(option).map((effect, index) => {
        const selectedRows = getSliderModifierSelectionRows(option.id);
        const selectedTargets = effect.selectable
            ? selectedRows.map(row => row[index]).filter(Boolean)
            : [];
        const selectedTarget = selectedTargets.length ? selectedTargets.map(getPointTypeMarkup).join(", ") : "";
        const target = selectedTarget
            ? selectedTarget
            : effect.selectable
                ? `Player chooses${effect.choices.length ? ` (${effect.choices.map(getPointTypeMarkup).join(", ")})` : ""}`
                : getPointTypeMarkup(effect.attribute);
        return `${target}: ${formatSliderModifierDisplayValue(effect)}`;
    });
}

function renderOption(opt, grid, subcat, subcatKey, cat, catIndex, catKey, catDiscountUnlocked, catAutoApplyAll, isDiscountableSubcat) {
    const wrapper = document.createElement("div");
    wrapper.className = "option-wrapper";

    const selectedCount = selectedOptions[opt.id] || 0;
    const maxSelections = getOptionMaxSelections(opt);
    const hasTextInput = opt.inputType === "text";
    const hasMultipleCostOptions = normalizeOptionCostOptions(opt).length > 1;
    const isSingleChoice = maxSelections === 1;
    const lockedSelection = isOptionSelectionLocked(opt);

    if (isSingleChoice && !hasTextInput && !hasMultipleCostOptions) {
        wrapper.classList.add("is-clickable");
    }
    if (selectedCount > 0) {
        wrapper.classList.add("selected");
    }
    const optionBorderColor = getEffectiveDarkMode()
        ? (opt.darkBorderColor || opt.borderColor)
        : opt.borderColor;
    if (optionBorderColor && isSafeTextColor(optionBorderColor)) {
        wrapper.style.borderColor = optionBorderColor;
    }

    if (isSingleChoice && !hasTextInput && !hasMultipleCostOptions) {
        wrapper.onclick = (e) => {
            // Check if we clicked an interactive element like a discount button
            if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) {
                return;
            }
            if (selectedCount > 0) {
                if (!lockedSelection) removeSelection(opt);
            } else {
                ensureSubcategoryLimit(opt);
                if (canSelect(opt)) {
                    addSelection(opt);
                }
            }
        };
    }

    const imageUrl = opt.image || opt.img;
    if (imageUrl) {
        const normalizedImageUrl = normalizeAssetUrl(imageUrl);
        const cachedImg = normalizedImageUrl ? preloadedImageCache.get(normalizedImageUrl) : null;
        const img = cachedImg ? cachedImg.cloneNode(true) : document.createElement("img");
        img.loading = "eager";
        img.decoding = "sync";
        if (!cachedImg) {
            img.src = imageUrl;
        }
        img.alt = opt.label;
        wrapper.appendChild(img);
    }

    const contentWrapper = document.createElement("div");
    contentWrapper.className = "option-content";

    const label = document.createElement("strong");
    label.style.alignSelf = "stretch";
    label.style.textAlign = getOptionComponentAlignment(opt, "titleAlignment", optionTitleAlignment, optionTitleAlignmentExplicit);
    setMultilineText(label, opt.label || "");

    const requirements = document.createElement("div");
    requirements.className = "option-requirements";
    requirements.style.textAlign = getOptionComponentAlignment(opt, "metaAlignment", optionMetaAlignment, optionMetaAlignmentExplicit);

    const showingNextSelection = selectedCount < maxSelections;
    const displaySelectionNumber = showingNextSelection ? selectedCount + 1 : Math.max(selectedCount, 1);
    const selectedCostOptionIndex = getInitialCostOptionIndex(opt, displaySelectionNumber);
    const costChoices = getOptionEffectiveCostChoices(opt, {
        selectionNumber: displaySelectionNumber,
        includeUnavailable: true
    });
    const shouldShowCostOptions = costChoices.length > 1 && selectedCount === 0;
    const displayCost = getOptionEffectiveCost(opt, {
        costOptionIndex: selectedCostOptionIndex,
        selectionNumber: displaySelectionNumber
    });
    const originalCost = getOptionBaseCostByChoice(opt, selectedCostOptionIndex, {
        selectionNumber: displaySelectionNumber
    });

    let costToShow = displayCost;
    if (!showingNextSelection && selectedCount > 0 && discountedSelections[opt.id] && discountedSelections[opt.id].length >= selectedCount) {
        costToShow = discountedSelections[opt.id][selectedCount - 1] || displayCost;
    }

    const gain = [], spend = [];

    Object.entries(costToShow || {}).forEach(([type, val]) => {
        if (val < 0) {
            gain.push(getPointAmountMarkup(type, Math.abs(val)));
        } else {
            const orig = originalCost[type];
            if (orig !== undefined && orig !== val) {
                // Show modified price and original in parentheses.
                spend.push(`${getPointAmountMarkup(type, val)} (was ${escapeHtml(String(orig))})`);
            } else {
                spend.push(getPointAmountMarkup(type, val));
            }
        }
    });

    if (!shouldShowCostOptions) {
        appendOptionMetaSection(
            requirements,
            showingNextSelection && selectedCount > 0 ? "Next Selection" : "Points",
            [
                ...gain.map(line => `Gain: ${line}`),
                ...spend.map(line => `Cost: ${line}`)
            ],
            "option-meta-points"
        );
    }

    if (shouldShowCostOptions) {
        appendOptionMetaSection(
            requirements,
            "Cost Options",
            costChoices.map(choice => {
                const status = choice.index === selectedCostOptionIndex ? "●" : "○";
                return `${status} ${formatCostMapDisplay(choice.cost) || "Free"}`;
            }),
            "option-meta-points"
        );
    }

    const conditionalCostRows = getModifiedCostDisplayRows(opt, subcat);
    if (conditionalCostRows.length > 0) {
        const rows = conditionalCostRows.map(row => {
            const status = row.active ? "✅" : "❌";
            return `${status} if ${row.condition}, ${row.result}`;
        });
        appendOptionMetaSection(requirements, "Conditional Costs", rows, "option-meta-conditional-costs");
    }

    const autoGrantRows = getAutoGrantDisplayRows(opt);
    if (autoGrantRows.length > 0) {
        const rows = autoGrantRows.map(row => {
            const status = row.selected ? "✅" : "❌";
            const suffix = row.canDeselect ? " (can be deselected)" : " (locked)";
            return `${status} ${row.label}${suffix}`;
        });
        appendOptionMetaSection(requirements, "Automatically Grants", rows, "option-meta-auto-grants");
    }

    const sliderModifierRows = getSliderModifierDisplayRows(opt);
    if (sliderModifierRows.length > 0) {
        appendOptionMetaSection(requirements, "Slider Modifiers", sliderModifierRows, "option-meta-slider-modifiers");
    }

    const randomRollRows = getRandomRollDisplayRows(opt);
    if (randomRollRows.length > 0) {
        appendOptionMetaSection(requirements, "Roll Results", randomRollRows, "option-meta-random-results");
    }

    // Indicate modified cost availability/applied for this item.
    const displayDiffers = Object.entries(displayCost || {}).some(([type, val]) => val !== (originalCost[type] ?? val));
    const displayShowsFree = Object.entries(displayCost || {}).some(([type, val]) => val === 0 && (originalCost[type] ?? 0) > 0);
    const costToShowDiffers = Object.entries(costToShow || {}).some(([type, val]) => val !== (originalCost[type] ?? val));
    const costToShowShowsFree = Object.entries(costToShow || {}).some(([type, val]) => val === 0 && (originalCost[type] ?? 0) > 0);

    if (selectedCount > 0 && !showingNextSelection && costToShowDiffers) {
        appendOptionMetaSection(
            requirements,
            "Pricing Status",
            [costToShowShowsFree ? "Modified Cost Applied (Free)" : "Modified Cost Applied"],
            "option-meta-pricing-status"
        );
    } else if ((selectedCount === 0 || showingNextSelection) && displayDiffers) {
        appendOptionMetaSection(
            requirements,
            "Pricing Status",
            [displayShowsFree ? "Modified Cost Available (Free)" : "Modified Cost Available"],
            "option-meta-pricing-status"
        );
    }

    let conflictRendered = false;
    const displayRequirements = getOptionDisplayRequirements(opt, displaySelectionNumber);
    if (displayRequirements.length > 0) {
        const prereqLines = displayRequirements.flatMap(requirement => buildRequirementDisplayLines(requirement));
        const prereqHelpTitle = displayRequirements.map(buildRequirementHelpText).join("\n\n");
        const helpHtml = `<span class=\"prereq-help\" title=\"${prereqHelpTitle.replace(/\"/g, '&quot;')}\">?</span>`;
        appendOptionMetaSection(requirements, `🔒 Requires ${helpHtml}`, prereqLines, "option-meta-prerequisites");

        const conflictIds = getOptionConflictIds(opt);
        if (conflictIds.length > 0) {
            const conflictLines = conflictIds.map(id => {
                const label = getOptionLabelMarkup(id) || id;
                const selected = !!selectedOptions[id];
                const symbol = selected ? '❌' : '✅';
                return `${symbol} ${label}`;
            });
            appendOptionMetaSection(requirements, "⚠️ Incompatible With", conflictLines, "option-meta-conflicts");
            conflictRendered = true;
        }
    }

    const conflictIds = getOptionConflictIds(opt);
    if (!conflictRendered && conflictIds.length > 0) {
        const conflictLines = conflictIds.map(id => {
            const label = getOptionLabelMarkup(id) || id;
            const selected = !!selectedOptions[id];
            const symbol = selected ? '❌' : '✅';
            return `${symbol} ${label}`;
        });
        appendOptionMetaSection(requirements, "⚠️ Incompatible With", conflictLines, "option-meta-conflicts");
    }

    const desc = document.createElement("div");
    desc.className = "option-description";
    desc.style.textAlign = getOptionComponentAlignment(opt, "descriptionAlignment", optionDescriptionAlignment, optionDescriptionAlignmentExplicit);
    setMultilineText(desc, opt.description || "");

    const baseCost = getOptionBaseCost(opt);
    const discountContexts = [];
    if (isDiscountableSubcat && opt.disableSubcategoryDiscount !== true) {
        discountContexts.push({
            level: 'subcategory',
            entity: subcat,
            limit: subcat.discountSelectionLimit,
            eligible: subcat.discountEligibleUnder,
            map: getSubcategoryDiscountMap(subcatKey),
            mode: subcat.discountMode || 'half'
        });
    }
    if (catDiscountUnlocked && opt.disableCategoryDiscount !== true && !catAutoApplyAll) {
        discountContexts.push({
            level: 'category',
            entity: cat,
            limit: cat.discountSelectionLimit,
            eligible: cat.discountEligibleUnder,
            map: getCategoryDiscountMap(catKey),
            mode: cat.discountMode || 'half'
        });
    }

    discountContexts.forEach(discountContext => {
        const {
            value: eligibleCost
        } = getDiscountEligibleCost(baseCost, discountContext.entity);
        if (eligibleCost === null || eligibleCost <= 0 || eligibleCost > discountContext.eligible) {
            return;
        }

        const discountMap = discountContext.map;
        const assignedCount = discountMap[opt.id] || 0;
        const totalAssigned = getDiscountTotalCount(discountMap);
        const discountLimit = discountContext.limit || 0;
        const alreadySelected = selectedOptions[opt.id] > 0;
        const totalOthers = totalAssigned - assignedCount;
        const availableSlots = Math.max(0, discountLimit - totalOthers);
        const contextLabel = discountContext.level === 'subcategory' ? 'subcategory' : 'category';
        const discountLabel = discountContext.mode === 'free' ? 'Free slots' : 'Discount slots';

        if (assignedCount > 0) {
            const remaining = Math.max(0, assignedCount - (selectedOptions[opt.id] || 0));
            const remainingText = remaining > 0 ? ` (remaining ${remaining})` : '';
            requirements.innerHTML += `${discountLabel} assigned (${contextLabel}): ${assignedCount}${remainingText}<br>`;
        }

        const discountBtn = document.createElement("button");
        discountBtn.className = "discount-toggle";
        if (assignedCount > 0) {
            discountBtn.textContent = discountContext.mode === 'free'
                ? `Discount Applied (${assignedCount}) – Free (${contextLabel})`
                : `Discount Applied (${assignedCount}) (${contextLabel})`;
        } else {
            discountBtn.textContent = discountContext.mode === 'free'
                ? `Apply Free Slot (${contextLabel})`
                : `Apply Discount (${contextLabel})`;
        }

        const canIncrease = availableSlots > assignedCount;
        discountBtn.disabled = alreadySelected || (assignedCount === 0 && !canIncrease);
        if (alreadySelected) {
            discountBtn.title = `Remove and re-select this item to change ${contextLabel} discount status.`;
        } else if (assignedCount === 0 && !canIncrease) {
            const limitLabel = discountContext.mode === 'free' ? 'Free slot' : 'Discount';
            discountBtn.title = `${limitLabel} limit reached at the ${contextLabel} level. Remove an existing selection to free a slot (limit ${discountLimit}).`;
        } else {
            discountBtn.title = discountContext.mode === 'free'
                ? `Assign or remove a free ${contextLabel} slot for this item.`
                : `Cycle the number of ${contextLabel} discount slots applied to this item.`;
        }

        discountBtn.onclick = () => {
            if (selectedOptions[opt.id] > 0) return;

            const current = discountMap[opt.id] || 0;
            const freshTotal = getDiscountTotalCount(discountMap) - current;
            const maxAllowed = Math.max(0, discountLimit - freshTotal);

            if (maxAllowed === 0 && current === 0) {
                const limitLabel = discountContext.mode === 'free' ? 'Free slot' : 'Discount';
                alert(`${limitLabel} limit reached at the ${contextLabel} level. Remove an existing selection to free a slot (limit ${discountLimit}).`);
                return;
            }

            let next = current + 1;
            if (next > maxAllowed) {
                next = 0;
            }

            if (next > 0) {
                discountMap[opt.id] = next;
                discountContexts.forEach(otherContext => {
                    if (otherContext !== discountContext && otherContext.map[opt.id]) {
                        delete otherContext.map[opt.id];
                    }
                });
            } else {
                delete discountMap[opt.id];
            }
            renderAccordion();
        };
        requirements.appendChild(discountBtn);
    });

    const optionGrantContexts = getActiveOptionGrantContexts(opt.id);
    optionGrantContexts.forEach(ctx => {
        const assignedCount = ctx.map[opt.id] || 0;
        const totalAssigned = getDiscountTotalCount(ctx.map);
        const totalOthers = totalAssigned - assignedCount;
        const maxAllowed = Math.max(0, ctx.limit - totalOthers);
        const alreadySelected = selectedOptions[opt.id] || 0;
        const providerLabel = ctx.provider?.label || ctx.provider?.id || "Option";

        if (assignedCount > 0) {
            const remaining = Math.max(0, assignedCount - alreadySelected);
            const remainingText = remaining > 0 ? ` (remaining ${remaining})` : "";
            const slotText = ctx.mode === 'free' ? "Free slots" : "Discount slots";
            requirements.innerHTML += `${slotText} assigned by ${providerLabel}: ${assignedCount}${remainingText}<br>`;
        }

        const btn = document.createElement("button");
        btn.className = "discount-toggle";
        btn.textContent = ctx.mode === 'free'
            ? `Use Free Slot (${providerLabel})`
            : `Use Discount Slot (${providerLabel})`;
        if (assignedCount > 0) {
            btn.textContent = ctx.mode === 'free'
                ? `Free Slot Applied (${assignedCount}) – ${providerLabel}`
                : `Discount Applied (${assignedCount}) – ${providerLabel}`;
        }

        const canIncrease = maxAllowed > assignedCount;
        btn.disabled = alreadySelected > 0 || (assignedCount === 0 && !canIncrease);
        if (alreadySelected > 0) {
            btn.title = `Remove and re-select this item to change slots from ${providerLabel}.`;
        } else if (assignedCount === 0 && !canIncrease) {
            btn.title = `${providerLabel} has no slots left to assign (${ctx.limit} max).`;
        } else {
            btn.title = `Cycle assigned slots from ${providerLabel}.`;
        }

        btn.onclick = () => {
            if ((selectedOptions[opt.id] || 0) > 0) return;
            const current = ctx.map[opt.id] || 0;
            const freshTotal = getDiscountTotalCount(ctx.map) - current;
            const allowed = Math.max(0, ctx.limit - freshTotal);
            if (allowed === 0 && current === 0) {
                alert(`${providerLabel} has no slots left to assign.`);
                return;
            }
            let next = current + 1;
            if (next > allowed) next = 0;
            if (next > 0) {
                ctx.map[opt.id] = next;
            } else {
                delete ctx.map[opt.id];
            }
            renderAccordion();
        };

        requirements.appendChild(btn);
    });

    contentWrapper.appendChild(label);
    contentWrapper.appendChild(requirements);
    contentWrapper.appendChild(desc);

    if (opt.inputType === "slider") {
        renderSliderControl(opt, contentWrapper);
    } else if (opt.inputType === "text") {
        renderTextInputControl(opt, contentWrapper);
        renderSelectionButton(opt, contentWrapper);
    } else {
        if (shouldRenderSelectionControls(opt)) {
            renderSelectionButton(opt, contentWrapper);
        }
        if (opt.pointAllocation) {
            renderPointAllocationControl(opt, contentWrapper);
        }
        if (selectedOptions[opt.id] && normalizeSliderModifiers(opt).some(effect => effect.selectable)) {
            renderSliderModifierControls(opt, contentWrapper);
        }
        if (selectedOptions[opt.id] && opt.dynamicCost) {
            renderDynamicCost(opt, contentWrapper);
        }
    }

    wrapper.appendChild(contentWrapper);
    grid.appendChild(wrapper);
}

function renderSliderControl(opt, contentWrapper) {
    const { currencyType, attributeType } = getSliderTypes(opt.costPerPoint || {});
    const attrName = attributeType;
    const effectiveMin = opt.min ?? attributeRanges[attrName]?.min ?? 0;
    const effectiveMax = attributeRanges[attrName]?.max ?? opt.max ?? 40;

    let currentValue = attributeSliderValues[opt.id] ?? effectiveMin;
    if (currentValue > effectiveMax) {
        currentValue = effectiveMax;
        attributeSliderValues[opt.id] = currentValue;
        if (attrName) attributeSliderValues[attrName] = currentValue;
    }
    if (currentValue < effectiveMin) {
        currentValue = effectiveMin;
        attributeSliderValues[opt.id] = currentValue;
        if (attrName) attributeSliderValues[attrName] = currentValue;
    }

    if (attributeSliderValues[opt.id] === undefined) {
        attributeSliderValues[opt.id] = currentValue;
    }
    if (attrName && attributeSliderValues[attrName] === undefined) {
        attributeSliderValues[attrName] = currentValue;
    }

    const sliderWrapper = document.createElement("div");
    sliderWrapper.className = "slider-wrapper";

    const sliderLabel = document.createElement("label");
    sliderLabel.textContent = `${opt.label}: ${currentValue}`;
    sliderLabel.htmlFor = `${opt.id}-slider`;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = effectiveMin;
    slider.max = effectiveMax;
    slider.value = currentValue;
    slider.id = `${opt.id}-slider`;

    slider.oninput = (e) => {
        restoreActiveSliderModifierPointValues();
        const newVal = parseInt(e.target.value);
        const { currencyType: currentCurrency, attributeType: currentAttribute } = getSliderTypes(opt.costPerPoint || {});
        const costPerPoint = opt.costPerPoint?.[currentCurrency] || 0;
        const attrNameForCost = currentAttribute;

        const currentEffectiveMax = attributeRanges[attrNameForCost]?.max ?? parseInt(slider.max);
        slider.max = currentEffectiveMax;

        if (newVal > currentEffectiveMax) {
            e.target.value = currentEffectiveMax;
            sliderLabel.textContent = `${opt.label}: ${currentEffectiveMax}`;
            return;
        }

        const oldVal = attributeSliderValues[opt.id] ?? effectiveMin;
        let diff = newVal - oldVal;

        let freeBoostAmount = 0;
        for (const dynOptId in dynamicSelections) {
            const dynOpt = findOptionById(dynOptId);
            if (dynOpt && dynOpt.dynamicCost) {
                dynOpt.dynamicCost.choices.forEach((choice, i) => {
                    if (dynamicSelections[dynOptId][i] === attrNameForCost && dynOpt.dynamicCost.types[i] === "Boost Attribute") {
                        freeBoostAmount = parseInt(dynOpt.dynamicCost.values[i]);
                    }
                });
            }
        }

        let pointsChange = 0;

        if (diff > 0) {
            const paidOldVal = Math.max(0, oldVal - freeBoostAmount);
            const paidNewVal = Math.max(0, newVal - freeBoostAmount);
            const paidIncrease = paidNewVal - paidOldVal;

            if (paidIncrease > 0) {
                const cost = costPerPoint * paidIncrease;
                if (points[currentCurrency] < cost && !allowNegativeTypes.has(currentCurrency)) {
                    e.target.value = oldVal;
                    sliderLabel.textContent = `${opt.label}: ${oldVal}`;
                    return;
                }
                pointsChange = -cost;
            }
        } else if (diff < 0) {
            const paidOldVal = Math.max(0, oldVal - freeBoostAmount);
            const paidNewVal = Math.max(0, newVal - freeBoostAmount);
            const paidDecrease = paidOldVal - paidNewVal;

            if (paidDecrease > 0) {
                pointsChange = costPerPoint * paidDecrease;
            }
        }

        if (pointsChange !== 0) {
            points[currentCurrency] += pointsChange;
        }

        attributeSliderValues[opt.id] = newVal;
        if (attrNameForCost) {
            attributeSliderValues[attrNameForCost] = newVal;
        }
        if (attrNameForCost && points.hasOwnProperty(attrNameForCost)) {
            points[attrNameForCost] = newVal;
        }

        sliderLabel.textContent = `${opt.label}: ${newVal}`;
        applyDynamicCosts();
        updatePointsDisplay();
    };

    sliderWrapper.appendChild(sliderLabel);
    sliderWrapper.appendChild(slider);
    contentWrapper.appendChild(sliderWrapper);
}

function renderTextInputControl(opt, contentWrapper) {
    const inputWrapper = document.createElement("div");
    inputWrapper.className = "option-input-wrapper";
    const isSelected = !!selectedOptions[opt.id];

    if (opt.inputLabel) {
        const label = document.createElement("label");
        label.textContent = opt.inputLabel;
        label.setAttribute("for", `option-input-${opt.id}`);
        inputWrapper.appendChild(label);
    }

    const input = document.createElement("input");
    input.type = "text";
    input.id = `option-input-${opt.id}`;
    input.className = "option-text-input";
    input.placeholder = isSelected ? (opt.placeholder || "") : "Select this option to enter text";
    const maxLength = Number(opt.maxLength);
    input.maxLength = Number.isFinite(maxLength) && maxLength > 0 ? Math.floor(maxLength) : 200;
    input.value = sanitizeStoryInputValue(storyInputs[opt.id] || "", input.maxLength);
    input.disabled = !isSelected;
    input.addEventListener("input", e => {
        if (!selectedOptions[opt.id]) {
            e.target.value = "";
            delete storyInputs[opt.id];
            return;
        }
        const safeValue = sanitizeStoryInputValue(e.target.value, input.maxLength);
        e.target.value = safeValue;
        storyInputs[opt.id] = safeValue;
    });
    inputWrapper.appendChild(input);
    contentWrapper.appendChild(inputWrapper);
}

function renderSelectionButton(opt, contentWrapper) {
    const controls = document.createElement("div");
    controls.className = "option-controls";

    const count = selectedOptions[opt.id] || 0;
    const max = getOptionMaxSelections(opt);
    const nextSelectionNumber = count + 1;
    const costOptions = normalizeOptionCostOptions(opt, { selectionNumber: nextSelectionNumber });
    const displayCostOptions = normalizeOptionCostOptions(opt, {
        selectionNumber: nextSelectionNumber,
        includeUnavailable: true
    });
    const selectedCostOptionIndex = getInitialCostOptionIndex(opt, nextSelectionNumber);
    const canAdd = canSelect(opt);
    const grant = autoGrantedSelections[opt.id];
    const lockedAutoGrant = isAutoGrantedLocked(opt.id);
    const lockedSelection = isOptionSelectionLocked(opt);
    const grantSourceLabel = grant?.sourceId ? (getOptionLabel(grant.sourceId) || grant.sourceId) : "";

    if (displayCostOptions.length > 1 && count < max && !grant) {
        const select = document.createElement("select");
        select.className = "cost-option-select";
        displayCostOptions.forEach(choice => {
            const option = document.createElement("option");
            const effectiveCost = getOptionEffectiveCost(opt, {
                costOptionIndex: choice.index,
                selectionNumber: nextSelectionNumber,
                includeUnavailable: true
            });
            option.value = String(choice.index);
            option.textContent = formatCostMapPlainText(effectiveCost) || "Free";
            option.disabled = choice.available === false || !canAffordCost(effectiveCost);
            select.appendChild(option);
        });
        select.value = String(selectedCostOptionIndex);
        select.addEventListener("change", () => {
            selectedCostOptionIndexes[opt.id] = Number(select.value);
            renderAccordion();
        });
        controls.appendChild(select);
    }

    if (max > 1) {
        const stepper = document.createElement("div");
        stepper.className = "option-stepper";

        const incrementBtn = document.createElement("button");
        incrementBtn.type = "button";
        incrementBtn.className = "stepper-btn";
        incrementBtn.textContent = "+";
        incrementBtn.disabled = (!canAdd && count === 0) || (count >= max && max !== Infinity);
        incrementBtn.onclick = (e) => {
            e.stopPropagation();
            ensureSubcategoryLimit(opt);
            if (canSelect(opt)) {
                addSelection(opt, { costOptionIndex: getInitialCostOptionIndex(opt, nextSelectionNumber) });
            }
        };

        const countDisplay = document.createElement("span");
        countDisplay.className = "stepper-count";
        countDisplay.textContent = String(count);
        const maxLabel = max === Infinity ? "∞" : String(max);
        countDisplay.title = `Selected ${count} of ${maxLabel}`;

        const decrementBtn = document.createElement("button");
        decrementBtn.type = "button";
        decrementBtn.className = "stepper-btn remove-btn";
        decrementBtn.textContent = "-";
        decrementBtn.disabled = count <= 0 || lockedAutoGrant || lockedSelection;
        if (lockedAutoGrant) {
            decrementBtn.title = grantSourceLabel
                ? `Granted by ${grantSourceLabel} and cannot be removed directly.`
                : "This granted option cannot be removed directly.";
        } else if (lockedSelection) {
            decrementBtn.title = "This option is locked after selection.";
        }
        decrementBtn.onclick = (e) => {
            e.stopPropagation();
            removeSelection(opt);
        };

        stepper.appendChild(decrementBtn);
        stepper.appendChild(countDisplay);
        stepper.appendChild(incrementBtn);
        controls.appendChild(stepper);
    } else {
        const btn = document.createElement("button");
        btn.textContent = count > 0 ? (grant ? "✓ Granted" : "✓ Selected") : "Select";
        btn.disabled = (!canAdd && count === 0) || lockedAutoGrant || (count > 0 && lockedSelection);
        if (lockedAutoGrant) {
            btn.title = grantSourceLabel
                ? `Granted by ${grantSourceLabel} and cannot be removed directly.`
                : "This granted option cannot be removed directly.";
        } else if (count > 0 && lockedSelection) {
            btn.title = "This option is locked after selection.";
        }
        btn.onclick = () => {
            if (count > 0) {
                removeSelection(opt);
            } else {
                ensureSubcategoryLimit(opt);
                if (canSelect(opt)) {
                    addSelection(opt, { costOptionIndex: getInitialCostOptionIndex(opt, nextSelectionNumber) });
                }
            }
        };
        controls.appendChild(btn);
    }

    contentWrapper.appendChild(controls);
}

function renderPointAllocationControl(opt, contentWrapper) {
    const config = normalizePointAllocationConfig(opt);
    if (!config) return;

    const wrapper = document.createElement("div");
    wrapper.className = "dynamic-choice-wrapper point-allocation-wrapper";
    const selected = !!selectedOptions[opt.id];
    const values = getPointAllocationValues(opt);
    const totalUsed = Object.values(values).reduce((sum, value) => sum + (Number(value) || 0), 0);

    const heading = document.createElement("label");
    heading.textContent = `Allocate ${config.total} picks (${totalUsed}/${config.total})`;
    heading.style.display = "block";
    wrapper.appendChild(heading);

    const sliderControls = {};
    const updateDisplayedAllocation = () => {
        const currentValues = getPointAllocationValues(opt);
        const used = Object.values(currentValues).reduce((sum, value) => sum + (Number(value) || 0), 0);
        heading.textContent = `Allocate ${config.total} picks (${used}/${config.total})`;
        Object.entries(sliderControls).forEach(([controlType, control]) => {
            const nextValue = String(currentValues[controlType] || 0);
            control.valueLabel.textContent = nextValue;
            if (document.activeElement !== control.slider) {
                control.slider.value = nextValue;
            }
        });
    };

    config.types.forEach((type, index) => {
        const row = document.createElement("div");
        row.className = "point-allocation-row";
        row.style.marginTop = "0.25em";

        const label = document.createElement("label");
        label.htmlFor = `${opt.id}-${type}-allocation-slider`;
        label.textContent = `${stripFormattingMarkup(type)}: `;

        const valueLabel = document.createElement("span");
        valueLabel.textContent = String(values[type] || 0);
        label.appendChild(valueLabel);

        const slider = document.createElement("input");
        slider.type = "range";
        slider.className = "point-allocation-slider";
        slider.min = "0";
        slider.max = String(config.total);
        slider.step = "1";
        slider.value = String(values[type] || 0);
        slider.id = `${opt.id}-${type}-allocation-slider`;
        slider.disabled = selected;
        sliderControls[type] = { slider, valueLabel };
        slider.addEventListener("input", () => {
            const current = getPointAllocationValues(opt);
            const requested = Math.max(0, Math.min(config.total, Math.floor(Number(slider.value) || 0)));
            current[type] = requested;

            let remaining = config.total - requested;
            config.types.forEach(otherType => {
                if (otherType === type) return;
                const otherValue = Math.max(0, Math.floor(Number(current[otherType]) || 0));
                const nextValue = Math.min(otherValue, remaining);
                current[otherType] = nextValue;
                remaining -= nextValue;
            });

            if (remaining > 0) {
                const fallbackType = config.types.find(otherType => otherType !== type) || type;
                current[fallbackType] = (Number(current[fallbackType]) || 0) + remaining;
            }

            pointAllocationSelections[opt.id] = normalizePointAllocationValues(opt, current);
            updateDisplayedAllocation();
        });

        row.appendChild(label);
        row.appendChild(slider);
        if (index === config.types.length - 1) {
            const note = document.createElement("span");
            note.textContent = " (auto-balances total)";
            row.appendChild(note);
        }
        wrapper.appendChild(row);
    });

    if (selected) {
        const note = document.createElement("div");
        note.className = "field-help";
        note.textContent = "Remove and re-select this option to change the allocation.";
        wrapper.appendChild(note);
    }

    contentWrapper.appendChild(wrapper);
}

function renderSliderModifierControls(opt, contentWrapper) {
    const effects = normalizeSliderModifiers(opt);
    const selectableEffects = effects
        .map((effect, index) => ({ ...effect, index }))
        .filter(effect => effect.selectable);
    if (!selectableEffects.length) return;

    const wrapper = document.createElement("div");
    wrapper.className = "dynamic-choice-wrapper";
    const selectedCount = Math.max(1, selectedOptions[opt.id] || 1);
    let selectionRows = getSliderModifierSelectionRows(opt.id);
    while (selectionRows.length < selectedCount) selectionRows.push([]);
    if (selectionRows.length > selectedCount) selectionRows = selectionRows.slice(0, selectedCount);

    const header = document.createElement("div");
    header.className = "field-inline";
    const headerLabel = document.createElement("label");
    headerLabel.textContent = "Player-chosen slider modifiers";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "button-subtle";
    clearBtn.textContent = "Clear all";
    clearBtn.disabled = !selectionRows.some(row => row.some(Boolean));
    clearBtn.addEventListener("click", () => {
        delete sliderModifierSelections[opt.id];
        applyDynamicCosts();
        updatePointsDisplay();
        renderAccordion();
    });
    header.append(headerLabel, clearBtn);
    wrapper.appendChild(header);

    for (let selectionIndex = 0; selectionIndex < selectedCount; selectionIndex += 1) {
        const selectionGroup = document.createElement("div");
        selectionGroup.className = "dynamic-choice-group";
        if (selectedCount > 1) {
            const selectionTitle = document.createElement("div");
            selectionTitle.className = "field-help";
            selectionTitle.textContent = `Selection ${selectionIndex + 1}`;
            selectionGroup.appendChild(selectionTitle);
        }

        selectableEffects.forEach(effect => {
            const row = document.createElement("div");
            row.className = "field-inline";

            const label = document.createElement("label");
            const verb = effect.type === "cap"
                ? `Max ${effect.value}`
                : effect.type === "add"
                    ? `+${effect.value}`
                    : effect.type === "subtract"
                        ? `-${effect.value}`
                        : `x${effect.value}`;
            label.textContent = `Slider modifier (${verb})`;

            const select = document.createElement("select");
            select.innerHTML = `<option value="">-- Select --</option>` +
                effect.choices.map(choice => `<option value="${escapeHtml(choice)}">${getPointTypeMarkup(choice)}</option>`).join("");
            select.value = selectionRows[selectionIndex]?.[effect.index] || "";

            select.addEventListener("change", () => {
                const rows = getSliderModifierSelectionRows(opt.id);
                while (rows.length < selectedCount) rows.push([]);
                const previous = rows[selectionIndex]?.[effect.index] || "";
                const next = select.value;
                rows[selectionIndex] = [...(rows[selectionIndex] || [])];
                rows[selectionIndex][effect.index] = next;
                const chosen = rows.flat().filter(Boolean);
                if (new Set(chosen).size !== chosen.length) {
                    alert("Each slider modifier selection must be unique.");
                    select.value = previous;
                    return;
                }
                setSliderModifierSelectionRows(opt.id, rows);
                applyDynamicCosts();
                updatePointsDisplay();
                renderAccordion();
            });

            row.append(label, select);
            selectionGroup.appendChild(row);
        });

        wrapper.appendChild(selectionGroup);
    }

    contentWrapper.appendChild(wrapper);
}

function renderDynamicCost(opt, contentWrapper) {
    const choiceWrapper = document.createElement("div");
    choiceWrapper.className = "dynamic-choice-wrapper";

    const numChoices = opt.dynamicCost.values.length;
    const affectedTypes = opt.dynamicCost.types || [];

    if (!dynamicSelections[opt.id]) {
        dynamicSelections[opt.id] = Array(numChoices).fill("");
    }

    for (let i = 0; i < numChoices; i++) {
        const select = document.createElement("select");
        select.innerHTML = `<option value="">-- Select --</option>` +
            opt.dynamicCost.choices.map(choice => `<option value="${choice}">${choice}</option>`).join("");
        select.value = dynamicSelections[opt.id][i] || "";

        const label = document.createElement("label");
        const valueText = opt.dynamicCost.values[i];
        let effectText = "";
        if (typeof valueText === 'string' && valueText.startsWith("cap:")) {
            effectText = `(Cap at ${valueText.slice(4)})`;
        } else if (typeof valueText === 'number') {
            effectText = `(${valueText >= 0 ? "+" : ""}${valueText})`;
        }
        label.textContent = `${affectedTypes[i] || "Select Effect"}: ${effectText}`;
        label.style.display = "block";
        label.style.marginTop = "0.25em";

        select.onchange = (e) => {
            const newValue = e.target.value;
            const prevValue = dynamicSelections[opt.id][i];

            const tempDynamicSelections = [...dynamicSelections[opt.id]];
            tempDynamicSelections[i] = newValue;
            const uniqueSelections = new Set(tempDynamicSelections.filter(v => v !== ""));
            if (uniqueSelections.size !== tempDynamicSelections.filter(v => v !== "").length) {
                alert("Each selection must be unique for this set of choices.");
                e.target.value = prevValue;
                return;
            }

            dynamicSelections[opt.id][i] = newValue;
            applyDynamicCosts();
            updatePointsDisplay();
            renderAccordion();
        };
        choiceWrapper.appendChild(label);
        choiceWrapper.appendChild(select);
    }
    contentWrapper.appendChild(choiceWrapper);
}

// Put this near your other helpers (top-level scope)

// Put this near your other helpers (top-level scope)
function prereqReferencesId(prereq, id) {
    if (!prereq) return false;

    // String: could be a single id or a boolean expression referencing ids
    if (typeof prereq === 'string') {
        // Match whole-id occurrences: kgA, not substrings like kgAB
        const re = new RegExp(`\\b${id}\\b`);
        return re.test(prereq);
    }

    // Array: interpreted as "must have all" (or however you’re using it)
    if (Array.isArray(prereq)) {
        return prereq.includes(id);
    }

    // Object: support {and:[]}, {or:[]}, {not:...} (any can be omitted)
    if (typeof prereq === 'object') {
        const hasAnd = Array.isArray(prereq.and) && prereq.and.some(p => prereqReferencesId(p, id));
        const hasOr = Array.isArray(prereq.or) && prereq.or.some(p => prereqReferencesId(p, id));
        const hasNot = prereq.not ? prereqReferencesId(prereq.not, id) : false;

        // If it's referenced positively in AND/OR, or in NOT (still a dependency)
        return hasAnd || hasOr || hasNot;
    }

    return false;
}

function getOptionConflictIds(option) {
    if (!option?.id) return [];
    const ids = new Set(Array.isArray(option.conflictsWith) ? option.conflictsWith : []);
    getAllOptions().forEach(other => {
        if (!other || other.id === option.id || !Array.isArray(other.conflictsWith)) return;
        if (other.conflictsWith.includes(option.id)) ids.add(other.id);
    });
    return Array.from(ids);
}

function createThemeToggleButton() {
    const btn = document.createElement("button");
    btn.id = "themeToggle";
    btn.className = "theme-toggle";
    btn.type = "button";
    btn.addEventListener("click", toggleDarkMode);
    return btn;
}

function updateThemeToggleButton() {
    const canToggleTheme = themeMode === "toggle";
    let btn = document.getElementById("themeToggle");

    if (!canToggleTheme) {
        btn?.remove();
        return;
    }

    if (!btn) {
        btn = createThemeToggleButton();
        document.querySelector(".container")?.prepend(btn);
    }

    btn.textContent = getEffectiveDarkMode() ? '☀️' : '🌙';
    btn.title = "Toggle Dark Mode";
}

function toggleDarkMode() {
    if (themeMode !== "toggle") return;
    isDarkMode = !isDarkMode;
    localStorage.setItem('cyoa-dark-mode', isDarkMode);
    if (window._lastCyoaData) {
        applyCyoaData(window._lastCyoaData, { preservePlayerState: true });
    }
}

document.getElementById('themeToggle')?.addEventListener('click', toggleDarkMode);

// Backpack Feature
function openBackpackModal() {
    const modal = document.getElementById("backpackModal");
    const content = document.getElementById("backpackContent");
    content.innerHTML = "";

    // Group selected options by category
    const backpackByCategory = {};

    categories.forEach((cat) => {
        if (["points", "headerImage", "title", "description", "formulas", "backpack"].includes(cat.type)) {
            return;
        }

        const catName = cat.name;
        const selectedInCat = [];

        forEachCategoryOption(cat, (opt) => {
            if (selectedOptions[opt.id] > 0) {
                selectedInCat.push(opt);
            }
        });

        if (selectedInCat.length > 0) {
            backpackByCategory[catName] = selectedInCat;
        }
    });

    // Render categories and items
    Object.entries(backpackByCategory).forEach(([catName, options]) => {
        const categoryDiv = document.createElement("div");
        categoryDiv.className = "backpack-category";

        const titleDiv = document.createElement("div");
        titleDiv.className = "backpack-category-title";
        titleDiv.textContent = catName;
        categoryDiv.appendChild(titleDiv);

        const gridDiv = document.createElement("div");
        gridDiv.className = "backpack-grid";

        options.forEach((opt) => {
            const itemDiv = document.createElement("div");
            itemDiv.className = "backpack-item";

            const imageUrl = opt.image || opt.img;
            if (imageUrl) {
                const img = document.createElement("img");
                img.src = imageUrl;
                img.alt = opt.label;
                img.className = "backpack-item-image";
                itemDiv.appendChild(img);
            }

            const labelDiv = document.createElement("div");
            labelDiv.className = "backpack-item-label";
            const selectedCount = selectedOptions[opt.id] || 0;
            labelDiv.textContent = selectedCount > 1 ? `${opt.label} x${selectedCount}` : opt.label;
            itemDiv.appendChild(labelDiv);

            gridDiv.appendChild(itemDiv);
        });

        categoryDiv.appendChild(gridDiv);
        content.appendChild(categoryDiv);
    });

    // Show empty message if no selections
    if (Object.keys(backpackByCategory).length === 0) {
        const emptyMsg = document.createElement("p");
        emptyMsg.style.textAlign = "center";
        emptyMsg.style.color = "var(--text-muted)";
        emptyMsg.textContent = "No selections yet. Make some choices to see them here!";
        content.appendChild(emptyMsg);
    }

    modal.style.display = "flex";
}

function closeBackpackModal() {
    const modal = document.getElementById("backpackModal");
    modal.style.display = "none";
}



// Close modal when clicking outside
window.onclick = (event) => {
    const modal = document.getElementById("modal");
    const backpackModal = document.getElementById("backpackModal");

    if (event.target === modal) closeModal();
    if (event.target === backpackModal) closeBackpackModal();
};
