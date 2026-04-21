const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { evaluatePrereqExpr } = require("../logicExpr");

const ROOT = path.join(__dirname, "..");
const CYOAS_DIR = path.join(ROOT, "CYOAs");

const FEATURE_COVERAGE = [
    "all CYOA JSON fixtures load as functional data",
    "point gains, costs, refunds, and allow-negative point types",
    "single-select options and maxSelections replacement",
    "multi-select options and option maxSelections",
    "countsAsOneSelection for subcategory limits",
    "bypassSubcategoryMaxSelections options do not consume subcategory limit slots",
    "string, array, object, negated, OR, AND, and count-suffix prerequisites",
    "dependent selections are removed when prerequisites become false",
    "one-way outgoing and incoming conflicts",
    "category requiresOption and category maxSelections",
    "category and nested subcategory display mode metadata",
    "adding and removing categories, subcategories, and options",
    "subcategory requiresOption",
    "subcategory discountFirstN with discountAmount",
    "subcategory defaultCost",
    "subcategory columnsPerRow metadata",
    "option-level absolute modified costs",
    "subcategory-wide relative modified costs",
    "modified cost minCost and maxCost clamps",
    "option modified costs override subcategory modified costs and highest-priority matching rules win",
    "conditional cost display rows show resulting gain/cost without scope prefixes",
    "automatic grant display rows show granted targets and selected state",
    "legacy discounts fallback for old CYOAs",
    "idsAny/minSelected conditional cost rules",
    "Lantern Colorless Rings grant forced zero-point Emotional Instability and Characteristic Power discounts",
    "automatic option grants, locked grants, and free granted selections",
    "option-granted discount slots across target options",
    "theme settings include option metadata section colors",
    "custom JSON option fields are preserved and ignored by runtime logic",
    "packed export/import state round trips",
    "safe text formatting markup for color, size, weight, bold, and italic"
];

function loadCyoa(filename) {
    return JSON.parse(fs.readFileSync(path.join(CYOAS_DIR, filename), "utf8"));
}

const OPTION_META_THEME_KEYS = [
    "option-meta-bg",
    "option-meta-heading-bg",
    "option-meta-heading-text",
    "option-meta-points-color",
    "option-meta-conditional-color",
    "option-meta-auto-grants-color",
    "option-meta-prerequisites-color",
    "option-meta-conflicts-color"
];

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
        this.filename = label || (typeof source === "string" ? source : "synthetic");
        this.data = typeof source === "string" ? loadCyoa(source) : JSON.parse(JSON.stringify(source));
        this.pointsEntry = this.data.find(entry => entry.type === "points") || { values: {} };
        this.points = { ...(this.pointsEntry.values || {}) };
        this.allowNegativeTypes = new Set(this.pointsEntry.allowNegative || []);
        this.categories = this.data.filter(entry => !entry.type || entry.name);
        this.selectedOptions = {};
        this.selectionHistory = [];
        this.discountedSelections = {};
        this.storyInputs = {};
        this.attributeSliderValues = {};
        this.dynamicSelections = {};
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
    }

    static synthetic() {
        return new CyoaEngine([
            { type: "title", text: "Synthetic Feature Coverage CYOA" },
            { type: "points", values: { Points: 10, Tokens: 0 }, allowNegative: ["Debt"] },
            {
                name: "Core",
                subcategories: [
                    {
                        name: "Choices",
                        maxSelections: 2,
                        defaultCost: { Points: 1 },
                        modifiedCosts: [
                            { ids: ["discountTrigger"], costDelta: { Points: -2 }, minCost: { Points: 0 }, priority: 1 },
                            { ids: ["surchargeTrigger"], costDelta: { Points: 3 }, maxCost: { Points: 5 }, priority: 2 },
                            { ids: ["legacyTrigger"], discounts: [], cost: { Points: 4 }, priority: 3 }
                        ],
                        options: [
                            { id: "freeDefault", label: "Default Cost" },
                            { id: "spendTwo", label: "Spend Two", cost: { Points: 2 } },
                            { id: "gainThree", label: "Gain Three", cost: { Points: -3 } },
                            { id: "multi", label: "Multi", cost: { Points: 1 }, maxSelections: 3, countsAsOneSelection: true },
                            { id: "limitBypass", label: "Limit Bypass", cost: {}, bypassSubcategoryMaxSelections: true },
                            { id: "discountTrigger", label: "Discount Trigger", cost: {} },
                            { id: "surchargeTrigger", label: "Surcharge Trigger", cost: {} },
                            { id: "legacyTrigger", label: "Legacy Trigger", cost: {} },
                            { id: "maxClampBase", label: "Max Clamp Base", cost: { Points: 4 } },
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
                            { id: "oneWayA", label: "One-Way A", cost: {}, conflictsWith: ["oneWayB"] },
                            { id: "oneWayB", label: "One-Way B", cost: {} }
                        ]
                    },
                    {
                        name: "Grants",
                        options: [
                            { id: "grantSource", label: "Grant Source", cost: { Points: 2 }, autoGrants: [{ id: "grantedLocked", canDeselect: false }] },
                            { id: "grantedLocked", label: "Granted Locked", cost: { Points: 5 } },
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
                            { id: "customFields", label: "Custom Fields", cost: {}, creatorNotes: "runtime should preserve this", customMetadata: { tier: 2 } }
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
                        subcategoryDisplayMode: "all",
                        columnsPerRow: 3,
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

    findSubcategoryInfo(optionId) {
        for (const category of this.categories) {
            if ((category.options || []).some(option => option.id === optionId)) {
                return { category, subcat: null, subcatPath: [] };
            }
            let found = null;
            walkSubcategories(category.subcategories, (subcat, path) => {
                if (!found && (subcat.options || []).some(option => option.id === optionId)) {
                    found = {
                        category,
                        subcat,
                        subcatPath: this.getSubcategoryPath(category, path)
                    };
                }
            });
            if (found) return found;
        }
        return { category: null, subcat: null, subcatPath: [] };
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
        const subcatDefault = this.findSubcategoryInfo(option.id).subcat?.defaultCost || {};
        const optionCost = option.cost || {};
        return Object.keys(optionCost).length ? { ...optionCost } : { ...subcatDefault };
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

    effectiveCost(optionOrId) {
        const option = typeof optionOrId === "string" ? this.option(optionOrId) : optionOrId;
        const info = this.findSubcategoryInfo(option.id);
        let cost = this.getBaseCost(option);
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
                    ? `Gain: ${type} ${Math.abs(numeric)}`
                    : `Cost: ${type} ${numeric}`;
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

    canSelect(optionOrId) {
        const option = typeof optionOrId === "string" ? this.option(optionOrId) : optionOrId;
        const subcat = this.findSubcategoryOfOption(option.id);
        const subcatMax = subcat?.maxSelections || Infinity;
        const subcatCount = this.subcategorySelectionCount(subcat, option.id);
        const underSubcatLimit = (subcatCount <= subcatMax) || (subcatMax !== Infinity && this.hasRemovableSelection(subcat));
        const maxPerOption = option.maxSelections || 1;
        const underOptionLimit = (this.selectedOptions[option.id] || 0) < maxPerOption;
        const categoryMax = Number(this.findSubcategoryInfo(option.id).category?.maxSelections);
        const underCategoryLimit = !Number.isFinite(categoryMax) || categoryMax <= 0 || this.categorySelectionCount(this.findSubcategoryInfo(option.id).category) < categoryMax;
        const hasPoints = Object.entries(this.effectiveCost(option)).every(([type, cost]) => {
            if (cost < 0) return true;
            const current = Number(this.points[type]);
            const projected = (Number.isFinite(current) ? current : 0) - cost;
            return projected >= 0 || this.allowNegativeTypes.has(type);
        });

        return this.structuralRequirementsMet(option)
            && this.prerequisiteMet(option.prerequisites)
            && this.hasNoConflicts(option)
            && underSubcatLimit
            && underCategoryLimit
            && underOptionLimit
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

    select(optionId) {
        const option = this.option(optionId);
        this.ensureSubcategoryLimit(option);
        assert(this.canSelect(option), `${this.filename}: expected ${optionId} to be selectable`);
        const cost = this.effectiveCost(option);
        const isAutoGrant = !!this.pendingAutoGrantSourceId;
        if (!isAutoGrant) {
            Object.entries(cost).forEach(([type, value]) => {
                if (!Object.prototype.hasOwnProperty.call(this.points, type)) this.points[type] = 0;
                this.points[type] -= value;
            });
        }
        if (!this.discountedSelections[option.id]) this.discountedSelections[option.id] = [];
        this.discountedSelections[option.id].push(isAutoGrant ? {} : cost);
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
    }

    remove(optionId) {
        const option = this.option(optionId);
        assert(this.selectedOptions[option.id] > 0, `${this.filename}: expected ${optionId} to be selected`);
        const cost = this.discountedSelections[option.id]?.pop() ?? this.effectiveCost(option);
        Object.entries(cost).forEach(([type, value]) => {
            if (!Object.prototype.hasOwnProperty.call(this.points, type)) this.points[type] = 0;
            this.points[type] += value;
        });
        this.selectedOptions[option.id] -= 1;
        if (this.selectedOptions[option.id] <= 0) delete this.selectedOptions[option.id];
        const historyIndex = this.selectionHistory.indexOf(option.id);
        if (historyIndex >= 0) this.selectionHistory.splice(historyIndex, 1);
        this.removeAutoGrantsFromSource(option.id);
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
                if (option && (!this.structuralRequirementsMet(option) || !this.prerequisiteMet(option.prerequisites))) {
                    this.remove(id);
                    removedAny = true;
                    break;
                }
            }
        }
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
            storyInputs: this.storyInputs,
            attributeSliderValues: this.attributeSliderValues,
            dynamicSelections: this.dynamicSelections,
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
        if (hasOwnEntries(full.storyInputs)) packed.t = full.storyInputs;
        if (hasOwnEntries(full.attributeSliderValues)) packed.a = full.attributeSliderValues;
        if (hasOwnEntries(full.dynamicSelections)) packed.y = full.dynamicSelections;
        if (hasOwnEntries(full.subcategoryDiscountSelections)) packed.u = full.subcategoryDiscountSelections;
        if (hasOwnEntries(full.categoryDiscountSelections)) packed.c = full.categoryDiscountSelections;
        if (hasOwnEntries(full.optionGrantDiscountSelections)) packed.g = full.optionGrantDiscountSelections;
        if (hasOwnEntries(full.autoGrantedSelections)) packed.r = full.autoGrantedSelections;
        return packed;
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
        storyInputs: importedData.t || {},
        attributeSliderValues: importedData.a || {},
        dynamicSelections: importedData.y || {},
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

function renderFormattedText(text = "") {
    const source = String(text);
    const tagPattern = /\*\*|\*|\[\/(color|size|weight)\]|\[(color|size|weight)=([^\]\s]+)\]/gi;
    let html = "";
    let lastIndex = 0;
    const openTags = [];
    let match;

    while ((match = tagPattern.exec(source)) !== null) {
        html += escapeHtml(source.slice(lastIndex, match.index));
        if (match[0] === "**") {
            html += openTags[openTags.length - 1] === "bold" ? "</strong>" : "<strong>";
            openTags[openTags.length - 1] === "bold" ? openTags.pop() : openTags.push("bold");
        } else if (match[0] === "*") {
            html += openTags[openTags.length - 1] === "italic" ? "</em>" : "<em>";
            openTags[openTags.length - 1] === "italic" ? openTags.pop() : openTags.push("italic");
        } else if (match[1]) {
            const closingTag = match[1].toLowerCase();
            if (openTags[openTags.length - 1] === closingTag) {
                html += "</span>";
                openTags.pop();
            } else {
                html += escapeHtml(match[0]);
            }
        } else {
            const openingTag = match[2].toLowerCase();
            const value = match[3].trim();
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
    return html.replace(/\n/g, "<br>");
}

function stripFormattingMarkup(text = "") {
    return String(text)
        .replace(/\*/g, "")
        .replace(/\[\/?(color|size|weight)(=[^\]\s]+)?\]/gi, "");
}

function assertDeepEqual(actual, expected, message) {
    assert.deepStrictEqual(actual, expected, message);
}

function findCategory(data, name) {
    return data.find(entry => entry && entry.name === name);
}

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

test("functional coverage list is explicit and non-empty", () => {
    assert(FEATURE_COVERAGE.length >= 18);
    FEATURE_COVERAGE.forEach(feature => assert.strictEqual(typeof feature, "string"));
});

test("all CYOA fixtures compute selectable state and effective costs without crashing", () => {
    const files = fs.readdirSync(CYOAS_DIR)
        .filter(file => file.endsWith(".json") && file !== "manifest.json")
        .sort();

    files.forEach(file => {
        const engine = new CyoaEngine(file);
        assert(engine.optionMap.size > 0, `${file}: expected at least one option`);
        let selectableCount = 0;
        engine.optionMap.forEach(option => {
            const cost = engine.effectiveCost(option);
            Object.entries(cost).forEach(([type, value]) => {
                assert(Number.isFinite(Number(value)), `${file}: ${option.id} has non-finite effective cost for ${type}`);
            });
            if (engine.canSelect(option)) selectableCount += 1;
        });
        assert(selectableCount > 0, `${file}: expected at least one selectable option`);
        engine.assertFinitePoints();
    });
});

test("superhero difficulty can be selected and switched within maxSelections: 1", () => {
    const engine = new CyoaEngine("superheroAmalgam.json");
    engine.select("powersDifficultySpectacularmanMode");
    assert.strictEqual(engine.points.Points, 200);
    assert.strictEqual(engine.selectedOptions.powersDifficultySpectacularmanMode, 1);

    engine.select("powersDifficultyDakestKnightRecommended");
    assert.strictEqual(engine.points.Points, 100);
    assert.strictEqual(engine.selectedOptions.powersDifficultySpectacularmanMode, undefined);
    assert.strictEqual(engine.selectedOptions.powersDifficultyDakestKnightRecommended, 1);
});

test("core point spend, gain, refund, and multi-select behavior works", () => {
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

test("subcategory default costs and countsAsOneSelection limits work", () => {
    const engine = CyoaEngine.synthetic();
    assertDeepEqual(engine.effectiveCost("freeDefault"), { Points: 1 });
    engine.select("multi");
    engine.select("multi");
    assert.strictEqual(engine.selectedOptions.multi, 2);
    assert.strictEqual(engine.subcategorySelectionCount(engine.findSubcategoryOfOption("multi")), 1);
});

test("options can bypass subcategory maxSelections", () => {
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

test("superhero prerequisites block and unlock dependent options", () => {
    const engine = new CyoaEngine("superheroAmalgam.json");
    assert.strictEqual(engine.canSelect("adultBenefitsHigherPaying"), false);
    engine.select("powersDifficultySpectacularmanMode");
    engine.select("youAgeYoungAdult");
    engine.select("powersSuperpowersSmart");
    assert.strictEqual(engine.canSelect("adultBenefitsHigherPaying"), true);
});

test("string, array, object, negated, OR, AND, and count prerequisites work", () => {
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

test("category requiresOption and maxSelections work", () => {
    const engine = CyoaEngine.synthetic();
    assert.strictEqual(engine.canSelect("categoryLimitA"), false);

    engine.select("preA");
    assert.strictEqual(engine.canSelect("categoryLimitA"), true);
    engine.select("categoryLimitA");
    assert.strictEqual(engine.selectedOptions.categoryLimitA, 1);
    assert.strictEqual(engine.canSelect("categoryLimitB"), false);
});

test("subcategory requiresOption works for nested options", () => {
    const engine = CyoaEngine.synthetic();
    assert.strictEqual(engine.canSelect("subcategoryRequiresOption"), false);
    assert.strictEqual(engine.canSelect("nestedSubcategoryOption"), false);

    engine.select("preA");
    assert.strictEqual(engine.canSelect("subcategoryRequiresOption"), true);
    assert.strictEqual(engine.canSelect("nestedSubcategoryOption"), true);
});

test("category and nested subcategory display metadata is preserved", () => {
    const engine = CyoaEngine.synthetic();
    const category = engine.categories.find(entry => entry.name === "Category Controls");
    const subcategory = engine.categories
        .find(entry => entry.name === "Subcategory Controls")
        .subcategories.find(entry => entry.name === "Subcategory Gate");
    const nested = subcategory.subcategories.find(entry => entry.name === "Nested Gate");

    assert.strictEqual(category.subcategoryDisplayMode, "all");
    assert.strictEqual(subcategory.subcategoryDisplayMode, "all");
    assert.strictEqual(nested.subcategoryDisplayMode, "all");
});

test("adding and removing options updates selectable data", () => {
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

test("adding and removing subcategories updates selectable data", () => {
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

test("adding and removing categories updates selectable data", () => {
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

test("subcategory discountFirstN and discountAmount work", () => {
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

test("subcategory columnsPerRow metadata is preserved", () => {
    const engine = CyoaEngine.synthetic();
    const subcategory = engine.categories
        .find(entry => entry.name === "Subcategory Controls")
        .subcategories.find(entry => entry.name === "Subcategory Gate");
    assert.strictEqual(subcategory.columnsPerRow, 3);
});

test("one-way conflicts block the reverse selection", () => {
    const engine = new CyoaEngine("superheroAmalgam.json");
    engine.option("drawbacksDrawbacksDumb").conflictsWith = [];
    assert.deepStrictEqual(engine.option("powersSuperpowersSmart").conflictsWith, ["drawbacksDrawbacksDumb"]);

    engine.select("powersDifficultySpectacularmanMode");
    engine.select("powersSuperpowersSmart");

    assert.strictEqual(engine.canSelect("drawbacksDrawbacksDumb"), false);
});

test("lantern absolute modified cost can replace a gain with zero cost", () => {
    const engine = new CyoaEngine("lantern_corps_recruit.json");
    engine.select("emotionalSpectrumEmotionalSpectrumColorOrangeOrangeColor");
    assertDeepEqual(engine.effectiveCost("universeOptionalSharedEmotions"), { Points: 0 }, "Orange should make Shared Emotions cost 0 Points");
    engine.select("universeOptionalSharedEmotions");
    assert.strictEqual(engine.points.Points, 50);
});

test("lantern subcategory relative modified cost applies to all options in the subcategory", () => {
    const engine = new CyoaEngine("lantern_corps_recruit.json");
    assertDeepEqual(engine.effectiveCost("speciesSpeciesVuldarian"), { Points: 13 });
    engine.select("universeOptionalOverpoweredSpecies");
    assertDeepEqual(engine.effectiveCost("speciesSpeciesVuldarian"), { Points: 16 });
});

test("lantern subcategory minCost clamps relative reductions", () => {
    const engine = new CyoaEngine("lantern_corps_recruit.json");
    engine.select("universeOptionalGroundedSpecies");
    assertDeepEqual(engine.effectiveCost("speciesSpeciesYautja"), { Points: -1 });
});

test("modified cost hierarchy, legacy discounts, idsAny, and maxCost work", () => {
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

test("conditional cost display rows show resulting costs without scope prefixes", () => {
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

test("conditional cost display hides subcategory rows overridden by option rows", () => {
    const engine = new CyoaEngine("lantern_corps_recruit.json");
    const lines = engine.conditionalCostDisplayLines("speciesSpeciesPowerlessSpecies");
    assert(lines.includes("❌ if Grounded Species, Gain: Points 1"));
    assert(lines.includes("❌ if Overpowered Species, Cost: Points 0"));
    assert.strictEqual(lines.filter(line => line.includes("Overpowered Species")).length, 1);
    assert(!lines.includes("❌ if Overpowered Species, Cost: Points 3"));
});

test("automatic grant display rows show granted targets and selected state", () => {
    const engine = CyoaEngine.synthetic();
    assert.deepStrictEqual(engine.autoGrantDisplayLines("grantSource"), [
        "❌ Granted Locked (locked)"
    ]);

    engine.select("grantSource");
    assert.deepStrictEqual(engine.autoGrantDisplayLines("grantSource"), [
        "✅ Granted Locked (locked)"
    ]);

    const lanternEngine = new CyoaEngine("lantern_corps_recruit.json");
    assert.deepStrictEqual(lanternEngine.autoGrantDisplayLines("emotionalSpectrumEmotionalSpectrumColor696969ColorlessRingsColor"), [
        "❌ Emotional Instability (locked)"
    ]);
});

test("lantern Colorless Rings force Emotional Instability and discount Characteristic Powers", () => {
    const engine = new CyoaEngine("lantern_corps_recruit.json");
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

test("automatic grants select targets for free and remove locked grants with their source", () => {
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
});

test("option-granted discount slots apply to selected target options", () => {
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

test("custom JSON option fields are preserved and ignored by runtime logic", () => {
    const engine = CyoaEngine.synthetic();
    const option = engine.option("customFields");
    assert.strictEqual(option.creatorNotes, "runtime should preserve this");
    assert.deepStrictEqual(option.customMetadata, { tier: 2 });
    assert.strictEqual(engine.canSelect("customFields"), true);
    engine.select("customFields");
    assert.strictEqual(engine.selectedOptions.customFields, 1);
    assert.strictEqual(engine.points.Points, 10);
});

test("packed export/import preserves selections, points, and granted state", () => {
    const engine = CyoaEngine.synthetic();
    engine.storyInputs.name = "Test User";
    engine.attributeSliderValues.Power = 4;
    engine.dynamicSelections.option = ["Power"];
    engine.subcategoryDiscountSelections.sub = { option: 1 };
    engine.categoryDiscountSelections.cat = { option: 1 };
    engine.optionGrantDiscountSelections.grant = { option: 1 };
    engine.select("grantSource");

    const packed = engine.buildPackedExportState();
    const unpacked = unpackImportedState(JSON.parse(JSON.stringify(packed)));
    assert.deepStrictEqual(unpacked.selectedOptions, engine.selectedOptions);
    assert.deepStrictEqual(unpacked.points, engine.points);
    assert.deepStrictEqual(unpacked.storyInputs, engine.storyInputs);
    assert.deepStrictEqual(unpacked.attributeSliderValues, engine.attributeSliderValues);
    assert.deepStrictEqual(unpacked.dynamicSelections, engine.dynamicSelections);
    assert.deepStrictEqual(unpacked.subcategoryDiscountSelections, engine.subcategoryDiscountSelections);
    assert.deepStrictEqual(unpacked.categoryDiscountSelections, engine.categoryDiscountSelections);
    assert.deepStrictEqual(unpacked.optionGrantDiscountSelections, engine.optionGrantDiscountSelections);
    assert.deepStrictEqual(unpacked.autoGrantedSelections, engine.autoGrantedSelections);
});

test("theme settings include option metadata section colors", () => {
    const scriptSource = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
    const editorSource = fs.readFileSync(path.join(ROOT, "editor.js"), "utf8");
    const cssSource = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");

    OPTION_META_THEME_KEYS.forEach(key => {
        assert(scriptSource.includes(`"${key}"`), `script.js defaults should include ${key}`);
        assert(editorSource.includes(`"${key}"`), `editor.js theme settings should include ${key}`);
        assert(cssSource.includes(`--${key}`), `style.css should consume --${key}`);
    });

    fs.readdirSync(CYOAS_DIR)
        .filter(file => file.endsWith(".json") && file !== "manifest.json")
        .forEach(file => {
            const data = loadCyoa(file);
            const settings = data.find(entry => entry.type === "settings");
            if (!settings) return;
            assert(["toggle", "light", "dark", undefined].includes(settings.themeMode), `${file}: invalid themeMode`);
        });
});

test("safe text formatting supports nesting and strips markup for plain labels", () => {
    const html = renderFormattedText("**Bold [color=blue]Blue[/color]** and *italic* [size=-2px]small[/size] [weight=700]heavy[/weight] <x>");
    assert(html.includes("<strong>Bold "));
    assert(html.includes("<span style=\"color: blue;\">Blue</span>"));
    assert(html.includes("<em>italic</em>"));
    assert(html.includes("font-size: calc(1em - 2px);"));
    assert(html.includes("font-weight: 700;"));
    assert(html.includes("&lt;x&gt;"));

    const unsafe = renderFormattedText("[color=javascript:alert(1)]bad[/color]");
    assert(unsafe.includes("[color=javascript:alert(1)]bad[/color]"));
    assert.strictEqual(stripFormattingMarkup("[color=red]Red[/color] **Bold**"), "Red Bold");
});

test("lantern emotional consistency is removed when later color choices make conditional prerequisites false", () => {
    const yellowEngine = new CyoaEngine("lantern_corps_recruit.json");
    yellowEngine.select("weaknessesWeaknessesEmotionalConsistency");
    assert.strictEqual(yellowEngine.selectedOptions.weaknessesWeaknessesEmotionalConsistency, 1);
    yellowEngine.select("emotionalSpectrumEmotionalSpectrumColorD5b60aYellowColor");
    assert.strictEqual(yellowEngine.selectedOptions.weaknessesWeaknessesEmotionalConsistency, undefined);
    assert.strictEqual(yellowEngine.canSelect("weaknessesWeaknessesEmotionalConsistency"), false);
    yellowEngine.select("emotionalSpectrumOptionalAdjustmentsYellowBelied");
    assert.strictEqual(yellowEngine.canSelect("weaknessesWeaknessesEmotionalConsistency"), true);

    const indigoEngine = new CyoaEngine("lantern_corps_recruit.json");
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
