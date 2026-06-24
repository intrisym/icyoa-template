const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { evaluatePrereqExpr } = require("../logicExpr");
const { validateCyoaData } = require("./validate-cyoas");

const ROOT = path.join(__dirname, "..");
const PLAYER_SCRIPT_SOURCE = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
const EDITOR_SCRIPT_SOURCE = fs.readFileSync(path.join(ROOT, "editor.js"), "utf8");
const SERVER_SCRIPT_SOURCE = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const STYLE_SOURCE = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");

const FEATURE_COVERAGE = [
    "synthetic CYOA data computes selectable state and effective costs",
    "point gains, costs, refunds, and allow-negative point types",
    "alternate selectable option cost maps",
    "repeatable cost options can require base picks and enforce explicit or default per-choice limits",
    "Superpowered World power and motorbike upgrades require base purchases",
    "Superpowered World allies can be selected as allies or bitter enemies",
    "Superpowered World skill mastery upgrades require base skill purchases",
    "user-controlled fixed point grants split across multiple point types with sliders",
    "selected options can apply live caps, bonuses, subtraction, and multipliers to configured point types",
    "standalone points display is hidden when selectable cost options are shown",
    "single-select payment options render explicit selection controls",
    "point type renames cascade through all cost maps",
    "point type edits refresh category-level cost controls",
    "point tracker categories can be edited and toggled by players",
    "visual editor can add, edit, and remove point allocation configs",
    "visual editor exposes repeat payment option availability limits",
    "visual editor can reorder subcategories from collapsed section headers",
    "single-select options and maxSelections replacement",
    "multi-select options and option maxSelections",
    "selection-specific costs for repeatable options",
    "selection-specific prerequisites for repeatable options",
    "countsAsOneSelection for subcategory limits",
    "bypassSubcategoryMaxSelections options do not consume subcategory limit slots",
    "string, array, object, negated, OR, AND, and count-suffix prerequisites",
    "dependent selections are removed when prerequisites become false",
    "one-way outgoing and incoming conflicts",
    "category requiresOption and category maxSelections",
    "category and nested subcategory display mode and theme-specific color metadata",
    "single-subcategory categories render their lone subcategory open by default",
    "visual editor opens loaded CYOAs with category details collapsed",
    "visual editor collapse all includes option details",
    "adding and removing categories, subcategories, and options",
    "subcategory requiresOption",
    "subcategory discountFirstN with discountAmount",
    "subcategory manual discount slots, eligibility ceilings, and option opt-outs",
    "category manual discount slots, eligibility ceilings, and option opt-outs",
    "subcategory inherited costOptions",
    "subcategory columnsPerRow metadata",
    "subcategory-level freeform text inputs persist in imported state",
    "option-level freeform text inputs persist in exported state",
    "option-level freeform text inputs require selection and sanitize imported values",
    "option-level absolute modified costs",
    "subcategory-wide relative modified costs",
    "option and subcategory percentage modified costs rounded up",
    "cost-modifier changes unselect stale priced options instead of repricing them",
    "modified cost minCost and maxCost clamps",
    "option modified costs override subcategory modified costs and highest-priority matching rules win",
    "conditional cost display rows show resulting gain/cost without scope prefixes",
    "automatic grant display rows show granted targets and selected state",
    "can-deselect automatic grant display rows",
    "legacy discounts fallback for older data shapes",
    "idsAny/minSelected conditional cost rules",
    "Lantern Colorless Rings grant forced zero-point Emotional Instability and Characteristic Power discounts",
    "automatic option grants, locked grants, and free granted selections",
    "option-granted discount slots across target options",
    "theme settings include option metadata section colors",
    "custom JSON option fields are preserved and ignored by runtime logic",
    "packed export/import state round trips through player script helpers",
    "theme toggles preserve selected options and paid costs",
    "safe Markdown-style formatting with legacy color, size, weight, and point-type labels",
    "multi-open category tabs and Open All category control",
    "backpack rendering groups selected options and shows repeated counts through player script helpers"
];

const OPTION_META_THEME_KEYS = [
    "option-meta-bg",
    "option-meta-heading-bg",
    "option-meta-heading-text",
    "option-meta-points-color",
    "option-meta-conditional-color",
    "option-meta-auto-grants-color",
    "option-meta-slider-modifiers-color",
    "option-meta-prerequisites-color",
    "option-meta-conflicts-color"
];

function sanitizeStoryInputValue(value, maxLength = 200) {
    let normalized = "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        normalized = String(value);
    }
    const lengthLimit = Number.isFinite(Number(maxLength)) && Number(maxLength) > 0 ? Math.floor(Number(maxLength)) : 200;
    return normalized.slice(0, lengthLimit);
}

function extractFunctionSource(source, functionName) {
    const marker = `function ${functionName}`;
    const start = source.indexOf(marker);
    assert(start >= 0, `script.js should define ${functionName}`);
    const bodyStart = source.indexOf("{", start);
    assert(bodyStart >= 0, `script.js should define a body for ${functionName}`);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === "{") depth += 1;
        if (char === "}") depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to extract ${functionName} from script.js`);
}

function makeDomElement(tagName = "div") {
    return {
        tagName: tagName.toUpperCase(),
        className: "",
        children: [],
        style: {},
        _textContent: "",
        _innerHTML: "",
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        set textContent(value) {
            this._textContent = String(value);
        },
        get textContent() {
            return this._textContent;
        },
        set innerHTML(value) {
            this._innerHTML = String(value);
            this.children = [];
        },
        get innerHTML() {
            return this._innerHTML;
        }
    };
}

function collectElementText(element, output = []) {
    if (element.textContent) output.push(element.textContent);
    (element.children || []).forEach(child => collectElementText(child, output));
    return output;
}

function renderBackpackWithPlayerScript(data, selectedOptionsState) {
    const elements = {
        backpackModal: makeDomElement("div"),
        backpackContent: makeDomElement("div")
    };
    const documentStub = {
        getElementById(id) {
            if (!elements[id]) elements[id] = makeDomElement("div");
            return elements[id];
        },
        createElement(tagName) {
            return makeDomElement(tagName);
        }
    };
    const source = [
        extractFunctionSource(PLAYER_SCRIPT_SOURCE, "walkSubcategoryTree"),
        extractFunctionSource(PLAYER_SCRIPT_SOURCE, "forEachCategoryOption"),
        extractFunctionSource(PLAYER_SCRIPT_SOURCE, "openBackpackModal")
    ].join("\n");
    const categoriesState = data.filter(entry => !entry.type || entry.name);
    const execute = new Function("document", "categories", "selectedOptions", `${source}; openBackpackModal();`);
    execute(documentStub, categoriesState, selectedOptionsState);
    return collectElementText(elements.backpackContent);
}

function runPlayerScriptExportImportHelpers(state) {
    const source = [
        "function restoreActiveSliderModifierPointValues() {}",
        "function applyDynamicCosts() {}",
        extractFunctionSource(PLAYER_SCRIPT_SOURCE, "hasOwnEntries"),
        extractFunctionSource(PLAYER_SCRIPT_SOURCE, "buildExportState"),
        extractFunctionSource(PLAYER_SCRIPT_SOURCE, "buildPackedExportState"),
        extractFunctionSource(PLAYER_SCRIPT_SOURCE, "unpackImportedState")
    ].join("\n");
    const execute = new Function(
        "selectedOptions",
        "points",
        "discountedSelections",
        "selectedCostOptionHistory",
        "storyInputs",
        "attributeSliderValues",
        "dynamicSelections",
        "sliderModifierSelections",
        "pointAllocationSelections",
        "subcategoryDiscountSelections",
        "categoryDiscountSelections",
        "optionGrantDiscountSelections",
        "autoGrantedSelections",
        `${source}; const packed = buildPackedExportState(); return { packed, unpacked: unpackImportedState(JSON.parse(JSON.stringify(packed))) };`
    );
    return execute(
        state.selectedOptions || {},
        state.points || {},
        state.discountedSelections || {},
        state.selectedCostOptionHistory || {},
        state.storyInputs || {},
        state.attributeSliderValues || {},
        state.dynamicSelections || {},
        state.sliderModifierSelections || {},
        state.pointAllocationSelections || {},
        state.subcategoryDiscountSelections || {},
        state.categoryDiscountSelections || {},
        state.optionGrantDiscountSelections || {},
        state.autoGrantedSelections || {}
    );
}

function tokenizePrerequisiteExpression(expression = "") {
    const tokens = [];
    const tokenPattern = /\s*(&&|\|\||!|\(|\)|[a-zA-Z_][a-zA-Z0-9_]*(?:__\d+)?)\s*/g;
    let match;
    let consumed = 0;
    while ((match = tokenPattern.exec(expression)) !== null) {
        if (match.index !== consumed && expression.slice(consumed, match.index).trim()) return [];
        tokens.push(match[1]);
        consumed = tokenPattern.lastIndex;
    }
    return expression.slice(consumed).trim() ? [] : tokens;
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
        if (/^[a-zA-Z_][a-zA-Z0-9_]*(?:__\d+)?$/.test(token || "")) {
            consume();
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
    const ast = parseOr();
    if (index !== tokens.length) throw new Error("Unexpected prerequisite token");
    return ast;
}

function evaluatePrerequisiteNode(node, meetsRequirement) {
    if (node.type === "atom") return meetsRequirement(node.id);
    if (node.type === "not") return !evaluatePrerequisiteNode(node.child, meetsRequirement);
    if (node.type === "and") return node.children.every(child => evaluatePrerequisiteNode(child, meetsRequirement));
    if (node.type === "or") return node.children.some(child => evaluatePrerequisiteNode(child, meetsRequirement));
    return false;
}

function computePrerequisiteDisplayStatuses(expression, meetsRequirement) {
    const ast = parsePrerequisiteExpression(expression);
    const displayByKey = new Map();
    const addAtom = (rawId, negated, satisfied) => {
        const key = `${negated ? "!" : ""}${rawId}`;
        const existing = displayByKey.get(key);
        displayByKey.set(key, { id: rawId, negated, satisfied: !!satisfied || !!existing?.satisfied });
    };
    const visit = (node, inheritedSatisfiedOr = false, negated = false) => {
        if (node.type === "atom") {
            const atomSatisfied = negated ? !meetsRequirement(node.id) : meetsRequirement(node.id);
            addAtom(node.id, negated, inheritedSatisfiedOr || atomSatisfied);
            return;
        }
        if (node.type === "not") {
            visit(node.child, inheritedSatisfiedOr, !negated);
            return;
        }
        if (node.type === "or") {
            const orSatisfied = inheritedSatisfiedOr || evaluatePrerequisiteNode(node, meetsRequirement);
            node.children.forEach(child => visit(child, orSatisfied, negated));
            return;
        }
        if (node.type === "and") {
            node.children.forEach(child => visit(child, inheritedSatisfiedOr, negated));
        }
    };
    visit(ast);
    return Array.from(displayByKey.values());
}

function walkSubcategories(subcategories, visitor, path = []) {
    if (!Array.isArray(subcategories)) return;
    subcategories.forEach((subcat, index) => {
        const nextPath = [...path, index];
        visitor(subcat, nextPath);
        walkSubcategories(subcat.subcategories, visitor, nextPath);
    });
}

class CyoaEngine {
    constructor(source, label = null) {
        this.filename = label || "synthetic";
        this.data = JSON.parse(JSON.stringify(source));
        this.pointsEntry = this.data.find(entry => entry.type === "points") || { values: {} };
        this.points = { ...(this.pointsEntry.values || {}) };
        this.allowNegativeTypes = new Set(this.pointsEntry.allowNegative || []);
        this.categories = this.data.filter(entry => !entry.type || entry.name);
        this.selectedOptions = {};
        this.selectionHistory = [];
        this.discountedSelections = {};
        this.selectedCostOptionIndexes = {};
        this.selectedCostOptionHistory = {};
        this.storyInputs = {};
        this.attributeSliderValues = {};
        this.dynamicSelections = {};
        this.sliderModifierSelections = {};
        this.activeSliderModifierPointBaselines = {};
        this.pointAllocationSelections = {};
        this.subcategoryDiscountSelections = {};
        this.categoryDiscountSelections = {};
        this.optionGrantDiscountSelections = {};
        this.autoGrantedSelections = {};
        this.removedByCostModifier = [];
        this.costModifierChangeConfirmed = true;
        this.optionMap = new Map();

        this.categories.forEach(category => {
            (category.options || []).forEach(option => this.optionMap.set(option.id, option));
            walkSubcategories(category.subcategories, subcat => {
                (subcat.options || []).forEach(option => this.optionMap.set(option.id, option));
            });
        });
    }

    static synthetic() {
        return new CyoaEngine([
            { type: "title", text: "Synthetic Feature Coverage CYOA" },
            { type: "points", values: { Points: 10, Tokens: 0, Skills: 0, Equipment: 0 }, allowNegative: ["Debt"] },
            {
                type: "settings",
                themeMode: "toggle",
                optionTitleAlignment: "right",
                optionMetaAlignment: "left",
                optionDescriptionAlignment: "justify"
            },
            {
                name: "Core",
                subcategories: [
                    {
                        name: "Choices",
                        maxSelections: 2,
                        costOptions: [{ cost: { Points: 1 } }],
                        modifiedCosts: [
                            { ids: ["discountTrigger"], costDelta: { Points: -2 }, minCost: { Points: 0 }, priority: 1 },
                            { ids: ["surchargeTrigger"], costDelta: { Points: 3 }, maxCost: { Points: 5 }, priority: 2 },
                            { ids: ["legacyTrigger"], discounts: [], cost: { Points: 4 }, priority: 3 }
                        ],
                        options: [
                            { id: "freeDefault", label: "Default Cost" },
                            { id: "spendTwo", label: "Spend Two", cost: { Points: 2 } },
                            { id: "gainThree", label: "Gain Three", cost: { Points: -3 } },
                            { id: "freeText", label: "Free Text", cost: {}, inputType: "text", inputLabel: "Describe it" },
                            {
                                id: "alternateCost",
                                label: "Alternate Cost",
                                maxSelections: 2,
                                costOptions: [
                                    { label: "Payment Option 1", cost: { Points: 4 } },
                                    { label: "Payment Option 2", cost: { Tokens: 2 } }
                                ]
                            },
                            {
                                id: "tieredRepeatCost",
                                label: "Tiered Repeat Cost",
                                maxSelections: 2,
                                costOptions: [
                                    { cost: { Points: 1 }, costBySelection: [{ Points: 1 }, { Points: 2 }] },
                                    { cost: { Tokens: 1 }, costBySelection: [{ Tokens: 1 }, { Tokens: 2 }] }
                                ]
                            },
                            {
                                id: "limitedRepeatCosts",
                                label: "Limited Repeat Costs",
                                maxSelections: 3,
                                bypassSubcategoryMaxSelections: true,
                                costOptions: [
                                    { cost: { Points: 1 }, maxSelections: 1 },
                                    { cost: { Tokens: 1 }, minSelected: 1, requiresCostOption: 0, maxSelections: 1 },
                                    { cost: { Points: -1 }, minSelected: 1, requiresCostOption: 0, maxSelections: 1 }
                                ]
                            },
                            {
                                id: "implicitLimitedRepeatCosts",
                                label: "Implicit Limited Repeat Costs",
                                maxSelections: 3,
                                bypassSubcategoryMaxSelections: true,
                                costOptions: [
                                    { cost: { Points: 1 } },
                                    { cost: { Points: 2 }, minSelected: 1, requiresCostOption: 0 },
                                    { cost: { Points: -1 }, minSelected: 1, requiresCostOption: 0 }
                                ]
                            },
                            {
                                id: "allocatedTeamGrant",
                                label: "Allocated Team Grant",
                                costOptions: [{ cost: {} }],
                                pointAllocation: {
                                    total: 6,
                                    types: ["Skills", "Equipment"]
                                }
                            },
                            {
                                id: "inheritedDefaultOption",
                                label: "Inherited Default Option",
                                costOptions: [
                                    { cost: {} }
                                ]
                            },
                            { id: "multi", label: "Multi", cost: { Points: 1 }, maxSelections: 3, countsAsOneSelection: true },
                            { id: "limitBypass", label: "Limit Bypass", cost: {}, bypassSubcategoryMaxSelections: true },
                            { id: "discountTrigger", label: "Discount Trigger", cost: {} },
                            { id: "surchargeTrigger", label: "Surcharge Trigger", cost: {} },
                            { id: "legacyTrigger", label: "Legacy Trigger", cost: {} },
                            { id: "maxClampBase", label: "Max Clamp Base", cost: { Points: 4 } },
                            { id: "percentBase", label: "Percent Base", cost: { Points: 7 } },
                            {
                                id: "optionOverride",
                                label: "Option Override",
                                cost: { Points: 2 },
                                modifiedCosts: [
                                    { ids: ["discountTrigger"], cost: { Points: 7 }, priority: 1 }
                                ]
                            },
                            {
                                id: "optionPriorityTarget",
                                label: "Option Priority Target",
                                cost: { Points: 9 },
                                modifiedCosts: [
                                    { ids: ["preA"], cost: { Points: 5 }, priority: 1 },
                                    { ids: ["preB"], cost: { Points: 2 }, priority: 5 }
                                ]
                            }
                        ]
                    },
                    {
                        name: "Prerequisites",
                        options: [
                            { id: "preA", label: "Pre A", cost: {} },
                            { id: "preB", label: "Pre B", cost: {} },
                            { id: "requiresString", label: "Requires String", cost: {}, prerequisites: "preA && !preB" },
                            { id: "requiresArray", label: "Requires Array", cost: {}, prerequisites: ["preA"] },
                            { id: "requiresObject", label: "Requires Object", cost: {}, prerequisites: { and: ["preA"], or: ["preB", "multi__2"] } },
                            { id: "requiresCount", label: "Requires Count", cost: {}, prerequisites: "multi__2" },
                            {
                                id: "repeatablePrereqGear",
                                label: "Repeatable Prereq Gear",
                                maxSelections: 2,
                                costOptions: [{ cost: { Points: 1 }, costBySelection: [{ Points: 1 }, { Points: 3 }] }],
                                prerequisitesBySelection: [null, "repeatablePrereqUnlock"]
                            },
                            { id: "repeatablePrereqUnlock", label: "Repeatable Prereq Unlock", cost: {} },
                            {
                                id: "repeatableOptionA",
                                label: "Option A",
                                maxSelections: 2,
                                costOptions: [{ cost: { Points: 3 }, costBySelection: [{ Points: 3 }, { Points: 5 }] }],
                                prerequisitesBySelection: [null, "repeatableOptionB"]
                            },
                            { id: "repeatableOptionB", label: "Option B", cost: {} },
                            { id: "gearGearExoSuit1", label: "Exo Suit 1", cost: {} },
                            { id: "powersScienceAlienTech", label: "Alien Tech", cost: {} },
                            { id: "questsQuestsTheyCameFromBeyond", label: "They Came from Beyond!", cost: {} },
                            { id: "gearGearExoSuit2", label: "Exo Suit 2", cost: {}, prerequisites: "gearGearExoSuit1 && (powersScienceAlienTech || questsQuestsTheyCameFromBeyond)" },
                            { id: "requiresComplexOrGroups", label: "Requires Complex OR Groups", cost: {}, prerequisites: "(preA || preB) && (multi__2 || oneWayA) && !drawbacksDrawbacksDumb" },
                            { id: "oneWayA", label: "One-Way A", cost: {}, conflictsWith: ["oneWayB"] },
                            { id: "oneWayB", label: "One-Way B", cost: {} },
                            { id: "youAgeYoungAdult", label: "Young Adult", cost: {} },
                            { id: "powersSuperpowersSmart", label: "Smart", cost: {}, conflictsWith: ["drawbacksDrawbacksDumb"] },
                            { id: "drawbacksDrawbacksDumb", label: "Dumb", cost: {} },
                            { id: "adultBenefitsHigherPaying", label: "Higher Paying", cost: {}, prerequisites: "youAgeYoungAdult && powersSuperpowersSmart" },
                            { id: "weaknessesWeaknessesEmotionalConsistency", label: "Emotional Consistency", cost: {}, prerequisites: "!(emotionalSpectrumEmotionalSpectrumColorD5b60aYellowColor && !emotionalSpectrumOptionalAdjustmentsYellowBelied) && !(emotionalSpectrumEmotionalSpectrumColorIndigoIndigoColor && !emotionalSpectrumOptionalAdjustmentsCompassionateSoul)" },
                            { id: "emotionalSpectrumEmotionalSpectrumColorD5b60aYellowColor", label: "Yellow Color", cost: {} },
                            { id: "emotionalSpectrumOptionalAdjustmentsYellowBelied", label: "Yellow Belied", cost: {} },
                            { id: "emotionalSpectrumEmotionalSpectrumColorIndigoIndigoColor", label: "Indigo Color", cost: {} },
                            { id: "emotionalSpectrumOptionalAdjustmentsCompassionateSoul", label: "Compassionate Soul", cost: {} }
                        ]
                    },
                    {
                        name: "Grants",
                        options: [
                            { id: "grantSource", label: "Grant Source", cost: { Points: 2 }, autoGrants: [{ id: "grantedLocked", canDeselect: false }] },
                            { id: "grantedLocked", label: "Granted Locked", cost: { Points: 5 } },
                            { id: "grantSourceCanDeselect", label: "Grant Source Can Deselect", cost: {}, autoGrants: [{ id: "grantedCanDeselect", canDeselect: true }] },
                            { id: "grantedCanDeselect", label: "Granted Can Deselect", cost: { Points: 4 } },
                            { id: "emotionalSpectrumEmotionalSpectrumColor696969ColorlessRingsColor", label: "Colorless Rings", cost: {}, autoGrants: [{ id: "weaknessesWeaknessesEmotionalInstability", canDeselect: false }] },
                            {
                                id: "weaknessesWeaknessesEmotionalInstability",
                                label: "Emotional Instability",
                                cost: { Points: 5 },
                                modifiedCosts: [{ ids: ["emotionalSpectrumEmotionalSpectrumColor696969ColorlessRingsColor"], cost: { Points: 0 } }]
                            },
                            {
                                id: "discountGrantSource",
                                label: "Discount Grant Source",
                                cost: {},
                                discountGrants: [
                                    { slots: 1, mode: "half", targetIds: ["discountGrantTargetA", "discountGrantTargetB"] }
                                ]
                            },
                            { id: "discountGrantTargetA", label: "Discount Grant Target A", cost: { Points: 6 } },
                            { id: "discountGrantTargetB", label: "Discount Grant Target B", cost: { Points: 5 } },
                            {
                                id: "customFields",
                                label: "Custom Fields",
                                cost: {},
                                creatorNotes: "runtime should preserve this",
                                customMetadata: { tier: 2 },
                                titleAlignment: "left",
                                metaAlignment: "right",
                                descriptionAlignment: "center",
                                borderColor: "#8886D1",
                                darkBorderColor: "#C0C0C0"
                            }
                        ]
                    },
                    {
                        name: "Legacy",
                        options: [
                            {
                                id: "legacyDiscounted",
                                label: "Legacy Discounted",
                                cost: { Points: 8 },
                                discounts: [{ ids: ["legacyTrigger"], cost: { Points: 1 } }]
                            },
                            {
                                id: "anyRule",
                                label: "Any Rule",
                                cost: { Points: 9 },
                                modifiedCosts: [{ idsAny: ["preA", "preB", "discountTrigger"], minSelected: 2, cost: { Points: 3 } }]
                            }
                        ]
                    }
                ]
            },
            {
                name: "Discount Slots",
                discountSelectionLimit: 1,
                discountEligibleUnder: 5,
                discountMode: "free",
                subcategories: [
                    {
                        name: "Category Slot Choices",
                        options: [
                            { id: "categorySlotEligible", label: "Category Slot Eligible", cost: { Points: 4 } },
                            { id: "categorySlotIneligible", label: "Category Slot Ineligible", cost: { Points: 6 } },
                            { id: "categorySlotOptOut", label: "Category Slot Opt Out", cost: { Points: 4 }, disableCategoryDiscount: true }
                        ]
                    },
                    {
                        name: "Subcategory Slot Choices",
                        discountSelectionLimit: 1,
                        discountEligibleUnder: 5,
                        discountMode: "free",
                        options: [
                            { id: "subcategorySlotEligible", label: "Subcategory Slot Eligible", cost: { Points: 4 } },
                            { id: "subcategorySlotIneligible", label: "Subcategory Slot Ineligible", cost: { Points: 6 } },
                            { id: "subcategorySlotOptOut", label: "Subcategory Slot Opt Out", cost: { Points: 4 }, disableSubcategoryDiscount: true }
                        ]
                    }
                ]
            },
            {
                name: "Category Controls",
                requiresOption: "preA",
                maxSelections: 1,
                subcategoryDisplayMode: "all",
                subcategories: [
                    {
                        name: "Category Limit Choices",
                        options: [
                            { id: "categoryLimitA", label: "Category Limit A", cost: {} },
                            { id: "categoryLimitB", label: "Category Limit B", cost: {} }
                        ]
                    }
                ]
            },
            {
                name: "Subcategory Controls",
                subcategories: [
                    {
                        name: "Subcategory Gate",
                        requiresOption: "preA",
                        input: { id: "subcatNote", label: "Subcategory Note", maxLength: 5 },
                        subcategoryDisplayMode: "all",
                        columnsPerRow: 3,
                        backgroundColor: "#7f1d1d",
                        textColor: "#ffffff",
                        accentColor: "#dc2626",
                        darkBackgroundColor: "#450a0a",
                        darkTextColor: "#fee2e2",
                        darkAccentColor: "#1f0707",
                        options: [
                            { id: "subcategoryRequiresOption", label: "Subcategory Requires Option", cost: {} }
                        ],
                        subcategories: [
                            {
                                name: "Nested Gate",
                                subcategoryDisplayMode: "all",
                                options: [
                                    { id: "nestedSubcategoryOption", label: "Nested Subcategory Option", cost: {} }
                                ]
                            }
                        ]
                    },
                    {
                        name: "First N Discounts",
                        discountFirstN: 1,
                        discountAmount: { Points: 2 },
                        options: [
                            { id: "firstNDiscountA", label: "First N Discount A", cost: { Points: 5 } },
                            { id: "firstNDiscountB", label: "First N Discount B", cost: { Points: 5 } }
                        ]
                    },
                    {
                        name: "Inherited Payment Options",
                        costOptions: [
                            { label: "Default Points", cost: { Points: 3 } },
                            { label: "Default Tokens", cost: { Tokens: 2 } }
                        ],
                        options: [
                            { id: "inheritedCostOptions", label: "Inherited Cost Options" },
                            {
                                id: "overrideCostOptions",
                                label: "Override Cost Options",
                                costOptions: [{ label: "Override Points", cost: { Points: 5 } }]
                            }
                        ]
                    },
                    {
                        name: "Single Select",
                        maxSelections: 1,
                        options: [
                            { id: "powersDifficultySpectacularmanMode", label: "Spectacularman Mode", cost: { Points: -190 } },
                            { id: "powersDifficultyDakestKnightRecommended", label: "Dakest Knight Recommended", cost: { Points: -90 } }
                        ]
                    },
                    {
                        name: "Species",
                        modifiedCosts: [
                            { ids: ["universeOptionalOverpoweredSpecies"], costDelta: { Points: 3 }, priority: 1 },
                            { ids: ["universeOptionalGroundedSpecies"], costDelta: { Points: -10 }, minCost: { Points: -1 }, priority: 1 }
                        ],
                        options: [
                            { id: "speciesSpeciesVuldarian", label: "Vuldarian", cost: { Points: 13 } },
                            { id: "speciesSpeciesYautja", label: "Yautja", cost: { Points: 5 } },
                            {
                                id: "speciesSpeciesPowerlessSpecies",
                                label: "Powerless Species",
                                cost: { Points: 3 },
                                modifiedCosts: [
                                    { ids: ["universeOptionalGroundedSpecies"], cost: { Points: -1 }, priority: 2 },
                                    { ids: ["universeOptionalOverpoweredSpecies"], cost: { Points: 0 }, priority: 2 }
                                ]
                            }
                        ]
                    },
                    {
                        name: "Lantern Powers",
                        modifiedCosts: [
                            { ids: ["emotionalSpectrumEmotionalSpectrumColor696969ColorlessRingsColor"], costDelta: { Points: -1 }, minCost: { Points: 0 } }
                        ],
                        options: [
                            { id: "ringPowersCharacteristicPowersEmotionalConstruct", label: "Emotional Construct", cost: { Points: 1 } },
                            { id: "ringPowersCharacteristicPowersDeathEmpowerment", label: "Death Empowerment", cost: { Points: 5 } }
                        ]
                    },
                    {
                        name: "Modified Cost Triggers",
                        modifiedCosts: [
                            { ids: ["powersScienceConstruction"], costPercent: { "Dollars (millions)": -12.5 }, priority: 1 },
                            { ids: ["powersScienceConstruction__2"], costPercent: { "Dollars (millions)": -25 }, priority: 2 }
                        ],
                        options: [
                            { id: "emotionalSpectrumEmotionalSpectrumColorOrangeOrangeColor", label: "Orange Color", cost: {} },
                            { id: "universeOptionalOverpoweredSpecies", label: "Overpowered Species", cost: {} },
                            { id: "universeOptionalGroundedSpecies", label: "Grounded Species", cost: {} },
                            {
                                id: "universeOptionalSharedEmotions",
                                label: "Shared Emotions",
                                cost: { Points: -5 },
                                modifiedCosts: [{ ids: ["emotionalSpectrumEmotionalSpectrumColorOrangeOrangeColor"], cost: { Points: 0 } }]
                            },
                            {
                                id: "gearGearShieldGenerator2",
                                label: "Shield Generator",
                                costOptions: [{ label: "Payment Option 1", cost: { "Dollars (millions)": 16 } }]
                            },
                            { id: "powersScienceConstruction", label: "Construction", cost: {}, maxSelections: 2 }
                        ]
                    }
                ]
            }
        ], "synthetic");
    }

    option(id) {
        const option = this.optionMap.get(id);
        assert(option, `${this.filename}: missing option ${id}`);
        return option;
    }

    getStoryInputConfig(inputId) {
        for (const category of this.categories) {
            let found = null;
            walkSubcategories(category.subcategories, subcat => {
                if (found) return;
                if (subcat?.input?.id === inputId) {
                    found = { id: inputId, maxLength: subcat.input.maxLength || 20, type: "subcategory" };
                    return;
                }
                (subcat?.options || []).forEach(option => {
                    if (!found && option.id === inputId && option.inputType === "text") {
                        found = { id: inputId, maxLength: option.maxLength || 200, type: "option" };
                    }
                });
            });
            if (found) return found;
            for (const option of category.options || []) {
                if (option.id === inputId && option.inputType === "text") {
                    return { id: inputId, maxLength: option.maxLength || 200, type: "option" };
                }
            }
        }
        return null;
    }

    findSubcategoryInfo(optionId) {
        for (const [categoryIndex, category] of this.categories.entries()) {
            const catKey = this.buildCategoryKey(categoryIndex, category);
            if ((category.options || []).some(option => option.id === optionId)) {
                return { category, subcat: null, subcatPath: [], catKey, key: null };
            }
            let found = null;
            walkSubcategories(category.subcategories, (subcat, path) => {
                if (!found && (subcat.options || []).some(option => option.id === optionId)) {
                    const subcatPath = this.getSubcategoryPath(category, path);
                    found = {
                        category,
                        subcat,
                        subcatPath,
                        catKey,
                        key: this.buildSubcategoryKey(categoryIndex, category, subcatPath)
                    };
                }
            });
            if (found) return found;
        }
        return { category: null, subcat: null, subcatPath: [], catKey: null, key: null };
    }

    buildCategoryKey(categoryIndex, category) {
        return `cat:${categoryIndex}:${category?.name || ""}`;
    }

    buildSubcategoryKey(categoryIndex, category, subcatPath = []) {
        const path = subcatPath.map(subcat => subcat?.name || "").join(">");
        return `sub:${categoryIndex}:${category?.name || ""}:${path}`;
    }

    getSubcategoryPath(category, path = []) {
        const result = [];
        let currentList = category.subcategories || [];
        for (const index of path) {
            const subcat = currentList[index];
            if (!subcat) break;
            result.push(subcat);
            currentList = subcat.subcategories || [];
        }
        return result;
    }

    findSubcategoryOfOption(optionId) {
        return this.findSubcategoryInfo(optionId).subcat;
    }

    getBaseCost(option) {
        const optionCost = option.cost || {};
        return { ...optionCost };
    }

    getNextSelectionNumber(option) {
        return (this.selectedOptions[option.id] || 0) + 1;
    }

    getCostOptionCostForSelection(entry, selectionNumber = 1) {
        const tiers = Array.isArray(entry?.costBySelection) ? entry.costBySelection : [];
        const tierIndex = Math.max(0, Number(selectionNumber || 1) - 1);
        const tierCost = tiers[tierIndex] || tiers[tiers.length - 1];
        if (tierCost && typeof tierCost === "object" && !Array.isArray(tierCost)) return tierCost;
        return entry?.cost && typeof entry.cost === "object" ? entry.cost : null;
    }

    getCostOptionSelectionCount(optionId, costOptionIndex) {
        return (this.selectedCostOptionHistory[optionId] || []).filter(index => Number(index) === Number(costOptionIndex)).length;
    }

    getEffectiveCostOptionSelectionCount(optionId, costOptionIndex) {
        const history = this.selectedCostOptionHistory[optionId] || [];
        const historyCount = history.filter(index => Number(index) === Number(costOptionIndex)).length;
        if (history.length || Number(costOptionIndex) !== 0) return historyCount;
        return this.selectedOptions[optionId] || 0;
    }

    hasExplicitCostOptionAvailability(entry) {
        return Object.prototype.hasOwnProperty.call(entry, "prerequisites")
            || Object.prototype.hasOwnProperty.call(entry, "minSelected")
            || Object.prototype.hasOwnProperty.call(entry, "requiresCostOption");
    }

    shouldAutoRequireBaseCostOption(option, entry, index, costOptions = []) {
        if (!option?.id || !entry || typeof entry !== "object") return false;
        if (index <= 0 || !Array.isArray(costOptions) || costOptions.length <= 1) return false;
        const optionMaxSelections = Number(option.maxSelections);
        if (!Number.isFinite(optionMaxSelections) || optionMaxSelections <= 1) return false;
        if (this.hasExplicitCostOptionAvailability(entry)) return false;
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

    costOptionAvailabilityMet(option, entry, index, costOptions = []) {
        if (!option?.id || !entry || typeof entry !== "object") return true;
        if (!this.prerequisiteMet(entry.prerequisites)) return false;
        const currentOptionCount = this.selectedOptions[option.id] || 0;
        const minSelected = Number(entry.minSelected);
        if (Number.isFinite(minSelected) && currentOptionCount < minSelected) return false;
        if (entry.requiresCostOption !== undefined) {
            const requiredIndex = Number(entry.requiresCostOption);
            if (!Number.isInteger(requiredIndex) || this.getEffectiveCostOptionSelectionCount(option.id, requiredIndex) <= 0) return false;
        }
        if (this.shouldAutoRequireBaseCostOption(option, entry, index, costOptions) && this.getEffectiveCostOptionSelectionCount(option.id, 0) <= 0) return false;
        const hasSelectionTiers = Array.isArray(entry.costBySelection) && entry.costBySelection.length > 0;
        const totalCostOptions = Array.isArray(costOptions) ? costOptions.length : 1;
        const maxSelections = entry.maxSelections === undefined && totalCostOptions > 1 && !hasSelectionTiers
            ? 1
            : Number(entry.maxSelections);
        return !(Number.isFinite(maxSelections) && maxSelections >= 0 && this.getEffectiveCostOptionSelectionCount(option.id, index) >= maxSelections);
    }

    costOptionsHaveMeaningfulCost(costOptions = []) {
        return costOptions.some(entry =>
            entry?.cost && typeof entry.cost === "object" && Object.keys(entry.cost).length
            || Array.isArray(entry?.costBySelection) && entry.costBySelection.some(cost => cost && typeof cost === "object" && Object.keys(cost).length)
        );
    }

    addPointCostMaps(...maps) {
        const merged = {};
        maps.forEach(map => {
            if (!map || typeof map !== "object" || Array.isArray(map)) return;
            Object.entries(map).forEach(([type, value]) => {
                merged[type] = (Number(merged[type]) || 0) + (Number(value) || 0);
            });
        });
        return merged;
    }

    getMergedDefaultCostForSelection(costOptions = [], selectionNumber = 1) {
        return costOptions.reduce((merged, entry) => {
            const rawCost = this.getCostOptionCostForSelection(entry, selectionNumber);
            return this.addPointCostMaps(merged, rawCost);
        }, {});
    }

    getMergedDefaultCostForOption(option, selectionNumber = null) {
        const info = option?.id ? this.findSubcategoryInfo(option.id) : {};
        const subcategoryOptions = Array.isArray(info.subcat?.costOptions) ? info.subcat.costOptions : [];
        if (info.subcat?.mergeDefaultCostOptions !== true || !subcategoryOptions.length) return {};
        return this.getMergedDefaultCostForSelection(subcategoryOptions, selectionNumber || this.getNextSelectionNumber(option));
    }

    configuredCostOptions(option) {
        const info = option?.id ? this.findSubcategoryInfo(option.id) : {};
        const ownOptions = Array.isArray(option?.costOptions) ? option.costOptions : [];
        const subcategoryOptions = Array.isArray(info.subcat?.costOptions) ? info.subcat.costOptions : [];
        const hasDirectOptionCost = option?.cost && typeof option.cost === "object" && Object.keys(option.cost).length > 0;
        const hasOwnCostOptions = this.costOptionsHaveMeaningfulCost(ownOptions);
        return hasOwnCostOptions ? ownOptions : (hasDirectOptionCost ? [] : subcategoryOptions);
    }

    selectedCostOptionStillValid(option, costOptionIndex) {
        const options = this.configuredCostOptions(option);
        if (!options.length || costOptionIndex === null || costOptionIndex === undefined) return true;
        const entry = options[Number(costOptionIndex)];
        if (!entry || typeof entry !== "object") return false;
        if (!this.prerequisiteMet(entry.prerequisites)) return false;
        const currentOptionCount = this.selectedOptions[option.id] || 0;
        const minSelected = Number(entry.minSelected);
        if (Number.isFinite(minSelected) && currentOptionCount < minSelected) return false;
        if (entry.requiresCostOption !== undefined) {
            const requiredIndex = Number(entry.requiresCostOption);
            if (!Number.isInteger(requiredIndex) || this.getEffectiveCostOptionSelectionCount(option.id, requiredIndex) <= 0) return false;
        }
        if (this.shouldAutoRequireBaseCostOption(option, entry, Number(costOptionIndex), options) && this.getEffectiveCostOptionSelectionCount(option.id, 0) <= 0) return false;
        return true;
    }

    selectedCostOptionsStillValid(option) {
        const history = this.selectedCostOptionHistory[option.id] || [];
        return history.every(costOptionIndex => this.selectedCostOptionStillValid(option, costOptionIndex));
    }

    normalizeCostOptions(option, { selectionNumber = null, includeUnavailable = false } = {}) {
        const options = this.configuredCostOptions(option);
        const effectiveSelectionNumber = selectionNumber || this.getNextSelectionNumber(option);
        const info = option?.id ? this.findSubcategoryInfo(option.id) : {};
        const ownOptions = Array.isArray(option?.costOptions) ? option.costOptions : [];
        const subcategoryOptions = Array.isArray(info.subcat?.costOptions) ? info.subcat.costOptions : [];
        const shouldMergeDefaults = this.costOptionsHaveMeaningfulCost(ownOptions)
            && info.subcat?.mergeDefaultCostOptions === true
            && subcategoryOptions.length > 0;
        const defaultCost = shouldMergeDefaults
            ? this.getMergedDefaultCostForSelection(subcategoryOptions, effectiveSelectionNumber)
            : {};
        return options
            .map((entry, index) => {
                const available = this.costOptionAvailabilityMet(option, entry, index, options);
                if (!available && !includeUnavailable) return null;
                const cost = this.getCostOptionCostForSelection(entry, effectiveSelectionNumber);
                return cost ? { index, available, cost: shouldMergeDefaults ? this.addPointCostMaps(defaultCost, cost) : { ...cost } } : null;
            })
            .filter(Boolean);
    }

    getBaseCostChoice(option, costOptionIndex = null, { selectionNumber = null, includeUnavailable = false } = {}) {
        const choices = this.normalizeCostOptions(option, { selectionNumber, includeUnavailable });
        if (!choices.length) {
            return this.addPointCostMaps(this.getMergedDefaultCostForOption(option, selectionNumber), this.getBaseCost(option));
        }
        if (costOptionIndex === null || costOptionIndex === undefined) return { ...choices[0].cost };
        const selected = choices.find(choice => choice.index === Number(costOptionIndex));
        if (!selected || Object.keys(selected.cost || {}).length === 0) {
            return this.addPointCostMaps(this.getMergedDefaultCostForOption(option, selectionNumber), this.getBaseCost(option));
        }
        return { ...selected.cost };
    }

    normalizePointAllocationConfig(option) {
        const config = option?.pointAllocation;
        if (!config || typeof config !== "object") return null;
        const types = Array.isArray(config.types)
            ? config.types.map(type => String(type || "").trim()).filter(Boolean)
            : [];
        const total = Math.max(0, Math.floor(Number(config.total) || 0));
        if (!types.length || total <= 0) return null;
        return { total, types: [...new Set(types)] };
    }

    normalizePointAllocationValues(option, rawValues = null) {
        const config = this.normalizePointAllocationConfig(option);
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
        if (remaining > 0 && config.types.length) values[config.types[0]] = (values[config.types[0]] || 0) + remaining;
        return values;
    }

    getPointAllocationValues(optionOrId) {
        const option = typeof optionOrId === "string" ? this.option(optionOrId) : optionOrId;
        const config = this.normalizePointAllocationConfig(option);
        if (!config) return {};
        if (!this.pointAllocationSelections[option.id]) {
            this.pointAllocationSelections[option.id] = this.normalizePointAllocationValues(option, {
                [config.types[0]]: config.total
            });
        } else {
            this.pointAllocationSelections[option.id] = this.normalizePointAllocationValues(option, this.pointAllocationSelections[option.id]);
        }
        return { ...this.pointAllocationSelections[option.id] };
    }

    setPointAllocation(optionOrId, values) {
        const option = typeof optionOrId === "string" ? this.option(optionOrId) : optionOrId;
        this.pointAllocationSelections[option.id] = this.normalizePointAllocationValues(option, values);
    }

    getPointAllocationCost(option) {
        const values = this.getPointAllocationValues(option);
        const cost = {};
        Object.entries(values).forEach(([type, value]) => {
            const numeric = Number(value) || 0;
            if (numeric > 0) cost[type] = -numeric;
        });
        return cost;
    }

    mergeCostMaps(...maps) {
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

    setAttributeSlider(attribute, value) {
        this.attributeSliderValues[attribute] = Number(value) || 0;
        this.applySliderModifiers();
    }

    getSliderOptionForAttribute(attribute) {
        for (const option of this.optionMap.values()) {
            if (option?.inputType !== "slider") continue;
            const costPerPoint = option.costPerPoint || {};
            const currencyType = Object.keys(costPerPoint).find(type => Number(costPerPoint[type]) > 0) || "Attribute Points";
            const attributeType = Object.keys(costPerPoint).find(type => type !== currencyType);
            if (attributeType === attribute) return option;
        }
        return null;
    }

    getSliderModifierTargetNames() {
        return Object.keys(this.pointsEntry.values || {});
    }

    getSliderBaseValue(attribute) {
        const sliderValue = Number(this.attributeSliderValues[attribute]);
        if (Number.isFinite(sliderValue)) return sliderValue;
        const sliderOption = this.getSliderOptionForAttribute(attribute);
        const optionValue = Number(sliderOption ? this.attributeSliderValues[sliderOption.id] : undefined);
        if (Number.isFinite(optionValue)) return optionValue;
        return Number(this.pointsEntry.values?.[attribute]) || 0;
    }

    resetSliderAttributePointValues() {
        Object.keys(this.pointsEntry.attributeRanges || {}).forEach(attribute => {
            if (Object.prototype.hasOwnProperty.call(this.points, attribute)) {
                this.points[attribute] = this.getSliderBaseValue(attribute);
            }
        });
    }

    setSliderBaseValue(attribute, value) {
        const nextValue = Number(value) || 0;
        this.attributeSliderValues[attribute] = nextValue;
        const sliderOption = this.getSliderOptionForAttribute(attribute);
        if (sliderOption) this.attributeSliderValues[sliderOption.id] = nextValue;
        if (Object.prototype.hasOwnProperty.call(this.points, attribute)) this.points[attribute] = nextValue;
    }

    refundSliderDecrease(attribute, oldValue, newValue) {
        const decrease = Math.max(0, (Number(oldValue) || 0) - (Number(newValue) || 0));
        if (decrease <= 0) return;
        const sliderOption = this.getSliderOptionForAttribute(attribute);
        const costPerPoint = sliderOption?.costPerPoint || {};
        const currencyType = Object.keys(costPerPoint).find(type => Number(costPerPoint[type]) > 0) || "Attribute Points";
        const cost = Number(costPerPoint[currencyType]) || 0;
        if (cost > 0) this.points[currencyType] = (Number(this.points[currencyType]) || 0) + (decrease * cost);
    }

    normalizeSliderModifiers(option) {
        const sliderTargets = this.getSliderModifierTargetNames();
        const sliderTargetSet = new Set(sliderTargets);
        const rawEffects = Array.isArray(option?.sliderModifiers)
            ? option.sliderModifiers
            : Array.isArray(option?.attributeEffects)
                ? option.attributeEffects
                : [];
        return rawEffects.map(effect => {
            const type = ["multiply", "cap", "add", "subtract"].includes(effect?.type) ? effect.type : "multiply";
            return {
                type,
                attribute: String(effect?.attribute || "").trim(),
                selectable: effect?.selectable === true || !String(effect?.attribute || "").trim(),
                choices: Array.isArray(effect?.choices) ? effect.choices.filter(choice => sliderTargetSet.has(choice)) : sliderTargets,
                value: type === "multiply" ? Number(effect?.multiplier ?? effect?.value) : Number(effect?.value ?? effect?.multiplier)
            };
        }).filter(effect => Number.isFinite(effect.value) && (effect.selectable || sliderTargetSet.has(effect.attribute)));
    }

    restoreActiveSliderModifierPointValues() {
        Object.entries(this.activeSliderModifierPointBaselines).forEach(([type, baseline]) => {
            if (baseline?.existed) this.points[type] = baseline.value;
            else delete this.points[type];
        });
        this.activeSliderModifierPointBaselines = {};
    }

    rememberSliderModifierPointBaseline(type) {
        if (Object.prototype.hasOwnProperty.call(this.activeSliderModifierPointBaselines, type)) return;
        this.activeSliderModifierPointBaselines[type] = {
            existed: Object.prototype.hasOwnProperty.call(this.points, type),
            value: this.points[type]
        };
    }

    applySliderModifiers() {
        this.restoreActiveSliderModifierPointValues();
        this.resetSliderAttributePointValues();
        const selectedEffects = [];
        Object.entries(this.selectedOptions).forEach(([optionId, count]) => {
            if (!count) return;
            const option = this.optionMap.get(optionId);
            this.normalizeSliderModifiers(option).forEach((effect, index) => {
                const attribute = effect.selectable ? this.sliderModifierSelections[optionId]?.[index] : effect.attribute;
                if (attribute) selectedEffects.push({ ...effect, attribute });
            });
        });

        selectedEffects.filter(effect => effect.type === "cap").forEach(effect => {
            const cap = effect.value;
            const currentMax = Number(this.pointsEntry.attributeRanges?.[effect.attribute]?.max ?? cap);
            const nextMax = Number.isFinite(currentMax) ? Math.min(currentMax, cap) : cap;
            const currentValue = this.getSliderBaseValue(effect.attribute);
            if (currentValue > nextMax) {
                this.refundSliderDecrease(effect.attribute, currentValue, nextMax);
                this.setSliderBaseValue(effect.attribute, nextMax);
            }
        });

        this.resetSliderAttributePointValues();
        selectedEffects.filter(effect => effect.type !== "cap").forEach(effect => {
            this.rememberSliderModifierPointBaseline(effect.attribute);
            const currentValue = Number(this.points[effect.attribute]) || 0;
            if (effect.type === "multiply") this.points[effect.attribute] = currentValue * effect.value;
            if (effect.type === "add") this.points[effect.attribute] = currentValue + effect.value;
            if (effect.type === "subtract") this.points[effect.attribute] = currentValue - effect.value;
        });
    }

    getModifiedCostRules(entity) {
        if (!entity || typeof entity !== "object") return [];
        if (Array.isArray(entity.modifiedCosts)) return entity.modifiedCosts;
        if (Array.isArray(entity.discounts)) return entity.discounts;
        return [];
    }

    meetsCountRequirement(rawId) {
        const [id, suffix] = String(rawId).split("__");
        const required = suffix ? Number(suffix) || 1 : 1;
        return (this.selectedOptions[id] || 0) >= required;
    }

    ruleQualifies(rule) {
        if (!rule) return false;
        if (rule.id || rule.ids) {
            const ids = rule.ids || (rule.id ? [rule.id] : []);
            if (ids.length && ids.every(id => this.meetsCountRequirement(id))) return true;
        }
        if (Array.isArray(rule.idsAny) && Number.isInteger(rule.minSelected)) {
            const selectedCount = rule.idsAny.reduce((sum, id) => sum + (this.meetsCountRequirement(id) ? 1 : 0), 0);
            return selectedCount >= rule.minSelected;
        }
        return false;
    }

    ruleTriggerIds(rule) {
        if (!rule) return [];
        if (Array.isArray(rule.idsAny)) return rule.idsAny.filter(Boolean);
        if (Array.isArray(rule.ids)) return rule.ids.filter(Boolean);
        if (rule.id) return [rule.id];
        return [];
    }

    isCostModifierTriggerOption(optionId) {
        const baseOptionId = String(optionId || "").split("__")[0];
        let isTrigger = false;
        const inspectRules = rules => {
            (rules || []).forEach(rule => {
                this.ruleTriggerIds(rule).forEach(triggerId => {
                    if (String(triggerId).split("__")[0] === baseOptionId) isTrigger = true;
                });
            });
        };

        this.categories.forEach(category => {
            inspectRules(this.getModifiedCostRules(category));
            walkSubcategories(category.subcategories, subcat => inspectRules(this.getModifiedCostRules(subcat)));
            (category.options || []).forEach(option => inspectRules(this.getModifiedCostRules(option)));
            walkSubcategories(category.subcategories, subcat => {
                (subcat.options || []).forEach(option => inspectRules(this.getModifiedCostRules(option)));
            });
        });
        return isTrigger;
    }

    rulePriority(rule, index) {
        const priority = Number(rule?.priority);
        return Number.isFinite(priority) ? priority : index + 1;
    }

    applyModifiedCostRule(currentCost, rule) {
        const nextCost = { ...currentCost, ...(rule.cost || {}) };
        if (rule.costDelta && typeof rule.costDelta === "object") {
            Object.entries(rule.costDelta).forEach(([type, delta]) => {
                const deltaValue = Number(delta);
                if (!Number.isFinite(deltaValue)) return;
                const currentValue = Number(nextCost[type]);
                nextCost[type] = (Number.isFinite(currentValue) ? currentValue : 0) + deltaValue;
            });
        }
        if (rule.costPercent && typeof rule.costPercent === "object") {
            Object.entries(rule.costPercent).forEach(([type, percent]) => {
                const percentValue = Number(percent);
                const currentValue = Number(nextCost[type]);
                if (!Number.isFinite(percentValue) || !Number.isFinite(currentValue) || currentValue <= 0) return;
                nextCost[type] = Math.max(0, Math.ceil(currentValue * (1 + percentValue / 100)));
            });
        }
        return this.clampCost(nextCost, rule.minCost, rule.maxCost);
    }

    applyDiscountCost(cost = {}, mode = "half") {
        const updated = { ...cost };
        Object.entries(updated).forEach(([type, value]) => {
            if (value > 0) {
                updated[type] = mode === "free" ? 0 : Math.ceil(value / 2);
            }
        });
        return updated;
    }

    applyDiscountAmount(cost = {}, discountAmount) {
        if (!discountAmount || typeof discountAmount !== "object") return cost;
        const updated = { ...cost };
        Object.entries(discountAmount).forEach(([type, amount]) => {
            if (typeof updated[type] === "number" && updated[type] > 0 && typeof amount === "number") {
                updated[type] = Math.max(0, updated[type] - amount);
            }
        });
        return updated;
    }

    canUseDiscount(entity) {
        return !!(entity && entity.discountSelectionLimit && entity.discountEligibleUnder);
    }

    discountEligibleCost(cost = {}, entity = {}) {
        const types = Array.isArray(entity.discountTypes) && entity.discountTypes.length
            ? entity.discountTypes
            : entity.discountAmount && typeof entity.discountAmount === "object"
                ? Object.keys(entity.discountAmount)
                : [];
        const entries = types.length
            ? types.map(type => [type, cost[type]])
            : Object.entries(cost);
        const entry = entries.find(([, value]) => typeof value === "number" && value > 0);
        return entry ? entry[1] : null;
    }

    applyAssignedDiscount(cost, entity) {
        return entity.discountAmount
            ? this.applyDiscountAmount(cost, entity.discountAmount)
            : this.applyDiscountCost(cost, entity.discountMode === "free" ? "free" : "half");
    }

    discountTotalCount(map = {}) {
        return Object.values(map || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
    }

    buildOptionGrantKey(providerId, ruleIndex) {
        return `${providerId}::${ruleIndex}`;
    }

    getGrantTargetIds(rule) {
        if (!rule) return [];
        if (Array.isArray(rule.targetIds)) return rule.targetIds.filter(Boolean);
        if (Array.isArray(rule.targets)) return rule.targets.filter(Boolean);
        if (rule.targetId) return [rule.targetId];
        return [];
    }

    getActiveOptionGrantContexts(targetOptionId) {
        const contexts = [];
        this.optionMap.forEach(provider => {
            const providerSelections = this.selectedOptions[provider.id] || 0;
            if (providerSelections <= 0) return;
            (provider.discountGrants || []).forEach((rule, ruleIndex) => {
                const slotsPerSelection = Math.max(0, Number(rule?.slots) || 0);
                if (slotsPerSelection <= 0) return;
                const targetIds = this.getGrantTargetIds(rule);
                if (!targetIds.includes(targetOptionId)) return;
                const key = this.buildOptionGrantKey(provider.id, ruleIndex);
                contexts.push({
                    key,
                    map: this.optionGrantDiscountSelections[key] || {},
                    limit: providerSelections * slotsPerSelection,
                    mode: rule.mode === "free" ? "free" : "half"
                });
            });
        });
        return contexts;
    }

    clampCost(cost, minCost, maxCost) {
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

    effectiveCost(optionOrId, { costOptionIndex = null, selectionNumber = null, includeUnavailable = false } = {}) {
        const option = typeof optionOrId === "string" ? this.option(optionOrId) : optionOrId;
        const info = this.findSubcategoryInfo(option.id);
        let cost = this.mergeCostMaps(
            this.getBaseCostChoice(option, costOptionIndex, { selectionNumber, includeUnavailable }),
            this.getPointAllocationCost(option)
        );
        const winningRule = this.winningModifiedCostRule(option, info.subcat);
        if (winningRule) {
            cost = this.applyModifiedCostRule(cost, winningRule.rule);
        }

        let bestCost = cost;
        let bestTotal = Object.values(bestCost).reduce((sum, value) => value > 0 ? sum + value : sum, 0);
        const alreadySelectedThis = this.selectedOptions[option.id] || 0;
        this.getActiveOptionGrantContexts(option.id).forEach(ctx => {
            const assignedForThis = ctx.map[option.id] || 0;
            const totalAssigned = this.discountTotalCount(ctx.map);
            const totalOthers = totalAssigned - assignedForThis;
            const allowedForThis = Math.max(0, Math.min(assignedForThis, ctx.limit - totalOthers));
            if (allowedForThis <= alreadySelectedThis) return;

            const candidate = this.applyDiscountCost(bestCost, ctx.mode);
            const candidateTotal = Object.values(candidate).reduce((sum, value) => value > 0 ? sum + value : sum, 0);
            if (candidateTotal < bestTotal) {
                bestCost = candidate;
                bestTotal = candidateTotal;
            }
        });

        let discountApplied = false;
        if (info.subcat && info.key && this.canUseDiscount(info.subcat)) {
            const map = this.subcategoryDiscountSelections[info.key] || {};
            const eligibleCost = this.discountEligibleCost(this.getBaseCost(option), info.subcat);
            const assigned = map[option.id] || 0;
            const alreadySelected = this.selectedOptions[option.id] || 0;
            if (option.disableSubcategoryDiscount === true) {
                delete map[option.id];
            } else if (eligibleCost !== null && eligibleCost <= info.subcat.discountEligibleUnder && assigned > alreadySelected) {
                bestCost = this.applyAssignedDiscount(bestCost, info.subcat);
                discountApplied = true;
            }
        }

        if (!discountApplied && info.category && info.catKey && this.canUseDiscount(info.category)) {
            const map = this.categoryDiscountSelections[info.catKey] || {};
            const eligibleCost = this.discountEligibleCost(this.getBaseCost(option), info.category);
            const assigned = map[option.id] || 0;
            const alreadySelected = this.selectedOptions[option.id] || 0;
            if (option.disableCategoryDiscount === true) {
                delete map[option.id];
            } else if (eligibleCost !== null && eligibleCost <= info.category.discountEligibleUnder && assigned > alreadySelected) {
                bestCost = this.applyAssignedDiscount(bestCost, info.category);
                discountApplied = true;
            }
        }

        const subcatSelectionCount = (info.subcat?.options || []).reduce((sum, optionInSubcat) => {
            return sum + (this.selectedOptions[optionInSubcat.id] || 0);
        }, 0);
        if (info.subcat && typeof info.subcat.discountFirstN === "number" && subcatSelectionCount < info.subcat.discountFirstN && !this.selectedOptions[option.id]) {
            bestCost = info.subcat.discountAmount
                ? this.applyDiscountAmount(bestCost, info.subcat.discountAmount)
                : this.applyDiscountCost(bestCost, info.subcat.discountMode || "half");
        }
        return bestCost;
    }

    withSelectedOptionsSnapshot(snapshot, callback) {
        const current = { ...this.selectedOptions };
        this.selectedOptions = { ...(snapshot || {}) };
        try {
            return callback();
        } finally {
            this.selectedOptions = current;
        }
    }

    selectedCostOptionIndex(option) {
        const choices = this.normalizeCostOptions(option);
        if (!choices.length) return null;
        const selected = this.selectedCostOptionIndexes[option.id];
        return choices.some(choice => choice.index === Number(selected)) ? Number(selected) : choices[0].index;
    }

    costMapsEqual(a = {}, b = {}) {
        const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
        for (const key of keys) {
            if ((Number(a?.[key]) || 0) !== (Number(b?.[key]) || 0)) return false;
        }
        return true;
    }

    optionsAffectedBySelectionCountChange(changingOption, nextCount) {
        const beforeSnapshot = { ...this.selectedOptions };
        const afterSnapshot = { ...this.selectedOptions };
        if (nextCount > 0) {
            afterSnapshot[changingOption.id] = nextCount;
        } else {
            delete afterSnapshot[changingOption.id];
        }

        const affected = [];
        Object.entries(beforeSnapshot).forEach(([optionId, count]) => {
            if (optionId === changingOption.id) return;
            if (this.isCostModifierTriggerOption(optionId)) return;
            const option = this.optionMap.get(optionId);
            const selectedCount = Number(count) || 0;
            if (!option || selectedCount <= 0) return;

            for (let index = 0; index < selectedCount; index += 1) {
                const selectionNumber = index + 1;
                const costOptionIndex = this.selectedCostOptionIndex(option);
                const beforeCost = this.withSelectedOptionsSnapshot(beforeSnapshot, () =>
                    this.effectiveCost(option, { costOptionIndex, selectionNumber })
                );
                const afterCost = this.withSelectedOptionsSnapshot(afterSnapshot, () =>
                    this.effectiveCost(option, { costOptionIndex, selectionNumber })
                );
                if (!this.costMapsEqual(beforeCost, afterCost)) {
                    affected.push(option);
                    break;
                }
            }
        });
        return affected;
    }

    removeSelectionsAffectedByCostModifierChange(changingOption, nextCount, { skipCostModifierAffectedRemoval = false } = {}) {
        if (skipCostModifierAffectedRemoval) return true;
        const affected = this.optionsAffectedBySelectionCountChange(changingOption, nextCount);
        if (affected.length && !this.costModifierChangeConfirmed) return false;
        affected.forEach(option => {
            while (this.selectedOptions[option.id] > 0) {
                this.remove(option.id, { skipCostModifierAffectedRemoval: true });
            }
            this.removedByCostModifier.push(option.id);
        });
        return true;
    }

    effectiveCostChoices(optionOrId, options = {}) {
        const option = typeof optionOrId === "string" ? this.option(optionOrId) : optionOrId;
        const choices = this.normalizeCostOptions(option, options);
        if (!choices.length) {
            const info = option?.id ? this.findSubcategoryInfo(option.id) : {};
            const hasDirectOptionCost = option?.cost && typeof option.cost === "object" && Object.keys(option.cost).length > 0;
            const hasConfiguredCostOptions = (Array.isArray(option?.costOptions) && option.costOptions.length > 0)
                || (!hasDirectOptionCost && Array.isArray(info.subcat?.costOptions) && info.subcat.costOptions.length > 0);
            if (hasConfiguredCostOptions) return [];
            return [{ index: null, label: "Cost", cost: this.effectiveCost(option, options) }];
        }
        return choices.map(choice => ({
            index: choice.index,
            cost: this.effectiveCost(option, {
                ...options,
                costOptionIndex: choice.index,
                includeUnavailable: options.includeUnavailable === true
            })
        }));
    }

    displayedNextSelectionCost(optionOrId, costOptionIndex = null) {
        const option = typeof optionOrId === "string" ? this.option(optionOrId) : optionOrId;
        const selectedCount = this.selectedOptions[option.id] || 0;
        const maxSelections = option.maxSelections || 1;
        const displaySelectionNumber = selectedCount < maxSelections ? selectedCount + 1 : Math.max(selectedCount, 1);
        const choices = this.normalizeCostOptions(option, { selectionNumber: displaySelectionNumber });
        const resolvedCostOptionIndex = costOptionIndex ?? (choices[0]?.index ?? null);
        return this.effectiveCost(option, {
            costOptionIndex: resolvedCostOptionIndex,
            selectionNumber: displaySelectionNumber
        });
    }

    highestPriorityModifiedCostRule(rules = []) {
        return rules
            .filter(({ rule }) => !this.isConditionalGrantRule(rule) && this.ruleQualifies(rule))
            .sort((a, b) =>
                this.rulePriority(b.rule, b.index) - this.rulePriority(a.rule, a.index)
                || b.index - a.index
            )[0] || null;
    }

    winningModifiedCostRule(option, subcat) {
        const optionRule = this.highestPriorityModifiedCostRule(
            this.getModifiedCostRules(option).map((rule, index) => ({ rule, index }))
        );
        if (optionRule) return optionRule;

        return this.highestPriorityModifiedCostRule(
            this.getModifiedCostRules(subcat).map((rule, index) => ({ rule, index }))
        );
    }

    isConditionalGrantRule(rule) {
        const slots = Number(rule?.slots) || 0;
        return slots > 0 && (rule.mode === "free" || rule.mode === "half");
    }

    formatConditionalCostResult(cost = {}) {
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

    formatModifiedCostRuleCondition(rule = {}) {
        if (Array.isArray(rule.idsAny) && rule.idsAny.length > 0) {
            const minSelected = Number.isInteger(rule.minSelected) ? rule.minSelected : 1;
            const labels = rule.idsAny.map(id => this.optionMap.get(String(id).split("__")[0])?.label || id);
            return `at least ${minSelected} of ${labels.join(", ")}`;
        }
        const ids = rule.ids || (rule.id ? [rule.id] : []);
        if (ids.length > 0) {
            return ids.map(id => {
                const [baseId, countSuffix] = String(id).split("__");
                const label = this.optionMap.get(baseId)?.label || baseId;
                return countSuffix ? `${label} (x${countSuffix})` : label;
            }).join(" + ");
        }
        return "condition met";
    }

    modifiedCostRuleConditionKey(rule = {}) {
        if (Array.isArray(rule.idsAny) && rule.idsAny.length > 0) {
            const minSelected = Number.isInteger(rule.minSelected) ? rule.minSelected : 1;
            return `any:${minSelected}:${rule.idsAny.join("|")}`;
        }
        const ids = rule.ids || (rule.id ? [rule.id] : []);
        if (ids.length > 0) return `all:${ids.join("|")}`;
        return "conditionless";
    }

    conditionalCostDisplayLines(optionOrId) {
        const option = typeof optionOrId === "string" ? this.option(optionOrId) : optionOrId;
        const info = this.findSubcategoryInfo(option.id);
        const baseCost = this.getBaseCost(option);
        const rowsByCondition = new Map();
        const rules = [
            ...this.getModifiedCostRules(info.subcat).map((rule, index) => ({ rule, index, scopeOrder: 0 })),
            ...this.getModifiedCostRules(option).map((rule, index) => ({ rule, index, scopeOrder: 1 }))
        ]
            .filter(({ rule }) => !this.isConditionalGrantRule(rule))
            .sort((a, b) =>
                a.scopeOrder - b.scopeOrder
                || this.rulePriority(a.rule, a.index) - this.rulePriority(b.rule, b.index)
                || a.index - b.index
            );

        rules.forEach(({ rule }) => {
            const key = this.modifiedCostRuleConditionKey(rule);
            const previous = rowsByCondition.get(key);
            const status = this.ruleQualifies(rule) ? "✅" : "❌";
            const condition = this.formatModifiedCostRuleCondition(rule);
            const resolvedCost = this.applyModifiedCostRule(previous?.resolvedCost || baseCost, rule);
            const result = this.formatConditionalCostResult(resolvedCost);
            if (condition && result) {
                rowsByCondition.set(key, {
                    line: `${status} if ${condition}, ${result}`,
                    resolvedCost
                });
            }
        });
        return Array.from(rowsByCondition.values()).map(row => row.line);
    }

    autoGrantDisplayLines(optionOrId) {
        const option = typeof optionOrId === "string" ? this.option(optionOrId) : optionOrId;
        return this.normalizeAutoGrantRules(option).map(rule => {
            const label = this.optionMap.get(rule.id)?.label || rule.id;
            const status = this.selectedOptions[rule.id] ? "✅" : "❌";
            const suffix = rule.canDeselect ? " (can be deselected)" : " (locked)";
            return `${status} ${label}${suffix}`;
        });
    }

    prerequisiteMet(requirement) {
        if (!requirement) return true;
        if (typeof requirement === "string") {
            return !!evaluatePrereqExpr(requirement, id => this.selectedOptions[id] || 0);
        }
        if (Array.isArray(requirement)) {
            return requirement.every(id => this.meetsCountRequirement(id));
        }
        if (typeof requirement === "object") {
            const andList = requirement.and || [];
            const orList = requirement.or || [];
            const notList = requirement.not ? [requirement.not] : [];
            return andList.every(id => this.meetsCountRequirement(id))
                && (orList.length === 0 || orList.some(id => this.meetsCountRequirement(id)))
                && notList.every(id => !this.meetsCountRequirement(id));
        }
        return true;
    }

    optionPrerequisitesMet(option, selectionNumber = null) {
        if (!this.prerequisiteMet(option.prerequisites)) return false;
        const nextSelectionNumber = Number(selectionNumber) || (this.selectedOptions[option.id] || 0);
        const selectionRequirements = Array.isArray(option.prerequisitesBySelection) ? option.prerequisitesBySelection : [];
        for (let index = 0; index < nextSelectionNumber; index += 1) {
            if (!this.prerequisiteMet(selectionRequirements[index])) return false;
        }
        return true;
    }

    hasNoConflicts(option) {
        const outgoing = !option.conflictsWith || option.conflictsWith.every(id => !this.selectedOptions[id]);
        const incoming = Object.keys(this.selectedOptions).every(id => {
            const selected = this.optionMap.get(id);
            return !selected?.conflictsWith || !selected.conflictsWith.includes(option.id);
        });
        return outgoing && incoming;
    }

    categorySelectionCount(category) {
        if (!category) return 0;
        let total = 0;
        (category.options || []).forEach(option => {
            total += this.selectedOptions[option.id] || 0;
        });
        walkSubcategories(category.subcategories, subcat => {
            (subcat.options || []).forEach(option => {
                total += this.selectedOptions[option.id] || 0;
            });
        });
        return total;
    }

    structuralRequirementsMet(option) {
        const info = this.findSubcategoryInfo(option.id);
        if (!this.prerequisiteMet(info.category?.requiresOption)) return false;
        return (info.subcatPath || []).every(subcat => this.prerequisiteMet(subcat.requiresOption));
    }

    optionCountForLimit(option, rawCount) {
        const count = Number(rawCount) || 0;
        if (count <= 0) return 0;
        if (option?.bypassSubcategoryMaxSelections === true) return 0;
        return option?.countsAsOneSelection === true ? 1 : count;
    }

    subcategorySelectionCount(subcat, optionIdToIncrement = null) {
        return (subcat?.options || []).reduce((total, option) => {
            const current = this.selectedOptions[option.id] || 0;
            const adjusted = optionIdToIncrement && option.id === optionIdToIncrement ? current + 1 : current;
            return total + this.optionCountForLimit(option, adjusted);
        }, 0);
    }

    hasRemovableSelection(subcat) {
        const ids = new Set((subcat?.options || []).map(option => option.id));
        return this.selectionHistory.some(id => ids.has(id) && this.selectedOptions[id] > 0);
    }

    canSelect(optionOrId, { costOptionIndex = null } = {}) {
        const option = typeof optionOrId === "string" ? this.option(optionOrId) : optionOrId;
        const subcat = this.findSubcategoryOfOption(option.id);
        const subcatMax = subcat?.maxSelections || Infinity;
        const subcatCount = this.subcategorySelectionCount(subcat, option.id);
        const underSubcatLimit = (subcatCount <= subcatMax) || (subcatMax !== Infinity && this.hasRemovableSelection(subcat));
        const maxPerOption = option.maxSelections || 1;
        const underOptionLimit = (this.selectedOptions[option.id] || 0) < maxPerOption;
        const categoryMax = Number(this.findSubcategoryInfo(option.id).category?.maxSelections);
        const underCategoryLimit = !Number.isFinite(categoryMax) || categoryMax <= 0 || this.categorySelectionCount(this.findSubcategoryInfo(option.id).category) < categoryMax;
        const nextSelectionNumber = (this.selectedOptions[option.id] || 0) + 1;
        const choices = this.normalizeCostOptions(option, { selectionNumber: nextSelectionNumber });
        const info = this.findSubcategoryInfo(option.id);
        const hasDirectOptionCost = option?.cost && typeof option.cost === "object" && Object.keys(option.cost).length > 0;
        const hasConfiguredCostOptions = (Array.isArray(option.costOptions) && option.costOptions.length > 0)
            || (!hasDirectOptionCost && Array.isArray(info.subcat?.costOptions) && info.subcat.costOptions.length > 0);
        const selectedChoice = costOptionIndex === null || costOptionIndex === undefined
            ? choices[0]
            : choices.find(choice => choice.index === Number(costOptionIndex));
        const hasAvailableCostOption = !hasConfiguredCostOptions || !!selectedChoice;
        const cost = selectedChoice
            ? this.effectiveCost(option, { costOptionIndex: selectedChoice.index, selectionNumber: nextSelectionNumber })
            : this.effectiveCost(option, { selectionNumber: nextSelectionNumber });
        const hasPoints = Object.entries(cost).every(([type, cost]) => {
            if (cost < 0) return true;
            const current = Number(this.points[type]);
            const projected = (Number.isFinite(current) ? current : 0) - cost;
            return projected >= 0 || this.allowNegativeTypes.has(type);
        });

        return this.structuralRequirementsMet(option)
            && this.optionPrerequisitesMet(option, nextSelectionNumber)
            && this.hasNoConflicts(option)
            && underSubcatLimit
            && underCategoryLimit
            && underOptionLimit
            && hasAvailableCostOption
            && hasPoints;
    }

    ensureSubcategoryLimit(option) {
        const subcat = this.findSubcategoryOfOption(option.id);
        if (!subcat || subcat.maxSelections === undefined || subcat.maxSelections === Infinity) return;
        const ids = new Set((subcat.options || []).map(opt => opt.id));
        let count = this.subcategorySelectionCount(subcat, option.id);
        while (count > subcat.maxSelections) {
            const id = this.selectionHistory.find(historyId => {
                const historyOption = this.optionMap.get(historyId);
                return ids.has(historyId)
                    && this.selectedOptions[historyId] > 0
                    && historyOption?.bypassSubcategoryMaxSelections !== true;
            });
            if (!id) break;
            this.remove(id);
            count = this.subcategorySelectionCount(subcat, option.id);
        }
    }

    select(optionId, { costOptionIndex = null, skipCostModifierAffectedRemoval = false } = {}) {
        const option = this.option(optionId);
        const nextSelectionNumber = (this.selectedOptions[option.id] || 0) + 1;
        this.restoreActiveSliderModifierPointValues();
        if (!this.pendingAutoGrantSourceId) {
            const confirmed = this.removeSelectionsAffectedByCostModifierChange(option, nextSelectionNumber, {
                skipCostModifierAffectedRemoval
            });
            if (!confirmed) return false;
        }
        this.ensureSubcategoryLimit(option);
        assert(this.canSelect(option, { costOptionIndex }), `${this.filename}: expected ${optionId} to be selectable`);
        const choices = this.normalizeCostOptions(option, { selectionNumber: nextSelectionNumber });
        const resolvedCostOptionIndex = costOptionIndex ?? (choices[0]?.index ?? null);
        const cost = this.effectiveCost(option, {
            costOptionIndex: resolvedCostOptionIndex,
            selectionNumber: nextSelectionNumber
        });
        if (resolvedCostOptionIndex !== null && resolvedCostOptionIndex !== undefined) {
            this.selectedCostOptionIndexes[option.id] = Number(resolvedCostOptionIndex);
        }
        const isAutoGrant = !!this.pendingAutoGrantSourceId;
        if (!isAutoGrant) {
            Object.entries(cost).forEach(([type, value]) => {
                if (!Object.prototype.hasOwnProperty.call(this.points, type)) this.points[type] = 0;
                this.points[type] -= value;
            });
        }
        if (!this.discountedSelections[option.id]) this.discountedSelections[option.id] = [];
        this.discountedSelections[option.id].push(isAutoGrant ? {} : cost);
        if (!isAutoGrant && resolvedCostOptionIndex !== null && resolvedCostOptionIndex !== undefined) {
            if (!this.selectedCostOptionHistory[option.id]) this.selectedCostOptionHistory[option.id] = [];
            this.selectedCostOptionHistory[option.id].push(Number(resolvedCostOptionIndex));
        }
        this.selectedOptions[option.id] = (this.selectedOptions[option.id] || 0) + 1;
        this.selectionHistory.push(option.id);
        if (isAutoGrant) {
            this.autoGrantedSelections[option.id] = {
                sourceId: this.pendingAutoGrantSourceId,
                canDeselect: this.pendingAutoGrantCanDeselect === true
            };
        }
        this.applyAutoGrants(option);
        this.removeOptionsWithUnmetPrerequisites();
        this.applySliderModifiers();
        return true;
    }

    remove(optionId, { skipCostModifierAffectedRemoval = false } = {}) {
        const option = this.option(optionId);
        assert(this.selectedOptions[option.id] > 0, `${this.filename}: expected ${optionId} to be selected`);
        this.restoreActiveSliderModifierPointValues();
        const confirmed = this.removeSelectionsAffectedByCostModifierChange(option, (this.selectedOptions[option.id] || 0) - 1, {
            skipCostModifierAffectedRemoval
        });
        if (!confirmed) return false;
        const cost = this.discountedSelections[option.id]?.pop() ?? this.effectiveCost(option);
        if (this.selectedCostOptionHistory[option.id]) {
            this.selectedCostOptionHistory[option.id].pop();
            if (this.selectedCostOptionHistory[option.id].length === 0) delete this.selectedCostOptionHistory[option.id];
        }
        Object.entries(cost).forEach(([type, value]) => {
            if (!Object.prototype.hasOwnProperty.call(this.points, type)) this.points[type] = 0;
            this.points[type] += value;
        });
        this.selectedOptions[option.id] -= 1;
        if (this.selectedOptions[option.id] <= 0) {
            delete this.selectedOptions[option.id];
            if (option.pointAllocation) delete this.pointAllocationSelections[option.id];
        }
        if (!this.selectedOptions[option.id] && option.inputType === "text") delete this.storyInputs[option.id];
        const historyIndex = this.selectionHistory.indexOf(option.id);
        if (historyIndex >= 0) this.selectionHistory.splice(historyIndex, 1);
        this.removeAutoGrantsFromSource(option.id);
        this.removeOptionsWithUnmetPrerequisites();
        this.applySliderModifiers();
        return true;
    }

    normalizeAutoGrantRules(option) {
        const rules = Array.isArray(option?.autoGrants) ? option.autoGrants : [];
        return rules.map(rule => {
            if (typeof rule === "string") return { id: rule, canDeselect: false };
            if (rule && typeof rule === "object" && typeof rule.id === "string") {
                return { id: rule.id, canDeselect: rule.canDeselect === true };
            }
            return null;
        }).filter(Boolean);
    }

    applyAutoGrants(option, visited = new Set()) {
        if (!option?.id || visited.has(option.id)) return;
        visited.add(option.id);
        this.normalizeAutoGrantRules(option).forEach(rule => {
            if (visited.has(rule.id) || this.selectedOptions[rule.id]) return;
            this.pendingAutoGrantSourceId = option.id;
            this.pendingAutoGrantCanDeselect = rule.canDeselect;
            this.select(rule.id);
            delete this.pendingAutoGrantSourceId;
            delete this.pendingAutoGrantCanDeselect;
        });
    }

    removeAutoGrantsFromSource(sourceId) {
        Object.entries({ ...this.autoGrantedSelections }).forEach(([targetId, grant]) => {
            if (grant?.sourceId !== sourceId) return;
            if (this.selectedOptions[targetId]) this.remove(targetId);
            delete this.autoGrantedSelections[targetId];
        });
    }

    removeOptionsWithUnmetPrerequisites() {
        let removedAny = true;
        while (removedAny) {
            removedAny = false;
            for (const id of Object.keys(this.selectedOptions)) {
                const option = this.optionMap.get(id);
                if (option && (!this.structuralRequirementsMet(option) || !this.optionPrerequisitesMet(option) || !this.selectedCostOptionsStillValid(option))) {
                    this.remove(id);
                    removedAny = true;
                    break;
                }
            }
        }
    }

    prerequisiteDisplayStatuses(expression) {
        return computePrerequisiteDisplayStatuses(expression, id => this.meetsCountRequirement(id));
    }

    displayRequirements(optionOrId, selectionNumber = null) {
        const option = typeof optionOrId === "string" ? this.option(optionOrId) : optionOrId;
        const requirements = [];
        if (option.prerequisites) requirements.push(option.prerequisites);
        const effectiveSelectionNumber = Number(selectionNumber);
        const selectionRequirements = Array.isArray(option.prerequisitesBySelection) ? option.prerequisitesBySelection : [];
        if (Number.isFinite(effectiveSelectionNumber) && effectiveSelectionNumber > 0) {
            const selectionRequirement = selectionRequirements[effectiveSelectionNumber - 1];
            if (selectionRequirement) requirements.push(selectionRequirement);
        }
        return requirements;
    }

    displayRequirementLines(optionOrId, selectionNumber = null) {
        const atomLine = (rawId, negated = false, inheritedSatisfiedOr = false) => {
            const [id, minSuffix] = String(rawId).split("__");
            const label = this.optionMap.get(id)?.label || id;
            const requiredCount = minSuffix ? Number(minSuffix) || 1 : 1;
            const countLabel = requiredCount > 1 ? ` (x${requiredCount})` : "";
            const atomSatisfied = negated ? !this.meetsCountRequirement(rawId) : this.meetsCountRequirement(rawId);
            return `${inheritedSatisfiedOr || atomSatisfied ? "✅" : "❌"} ${negated ? "NOT " : ""}${label}${countLabel}`;
        };
        const inlineNode = (node, inheritedSatisfiedOr = false, negated = false) => {
            if (node.type === "atom") return atomLine(node.id, negated, inheritedSatisfiedOr);
            if (node.type === "not") {
                if (node.child?.type === "atom") return inlineNode(node.child, inheritedSatisfiedOr, !negated);
                return `NOT (${inlineNode(node.child, inheritedSatisfiedOr, false)})`;
            }
            if (node.type === "or") {
                const orSatisfied = inheritedSatisfiedOr || evaluatePrerequisiteNode(node, id => this.meetsCountRequirement(id));
                return node.children.map(child => inlineNode(child, orSatisfied, negated)).filter(Boolean).join(" OR ");
            }
            if (node.type === "and") {
                const text = node.children.map(child => inlineNode(child, inheritedSatisfiedOr, negated)).filter(Boolean).join(" AND ");
                return node.children.length > 1 ? `(${text})` : text;
            }
            return "";
        };
        const linesForNode = (node, inheritedSatisfiedOr = false, negated = false) => {
            if (node.type === "and") return node.children.flatMap(child => linesForNode(child, inheritedSatisfiedOr, negated));
            return [inlineNode(node, inheritedSatisfiedOr, negated)].filter(Boolean);
        };
        return this.displayRequirements(optionOrId, selectionNumber).flatMap(requirement => {
            if (typeof requirement === "string") {
                return linesForNode(parsePrerequisiteExpression(requirement));
            }
            if (Array.isArray(requirement)) {
                return requirement.map(id => `${this.meetsCountRequirement(id) ? "✅" : "❌"} ${this.optionMap.get(id)?.label || id}`);
            }
            if (requirement && typeof requirement === "object") {
                const andList = requirement.and || [];
                const orList = requirement.or || [];
                const lines = andList.map(id => atomLine(id));
                if (orList.length) {
                    const orAccepted = orList.some(id => this.meetsCountRequirement(id));
                    lines.push(orList.map(id => atomLine(id, false, orAccepted)).join(" OR "));
                }
                return lines;
            }
            return [];
        });
    }

    setTextInput(optionId, value) {
        const option = this.option(optionId);
        assert.strictEqual(option.inputType, "text", `${this.filename}: expected ${optionId} to be a text input option`);
        assert(this.selectedOptions[option.id] > 0, `${this.filename}: expected ${optionId} to be selected before entering text`);
        this.storyInputs[option.id] = sanitizeStoryInputValue(value, option.maxLength || 200);
    }

    assertFinitePoints() {
        Object.entries(this.points).forEach(([type, value]) => {
            assert(Number.isFinite(Number(value)), `${this.filename}: point type ${type} became non-finite`);
        });
    }

    buildExportState() {
        return {
            selectedOptions: this.selectedOptions,
            points: this.points,
            discountedSelections: this.discountedSelections,
            selectedCostOptionHistory: this.selectedCostOptionHistory,
            storyInputs: this.storyInputs,
            attributeSliderValues: this.attributeSliderValues,
            dynamicSelections: this.dynamicSelections,
            pointAllocationSelections: this.pointAllocationSelections,
            subcategoryDiscountSelections: this.subcategoryDiscountSelections,
            categoryDiscountSelections: this.categoryDiscountSelections,
            optionGrantDiscountSelections: this.optionGrantDiscountSelections,
            autoGrantedSelections: this.autoGrantedSelections
        };
    }

    buildPackedExportState() {
        const full = this.buildExportState();
        const packed = { v: 1, s: full.selectedOptions, p: full.points };
        if (hasOwnEntries(full.discountedSelections)) packed.d = full.discountedSelections;
        if (hasOwnEntries(full.selectedCostOptionHistory)) packed.h = full.selectedCostOptionHistory;
        if (hasOwnEntries(full.storyInputs)) packed.t = full.storyInputs;
        if (hasOwnEntries(full.attributeSliderValues)) packed.a = full.attributeSliderValues;
        if (hasOwnEntries(full.dynamicSelections)) packed.y = full.dynamicSelections;
        if (hasOwnEntries(full.pointAllocationSelections)) packed.l = full.pointAllocationSelections;
        if (hasOwnEntries(full.subcategoryDiscountSelections)) packed.u = full.subcategoryDiscountSelections;
        if (hasOwnEntries(full.categoryDiscountSelections)) packed.c = full.categoryDiscountSelections;
        if (hasOwnEntries(full.optionGrantDiscountSelections)) packed.g = full.optionGrantDiscountSelections;
        if (hasOwnEntries(full.autoGrantedSelections)) packed.r = full.autoGrantedSelections;
        return packed;
    }

    importState(importedData) {
        const unpacked = unpackImportedState(JSON.parse(JSON.stringify(importedData)));
        this.selectedOptions = { ...(unpacked.selectedOptions || {}) };
        this.points = { ...(unpacked.points || {}) };
        this.discountedSelections = { ...(unpacked.discountedSelections || {}) };
        this.selectedCostOptionHistory = { ...(unpacked.selectedCostOptionHistory || {}) };
        this.storyInputs = {};
        Object.entries(unpacked.storyInputs || {}).forEach(([key, value]) => {
            const config = this.getStoryInputConfig(key);
            if (!config) return;
            if (config.type === "option" && !this.selectedOptions[key]) return;
            const safeValue = sanitizeStoryInputValue(value, config.maxLength);
            if (safeValue) this.storyInputs[key] = safeValue;
        });
        this.attributeSliderValues = { ...(unpacked.attributeSliderValues || {}) };
        this.dynamicSelections = { ...(unpacked.dynamicSelections || {}) };
        this.pointAllocationSelections = { ...(unpacked.pointAllocationSelections || {}) };
        this.subcategoryDiscountSelections = { ...(unpacked.subcategoryDiscountSelections || {}) };
        this.categoryDiscountSelections = { ...(unpacked.categoryDiscountSelections || {}) };
        this.optionGrantDiscountSelections = { ...(unpacked.optionGrantDiscountSelections || {}) };
        this.autoGrantedSelections = { ...(unpacked.autoGrantedSelections || {}) };
    }

    clonePlayerState() {
        return {
            ...JSON.parse(JSON.stringify(this.buildExportState())),
            selectedCostOptionIndexes: JSON.parse(JSON.stringify(this.selectedCostOptionIndexes)),
            selectedCostOptionHistory: JSON.parse(JSON.stringify(this.selectedCostOptionHistory)),
            selectionHistory: [...this.selectionHistory]
        };
    }

    restorePlayerState(state) {
        this.selectedOptions = { ...(state.selectedOptions || {}) };
        this.points = { ...(state.points || {}) };
        this.discountedSelections = { ...(state.discountedSelections || {}) };
        this.selectedCostOptionIndexes = { ...(state.selectedCostOptionIndexes || {}) };
        this.selectedCostOptionHistory = { ...(state.selectedCostOptionHistory || {}) };
        this.storyInputs = { ...(state.storyInputs || {}) };
        this.attributeSliderValues = { ...(state.attributeSliderValues || {}) };
        this.dynamicSelections = { ...(state.dynamicSelections || {}) };
        this.pointAllocationSelections = { ...(state.pointAllocationSelections || {}) };
        this.subcategoryDiscountSelections = { ...(state.subcategoryDiscountSelections || {}) };
        this.categoryDiscountSelections = { ...(state.categoryDiscountSelections || {}) };
        this.optionGrantDiscountSelections = { ...(state.optionGrantDiscountSelections || {}) };
        this.autoGrantedSelections = { ...(state.autoGrantedSelections || {}) };
        this.selectionHistory = [...(state.selectionHistory || [])];
    }

    reloadData({ preservePlayerState = false } = {}) {
        const state = preservePlayerState ? this.clonePlayerState() : null;
        const data = JSON.parse(JSON.stringify(this.data));
        this.data = data;
        this.pointsEntry = data.find(entry => entry.type === "points") || { values: {} };
        this.points = { ...(this.pointsEntry.values || {}) };
        this.allowNegativeTypes = new Set(this.pointsEntry.allowNegative || []);
        this.categories = data.filter(entry => !entry.type || entry.name);
        this.selectedOptions = {};
        this.selectionHistory = [];
        this.discountedSelections = {};
        this.selectedCostOptionIndexes = {};
        this.selectedCostOptionHistory = {};
        this.storyInputs = {};
        this.attributeSliderValues = {};
        this.dynamicSelections = {};
        this.pointAllocationSelections = {};
        this.subcategoryDiscountSelections = {};
        this.categoryDiscountSelections = {};
        this.optionGrantDiscountSelections = {};
        this.autoGrantedSelections = {};
        this.optionMap = new Map();
        this.categories.forEach(category => {
            (category.options || []).forEach(option => this.optionMap.set(option.id, option));
            walkSubcategories(category.subcategories, subcat => {
                (subcat.options || []).forEach(option => this.optionMap.set(option.id, option));
            });
        });
        if (state) this.restorePlayerState(state);
    }
}

function hasOwnEntries(obj) {
    return !!obj && typeof obj === "object" && Object.keys(obj).length > 0;
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
        pointAllocationSelections: importedData.l || {},
        subcategoryDiscountSelections: importedData.u || {},
        categoryDiscountSelections: importedData.c || {},
        optionGrantDiscountSelections: importedData.g || {},
        autoGrantedSelections: importedData.r || {}
    };
}

function escapeHtml(str = "") {
    return String(str).replace(/[&<>"']/g, ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    }[ch]));
}

function isSafeTextColor(value = "") {
    const color = String(value).trim();
    return /^#[0-9a-f]{3,8}$/i.test(color)
        || /^rgba?\(\s*(\d{1,3}%?\s*,\s*){2}\d{1,3}%?(\s*,\s*(0|1|0?\.\d+|[1-9]\d*%))?\s*\)$/i.test(color)
        || /^hsla?\(\s*-?\d+(\.\d+)?(deg|rad|turn)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(\s*,\s*(0|1|0?\.\d+|[1-9]\d*%))?\s*\)$/i.test(color)
        || /^[a-z]+$/i.test(color);
}

function isSafeTextSize(value = "") {
    return /^[+-]?(\d+(\.\d+)?)(px|em|rem|%)$/i.test(String(value).trim());
}

function isSafeTextWeight(value = "") {
    const weight = String(value).trim();
    return /^[1-9]00$/.test(weight) && Number(weight) <= 900;
}

function buildTextSizeStyle(value = "") {
    const size = String(value).trim();
    const match = size.match(/^([+-])(\d+(\.\d+)?)(px|em|rem|%)$/i);
    if (!match) return `font-size: ${size};`;
    const operator = match[1] === "-" ? "-" : "+";
    return `font-size: calc(1em ${operator} ${match[2]}${match[4]});`;
}

function isSafeMarkdownUrl(value = "") {
    const url = String(value).trim();
    if (!url) return false;
    if (/[\u0000-\u001f\u007f\s]/.test(url)) return false;
    return /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(url);
}

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
            html += openTags[openTags.length - 1] === "bold" ? "</strong>" : "<strong>";
            openTags[openTags.length - 1] === "bold" ? openTags.pop() : openTags.push("bold");
        } else if (match[0] === "*" || match[0] === "_") {
            html += openTags[openTags.length - 1] === "italic" ? "</em>" : "<em>";
            openTags[openTags.length - 1] === "italic" ? openTags.pop() : openTags.push("italic");
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

function getPointTypeMarkup(type = "") {
    return renderFormattedInlineText(type);
}

function getPointAmountMarkup(type, value) {
    return `${getPointTypeMarkup(type)} ${escapeHtml(String(value))}`;
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

function assertDeepEqual(actual, expected, message) {
    assert.deepStrictEqual(actual, expected, message);
}

function findCategory(data, name) {
    return data.find(entry => entry && entry.name === name);
}

function renamePointMapKey(map, oldName, newName) {
    if (!map || typeof map !== "object" || Array.isArray(map) || !Object.prototype.hasOwnProperty.call(map, oldName)) return;
    const existing = map[oldName];
    delete map[oldName];
    map[newName] = existing;
}

function renamePointTypeReferences(data, oldName, newName) {
    data.forEach(entry => {
        if (!entry || typeof entry !== "object") return;
        renamePointMapKey(entry.discountAmount, oldName, newName);

        const visitCostRules = owner => {
            [...(owner?.modifiedCosts || []), ...(owner?.discounts || [])].forEach(rule => {
                renamePointMapKey(rule?.cost, oldName, newName);
                renamePointMapKey(rule?.costDelta, oldName, newName);
                renamePointMapKey(rule?.costPercent, oldName, newName);
                renamePointMapKey(rule?.minCost, oldName, newName);
                renamePointMapKey(rule?.maxCost, oldName, newName);
            });
        };
        const visitOption = option => {
            renamePointMapKey(option?.cost, oldName, newName);
            (option?.costOptions || []).forEach(costOption => renamePointMapKey(costOption?.cost, oldName, newName));
            (option?.costOptions || []).forEach(costOption => (costOption?.costBySelection || []).forEach(cost => renamePointMapKey(cost, oldName, newName)));
            renamePointMapKey(option?.costPerPoint, oldName, newName);
            if (Array.isArray(option?.pointAllocation?.types)) {
                option.pointAllocation.types = option.pointAllocation.types.map(type => type === oldName ? newName : type);
            }
            visitCostRules(option);
        };
        const visitSubcategory = subcat => {
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

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

test("functional coverage should document every supported behavior area", () => {
    assert(FEATURE_COVERAGE.length >= 18);
    FEATURE_COVERAGE.forEach(feature => assert.strictEqual(typeof feature, "string"));
});

test("synthetic fixture should keep every option cost finite and expose selectable options", () => {
    const engine = CyoaEngine.synthetic();
    assert(engine.optionMap.size > 0, "synthetic: expected at least one option");
    let selectableCount = 0;
    engine.optionMap.forEach(option => {
        const cost = engine.effectiveCost(option);
        Object.entries(cost).forEach(([type, value]) => {
            assert(Number.isFinite(Number(value)), `synthetic: ${option.id} has non-finite effective cost for ${type}`);
        });
        if (engine.canSelect(option)) selectableCount += 1;
    });
    assert(selectableCount > 0, "synthetic: expected at least one selectable option");
    engine.assertFinitePoints();
});

test("single-select subcategories should replace the previous selection", () => {
    const engine = CyoaEngine.synthetic();
    engine.select("powersDifficultySpectacularmanMode");
    assert.strictEqual(engine.points.Points, 200);
    assert.strictEqual(engine.selectedOptions.powersDifficultySpectacularmanMode, 1);

    engine.select("powersDifficultyDakestKnightRecommended");
    assert.strictEqual(engine.points.Points, 100);
    assert.strictEqual(engine.selectedOptions.powersDifficultySpectacularmanMode, undefined);
    assert.strictEqual(engine.selectedOptions.powersDifficultyDakestKnightRecommended, 1);
});

test("selection costs should debit, gains should credit, and refunds should restore points", () => {
    const engine = CyoaEngine.synthetic();
    engine.select("spendTwo");
    assert.strictEqual(engine.points.Points, 8);
    engine.remove("spendTwo");
    assert.strictEqual(engine.points.Points, 10);

    engine.select("gainThree");
    assert.strictEqual(engine.points.Points, 13);
    engine.remove("gainThree");
    assert.strictEqual(engine.points.Points, 10);

    engine.select("multi");
    engine.select("multi");
    engine.select("multi");
    assert.strictEqual(engine.selectedOptions.multi, 3);
    assert.strictEqual(engine.canSelect("multi"), false);
});

test("alternate cost maps should charge the chosen payment option", () => {
    const engine = CyoaEngine.synthetic();
    engine.points.Tokens = 3;
    assert.deepStrictEqual(engine.effectiveCostChoices("alternateCost").map(choice => choice.cost), [
        { Points: 4 },
        { Tokens: 2 }
    ]);

    engine.select("alternateCost", { costOptionIndex: 1 });
    assert.strictEqual(engine.points.Points, 10);
    assert.strictEqual(engine.points.Tokens, 1);
    assert.deepStrictEqual(engine.discountedSelections.alternateCost[0], { Tokens: 2 });

    engine.select("alternateCost", { costOptionIndex: 0 });
    assert.strictEqual(engine.points.Points, 6);
    assert.strictEqual(engine.points.Tokens, 1);
    assert.deepStrictEqual(engine.discountedSelections.alternateCost[1], { Points: 4 });

    engine.remove("alternateCost");
    assert.strictEqual(engine.points.Points, 10);
    assert.strictEqual(engine.points.Tokens, 1);

    engine.remove("alternateCost");
    assert.strictEqual(engine.points.Points, 10);
    assert.strictEqual(engine.points.Tokens, 3);
});

test("repeatable options should use selection-specific costs for later selections", () => {
    const engine = CyoaEngine.synthetic();
    engine.points.Tokens = 3;

    assert.deepStrictEqual(engine.effectiveCostChoices("tieredRepeatCost").map(choice => choice.cost), [
        { Points: 1 },
        { Tokens: 1 }
    ]);
    engine.select("tieredRepeatCost", { costOptionIndex: 0 });
    assert.strictEqual(engine.points.Points, 9);
    assert.deepStrictEqual(engine.effectiveCostChoices("tieredRepeatCost").map(choice => choice.cost), [
        { Points: 2 },
        { Tokens: 2 }
    ]);
    engine.select("tieredRepeatCost", { costOptionIndex: 1 });
    assert.strictEqual(engine.points.Points, 9);
    assert.strictEqual(engine.points.Tokens, 1);
    assert.deepStrictEqual(engine.discountedSelections.tieredRepeatCost, [{ Points: 1 }, { Tokens: 2 }]);

    engine.remove("tieredRepeatCost");
    assert.strictEqual(engine.points.Tokens, 3);
    engine.remove("tieredRepeatCost");
    assert.strictEqual(engine.points.Points, 10);
    assert(
        EDITOR_SCRIPT_SOURCE.includes("Selection-specific costs"),
        "visual editor should expose selection-specific costs for repeatable options"
    );
});

test("repeatable option display costs should match charged selection-specific costs", () => {
    const engine = CyoaEngine.synthetic();

    const firstDisplayedCost = engine.displayedNextSelectionCost("tieredRepeatCost", 0);
    assert.deepStrictEqual(firstDisplayedCost, { Points: 1 });
    engine.select("tieredRepeatCost", { costOptionIndex: 0 });
    assert.deepStrictEqual(engine.discountedSelections.tieredRepeatCost[0], firstDisplayedCost);
    assert.strictEqual(engine.points.Points, 9);

    const secondDisplayedCost = engine.displayedNextSelectionCost("tieredRepeatCost", 0);
    assert.deepStrictEqual(secondDisplayedCost, { Points: 2 });
    engine.select("tieredRepeatCost", { costOptionIndex: 0 });
    assert.deepStrictEqual(engine.discountedSelections.tieredRepeatCost[1], secondDisplayedCost);
    assert.strictEqual(engine.points.Points, 7);
});

test("repeatable cost options should enforce base-first and per-choice limits", () => {
    const engine = CyoaEngine.synthetic();
    assert.deepStrictEqual(engine.effectiveCostChoices("limitedRepeatCosts"), [
        { index: 0, cost: { Points: 1 } }
    ]);

    const malformedImportEngine = CyoaEngine.synthetic();
    malformedImportEngine.selectedOptions.limitedRepeatCosts = 1;
    malformedImportEngine.selectedCostOptionHistory.limitedRepeatCosts = [1];
    assert.deepStrictEqual(malformedImportEngine.effectiveCostChoices("limitedRepeatCosts"), [
        { index: 0, cost: { Points: 1 } }
    ]);

    engine.points.Tokens = 1;
    engine.select("limitedRepeatCosts", { costOptionIndex: 0 });
    assert.deepStrictEqual(engine.selectedCostOptionHistory.limitedRepeatCosts, [0]);
    assert.deepStrictEqual(engine.effectiveCostChoices("limitedRepeatCosts"), [
        { index: 1, cost: { Tokens: 1 } },
        { index: 2, cost: { Points: -1 } }
    ]);

    engine.select("limitedRepeatCosts", { costOptionIndex: 1 });
    assert.deepStrictEqual(engine.selectedCostOptionHistory.limitedRepeatCosts, [0, 1]);
    assert.deepStrictEqual(engine.effectiveCostChoices("limitedRepeatCosts"), [
        { index: 2, cost: { Points: -1 } }
    ]);

    engine.select("limitedRepeatCosts", { costOptionIndex: 2 });
    assert.strictEqual(engine.canSelect("limitedRepeatCosts"), false);
    assert.strictEqual(engine.points.Points, 10);
    assert.strictEqual(engine.points.Tokens, 0);

    engine.remove("limitedRepeatCosts");
    assert.deepStrictEqual(engine.selectedCostOptionHistory.limitedRepeatCosts, [0, 1]);
    assert.deepStrictEqual(engine.effectiveCostChoices("limitedRepeatCosts"), [
        { index: 2, cost: { Points: -1 } }
    ]);
});

test("repeatable cost options should default each payment choice to one use", () => {
    const engine = CyoaEngine.synthetic();

    assert.deepStrictEqual(engine.effectiveCostChoices("implicitLimitedRepeatCosts"), [
        { index: 0, cost: { Points: 1 } }
    ]);
    assert.strictEqual(engine.canSelect("implicitLimitedRepeatCosts", { costOptionIndex: 1 }), false);
    assert.strictEqual(engine.canSelect("implicitLimitedRepeatCosts", { costOptionIndex: 2 }), false);

    engine.select("implicitLimitedRepeatCosts", { costOptionIndex: 0 });
    assert.deepStrictEqual(engine.selectedCostOptionHistory.implicitLimitedRepeatCosts, [0]);
    assert.deepStrictEqual(engine.effectiveCostChoices("implicitLimitedRepeatCosts"), [
        { index: 1, cost: { Points: 2 } },
        { index: 2, cost: { Points: -1 } }
    ]);
    assert.deepStrictEqual(
        engine.normalizeCostOptions(engine.option("implicitLimitedRepeatCosts"), {
            selectionNumber: 2,
            includeUnavailable: true
        }),
        [
            { index: 0, available: false, cost: { Points: 1 } },
            { index: 1, available: true, cost: { Points: 2 } },
            { index: 2, available: true, cost: { Points: -1 } }
        ],
        "player dropdown should keep payment options in stable configured order while disabling unavailable choices"
    );
    assert.deepStrictEqual(
        engine.effectiveCostChoices("implicitLimitedRepeatCosts", {
            selectionNumber: 2,
            includeUnavailable: true
        }),
        [
            { index: 0, cost: { Points: 1 } },
            { index: 1, cost: { Points: 2 } },
            { index: 2, cost: { Points: -1 } }
        ],
        "player payment option displays should keep unavailable choices in configured order with their own costs"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("includeUnavailable: true") &&
            PLAYER_SCRIPT_SOURCE.includes("displayCostOptions.forEach") &&
            PLAYER_SCRIPT_SOURCE.includes("option.disabled = choice.available === false || !canAffordCost(effectiveCost)") &&
            PLAYER_SCRIPT_SOURCE.includes("includeUnavailable: options.includeUnavailable === true"),
        "player renderer should keep unavailable payment choices in configured order instead of reordering by filtering"
    );

    engine.select("implicitLimitedRepeatCosts", { costOptionIndex: 1 });
    assert.deepStrictEqual(engine.selectedCostOptionHistory.implicitLimitedRepeatCosts, [0, 1]);
    assert.deepStrictEqual(engine.effectiveCostChoices("implicitLimitedRepeatCosts"), [
        { index: 2, cost: { Points: -1 } }
    ]);
    assert.strictEqual(engine.canSelect("implicitLimitedRepeatCosts", { costOptionIndex: 1 }), false);

    engine.select("implicitLimitedRepeatCosts", { costOptionIndex: 2 });
    assert.deepStrictEqual(engine.selectedCostOptionHistory.implicitLimitedRepeatCosts, [0, 1, 2]);
    assert.deepStrictEqual(engine.effectiveCostChoices("implicitLimitedRepeatCosts"), []);
    assert.strictEqual(engine.canSelect("implicitLimitedRepeatCosts"), false);
});

test("Superpowered World power and motorbike upgrades require base purchases", () => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "CYOAs", "superpowered_world.json"), "utf8"));
    walkSubcategories(data.find(entry => entry.name === "Powers").subcategories, subcat => {
        (subcat.options || []).forEach(option => {
            (option.costOptions || []).slice(1).forEach(costOption => {
                delete costOption.minSelected;
                delete costOption.requiresCostOption;
            });
        });
    });
    const skillsAndEquipmentForFixture = data.find(entry => entry.name === "Skills and Equipment");
    walkSubcategories(skillsAndEquipmentForFixture.subcategories, subcat => {
        if (subcat.name !== "Skills" && subcat.name !== "Equipment") return;
        (subcat.options || []).forEach(option => {
            if (subcat.name === "Equipment" && option.id !== "skillsAndEquipmentEquipmentMotorbike") return;
            (option.costOptions || []).slice(1).forEach(costOption => {
                delete costOption.minSelected;
                delete costOption.requiresCostOption;
            });
        });
    });
    const engine = new CyoaEngine(data, "superpowered_world.json");
    engine.points.Boons = 10;

    const powersCategory = data.find(entry => entry.name === "Powers");
    const powersSubcategory = powersCategory.subcategories.find(subcat => subcat.name === "Powers");
    const powerIds = powersSubcategory.options
        .filter(option => Array.isArray(option.costOptions) && option.costOptions.length > 1)
        .map(option => option.id);
    powerIds.forEach(id => {
        assert.deepStrictEqual(
            engine.effectiveCostChoices(id).map(choice => choice.cost),
            [{ Powers: 1 }],
            `${id} should expose only the base power purchase before selection`
        );
        assert.strictEqual(engine.canSelect(id, { costOptionIndex: 1 }), false, `${id} boon should be locked before base purchase`);
        if (engine.option(id).costOptions.length > 2) {
            assert.strictEqual(engine.canSelect(id, { costOptionIndex: 2 }), false, `${id} bane should be locked before base purchase`);
        }
    });

    engine.points.Powers = 10;
    engine.select("powersPowersHyperRunning", { costOptionIndex: 0 });
    assert.deepStrictEqual(
        engine.effectiveCostChoices("powersPowersHyperRunning").map(choice => choice.cost),
        [{ Boons: 1 }, { Boons: -1 }],
        "Hyper Running should expose boon and bane only after the base power purchase"
    );
    assert.strictEqual(engine.canSelect("powersPowersHyperRunning", { costOptionIndex: 1 }), true);
    assert.strictEqual(engine.canSelect("powersPowersHyperRunning", { costOptionIndex: 2 }), true);

    engine.points.Equipment = 5;
    assert.deepStrictEqual(engine.effectiveCostChoices("skillsAndEquipmentEquipmentMotorbike"), [
        { index: 0, cost: { Equipment: 1 } }
    ]);
    assert.strictEqual(engine.canSelect("skillsAndEquipmentEquipmentMotorbike", { costOptionIndex: 1 }), false);
    engine.select("skillsAndEquipmentEquipmentMotorbike", { costOptionIndex: 0 });
    assert.deepStrictEqual(engine.effectiveCostChoices("skillsAndEquipmentEquipmentMotorbike"), [
        { index: 1, cost: { Boons: 1 } }
    ]);
    assert.strictEqual(engine.canSelect("skillsAndEquipmentEquipmentMotorbike", { costOptionIndex: 1 }), true);

    const importedStateEngine = new CyoaEngine(data, "superpowered_world.json imported state");
    importedStateEngine.selectedOptions.powersPowersHyperRunning = 1;
    importedStateEngine.points.Boons = 10;
    assert.deepStrictEqual(
        importedStateEngine.effectiveCostChoices("powersPowersHyperRunning").map(choice => choice.cost),
        [{ Boons: 1 }, { Boons: -1 }],
        "Imported selections without cost-option history should still unlock upgrades from the selected count"
    );
});

test("Superpowered World allies can be selected as allies or bitter enemies", () => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "CYOAs", "superpowered_world.json"), "utf8"));
    const engine = new CyoaEngine(data, "superpowered_world.json");

    assert.deepStrictEqual(engine.effectiveCostChoices("alliesSidekicksMissilemen"), [
        { index: 0, cost: { Allies: 1 } },
        { index: 1, cost: { Boons: -0.5 } }
    ]);
    assert.deepStrictEqual(engine.effectiveCostChoices("alliesAverageJoesMeritorious"), [
        { index: 0, cost: { Allies: 1 } },
        { index: 1, cost: { Boons: -0.5 } }
    ]);
    assert.deepStrictEqual(engine.effectiveCostChoices("alliesIconsVaricell"), [
        { index: 0, cost: { Boons: 1, Allies: 1 } },
        { index: 1, cost: { Boons: -1 } }
    ]);
    assert.deepStrictEqual(engine.effectiveCostChoices("alliesSupericonsVictor"), [
        { index: 0, cost: { Boons: 2, Allies: 1 } },
        { index: 1, cost: { Boons: -1 } }
    ]);
    assert.deepStrictEqual(engine.effectiveCostChoices("alliesOtherAlternate"), [
        { index: null, label: "Cost", cost: {} }
    ]);
    assert.strictEqual(engine.optionMap.has("boonsAndBanesBanesBitterEnemies"), false);

    engine.points.Allies = 4;
    engine.select("alliesSidekicksMissilemen", { costOptionIndex: 1 });
    engine.select("alliesAverageJoesMeritorious", { costOptionIndex: 1 });
    assert.strictEqual(engine.points.Boons, 1);
    assert.strictEqual(engine.canSelect("alliesSidekicksMissilemen", { costOptionIndex: 0 }), false);

    const loneWolfEngine = new CyoaEngine(data, "superpowered_world.json lone wolf enemies");
    loneWolfEngine.points.Allies = 4;
    loneWolfEngine.points.Boons = 2;
    loneWolfEngine.select("originStoryYourTeamLoneWolf");
    assert.deepStrictEqual(loneWolfEngine.effectiveCostChoices("alliesSidekicksDFeats"), [
        { index: 1, cost: { Boons: -0.5 } }
    ]);
    assert.deepStrictEqual(loneWolfEngine.effectiveCostChoices("alliesIconsBlankman"), [
        { index: 1, cost: { Boons: -1 } }
    ]);
    assert.strictEqual(loneWolfEngine.canSelect("alliesSidekicksDFeats", { costOptionIndex: 0 }), false);
    assert.strictEqual(loneWolfEngine.canSelect("alliesSidekicksDFeats", { costOptionIndex: 1 }), true);
    assert.strictEqual(loneWolfEngine.canSelect("alliesIconsBlankman", { costOptionIndex: 0 }), false);
    assert.strictEqual(loneWolfEngine.canSelect("alliesIconsBlankman", { costOptionIndex: 1 }), true);
    assert.strictEqual(loneWolfEngine.canSelect("alliesOtherAlternate"), false);

    const allyThenLoneWolfEngine = new CyoaEngine(data, "superpowered_world.json ally then lone wolf");
    allyThenLoneWolfEngine.points.Allies = 4;
    allyThenLoneWolfEngine.select("alliesSidekicksHAM", { costOptionIndex: 0 });
    assert.strictEqual(allyThenLoneWolfEngine.selectedOptions.alliesSidekicksHAM, 1);
    allyThenLoneWolfEngine.select("originStoryYourTeamLoneWolf");
    assert.strictEqual(allyThenLoneWolfEngine.selectedOptions.alliesSidekicksHAM, undefined);
});

test("Superpowered World skill mastery upgrades require base skill purchases", () => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "CYOAs", "superpowered_world.json"), "utf8"));
    walkSubcategories(data.find(entry => entry.name === "Skills and Equipment").subcategories, subcat => {
        if (subcat.name !== "Skills") return;
        (subcat.options || []).forEach(option => {
            (option.costOptions || []).slice(1).forEach(costOption => {
                delete costOption.minSelected;
                delete costOption.requiresCostOption;
            });
        });
    });
    const engine = new CyoaEngine(data, "superpowered_world.json");
    engine.points.Boons = 5;

    assert.strictEqual(engine.optionMap.has("boonsAndBanesBoonsMastery"), false);
    const skillsCategory = data.find(entry => entry.name === "Skills and Equipment");
    const skillsSubcategory = skillsCategory.subcategories.find(subcat => subcat.name === "Skills");
    skillsSubcategory.options
        .filter(option => Array.isArray(option.costOptions) && option.costOptions.length > 1)
        .forEach(option => {
            assert.deepStrictEqual(
                engine.effectiveCostChoices(option.id),
                [{ index: 0, cost: { Skills: 1 } }],
                `${option.id} should expose only the base skill purchase before selection`
            );
            assert.strictEqual(engine.canSelect(option.id, { costOptionIndex: 1 }), false, `${option.id} mastery should be locked before base purchase`);
        });

    engine.points.Skills = 5;
    engine.select("skillsAndEquipmentSkillsFitness", { costOptionIndex: 0 });
    assert.deepStrictEqual(engine.effectiveCostChoices("skillsAndEquipmentSkillsFitness"), [
        { index: 1, cost: { Boons: 1 } }
    ]);
    assert.strictEqual(engine.canSelect("skillsAndEquipmentSkillsFitness", { costOptionIndex: 1 }), true);
    engine.select("skillsAndEquipmentSkillsFitness", { costOptionIndex: 1 });
    assert.strictEqual(engine.selectedOptions.skillsAndEquipmentSkillsFitness, 2);

    assert.deepStrictEqual(engine.effectiveCostChoices("skillsAndEquipmentSkillsPhD"), [
        { index: 0, cost: { Skills: 1, Boons: 1 } }
    ]);
    assert.strictEqual(engine.canSelect("skillsAndEquipmentSkillsPhD", { costOptionIndex: 1 }), false);
});

test("repeatable options should enforce selection-specific prerequisites", () => {
    const engine = CyoaEngine.synthetic();
    const gear = engine.option("repeatablePrereqGear");

    assert.strictEqual(engine.canSelect("repeatablePrereqGear"), true);
    assert.deepStrictEqual(engine.effectiveCost("repeatablePrereqGear", { costOptionIndex: 0, selectionNumber: 1 }), { Points: 1 });
    assert.deepStrictEqual(engine.effectiveCost("repeatablePrereqGear", { costOptionIndex: 0, selectionNumber: 2 }), { Points: 3 });
    assert.deepStrictEqual(engine.displayRequirements(gear, 1), []);
    assert.deepStrictEqual(engine.displayRequirements(gear, 2), ["repeatablePrereqUnlock"]);
    engine.select("repeatablePrereqGear");
    assert.strictEqual(engine.points.Points, 9);
    assert.strictEqual(engine.selectedOptions.repeatablePrereqGear, 1);
    assert.strictEqual(engine.canSelect("repeatablePrereqGear"), false);
    assert.deepStrictEqual(engine.displayRequirements(gear, engine.selectedOptions.repeatablePrereqGear + 1), ["repeatablePrereqUnlock"]);
    assert.deepStrictEqual(engine.prerequisiteDisplayStatuses(gear.prerequisitesBySelection[1]), [{
        id: "repeatablePrereqUnlock",
        negated: false,
        satisfied: false
    }]);

    engine.select("repeatablePrereqUnlock");
    assert.strictEqual(engine.canSelect("repeatablePrereqGear"), true);
    assert.deepStrictEqual(engine.effectiveCost("repeatablePrereqGear", { costOptionIndex: 0, selectionNumber: 2 }), { Points: 3 });
    assert.deepStrictEqual(engine.prerequisiteDisplayStatuses(gear.prerequisitesBySelection[1]), [{
        id: "repeatablePrereqUnlock",
        negated: false,
        satisfied: true
    }]);
    engine.select("repeatablePrereqGear");
    assert.strictEqual(engine.points.Points, 6);
    assert.strictEqual(engine.selectedOptions.repeatablePrereqGear, 2);
    assert.deepStrictEqual(engine.discountedSelections.repeatablePrereqGear, [{ Points: 1 }, { Points: 3 }]);

    engine.remove("repeatablePrereqUnlock");
    assert.strictEqual(engine.selectedOptions.repeatablePrereqGear, 1);
    assert.strictEqual(engine.points.Points, 9);
    assert(
        PLAYER_SCRIPT_SOURCE.includes("getOptionDisplayRequirements"),
        "player UI should include next-selection prerequisite rendering for repeatable options"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("selectionNumber: displaySelectionNumber"),
        "player UI should render selection-specific tier costs instead of the last paid cost"
    );
});

test("repeatable option second selections should disclose higher cost and prerequisite", () => {
    const engine = CyoaEngine.synthetic();

    assert.deepStrictEqual(engine.displayedNextSelectionCost("repeatableOptionA", 0), { Points: 3 });
    assert.deepStrictEqual(engine.displayRequirements("repeatableOptionA", 1), []);
    engine.select("repeatableOptionA");
    assert.strictEqual(engine.points.Points, 7);
    assert.strictEqual(engine.canSelect("repeatableOptionA"), false);

    assert.deepStrictEqual(engine.displayedNextSelectionCost("repeatableOptionA", 0), { Points: 5 });
    assert.deepStrictEqual(engine.displayRequirements("repeatableOptionA", 2), ["repeatableOptionB"]);
    assert.deepStrictEqual(engine.displayRequirementLines("repeatableOptionA", 2), ["❌ Option B"]);

    engine.select("repeatableOptionB");
    assert.strictEqual(engine.canSelect("repeatableOptionA"), true);
    assert.deepStrictEqual(engine.displayRequirementLines("repeatableOptionA", 2), ["✅ Option B"]);
    engine.select("repeatableOptionA");
    assert.strictEqual(engine.points.Points, 2);
    assert.deepStrictEqual(engine.discountedSelections.repeatableOptionA, [{ Points: 3 }, { Points: 5 }]);
});

test("payment option labels should not be player-facing because costs describe the choice", () => {
    assert(
        !EDITOR_SCRIPT_SOURCE.includes("Player-facing label"),
        "visual editor should not expose redundant labels for payment choices"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("option.textContent = formatCostMapPlainText(effectiveCost) || \"Free\""),
        "player dropdown should display generated cost/gain text instead of stored payment labels"
    );
});

test("standalone points display should be hidden when cost options are shown", () => {
    assert(
        PLAYER_SCRIPT_SOURCE.includes("const shouldShowCostOptions = costChoices.length > 1 && selectedCount === 0;"),
        "player should determine when selectable cost options will be shown"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("if (!shouldShowCostOptions)") && PLAYER_SCRIPT_SOURCE.includes("if (shouldShowCostOptions)"),
        "player should hide standalone Points when rendering Cost Options"
    );

    const engine = CyoaEngine.synthetic();
    const choices = engine.effectiveCostChoices("alternateCost").map(choice => choice.cost);
    assert.deepStrictEqual(choices, [{ Points: 4 }, { Tokens: 2 }]);
});

test("single-select payment options should still expose an explicit selector", () => {
    const singleSelectWithPaymentOptions = {
        id: "singlePayment",
        maxSelections: 1,
        costOptions: [
            { label: "Payment Option 1", cost: { Points: 1 } },
            { label: "Payment Option 2", cost: { Tokens: 1 } }
        ]
    };
    const singleSelectWithoutPaymentOptions = { id: "singleFree", maxSelections: 1, cost: {} };
    const multiSelectWithoutPaymentOptions = { id: "multi", maxSelections: 2, cost: {} };

    const shouldRenderSelectionControls = option => option.inputType === "text"
        || (option.maxSelections || 1) !== 1
        || (Array.isArray(option.costOptions) ? option.costOptions : []).length > 1;

    assert.strictEqual(shouldRenderSelectionControls(singleSelectWithPaymentOptions), true);
    assert.strictEqual(shouldRenderSelectionControls(singleSelectWithoutPaymentOptions), false);
    assert.strictEqual(shouldRenderSelectionControls(multiSelectWithoutPaymentOptions), true);
    assert(
        PLAYER_SCRIPT_SOURCE.includes("shouldRenderSelectionControls(opt)"),
        "player renderer should use shouldRenderSelectionControls so single-select payment options show the dropdown"
    );
});

test("category tabs should support multiple open panels and bulk expansion", () => {
    assert(
        PLAYER_SCRIPT_SOURCE.includes("openAllButton.textContent = \"Open All\""),
        "player should render an Open All category control"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("visibleCategories.forEach(cat => openCategoryAndSubcategories(cat))"),
        "Open All should add every visible category and its subcategories to open state"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("collectOpenableSubcategoryKeys(cat, catIndex, cat.subcategories || []).forEach(key => {"),
        "Open All should collect every unlocked subcategory key for each category"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("openSubcategories.add(key)") &&
        PLAYER_SCRIPT_SOURCE.includes("subcategoriesToAnimate.add(key)"),
        "Open All should open and animate all unlocked subcategories"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("openAllButton.disabled = allCategoryPanelsOpen"),
        "Open All should stay available until both categories and subcategories are open"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("closeAllButton.disabled = openCategories.size === 0 && openSubcategories.size === 0") &&
        PLAYER_SCRIPT_SOURCE.includes("openSubcategories.clear();") &&
        PLAYER_SCRIPT_SOURCE.includes("subcategoriesToAnimate.clear();"),
        "Close All should include subcategory open state"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("const activeCategories = visibleCategories.filter(cat => openCategories.has(cat.name))"),
        "player should render every open category instead of a single currentTab category"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("activeCategories.forEach(cat => renderCategoryContent(cat"),
        "player should render multiple active category contents in one pass"
    );
});

test("single-subcategory categories should render the only subcategory open by default", () => {
    assert(
        PLAYER_SCRIPT_SOURCE.includes('const hasTabbedNav = mode === "tabs" && children.length > 1'),
        "player should skip subcategory tab gating when a category has only one subcategory"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("hasTabbedNav\n            ? childMeta.filter(meta => openSubcategories.has(meta.key))\n            : childMeta"),
        "player should render all child metadata when no subcategory tab navigation is needed"
    );
});

test("backpack labels should include repeated selection counts", () => {
    assert(
        PLAYER_SCRIPT_SOURCE.includes("labelDiv.textContent = selectedCount > 1 ? `${opt.label} x${selectedCount}` : opt.label;"),
        "backpack should append xN to labels when an option has multiple selections"
    );

    const engine = CyoaEngine.synthetic();
    engine.select("multi");
    engine.select("multi");
    const labels = renderBackpackWithPlayerScript(engine.data, engine.selectedOptions);
    assert(labels.includes("Core"), "backpack should group selected synthetic options by category");
    assert(labels.includes("Multi x2"), "backpack should show repeated selection counts using script.js rendering logic");

    const emptyLabels = renderBackpackWithPlayerScript(engine.data, {});
    assert(
        emptyLabels.includes("No selections yet. Make some choices to see them here!"),
        "backpack should show the script.js empty-state message when nothing is selected"
    );
});

test("visual editor should enable backpack by default for new CYOAs", () => {
    assert(
        EDITOR_SCRIPT_SOURCE.includes('type: "backpack",\n            enabled: true'),
        "editor should create missing backpack entries as enabled by default"
    );
    assert(
        EDITOR_SCRIPT_SOURCE.includes("if (backpackEntry.enabled === undefined)") &&
            EDITOR_SCRIPT_SOURCE.includes("checkbox.checked = backpackEntry.enabled !== false"),
        "editor should treat missing backpack enabled flags as enabled while preserving explicit false"
    );
    assert(
        SERVER_SCRIPT_SOURCE.includes('{ "type": "backpack", "enabled": true }'),
        "server-created CYOA templates should include an enabled backpack entry"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("backpackEnabled = backpackEntry ? backpackEntry.enabled !== false : false;"),
        "player should treat backpack entries without an enabled flag as enabled"
    );
});

test("point type renames should update every referenced cost map", () => {
    const data = CyoaEngine.synthetic().data;
    const core = findCategory(data, "Core");
    const choices = core.subcategories.find(subcat => subcat.name === "Choices");
    const alternateCost = choices.options.find(option => option.id === "alternateCost");
    const optionOverride = choices.options.find(option => option.id === "optionOverride");
    optionOverride.modifiedCosts.push({ ids: ["preA"], costPercent: { Points: -25 }, priority: 2 });
    renamePointTypeReferences(data, "Points", "Hero Points");
    const grantTarget = new CyoaEngine(data, "renamed point type fixture").option("discountGrantTargetA");
    const firstN = findCategory(data, "Subcategory Controls").subcategories.find(subcat => subcat.name === "First N Discounts");
    const inheritedCosts = findCategory(data, "Subcategory Controls").subcategories.find(subcat => subcat.name === "Inherited Payment Options");
    const tieredRepeatCost = choices.options.find(option => option.id === "tieredRepeatCost");
    const allocatedTeamGrant = choices.options.find(option => option.id === "allocatedTeamGrant");

    assert.deepStrictEqual(choices.costOptions[0].cost, { "Hero Points": 1 });
    assert.deepStrictEqual(alternateCost.costOptions[0].cost, { "Hero Points": 4 });
    assert.deepStrictEqual(tieredRepeatCost.costOptions[0].costBySelection[1], { "Hero Points": 2 });
    assert.deepStrictEqual(optionOverride.modifiedCosts[0].cost, { "Hero Points": 7 });
    assert.deepStrictEqual(optionOverride.modifiedCosts[1].costPercent, { "Hero Points": -25 });
    assert.deepStrictEqual(grantTarget.cost, { "Hero Points": 6 });
    assert.deepStrictEqual(firstN.discountAmount, { "Hero Points": 2 });
    assert.deepStrictEqual(inheritedCosts.costOptions[0].cost, { "Hero Points": 3 });

    renamePointTypeReferences(data, "Skills", "Talents");
    assert.deepStrictEqual(allocatedTeamGrant.pointAllocation.types, ["Talents", "Equipment"]);
});

test("point type edits should refresh category cost controls", () => {
    const editorSource = fs.readFileSync(path.join(ROOT, "editor.js"), "utf8");
    [
        "renderGlobalSettings();\n                renderCategories();\n                schedulePreviewUpdate();",
        "renderGlobalSettings();\n            renderCategories();\n            schedulePreviewUpdate();"
    ].forEach(snippet => {
        assert(
            editorSource.includes(snippet),
            "editor should re-render category controls after point types are added, renamed, or removed"
        );
    });
    assert(
        editorSource.includes("renameMapKeyPreservingOrder") &&
            editorSource.includes("next[key === oldKey ? newKey : key] = value") &&
            editorSource.includes("container.__pointMapOrder") &&
            editorSource.includes("orderPointMapByEditorRows") &&
            editorSource.includes("currentPointType = newName") &&
            !editorSource.includes("delete valueMap[pointType];\n                valueMap[newName]"),
        "editor should preserve payment point row order when a selected point type is changed without re-rendering the row"
    );
});

test("point tracker categories should be editable and player-toggleable", () => {
    assert(
        EDITOR_SCRIPT_SOURCE.includes("pointCategories") &&
            EDITOR_SCRIPT_SOURCE.includes("Add point category") &&
            EDITOR_SCRIPT_SOURCE.includes("Uncategorized"),
        "editor should expose point category metadata and assignment controls"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("normalizePointCategories") &&
            PLAYER_SCRIPT_SOURCE.includes("point-category-toggles") &&
            PLAYER_SCRIPT_SOURCE.includes("visiblePointCategories") &&
            PLAYER_SCRIPT_SOURCE.includes('button.setAttribute("aria-pressed"') &&
            PLAYER_SCRIPT_SOURCE.includes("No point categories selected"),
        "player should render point category filter buttons backed by category visibility state"
    );

    const data = [
        { type: "title", text: "Point Categories" },
        {
            type: "points",
            values: { Points: 10, Tokens: 0, Skills: 0, Equipment: 0 }
        }
    ];
    const pointsEntry = data.find(entry => entry.type === "points");
    pointsEntry.pointCategories = {
        Core: ["Points", "Tokens"],
        Build: ["Skills", "Equipment"]
    };
    assert.deepStrictEqual(validateCyoaData("point-categories-valid.json", data).errors, []);

    pointsEntry.pointCategories = {
        Core: ["Points"],
        Duplicate: ["Points"]
    };
    assert(
        validateCyoaData("point-categories-duplicate.json", data).errors.some(error =>
            error.includes('assigns point type "Points" to more than one category')
        ),
        "validation should reject assigning one point type to multiple point categories"
    );

    pointsEntry.pointCategories = {
        Core: ["Unknown"]
    };
    assert(
        validateCyoaData("point-categories-unknown.json", data).errors.some(error =>
            error.includes('references unknown point type "Unknown"')
        ),
        "validation should reject point categories that reference missing point types"
    );
});

test("subcategory inherited cost options should price empty-cost options and repeated picks can count once", () => {
    const engine = CyoaEngine.synthetic();
    assert.deepStrictEqual(engine.effectiveCost("freeDefault"), { Points: 1 });
    assert.deepStrictEqual(engine.effectiveCost("spendTwo"), { Points: 2 });
    assert.deepStrictEqual(engine.effectiveCost("inheritedDefaultOption", { costOptionIndex: 0 }), { Points: 1 });
    assert.deepStrictEqual(engine.effectiveCostChoices("inheritedDefaultOption")[0].cost, { Points: 1 });
    engine.select("inheritedDefaultOption");
    assert.strictEqual(engine.points.Points, 9);
    engine.remove("inheritedDefaultOption");
    assert.strictEqual(engine.points.Points, 10);
    engine.select("multi");
    engine.select("multi");
    assert.strictEqual(engine.selectedOptions.multi, 2);
    assert.strictEqual(engine.subcategorySelectionCount(engine.findSubcategoryOfOption("multi")), 1);
});

test("subcategory cost options should be inherited unless an option defines its own choices", () => {
    const engine = CyoaEngine.synthetic();
    const inheritedCosts = findCategory(engine.data, "Subcategory Controls").subcategories.find(subcat => subcat.name === "Inherited Payment Options");
    assert.deepStrictEqual(engine.effectiveCostChoices("inheritedCostOptions"), [
        { index: 0, cost: { Points: 3 } },
        { index: 1, cost: { Tokens: 2 } }
    ]);
    assertDeepEqual(engine.effectiveCost("inheritedCostOptions", { costOptionIndex: 1 }), { Tokens: 2 });
    assert.deepStrictEqual(engine.effectiveCostChoices("overrideCostOptions"), [
        { index: 0, cost: { Points: 5 } }
    ]);
    const directMergedCost = { id: "directMergedCost", label: "Direct Merged Cost", cost: { Points: 2 } };
    inheritedCosts.options.push(directMergedCost);
    inheritedCosts.mergeDefaultCostOptions = true;
    assertDeepEqual(engine.effectiveCost(directMergedCost), { Points: 5, Tokens: 2 });
    assert.deepStrictEqual(engine.effectiveCostChoices("overrideCostOptions"), [
        { index: 0, cost: { Points: 8, Tokens: 2 } }
    ]);
    assertDeepEqual(engine.effectiveCost("overrideCostOptions", { costOptionIndex: 0 }), { Points: 8, Tokens: 2 });
    const overrideOption = engine.option("overrideCostOptions");
    overrideOption.costOptions.push({ label: "Override Tokens", cost: { Tokens: 1 } });
    assert.deepStrictEqual(engine.effectiveCostChoices("overrideCostOptions"), [
        { index: 0, cost: { Points: 8, Tokens: 2 } },
        { index: 1, cost: { Points: 3, Tokens: 3 } }
    ]);
    assert(
        EDITOR_SCRIPT_SOURCE.includes("mergeDefaultCostOptions") &&
            EDITOR_SCRIPT_SOURCE.includes("Add these default costs into each option-specific payment choice"),
        "visual editor should expose a subcategory toggle for adding defaults into option-specific payment choices"
    );

    engine.points.Tokens = 2;
    engine.select("inheritedCostOptions", { costOptionIndex: 1 });
    assert.strictEqual(engine.points.Tokens, 0);
});

test("point allocations should split a fixed grant across configured point types", () => {
    const engine = CyoaEngine.synthetic();
    assert.deepStrictEqual(engine.getPointAllocationValues("allocatedTeamGrant"), { Skills: 6, Equipment: 0 });
    assert.deepStrictEqual(engine.effectiveCost("allocatedTeamGrant"), { Points: 1, Skills: -6 });

    engine.setPointAllocation("allocatedTeamGrant", { Skills: 2, Equipment: 4 });
    assert.deepStrictEqual(engine.getPointAllocationValues("allocatedTeamGrant"), { Skills: 2, Equipment: 4 });
    assert.deepStrictEqual(engine.effectiveCost("allocatedTeamGrant"), { Points: 1, Skills: -2, Equipment: -4 });

    engine.select("allocatedTeamGrant");
    assert.strictEqual(engine.points.Points, 9);
    assert.strictEqual(engine.points.Skills, 2);
    assert.strictEqual(engine.points.Equipment, 4);
    assert.deepStrictEqual(engine.discountedSelections.allocatedTeamGrant, [{ Points: 1, Skills: -2, Equipment: -4 }]);

    engine.remove("allocatedTeamGrant");
    assert.strictEqual(engine.points.Points, 10);
    assert.strictEqual(engine.points.Skills, 0);
    assert.strictEqual(engine.points.Equipment, 0);
    assert.strictEqual(engine.pointAllocationSelections.allocatedTeamGrant, undefined);
});

test("point allocation controls should render as sliders instead of number boxes", () => {
    const source = extractFunctionSource(PLAYER_SCRIPT_SOURCE, "renderPointAllocationControl");
    assert(source.includes('slider.type = "range"'), "point allocation controls should use range sliders");
    assert(source.includes("point-allocation-slider"), "point allocation sliders should have a stable CSS class");
    assert(source.includes("updateDisplayedAllocation()"), "point allocation sliders should update displayed values in place while dragging");
    assert(!source.includes("renderAccordion();"), "point allocation sliders should not re-render the accordion on each input event");
    assert(!source.includes('input.type = "number"'), "point allocation controls should not render number input boxes");
});

test("Overlord attributes should spend Attribute Points through sliders", () => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "CYOAs", "overlord_cyoa.json"), "utf8"));
    const pointsEntry = data.find(entry => entry.type === "points");
    const intro = data.find(entry => entry.name === "Intro");
    const attributes = intro.subcategories.find(subcat => subcat.name === "Attributes");
    const expectedAttributes = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];

    expectedAttributes.forEach(attribute => {
        assert.deepStrictEqual(pointsEntry.attributeRanges[attribute], { min: 0, max: 40 });
        assert.strictEqual(pointsEntry.values[attribute], 0);

        const option = attributes.options.find(entry => entry.label === attribute);
        assert(option, `Overlord should define ${attribute} attribute option`);
        assert.strictEqual(option.inputType, "slider", `${attribute} should use a slider`);
        assert.strictEqual(option.min, 0, `${attribute} slider should start at 0`);
        assert.strictEqual(option.max, 40, `${attribute} slider should cap at 40`);
        assert.deepStrictEqual(option.costPerPoint, {
            "Attribute Points": 1,
            [attribute]: -1
        });
    });
});

test("Overlord humanoid race costs should include merged RP default", () => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "CYOAs", "overlord_cyoa.json"), "utf8"));
    const engine = new CyoaEngine(data, "overlord_cyoa.json");
    const race = engine.data.find(entry => entry.name === "Race");
    const humanoid = race.subcategories.find(subcat => subcat.name === "Humanoid");

    assert.strictEqual(humanoid.mergeDefaultCostOptions, true);
    assert.deepStrictEqual(engine.effectiveCostChoices("raceHumanoidDeepDwarf"), [
        {
            index: 0,
            cost: {
                RP: 1,
                "Martial Level": -5,
                Vitality: -1,
                Heat: -50,
                Cold: 25,
                Dark: 25
            }
        }
    ]);
});

test("Overlord Giantkin should double live Strength slider value", () => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "CYOAs", "overlord_cyoa.json"), "utf8"));
    const engine = new CyoaEngine(data, "overlord_cyoa.json");
    const giantkin = engine.option("raceDemiHumanoidsGiantkin");

    assert.deepStrictEqual(giantkin.sliderModifiers, [
        { type: "multiply", selectable: false, attribute: "Strength", multiplier: 2 }
    ]);
    assert(
        EDITOR_SCRIPT_SOURCE.includes("renderSliderModifiersEditor") &&
            EDITOR_SCRIPT_SOURCE.includes("Add slider modifier") &&
            EDITOR_SCRIPT_SOURCE.includes("Set max") &&
            EDITOR_SCRIPT_SOURCE.includes("Player chooses"),
        "visual editor should expose generalized slider modifier controls"
    );

    engine.setAttributeSlider("Strength", 10);
    assert.strictEqual(engine.points.Strength, 10);
    engine.select("raceDemiHumanoidsGiantkin");
    assert.strictEqual(engine.points.Strength, 20);
    engine.setAttributeSlider("Strength", 15);
    assert.strictEqual(engine.points.Strength, 30);
    engine.remove("raceDemiHumanoidsGiantkin", { skipCostModifierAffectedRemoval: true });
    assert.strictEqual(engine.points.Strength, 15);
});

test("slider modifiers should cap with refund and add fixed values", () => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "CYOAs", "overlord_cyoa.json"), "utf8"));
    const engine = new CyoaEngine(data, "overlord_cyoa.json");
    const modifierOption = {
        id: "testSliderModifierOption",
        label: "Test Slider Modifier Option",
        sliderModifiers: [
            { type: "cap", attribute: "Strength", value: 8 },
            { type: "add", attribute: "Dexterity", value: 8 },
            { type: "subtract", attribute: "Charisma", value: 3 },
            { type: "cap", selectable: true, value: 8 },
            { type: "add", selectable: true, value: 8, choices: ["Wisdom", "Charisma"] },
            { type: "add", attribute: "RP", value: 5 },
            { type: "subtract", attribute: "Heat", value: 10 }
        ]
    };
    const race = data.find(entry => entry.name === "Race");
    race.subcategories[0].options.push(modifierOption);
    engine.optionMap.set(modifierOption.id, modifierOption);
    const baseRP = engine.points.RP;
    const baseHeat = engine.points.Heat;

    engine.points["Attribute Points"] = 8;
    engine.setAttributeSlider("Strength", 12);
    engine.setAttributeSlider("Dexterity", 4);
    engine.setAttributeSlider("Charisma", 7);
    engine.sliderModifierSelections[modifierOption.id] = [, , , "Constitution", "Wisdom"];
    engine.setAttributeSlider("Constitution", 10);
    engine.setAttributeSlider("Wisdom", 3);
    engine.select(modifierOption.id);

    assert.strictEqual(engine.attributeSliderValues.Strength, 8, "fixed cap should clamp Strength slider");
    assert.strictEqual(engine.points.Strength, 8, "fixed cap should display capped Strength");
    assert.strictEqual(engine.points["Attribute Points"], 14, "caps should refund paid points above each cap");
    assert.strictEqual(engine.points.Dexterity, 12, "fixed add should increase displayed Dexterity");
    assert.strictEqual(engine.points.Charisma, 4, "fixed subtract should reduce displayed Charisma");
    assert.strictEqual(engine.attributeSliderValues.Constitution, 8, "selectable cap should clamp chosen Constitution slider");
    assert.strictEqual(engine.points.Wisdom, 11, "selectable add should increase chosen Wisdom");
    assert.strictEqual(engine.points.RP, baseRP + 5, "fixed add should increase ordinary point types");
    assert.strictEqual(engine.points.Heat, baseHeat - 10, "fixed subtract should reduce ordinary point types");
    engine.remove(modifierOption.id, { skipCostModifierAffectedRemoval: true });
    assert.strictEqual(engine.points.Dexterity, 4, "removing fixed add should restore modified point values");
    assert.strictEqual(engine.points.Charisma, 7, "removing fixed subtract should restore modified point values");
    assert.strictEqual(engine.points.Wisdom, 3, "removing selectable add should restore selected point type");
    assert.strictEqual(engine.points.RP, baseRP, "removing fixed add should restore ordinary point types");
    assert.strictEqual(engine.points.Heat, baseHeat, "removing fixed subtract should restore ordinary point types");
    assert.deepStrictEqual(modifierOption.sliderModifiers[4].choices, ["Wisdom", "Charisma"]);
    assert.deepStrictEqual(
        engine.normalizeSliderModifiers({ sliderModifiers: [{ type: "add", selectable: true, value: 1 }] })[0].choices,
        Object.keys(engine.pointsEntry.values),
        "unrestricted player-choice slider modifiers should default to all configured point types"
    );
    assert(
        EDITOR_SCRIPT_SOURCE.includes("Subtract") &&
            EDITOR_SCRIPT_SOURCE.includes("effect.choices") &&
            EDITOR_SCRIPT_SOURCE.includes("return getPointTypeNames();") &&
            PLAYER_SCRIPT_SOURCE.includes("return Object.keys(originalPoints || {});") &&
            PLAYER_SCRIPT_SOURCE.includes('effect.type === "subtract"') &&
            PLAYER_SCRIPT_SOURCE.includes("getSliderModifierDisplayRows") &&
            PLAYER_SCRIPT_SOURCE.includes("Slider Modifiers") &&
            PLAYER_SCRIPT_SOURCE.includes("option-meta-slider-modifiers"),
        "visual editor and player should support subtract modifiers, point-type-based player-choice lists, and card display rows"
    );
});

test("visual editor should expose add and remove controls for point allocation", () => {
    assert(
        EDITOR_SCRIPT_SOURCE.includes("function renderPointAllocationEditor"),
        "visual editor should define a point allocation editor"
    );
    assert(
        EDITOR_SCRIPT_SOURCE.includes("Add point allocation"),
        "visual editor should allow adding point allocation to an option"
    );
    assert(
        EDITOR_SCRIPT_SOURCE.includes("Remove point allocation"),
        "visual editor should allow removing point allocation from an option"
    );
    assert(
        EDITOR_SCRIPT_SOURCE.includes("Total picks to allocate"),
        "visual editor should expose the allocation total"
    );
    assert(
        EDITOR_SCRIPT_SOURCE.includes("Add allocation point type"),
        "visual editor should allow editing allocation point types"
    );
});

test("visual editor should expose repeat payment option availability limits", () => {
    assert(
        EDITOR_SCRIPT_SOURCE.includes("Selection availability"),
        "visual editor should expose payment option availability controls"
    );
    assert(
        EDITOR_SCRIPT_SOURCE.includes("minSelectedInput"),
        "visual editor should allow payment options to require existing selections"
    );
    assert(
        EDITOR_SCRIPT_SOURCE.includes("maxSelectionsInput"),
        "visual editor should allow payment options to cap uses"
    );
    assert(
        EDITOR_SCRIPT_SOURCE.includes("requiresCostOptionInput"),
        "visual editor should allow payment options to require another payment option first"
    );
});

test("visual editor should expose subcategory reorder controls in section headers", () => {
    assert(
        EDITOR_SCRIPT_SOURCE.includes('subUpBtn.title = "Move section up"') &&
        EDITOR_SCRIPT_SOURCE.includes('subDownBtn.title = "Move section down"'),
        "visual editor should expose up/down controls for subcategories"
    );
    assert(
        EDITOR_SCRIPT_SOURCE.includes("moveArrayItem(parentArray, subIndex, -1)") &&
        EDITOR_SCRIPT_SOURCE.includes("moveArrayItem(parentArray, subIndex, 1)"),
        "subcategory reorder controls should move the current subcategory within its parent array"
    );
    assert(
        EDITOR_SCRIPT_SOURCE.includes("subSummary.appendChild(subActions)") &&
        EDITOR_SCRIPT_SOURCE.includes("preventSummaryToggle(subActions)"),
        "subcategory reorder controls should live in the collapsed section header without toggling it"
    );
});

test("option border colors should be supported through visual editor style fields", () => {
    const engine = CyoaEngine.synthetic();
    const option = engine.option("customFields");
    assert.strictEqual(option.borderColor, "#8886D1");
    assert.strictEqual(option.darkBorderColor, "#C0C0C0");
    assert(
        PLAYER_SCRIPT_SOURCE.includes("opt.darkBorderColor || opt.borderColor")
            && PLAYER_SCRIPT_SOURCE.includes("wrapper.style.borderColor = optionBorderColor"),
        "player should apply safe option-level border colors"
    );
    assert(
        EDITOR_SCRIPT_SOURCE.includes("Option border")
            && EDITOR_SCRIPT_SOURCE.includes("borderColor")
            && EDITOR_SCRIPT_SOURCE.includes("darkBorderColor")
            && EDITOR_SCRIPT_SOURCE.includes("Light border color")
            && EDITOR_SCRIPT_SOURCE.includes("Dark border color"),
        "visual editor should expose first-class option border color fields"
    );
});

test("option content alignment should support global defaults and option overrides", () => {
    const engine = CyoaEngine.synthetic();
    const settings = engine.data.find(entry => entry.type === "settings");
    const option = engine.option("customFields");

    assert.strictEqual(settings.optionTitleAlignment, "right");
    assert.strictEqual(settings.optionMetaAlignment, "left");
    assert.strictEqual(settings.optionDescriptionAlignment, "justify");
    assert.strictEqual(option.titleAlignment, "left");
    assert.strictEqual(option.metaAlignment, "right");
    assert.strictEqual(option.descriptionAlignment, "center");
    assert(
        PLAYER_SCRIPT_SOURCE.includes('let optionTitleAlignment = "center"') &&
            PLAYER_SCRIPT_SOURCE.includes('let optionMetaAlignment = "center"') &&
            PLAYER_SCRIPT_SOURCE.includes('let optionDescriptionAlignment = "center"') &&
            PLAYER_SCRIPT_SOURCE.includes("getOptionComponentAlignment(opt, \"titleAlignment\", optionTitleAlignment, optionTitleAlignmentExplicit)") &&
            PLAYER_SCRIPT_SOURCE.includes("getOptionComponentAlignment(opt, \"metaAlignment\", optionMetaAlignment, optionMetaAlignmentExplicit)") &&
            PLAYER_SCRIPT_SOURCE.includes("getOptionComponentAlignment(opt, \"descriptionAlignment\", optionDescriptionAlignment, optionDescriptionAlignmentExplicit)") &&
            PLAYER_SCRIPT_SOURCE.includes("isOptionAlignmentValue(settingsEntry.optionTitleAlignment)") &&
            PLAYER_SCRIPT_SOURCE.includes("if (!globalExplicit && isOptionAlignmentValue(option?.alignment))") &&
            PLAYER_SCRIPT_SOURCE.includes("settingsEntry.optionTitleAlignment") &&
            PLAYER_SCRIPT_SOURCE.includes("settingsEntry.optionMetaAlignment") &&
            PLAYER_SCRIPT_SOURCE.includes("settingsEntry.optionDescriptionAlignment") &&
            STYLE_SOURCE.includes("text-align: inherit;"),
        "player should resolve separate option title, details, and description alignments"
    );
    assert(
        EDITOR_SCRIPT_SOURCE.includes("Option title") &&
            EDITOR_SCRIPT_SOURCE.includes("Costs and prerequisites") &&
            EDITOR_SCRIPT_SOURCE.includes("Option description") &&
            EDITOR_SCRIPT_SOURCE.includes("Text alignment") &&
            EDITOR_SCRIPT_SOURCE.includes("renderAlignmentSelect(option[key], \"Use CYOA default\"") &&
            EDITOR_SCRIPT_SOURCE.includes("Use CYOA default") &&
            EDITOR_SCRIPT_SOURCE.includes("Justify"),
        "visual editor should expose global and per-option component alignment controls"
    );
});

test("selected option text inputs should survive export and import", () => {
    const engine = CyoaEngine.synthetic();
    engine.select("freeText");
    engine.setTextInput("freeText", "Anywhere, any time");
    assert.strictEqual(engine.storyInputs.freeText, "Anywhere, any time");
    assert.strictEqual(engine.selectedOptions.freeText, 1);
    assert.strictEqual(engine.points.Points, 9);

    const packed = engine.buildPackedExportState();
    const unpacked = unpackImportedState(JSON.parse(JSON.stringify(packed)));
    assert.strictEqual(unpacked.storyInputs.freeText, "Anywhere, any time");
});

test("subcategory text inputs should import sanitized values without requiring option selection", () => {
    const importEngine = CyoaEngine.synthetic();
    importEngine.importState({
        selectedOptions: {},
        points: { Points: 10 },
        storyInputs: {
            subcatNote: "abcdef",
            unknownSubcatNote: "ignored"
        }
    });

    assert.strictEqual(importEngine.storyInputs.subcatNote, "abcde");
    assert.strictEqual(importEngine.storyInputs.unknownSubcatNote, undefined);
});

test("option text inputs should require selection and ignore invalid imports", () => {
    const engine = CyoaEngine.synthetic();
    assert.throws(() => engine.setTextInput("freeText", "<img src=x onerror=alert(1)>"));

    engine.select("freeText");
    engine.setTextInput("freeText", "<img src=x onerror=alert(1)>");
    assert.strictEqual(engine.storyInputs.freeText, "<img src=x onerror=alert(1)>");

    engine.remove("freeText");
    assert.strictEqual(engine.storyInputs.freeText, undefined);

    const importEngine = CyoaEngine.synthetic();
    importEngine.importState({
        v: 1,
        s: { freeText: 1 },
        p: { Points: 10, Tokens: 0 },
        t: {
            freeText: "<svg onload=alert(1)>",
            unknownInput: "should be ignored",
            freeDefault: "not an input",
            objectPayload: { nope: true }
        }
    });
    assert.strictEqual(importEngine.storyInputs.freeText, "<svg onload=alert(1)>");
    assert.strictEqual(importEngine.storyInputs.unknownInput, undefined);
    assert.strictEqual(importEngine.storyInputs.freeDefault, undefined);
    assert.strictEqual(importEngine.storyInputs.objectPayload, undefined);

    const clampEngine = CyoaEngine.synthetic();
    clampEngine.importState({
        v: 1,
        s: { freeText: 1 },
        p: { Points: 10, Tokens: 0 },
        t: { freeText: "x".repeat(500) }
    });
    assert.strictEqual(clampEngine.storyInputs.freeText.length, 200);

    const unselectedEngine = CyoaEngine.synthetic();
    unselectedEngine.importState({
        v: 1,
        s: {},
        p: { Points: 10, Tokens: 0 },
        t: { freeText: "should be dropped" }
    });
    assert.strictEqual(unselectedEngine.storyInputs.freeText, undefined);
});

test("bypass options should not consume subcategory selection slots", () => {
    const engine = CyoaEngine.synthetic();
    engine.select("spendTwo");
    engine.select("freeDefault");
    assert.strictEqual(engine.canSelect("discountTrigger"), true);

    engine.select("limitBypass");
    assert.strictEqual(engine.selectedOptions.spendTwo, 1);
    assert.strictEqual(engine.selectedOptions.freeDefault, 1);
    assert.strictEqual(engine.selectedOptions.limitBypass, 1);
    assert.strictEqual(engine.subcategorySelectionCount(engine.findSubcategoryOfOption("limitBypass")), 2);
    assert.strictEqual(engine.canSelect("discountTrigger"), true);
});

test("dependent options should stay locked until prerequisites are selected", () => {
    const engine = CyoaEngine.synthetic();
    assert.strictEqual(engine.canSelect("adultBenefitsHigherPaying"), false);
    engine.select("powersDifficultySpectacularmanMode");
    engine.select("youAgeYoungAdult");
    engine.select("powersSuperpowersSmart");
    assert.strictEqual(engine.canSelect("adultBenefitsHigherPaying"), true);
});

test("all prerequisite syntaxes should resolve selection eligibility correctly", () => {
    const engine = CyoaEngine.synthetic();
    assert.strictEqual(engine.canSelect("requiresString"), false);
    assert.strictEqual(engine.canSelect("requiresArray"), false);
    assert.strictEqual(engine.canSelect("requiresObject"), false);
    assert.strictEqual(engine.canSelect("requiresCount"), false);

    engine.select("preA");
    assert.strictEqual(engine.canSelect("requiresString"), true);
    assert.strictEqual(engine.canSelect("requiresArray"), true);
    assert.strictEqual(engine.canSelect("requiresObject"), false);

    engine.select("multi");
    engine.select("multi");
    assert.strictEqual(engine.canSelect("requiresCount"), true);
    assert.strictEqual(engine.canSelect("requiresObject"), true);

    engine.select("preB");
    assert.strictEqual(engine.canSelect("requiresString"), false);
});

test("complex prerequisite displays should mark fulfilled OR branches as satisfied", () => {
    const engine = CyoaEngine.synthetic();
    const exoExpression = engine.option("gearGearExoSuit2").prerequisites;

    assert.deepStrictEqual(engine.displayRequirementLines("gearGearExoSuit2"), [
        "❌ Exo Suit 1",
        "❌ Alien Tech OR ❌ They Came from Beyond!"
    ]);

    assert.deepStrictEqual(engine.prerequisiteDisplayStatuses(exoExpression), [
        { id: "gearGearExoSuit1", negated: false, satisfied: false },
        { id: "powersScienceAlienTech", negated: false, satisfied: false },
        { id: "questsQuestsTheyCameFromBeyond", negated: false, satisfied: false }
    ]);

    engine.select("questsQuestsTheyCameFromBeyond");
    assert.deepStrictEqual(engine.displayRequirementLines("gearGearExoSuit2"), [
        "❌ Exo Suit 1",
        "✅ Alien Tech OR ✅ They Came from Beyond!"
    ]);
    assert.deepStrictEqual(engine.prerequisiteDisplayStatuses(exoExpression), [
        { id: "gearGearExoSuit1", negated: false, satisfied: false },
        { id: "powersScienceAlienTech", negated: false, satisfied: true },
        { id: "questsQuestsTheyCameFromBeyond", negated: false, satisfied: true }
    ]);
    assert.strictEqual(engine.canSelect("gearGearExoSuit2"), false);

    engine.select("gearGearExoSuit1");
    assert.strictEqual(engine.canSelect("gearGearExoSuit2"), true);

    const complexExpression = engine.option("requiresComplexOrGroups").prerequisites;
    assert.deepStrictEqual(engine.displayRequirementLines("requiresComplexOrGroups"), [
        "❌ Pre A OR ❌ Pre B",
        "❌ Multi (x2) OR ❌ One-Way A",
        "✅ NOT Dumb"
    ]);
    assert.deepStrictEqual(engine.prerequisiteDisplayStatuses(complexExpression), [
        { id: "preA", negated: false, satisfied: false },
        { id: "preB", negated: false, satisfied: false },
        { id: "multi__2", negated: false, satisfied: false },
        { id: "oneWayA", negated: false, satisfied: false },
        { id: "drawbacksDrawbacksDumb", negated: true, satisfied: true }
    ]);

    engine.select("preB");
    engine.select("multi");
    engine.select("multi");
    assert.deepStrictEqual(engine.prerequisiteDisplayStatuses(complexExpression), [
        { id: "preA", negated: false, satisfied: true },
        { id: "preB", negated: false, satisfied: true },
        { id: "multi__2", negated: false, satisfied: true },
        { id: "oneWayA", negated: false, satisfied: true },
        { id: "drawbacksDrawbacksDumb", negated: true, satisfied: true }
    ]);
    assert.strictEqual(engine.canSelect("requiresComplexOrGroups"), true);

    assert.deepStrictEqual(engine.displayRequirementLines("requiresObject"), [
        "❌ Pre A",
        "✅ Pre B OR ✅ Multi (x2)"
    ]);

    engine.option("powersSuperpowersSmart").conflictsWith = [];
    engine.select("drawbacksDrawbacksDumb");
    assert.strictEqual(engine.canSelect("requiresComplexOrGroups"), false);
    assert.deepStrictEqual(engine.prerequisiteDisplayStatuses(complexExpression).at(-1), {
        id: "drawbacksDrawbacksDumb",
        negated: true,
        satisfied: false
    });
    assert(
        PLAYER_SCRIPT_SOURCE.includes("buildPrerequisiteDisplayLines(requirement)"),
        "player prerequisite display should use expression-aware OR group rendering"
    );
});

test("CYOA validation should accept synthetic count-suffix prerequisites after option merges", () => {
    const data = [
        { type: "title", text: "Synthetic Validation CYOA" },
        { type: "points", values: { Points: 5 } },
        {
            name: "Synthetic",
            subcategories: [
                {
                    name: "Options",
                    options: [
                        {
                            id: "rankedPower",
                            label: "Ranked Power",
                            maxSelections: 2,
                            costOptions: [{ cost: { Points: 1 }, costBySelection: [{ Points: 1 }, { Points: 2 }] }]
                        },
                        { id: "questAlternative", label: "Quest Alternative", cost: {} },
                        {
                            id: "dependentGear",
                            label: "Dependent Gear",
                            cost: {},
                            prerequisites: "rankedPower && (rankedPower__2 || questAlternative)"
                        }
                    ]
                }
            ]
        }
    ];

    assert.deepStrictEqual(validateCyoaData("synthetic-validation.json", data).errors, []);
    data[2].subcategories[0].options[2].prerequisites = "oldRankedPower1 && (rankedPower__2 || questAlternative)";
    assert(
        validateCyoaData("synthetic-validation.json", data).errors.some(error =>
            error.includes('references unknown option ID "oldRankedPower1"')
        ),
        "synthetic validation should catch stale prerequisite IDs without depending on existing CYOAs"
    );
});

test("CYOA validation should reject unsafe option border colors", () => {
    const data = CyoaEngine.synthetic().data;
    let customOption = null;
    walkSubcategories(data.find(entry => entry.name === "Core").subcategories, subcat => {
        customOption = customOption || (subcat.options || []).find(option => option.id === "customFields");
    });
    customOption.borderColor = "url(javascript:alert(1))";
    assert(
        validateCyoaData("synthetic-border-validation.json", data).errors.some(error =>
            error.includes(".borderColor must be a safe CSS color string")
        ),
        "synthetic validation should reject unsafe option border colors"
    );
});

test("CYOA validation should reject unsupported option alignment values", () => {
    const data = CyoaEngine.synthetic().data;
    const settings = data.find(entry => entry.type === "settings");
    let customOption = null;
    walkSubcategories(data.find(entry => entry.name === "Core").subcategories, subcat => {
        customOption = customOption || (subcat.options || []).find(option => option.id === "customFields");
    });
    settings.optionAlignment = "diagonal";
    settings.optionMetaAlignment = "sideways";
    customOption.alignment = "middle";
    customOption.descriptionAlignment = "bottom";
    const errors = validateCyoaData("synthetic-alignment-validation.json", data).errors;
    assert(
        errors.some(error => error.includes('settings.optionAlignment must be "left", "center", "right", or "justify"')) &&
            errors.some(error => error.includes('settings.optionMetaAlignment must be "left", "center", "right", or "justify"')) &&
            errors.some(error => error.includes('.alignment must be "left", "center", "right", or "justify"')) &&
            errors.some(error => error.includes('.descriptionAlignment must be "left", "center", "right", or "justify"')),
        "synthetic validation should reject unsupported global and option component alignment values"
    );
});

test("CYOA validation should accept slider modifiers targeting configured point types", () => {
    const data = CyoaEngine.synthetic().data;
    let customOption = null;
    walkSubcategories(data.find(entry => entry.name === "Core").subcategories, subcat => {
        customOption = customOption || (subcat.options || []).find(option => option.id === "customFields");
    });
    customOption.sliderModifiers = [
        { type: "add", attribute: "Points", value: 1 },
        { type: "add", selectable: true, choices: ["Tokens"], value: 1 }
    ];
    const errors = validateCyoaData("synthetic-slider-modifier-validation.json", data).errors;
    assert.strictEqual(
        errors.filter(error => error.includes("sliderModifiers")).length,
        0,
        "synthetic validation should allow slider modifiers to target any configured point type"
    );
});

test("category requirements should gate options and category limits should cap selections", () => {
    const engine = CyoaEngine.synthetic();
    assert.strictEqual(engine.canSelect("categoryLimitA"), false);

    engine.select("preA");
    assert.strictEqual(engine.canSelect("categoryLimitA"), true);
    engine.select("categoryLimitA");
    assert.strictEqual(engine.selectedOptions.categoryLimitA, 1);
    assert.strictEqual(engine.canSelect("categoryLimitB"), false);
});

test("subcategory requirements should gate direct and nested options", () => {
    const engine = CyoaEngine.synthetic();
    assert.strictEqual(engine.canSelect("subcategoryRequiresOption"), false);
    assert.strictEqual(engine.canSelect("nestedSubcategoryOption"), false);

    engine.select("preA");
    assert.strictEqual(engine.canSelect("subcategoryRequiresOption"), true);
    assert.strictEqual(engine.canSelect("nestedSubcategoryOption"), true);
});

test("display mode and theme color metadata should remain available to player and editor", () => {
    const engine = CyoaEngine.synthetic();
    const category = engine.categories.find(entry => entry.name === "Category Controls");
    const subcategory = engine.categories
        .find(entry => entry.name === "Subcategory Controls")
        .subcategories.find(entry => entry.name === "Subcategory Gate");
    const nested = subcategory.subcategories.find(entry => entry.name === "Nested Gate");

    assert.strictEqual(category.subcategoryDisplayMode, "all");
    assert.strictEqual(subcategory.subcategoryDisplayMode, "all");
    assert.strictEqual(nested.subcategoryDisplayMode, "all");
    assert.strictEqual(subcategory.backgroundColor, "#7f1d1d");
    assert.strictEqual(subcategory.textColor, "#ffffff");
    assert.strictEqual(subcategory.accentColor, "#dc2626");
    assert.strictEqual(subcategory.darkBackgroundColor, "#450a0a");
    assert.strictEqual(subcategory.darkTextColor, "#fee2e2");
    assert.strictEqual(subcategory.darkAccentColor, "#1f0707");
    assert(
        PLAYER_SCRIPT_SOURCE.includes("subcat.darkBackgroundColor"),
        "player should support dark-mode subcategory background colors"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("subcat.darkTextColor"),
        "player should support dark-mode subcategory text colors"
    );
    assert(
        PLAYER_SCRIPT_SOURCE.includes("subcat.darkAccentColor"),
        "player should support dark-mode subcategory accent colors"
    );

    const editorSource = fs.readFileSync(path.join(ROOT, "editor.js"), "utf8");
    ["darkBackgroundColor", "darkTextColor", "darkAccentColor"].forEach(key => {
        assert(editorSource.includes(`"${key}"`), `visual editor should expose ${key}`);
    });
});

test("visual editor should open loaded CYOAs with all category details collapsed", () => {
    const editorSource = fs.readFileSync(path.join(ROOT, "editor.js"), "utf8");
    assert(
        editorSource.includes("categoryOpenState.has(category) ? categoryOpenState.get(category) : false"),
        "editor category cards should default closed when no stored user state exists"
    );
    assert(
        editorSource.includes("subcategoryOpenState.has(subcat) ? subcategoryOpenState.get(subcat) : false"),
        "editor subcategory cards should default closed when no stored user state exists"
    );
    assert(
        editorSource.includes("optionOpenState.has(option) ? optionOpenState.get(option) : false"),
        "editor option cards should default closed when no stored user state exists"
    );
});

test("visual editor collapse all should include global sections and option details", () => {
    const editorSource = fs.readFileSync(path.join(ROOT, "editor.js"), "utf8");
    assert(
        editorSource.includes("details.dataset.storageKey = storageKey"),
        "editor section details should expose their storage keys to collapse all"
    );
    assert(
        editorSource.includes('globalSettingsEl?.querySelectorAll("details").forEach'),
        "collapse all should include global settings sections such as Title and Description"
    );
    assert(
        editorSource.includes("sectionOpenState.set(node.dataset.storageKey, open)"),
        "collapse all should persist global section open state"
    );
    assert(
        editorSource.includes("categoryOpenState.set(category, open)"),
        "collapse all should update category open state"
    );
    assert(
        editorSource.includes("subcategoryOpenState.set(subcat, open)"),
        "collapse all should update subcategory open state"
    );
    assert(
        editorSource.includes("optionOpenState.set(option, open)"),
        "collapse all should update option open state"
    );
});

test("newly added options should become selectable and removed options should disappear", () => {
    const data = CyoaEngine.synthetic().data;
    const subcategory = findCategory(data, "Core").subcategories.find(entry => entry.name === "Choices");
    subcategory.options.push({ id: "addedOption", label: "Added Option", cost: { Points: 2 } });

    let engine = new CyoaEngine(data, "synthetic option add/remove");
    assert.strictEqual(engine.canSelect("addedOption"), true);
    engine.select("addedOption");
    assert.strictEqual(engine.points.Points, 8);

    subcategory.options.splice(subcategory.options.findIndex(option => option.id === "addedOption"), 1);
    engine = new CyoaEngine(data, "synthetic option removed");
    assert.strictEqual(engine.optionMap.has("addedOption"), false);
});

test("newly added subcategories should become selectable and removed subcategories should disappear", () => {
    const data = CyoaEngine.synthetic().data;
    const category = findCategory(data, "Core");
    category.subcategories.push({
        name: "Added Subcategory",
        options: [
            { id: "addedSubcategoryOption", label: "Added Subcategory Option", cost: { Points: 1 } }
        ]
    });

    let engine = new CyoaEngine(data, "synthetic subcategory add/remove");
    assert.strictEqual(engine.canSelect("addedSubcategoryOption"), true);
    engine.select("addedSubcategoryOption");
    assert.strictEqual(engine.points.Points, 9);

    category.subcategories.splice(category.subcategories.findIndex(subcat => subcat.name === "Added Subcategory"), 1);
    engine = new CyoaEngine(data, "synthetic subcategory removed");
    assert.strictEqual(engine.optionMap.has("addedSubcategoryOption"), false);
});

test("newly added categories should become selectable and removed categories should disappear", () => {
    const data = CyoaEngine.synthetic().data;
    data.push({
        name: "Added Category",
        subcategories: [
            {
                name: "Added Category Subcategory",
                options: [
                    { id: "addedCategoryOption", label: "Added Category Option", cost: { Points: 1 } }
                ]
            }
        ]
    });

    let engine = new CyoaEngine(data, "synthetic category add/remove");
    assert.strictEqual(engine.canSelect("addedCategoryOption"), true);
    engine.select("addedCategoryOption");
    assert.strictEqual(engine.points.Points, 9);

    data.splice(data.findIndex(entry => entry.name === "Added Category"), 1);
    engine = new CyoaEngine(data, "synthetic category removed");
    assert.strictEqual(engine.optionMap.has("addedCategoryOption"), false);
});

test("first-N subcategory discounts should discount only eligible early selections", () => {
    const engine = CyoaEngine.synthetic();
    assertDeepEqual(engine.effectiveCost("firstNDiscountA"), { Points: 3 });
    engine.select("firstNDiscountA");
    assert.strictEqual(engine.points.Points, 7);
    assertDeepEqual(engine.discountedSelections.firstNDiscountA[0], { Points: 3 });

    assertDeepEqual(engine.effectiveCost("firstNDiscountB"), { Points: 5 });
    engine.select("firstNDiscountB");
    assert.strictEqual(engine.points.Points, 2);
    assertDeepEqual(engine.discountedSelections.firstNDiscountB[0], { Points: 5 });
});

test("subcategory discount slots should honor assignments, eligibility ceilings, and opt-outs", () => {
    const engine = CyoaEngine.synthetic();
    const eligibleInfo = engine.findSubcategoryInfo("subcategorySlotEligible");
    engine.subcategoryDiscountSelections[eligibleInfo.key] = {
        subcategorySlotEligible: 1,
        subcategorySlotIneligible: 1,
        subcategorySlotOptOut: 1
    };

    assertDeepEqual(engine.effectiveCost("subcategorySlotEligible"), { Points: 0 });
    assertDeepEqual(engine.effectiveCost("subcategorySlotIneligible"), { Points: 6 });
    assertDeepEqual(engine.effectiveCost("subcategorySlotOptOut"), { Points: 4 });
    assert.strictEqual(engine.subcategoryDiscountSelections[eligibleInfo.key].subcategorySlotOptOut, undefined);

    engine.select("subcategorySlotEligible");
    assert.strictEqual(engine.points.Points, 10);
    assertDeepEqual(engine.discountedSelections.subcategorySlotEligible[0], { Points: 0 });
    assertDeepEqual(engine.effectiveCost("subcategorySlotEligible"), { Points: 4 });
});

test("category discount slots should honor assignments, eligibility ceilings, and opt-outs", () => {
    const engine = CyoaEngine.synthetic();
    const eligibleInfo = engine.findSubcategoryInfo("categorySlotEligible");
    engine.categoryDiscountSelections[eligibleInfo.catKey] = {
        categorySlotEligible: 1,
        categorySlotIneligible: 1,
        categorySlotOptOut: 1
    };

    assertDeepEqual(engine.effectiveCost("categorySlotEligible"), { Points: 0 });
    assertDeepEqual(engine.effectiveCost("categorySlotIneligible"), { Points: 6 });
    assertDeepEqual(engine.effectiveCost("categorySlotOptOut"), { Points: 4 });
    assert.strictEqual(engine.categoryDiscountSelections[eligibleInfo.catKey].categorySlotOptOut, undefined);

    engine.select("categorySlotEligible");
    assert.strictEqual(engine.points.Points, 10);
    assertDeepEqual(engine.discountedSelections.categorySlotEligible[0], { Points: 0 });
    assertDeepEqual(engine.effectiveCost("categorySlotEligible"), { Points: 4 });
});

test("subcategory column metadata should remain available", () => {
    const engine = CyoaEngine.synthetic();
    const subcategory = engine.categories
        .find(entry => entry.name === "Subcategory Controls")
        .subcategories.find(entry => entry.name === "Subcategory Gate");
    assert.strictEqual(subcategory.columnsPerRow, 3);
});

test("one-way conflicts should prevent selecting the conflicting target", () => {
    const engine = CyoaEngine.synthetic();
    engine.option("drawbacksDrawbacksDumb").conflictsWith = [];
    assert.deepStrictEqual(engine.option("powersSuperpowersSmart").conflictsWith, ["drawbacksDrawbacksDumb"]);

    engine.select("powersDifficultySpectacularmanMode");
    engine.select("powersSuperpowersSmart");

    assert.strictEqual(engine.canSelect("drawbacksDrawbacksDumb"), false);
});

test("absolute modified costs should be able to replace gains with zero cost", () => {
    const engine = CyoaEngine.synthetic();
    engine.select("emotionalSpectrumEmotionalSpectrumColorOrangeOrangeColor");
    assertDeepEqual(engine.effectiveCost("universeOptionalSharedEmotions"), { Points: 0 }, "Orange should make Shared Emotions cost 0 Points");
    engine.select("universeOptionalSharedEmotions");
    assert.strictEqual(engine.points.Points, 10);
});

test("subcategory relative cost modifiers should apply to every option in that subcategory", () => {
    const engine = CyoaEngine.synthetic();
    assertDeepEqual(engine.effectiveCost("speciesSpeciesVuldarian"), { Points: 13 });
    engine.select("universeOptionalOverpoweredSpecies");
    assertDeepEqual(engine.effectiveCost("speciesSpeciesVuldarian"), { Points: 16 });
});

test("subcategory minCost should clamp relative cost reductions", () => {
    const engine = CyoaEngine.synthetic();
    engine.select("universeOptionalGroundedSpecies");
    assertDeepEqual(engine.effectiveCost("speciesSpeciesYautja"), { Points: -1 });
});

test("percentage modifiers should round up for option and subcategory costs", () => {
    const subcategoryEngine = CyoaEngine.synthetic();
    const choices = findCategory(subcategoryEngine.data, "Core").subcategories.find(subcat => subcat.name === "Choices");
    choices.options.find(option => option.id === "discountTrigger").maxSelections = 2;
    choices.modifiedCosts.push(
        { ids: ["discountTrigger"], costPercent: { Points: -15 }, priority: 10 },
        { ids: ["discountTrigger__2"], costPercent: { Points: -30 }, priority: 11 }
    );

    assertDeepEqual(subcategoryEngine.effectiveCost("percentBase"), { Points: 7 });
    subcategoryEngine.select("discountTrigger");
    assertDeepEqual(subcategoryEngine.effectiveCost("percentBase"), { Points: 6 });
    subcategoryEngine.select("discountTrigger");
    assertDeepEqual(subcategoryEngine.effectiveCost("percentBase"), { Points: 5 });

    const optionEngine = CyoaEngine.synthetic();
    const option = optionEngine.option("percentBase");
    option.modifiedCosts = [{ ids: ["discountTrigger"], costPercent: { Points: -50 }, priority: 1 }];
    optionEngine.select("discountTrigger");
    assertDeepEqual(optionEngine.effectiveCost("percentBase"), { Points: 4 });

    const marvel = CyoaEngine.synthetic();
    marvel.points.GP = 2;
    assertDeepEqual(marvel.effectiveCost("gearGearShieldGenerator2", { costOptionIndex: 0 }), { "Dollars (millions)": 16 });
    marvel.select("powersScienceConstruction", { costOptionIndex: 0 });
    assertDeepEqual(marvel.effectiveCost("gearGearShieldGenerator2", { costOptionIndex: 0 }), { "Dollars (millions)": 14 });
    marvel.select("powersScienceConstruction", { costOptionIndex: 0 });
    assertDeepEqual(marvel.effectiveCost("gearGearShieldGenerator2", { costOptionIndex: 0 }), { "Dollars (millions)": 12 });
});

test("cost modifier changes should unselect stale priced options instead of repricing them", () => {
    const engine = CyoaEngine.synthetic();
    engine.points["Dollars (millions)"] = 50;

    engine.select("gearGearShieldGenerator2", { costOptionIndex: 0 });
    assert.strictEqual(engine.points["Dollars (millions)"], 34);

    engine.select("powersScienceConstruction");
    assert.strictEqual(engine.selectedOptions.gearGearShieldGenerator2, undefined);
    assert.strictEqual(engine.selectedOptions.powersScienceConstruction, 1);
    assert.strictEqual(engine.points["Dollars (millions)"], 50);
    assert.deepStrictEqual(engine.removedByCostModifier, ["gearGearShieldGenerator2"]);

    engine.select("gearGearShieldGenerator2", { costOptionIndex: 0 });
    assert.strictEqual(engine.points["Dollars (millions)"], 36);

    engine.select("powersScienceConstruction");
    assert.strictEqual(engine.selectedOptions.gearGearShieldGenerator2, undefined);
    assert.strictEqual(engine.selectedOptions.powersScienceConstruction, 2);
    assert.strictEqual(engine.points["Dollars (millions)"], 50);

    engine.select("gearGearShieldGenerator2", { costOptionIndex: 0 });
    assert.strictEqual(engine.points["Dollars (millions)"], 38);

    engine.remove("powersScienceConstruction");
    assert.strictEqual(engine.selectedOptions.gearGearShieldGenerator2, undefined);
    assert.strictEqual(engine.selectedOptions.powersScienceConstruction, 1);
    assert.strictEqual(engine.points["Dollars (millions)"], 50);
});

test("percentage cost modifier changes should keep current selections when rejected", () => {
    const engine = CyoaEngine.synthetic();
    engine.points["Dollars (millions)"] = 50;
    engine.costModifierChangeConfirmed = false;

    engine.select("gearGearShieldGenerator2", { costOptionIndex: 0 });
    assert.strictEqual(engine.points["Dollars (millions)"], 34);

    const accepted = engine.select("powersScienceConstruction");
    assert.strictEqual(accepted, false);
    assert.strictEqual(engine.selectedOptions.gearGearShieldGenerator2, 1);
    assert.strictEqual(engine.selectedOptions.powersScienceConstruction, undefined);
    assert.strictEqual(engine.points["Dollars (millions)"], 34);
    assert.deepStrictEqual(engine.removedByCostModifier, []);
});

test("point cost modifier changes should unselect stale priced options when accepted", () => {
    const engine = CyoaEngine.synthetic();

    engine.select("ringPowersCharacteristicPowersDeathEmpowerment");
    assert.strictEqual(engine.points.Points, 5);

    const accepted = engine.select("emotionalSpectrumEmotionalSpectrumColor696969ColorlessRingsColor");
    assert.strictEqual(accepted, true);
    assert.strictEqual(engine.selectedOptions.ringPowersCharacteristicPowersDeathEmpowerment, undefined);
    assert.strictEqual(engine.selectedOptions.emotionalSpectrumEmotionalSpectrumColor696969ColorlessRingsColor, 1);
    assert.strictEqual(engine.points.Points, 10);
    assert.deepStrictEqual(engine.removedByCostModifier, ["ringPowersCharacteristicPowersDeathEmpowerment"]);
});

test("point cost modifier changes should keep current selections when rejected", () => {
    const engine = CyoaEngine.synthetic();
    engine.costModifierChangeConfirmed = false;

    engine.select("ringPowersCharacteristicPowersDeathEmpowerment");
    assert.strictEqual(engine.points.Points, 5);

    const accepted = engine.select("emotionalSpectrumEmotionalSpectrumColor696969ColorlessRingsColor");
    assert.strictEqual(accepted, false);
    assert.strictEqual(engine.selectedOptions.ringPowersCharacteristicPowersDeathEmpowerment, 1);
    assert.strictEqual(engine.selectedOptions.emotionalSpectrumEmotionalSpectrumColor696969ColorlessRingsColor, undefined);
    assert.strictEqual(engine.points.Points, 5);
    assert.deepStrictEqual(engine.removedByCostModifier, []);
});

test("modified cost priority should respect hierarchy, legacy rules, idsAny, and maxCost", () => {
    const engine = CyoaEngine.synthetic();
    engine.select("discountTrigger");
    assertDeepEqual(engine.effectiveCost("freeDefault"), { Points: 0 });
    assertDeepEqual(engine.effectiveCost("optionOverride"), { Points: 7 });

    const subcategoryPriorityEngine = CyoaEngine.synthetic();
    subcategoryPriorityEngine.select("discountTrigger");
    subcategoryPriorityEngine.select("surchargeTrigger");
    assertDeepEqual(subcategoryPriorityEngine.effectiveCost("freeDefault"), { Points: 4 }, "Higher-priority subcategory rule should win instead of stacking");
    assertDeepEqual(subcategoryPriorityEngine.effectiveCost("optionOverride"), { Points: 7 }, "Option-level rule should outrank subcategory rules regardless of priority");

    engine.select("legacyTrigger");
    assertDeepEqual(engine.effectiveCost("legacyDiscounted"), { Points: 1 });

    engine.select("preA");
    assertDeepEqual(engine.effectiveCost("anyRule"), { Points: 3 });

    engine.select("preB");
    assertDeepEqual(engine.effectiveCost("optionPriorityTarget"), { Points: 2 }, "Higher-priority option-level rule should win when multiple option rules match");

    const maxEngine = CyoaEngine.synthetic();
    maxEngine.select("surchargeTrigger");
    assertDeepEqual(maxEngine.effectiveCost("maxClampBase"), { Points: 5 });
});

test("conditional cost rows should show resolved costs without internal scope prefixes", () => {
    const inactiveEngine = CyoaEngine.synthetic();
    assert.deepStrictEqual(inactiveEngine.conditionalCostDisplayLines("legacyDiscounted"), [
        "❌ if Legacy Trigger, Cost: Points 1"
    ]);

    const activeEngine = CyoaEngine.synthetic();
    activeEngine.select("discountTrigger");
    const lines = activeEngine.conditionalCostDisplayLines("freeDefault");
    assert(lines.includes("✅ if Discount Trigger, Cost: Points 0"));
    assert(lines.every(line => !line.includes("option:") && !line.includes("subcategory:")));
    assert(lines.every(line => !line.includes("(was")));
});

test("conditional cost rows should hide subcategory rules overridden by option rules", () => {
    const engine = CyoaEngine.synthetic();
    const lines = engine.conditionalCostDisplayLines("speciesSpeciesPowerlessSpecies");
    assert(lines.includes("❌ if Grounded Species, Gain: Points 1"));
    assert(lines.includes("❌ if Overpowered Species, Cost: Points 0"));
    assert.strictEqual(lines.filter(line => line.includes("Overpowered Species")).length, 1);
    assert(!lines.includes("❌ if Overpowered Species, Cost: Points 3"));
});

test("automatic grant rows should show target labels and selected state", () => {
    const engine = CyoaEngine.synthetic();
    assert.deepStrictEqual(engine.autoGrantDisplayLines("grantSource"), [
        "❌ Granted Locked (locked)"
    ]);

    engine.select("grantSource");
    assert.deepStrictEqual(engine.autoGrantDisplayLines("grantSource"), [
        "✅ Granted Locked (locked)"
    ]);

    const lanternEngine = CyoaEngine.synthetic();
    assert.deepStrictEqual(lanternEngine.autoGrantDisplayLines("emotionalSpectrumEmotionalSpectrumColor696969ColorlessRingsColor"), [
        "❌ Emotional Instability (locked)"
    ]);

    assert.deepStrictEqual(engine.autoGrantDisplayLines("grantSourceCanDeselect"), [
        "❌ Granted Can Deselect (can be deselected)"
    ]);
});

test("locked automatic grants should be free and trigger related discounts", () => {
    const engine = CyoaEngine.synthetic();
    const startingPoints = engine.points.Points;
    engine.select("emotionalSpectrumEmotionalSpectrumColor696969ColorlessRingsColor");

    assert.strictEqual(engine.selectedOptions.weaknessesWeaknessesEmotionalInstability, 1);
    assert.deepStrictEqual(engine.autoGrantedSelections.weaknessesWeaknessesEmotionalInstability, {
        sourceId: "emotionalSpectrumEmotionalSpectrumColor696969ColorlessRingsColor",
        canDeselect: false
    });
    assert.strictEqual(engine.points.Points, startingPoints);
    assertDeepEqual(engine.effectiveCost("weaknessesWeaknessesEmotionalInstability"), { Points: 0 });
    assertDeepEqual(engine.effectiveCost("ringPowersCharacteristicPowersEmotionalConstruct"), { Points: 0 });
    assertDeepEqual(engine.effectiveCost("ringPowersCharacteristicPowersDeathEmpowerment"), { Points: 4 });
});

test("automatic grants should add free locked targets and remove them with their source", () => {
    const engine = CyoaEngine.synthetic();
    engine.select("grantSource");
    assert.strictEqual(engine.points.Points, 8);
    assert.strictEqual(engine.selectedOptions.grantSource, 1);
    assert.strictEqual(engine.selectedOptions.grantedLocked, 1);
    assert.deepStrictEqual(engine.autoGrantedSelections.grantedLocked, {
        sourceId: "grantSource",
        canDeselect: false
    });

    engine.remove("grantSource");
    assert.strictEqual(engine.selectedOptions.grantSource, undefined);
    assert.strictEqual(engine.selectedOptions.grantedLocked, undefined);
    assert.strictEqual(engine.autoGrantedSelections.grantedLocked, undefined);

    const canDeselectEngine = CyoaEngine.synthetic();
    canDeselectEngine.select("grantSourceCanDeselect");
    assert.strictEqual(canDeselectEngine.selectedOptions.grantSourceCanDeselect, 1);
    assert.strictEqual(canDeselectEngine.selectedOptions.grantedCanDeselect, 1);
    assert.deepStrictEqual(canDeselectEngine.autoGrantedSelections.grantedCanDeselect, {
        sourceId: "grantSourceCanDeselect",
        canDeselect: true
    });
});

test("option-granted discount slots should apply only to assigned target selections", () => {
    const engine = CyoaEngine.synthetic();
    engine.select("discountGrantSource");
    assertDeepEqual(engine.effectiveCost("discountGrantTargetA"), { Points: 6 });

    engine.optionGrantDiscountSelections["discountGrantSource::0"] = { discountGrantTargetA: 1 };
    assertDeepEqual(engine.effectiveCost("discountGrantTargetA"), { Points: 3 });
    assertDeepEqual(engine.effectiveCost("discountGrantTargetB"), { Points: 5 });

    engine.select("discountGrantTargetA");
    assert.strictEqual(engine.points.Points, 7);
    assertDeepEqual(engine.discountedSelections.discountGrantTargetA[0], { Points: 3 });

    engine.optionGrantDiscountSelections["discountGrantSource::0"] = {
        discountGrantTargetA: 1,
        discountGrantTargetB: 1
    };
    assertDeepEqual(engine.effectiveCost("discountGrantTargetB"), { Points: 5 }, "A one-slot grant should not discount a second target");
});

test("unknown option fields should be preserved without affecting runtime logic", () => {
    const engine = CyoaEngine.synthetic();
    const option = engine.option("customFields");
    assert.strictEqual(option.creatorNotes, "runtime should preserve this");
    assert.deepStrictEqual(option.customMetadata, { tier: 2 });
    assert.strictEqual(engine.canSelect("customFields"), true);
    engine.select("customFields");
    assert.strictEqual(engine.selectedOptions.customFields, 1);
    assert.strictEqual(engine.points.Points, 10);
});

test("packed export state should round-trip selections, points, inputs, and grants", () => {
    const engine = CyoaEngine.synthetic();
    engine.select("freeText");
    engine.storyInputs.freeText = "Test User";
    engine.storyInputs.subcatNote = "Synth";
    engine.attributeSliderValues.Power = 4;
    engine.dynamicSelections.option = ["Power"];
    engine.pointAllocationSelections.allocatedTeamGrant = { Skills: 2, Equipment: 4 };
    engine.subcategoryDiscountSelections.sub = { option: 1 };
    engine.categoryDiscountSelections.cat = { option: 1 };
    engine.optionGrantDiscountSelections.grant = { option: 1 };
    engine.select("grantSource");

    const packed = engine.buildPackedExportState();
    const unpacked = unpackImportedState(JSON.parse(JSON.stringify(packed)));
    assert.deepStrictEqual(unpacked.selectedOptions, engine.selectedOptions);
    assert.deepStrictEqual(unpacked.points, engine.points);
    assert.deepStrictEqual(unpacked.selectedCostOptionHistory, engine.selectedCostOptionHistory);
    assert.deepStrictEqual(unpacked.storyInputs, engine.storyInputs);
    assert.deepStrictEqual(unpacked.attributeSliderValues, engine.attributeSliderValues);
    assert.deepStrictEqual(unpacked.dynamicSelections, engine.dynamicSelections);
    assert.deepStrictEqual(unpacked.pointAllocationSelections, engine.pointAllocationSelections);
    assert.deepStrictEqual(unpacked.subcategoryDiscountSelections, engine.subcategoryDiscountSelections);
    assert.deepStrictEqual(unpacked.categoryDiscountSelections, engine.categoryDiscountSelections);
    assert.deepStrictEqual(unpacked.optionGrantDiscountSelections, engine.optionGrantDiscountSelections);
    assert.deepStrictEqual(unpacked.autoGrantedSelections, engine.autoGrantedSelections);

    const scriptRoundTrip = runPlayerScriptExportImportHelpers(engine.buildExportState());
    assert.deepStrictEqual(scriptRoundTrip.unpacked.selectedOptions, engine.selectedOptions);
    assert.deepStrictEqual(scriptRoundTrip.unpacked.points, engine.points);
    assert.deepStrictEqual(scriptRoundTrip.unpacked.discountedSelections, engine.discountedSelections);
    assert.deepStrictEqual(scriptRoundTrip.unpacked.selectedCostOptionHistory, engine.selectedCostOptionHistory);
    assert.deepStrictEqual(scriptRoundTrip.unpacked.storyInputs, engine.storyInputs);
    assert.deepStrictEqual(scriptRoundTrip.unpacked.attributeSliderValues, engine.attributeSliderValues);
    assert.deepStrictEqual(scriptRoundTrip.unpacked.dynamicSelections, engine.dynamicSelections);
    assert.deepStrictEqual(scriptRoundTrip.unpacked.pointAllocationSelections, engine.pointAllocationSelections);
    assert.deepStrictEqual(scriptRoundTrip.unpacked.subcategoryDiscountSelections, engine.subcategoryDiscountSelections);
    assert.deepStrictEqual(scriptRoundTrip.unpacked.categoryDiscountSelections, engine.categoryDiscountSelections);
    assert.deepStrictEqual(scriptRoundTrip.unpacked.optionGrantDiscountSelections, engine.optionGrantDiscountSelections);
    assert.deepStrictEqual(scriptRoundTrip.unpacked.autoGrantedSelections, engine.autoGrantedSelections);

    const importedEngine = CyoaEngine.synthetic();
    importedEngine.importState(scriptRoundTrip.packed);
    assert.deepStrictEqual(importedEngine.selectedOptions, engine.selectedOptions);
    assert.deepStrictEqual(importedEngine.points, engine.points);
    assert.deepStrictEqual(importedEngine.discountedSelections, engine.discountedSelections);
    assert.deepStrictEqual(importedEngine.selectedCostOptionHistory, engine.selectedCostOptionHistory);
    assert.deepStrictEqual(importedEngine.storyInputs, engine.storyInputs);
    assert.deepStrictEqual(importedEngine.attributeSliderValues, engine.attributeSliderValues);
    assert.deepStrictEqual(importedEngine.dynamicSelections, engine.dynamicSelections);
    assert.deepStrictEqual(importedEngine.pointAllocationSelections, engine.pointAllocationSelections);
    assert.deepStrictEqual(importedEngine.subcategoryDiscountSelections, engine.subcategoryDiscountSelections);
    assert.deepStrictEqual(importedEngine.categoryDiscountSelections, engine.categoryDiscountSelections);
    assert.deepStrictEqual(importedEngine.optionGrantDiscountSelections, engine.optionGrantDiscountSelections);
    assert.deepStrictEqual(importedEngine.autoGrantedSelections, engine.autoGrantedSelections);
});

test("theme settings should define colors for every option metadata section", () => {
    const scriptSource = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
    const editorSource = fs.readFileSync(path.join(ROOT, "editor.js"), "utf8");
    const cssSource = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");

    OPTION_META_THEME_KEYS.forEach(key => {
        assert(scriptSource.includes(`"${key}"`), `script.js defaults should include ${key}`);
        assert(editorSource.includes(`"${key}"`), `editor.js theme settings should include ${key}`);
        assert(cssSource.includes(`--${key}`), `style.css should consume --${key}`);
    });
});

test("theme toggles should preserve selections, points, and paid costs", () => {
    const engine = CyoaEngine.synthetic();
    engine.select("spendTwo");
    engine.select("freeText");
    engine.setTextInput("freeText", "Theme-safe");
    engine.select("preA");
    engine.selectedCostOptionIndexes = { alternateCost: 1 };
    const before = engine.clonePlayerState();

    engine.reloadData({ preservePlayerState: true });

    assert.deepStrictEqual(engine.selectedOptions, before.selectedOptions);
    assert.deepStrictEqual(engine.points, before.points);
    assert.deepStrictEqual(engine.discountedSelections, before.discountedSelections);
    assert.deepStrictEqual(engine.selectedCostOptionIndexes, before.selectedCostOptionIndexes);
    assert.deepStrictEqual(engine.storyInputs, before.storyInputs);
    assert.deepStrictEqual(engine.selectionHistory, before.selectionHistory);
    assert(
        PLAYER_SCRIPT_SOURCE.includes("applyCyoaData(window._lastCyoaData, { preservePlayerState: true })"),
        "dark-mode toggle should refresh theme without resetting player state"
    );
});

test("text formatting should support safe Markdown, legacy tags, and plain-label stripping", () => {
    const html = renderFormattedText("# Heading\n\n**Bold [color=blue]Blue[/color]** and *italic* [size=-2px]small[/size] [weight=700]heavy[/weight] `code` <x>\n\n- [Link](https://example.com)");
    assert(html.includes("<h1>Heading</h1>"));
    assert(html.includes("<strong>Bold "));
    assert(html.includes("<span style=\"color: blue;\">Blue</span>"));
    assert(html.includes("<em>italic</em>"));
    assert(html.includes("font-size: calc(1em - 2px);"));
    assert(html.includes("font-weight: 700;"));
    assert(html.includes("<code>code</code>"));
    assert(html.includes("<ul><li><a href=\"https://example.com\" target=\"_blank\" rel=\"noopener noreferrer\">Link</a></li></ul>"));
    assert(html.includes("&lt;x&gt;"));

    const unsafe = renderFormattedText("[bad](javascript:alert) [color=javascript:alert(1)]bad[/color]");
    assert(unsafe.includes("[bad](javascript:alert)"));
    assert(unsafe.includes("[color=javascript:alert(1)]bad[/color]"));
    assert.strictEqual(stripFormattingMarkup("# [color=red]Red[/color] **Bold** and [Link](https://example.com)"), "Red Bold and Link");

    assert.strictEqual(
        getPointAmountMarkup("[color=gold]Gold[/color] **Points**", 5),
        "<span style=\"color: gold;\">Gold</span> <strong>Points</strong> 5"
    );
});

test("selected options should be removed when later choices invalidate conditional prerequisites", () => {
    const yellowEngine = CyoaEngine.synthetic();
    yellowEngine.select("weaknessesWeaknessesEmotionalConsistency");
    assert.strictEqual(yellowEngine.selectedOptions.weaknessesWeaknessesEmotionalConsistency, 1);
    yellowEngine.select("emotionalSpectrumEmotionalSpectrumColorD5b60aYellowColor");
    assert.strictEqual(yellowEngine.selectedOptions.weaknessesWeaknessesEmotionalConsistency, undefined);
    assert.strictEqual(yellowEngine.canSelect("weaknessesWeaknessesEmotionalConsistency"), false);
    yellowEngine.select("emotionalSpectrumOptionalAdjustmentsYellowBelied");
    assert.strictEqual(yellowEngine.canSelect("weaknessesWeaknessesEmotionalConsistency"), true);

    const indigoEngine = CyoaEngine.synthetic();
    indigoEngine.select("weaknessesWeaknessesEmotionalConsistency");
    indigoEngine.select("emotionalSpectrumEmotionalSpectrumColorIndigoIndigoColor");
    assert.strictEqual(indigoEngine.selectedOptions.weaknessesWeaknessesEmotionalConsistency, undefined);
    assert.strictEqual(indigoEngine.canSelect("weaknessesWeaknessesEmotionalConsistency"), false);
    indigoEngine.select("emotionalSpectrumOptionalAdjustmentsCompassionateSoul");
    assert.strictEqual(indigoEngine.canSelect("weaknessesWeaknessesEmotionalConsistency"), true);
});

function main() {
    const failures = [];
    tests.forEach(({ name, fn }) => {
        try {
            fn();
            console.log(`ok - ${name}`);
        } catch (err) {
            failures.push({ name, err });
            console.error(`not ok - ${name}`);
            console.error(err.stack || err.message || String(err));
        }
    });

    if (failures.length) {
        console.error(`${failures.length}/${tests.length} functional CYOA test(s) failed.`);
        process.exit(1);
    }
    console.log(`Passed ${tests.length} functional CYOA test(s).`);
}

main();
