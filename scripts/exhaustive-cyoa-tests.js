const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { validateCyoaData } = require("./validate-cyoas");
const { CyoaEngine, walkSubcategories } = require("./functional-cyoa-tests");

const ROOT = path.join(__dirname, "..");
const CYOA_DIR = path.join(ROOT, "CYOAs");
const DEFAULT_FILE = fs.existsSync(path.join(CYOA_DIR, "overlord_cyoa.json"))
    ? "overlord_cyoa.json"
    : null;
const LARGE_BALANCE = 1000000;
const CLI_ARGS = process.argv.slice(2).filter(Boolean);
const REPORT_BLOCKED = CLI_ARGS.includes("--blocked") || CLI_ARGS.includes("--verbose");

function readJson(file) {
    return JSON.parse(fs.readFileSync(path.join(CYOA_DIR, file), "utf8"));
}

function listCyoaFiles() {
    return fs.readdirSync(CYOA_DIR)
        .filter(file => file.endsWith(".json") && file !== "manifest.json")
        .sort();
}

function selectedFiles() {
    if (CLI_ARGS.includes("--help") || CLI_ARGS.includes("-h")) {
        console.log("Usage: node scripts/exhaustive-cyoa-tests.js [all|file.json ...] [--blocked]");
        process.exit(0);
    }
    const args = CLI_ARGS.filter(arg => !arg.startsWith("--"));
    if (args.length === 0) {
        if (!DEFAULT_FILE) throw new Error("No default CYOA found. Pass a CYOA filename or 'all'.");
        return [DEFAULT_FILE];
    }
    if (args.includes("all")) return listCyoaFiles();
    return args.map(file => file.endsWith(".json") ? file : `${file}.json`);
}

function collectOptions(data) {
    const entries = [];
    data.filter(entry => !entry.type || entry.name).forEach(category => {
        (category.options || []).forEach(option => {
            entries.push({ option, path: [category.name || "Unnamed Category"] });
        });
        walkSubcategories(category.subcategories, (subcat, pathIndexes) => {
            const subcatPath = [];
            let current = category.subcategories || [];
            pathIndexes.forEach(index => {
                const next = current[index];
                if (next) subcatPath.push(next.name || "Unnamed Subcategory");
                current = next?.subcategories || [];
            });
            (subcat.options || []).forEach(option => {
                entries.push({ option, path: [category.name || "Unnamed Category", ...subcatPath] });
            });
        });
    });
    return entries;
}

function assertFiniteMap(label, map = {}) {
    Object.entries(map || {}).forEach(([type, value]) => {
        assert(Number.isFinite(Number(value)), `${label}: ${type} is non-finite (${value})`);
    });
}

function seedLargePointBalances(engine) {
    const pointTypes = new Set(Object.keys(engine.pointsEntry.values || {}));
    engine.optionMap.forEach(option => {
        Object.keys(option.cost || {}).forEach(type => pointTypes.add(type));
        Object.keys(option.costPerPoint || {}).forEach(type => pointTypes.add(type));
        (option.costOptions || []).forEach(costOption => {
            Object.keys(costOption.cost || {}).forEach(type => pointTypes.add(type));
            (costOption.costBySelection || []).forEach(cost => Object.keys(cost || {}).forEach(type => pointTypes.add(type)));
        });
        (option.sliderModifiers || option.attributeEffects || []).forEach(effect => {
            if (effect?.attribute) pointTypes.add(effect.attribute);
            (effect?.choices || []).forEach(type => pointTypes.add(type));
        });
    });
    pointTypes.forEach(type => {
        if (!Object.prototype.hasOwnProperty.call(engine.points, type)) engine.points[type] = 0;
        if (!engine.derivedValueConfigs.some(config => config.pointType === type)) engine.points[type] = LARGE_BALANCE;
    });
    Object.entries(engine.pointsEntry.attributeRanges || {}).forEach(([type, range]) => {
        const max = Number(range?.max);
        const value = Number.isFinite(max) ? max : LARGE_BALANCE;
        engine.setSliderBaseValue(type, value);
    });
    engine.applySliderModifiers();
}

function enableAllowedPointSubtypes(engine) {
    engine.pointEnablementSets.forEach(set => {
        const limit = engine.pointEnablementLimit(set);
        engine.enabledPointTypeSelections[engine.pointEnablementKey(set)] = set.subtypes.slice(0, limit);
    });
    engine.normalizeEnabledPointTypeSelections();
}

function requirementToText(requirement) {
    if (!requirement) return "";
    if (typeof requirement === "string") return requirement;
    if (Array.isArray(requirement)) return requirement.join(" && ");
    if (typeof requirement === "object") {
        return [
            ...(requirement.and || []),
            ...(requirement.or || []),
            requirement.not ? `!${requirement.not}` : ""
        ].filter(Boolean).join(" ");
    }
    return "";
}

function extractPositiveRequirementIds(requirement, optionIds, pointTypes) {
    const text = requirementToText(requirement);
    if (!text) return [];
    const ignored = new Set(["category", "subcategory", "selected"]);
    const ids = [];
    const tokenPattern = /!?[A-Za-z_][A-Za-z0-9_]*(?:__\d+)?/g;
    let match;
    while ((match = tokenPattern.exec(text)) !== null) {
        const raw = match[0];
        if (raw.startsWith("!")) continue;
        const baseId = raw.split("__")[0];
        if (ignored.has(baseId) || pointTypes.has(baseId)) continue;
        if (optionIds.has(baseId) && !ids.includes(baseId)) ids.push(baseId);
    }
    return ids;
}

function extractNegatedRequirementIds(requirement, optionIds) {
    const text = requirementToText(requirement);
    if (!text) return [];
    const ids = [];
    const addId = rawId => {
        const baseId = String(rawId || "").split("__")[0];
        if (optionIds.has(baseId) && !ids.includes(baseId)) ids.push(baseId);
    };
    const groupPattern = /!\s*\(([^)]*)\)/g;
    let groupMatch;
    while ((groupMatch = groupPattern.exec(text)) !== null) {
        const idPattern = /[A-Za-z_][A-Za-z0-9_]*(?:__\d+)?/g;
        let idMatch;
        while ((idMatch = idPattern.exec(groupMatch[1])) !== null) addId(idMatch[0]);
    }
    const tokenPattern = /!\s*\(?\s*([A-Za-z_][A-Za-z0-9_]*(?:__\d+)?)/g;
    let match;
    while ((match = tokenPattern.exec(text)) !== null) {
        addId(match[1]);
    }
    return ids;
}

function extractPointThresholds(requirement, pointTypes) {
    const text = requirementToText(requirement);
    if (!text) return [];
    const thresholds = [];
    const token = String.raw`(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([A-Za-z_][A-Za-z0-9_]*))`;
    const comparisonPattern = new RegExp(`${token}\\s*(>=|>|==|=|<=|<)\\s*(-?\\d+(?:\\.\\d+)?)`, "g");
    const suffixPattern = new RegExp(`${token}\\s+(-?\\d+(?:\\.\\d+)?)\\+`, "g");
    let match;
    while ((match = comparisonPattern.exec(text)) !== null) {
        const pointType = (match[1] || match[2] || match[3] || "").replace(/\\(["'\\])/g, "$1");
        if (!pointTypes.has(pointType)) continue;
        thresholds.push({ pointType, operator: match[4], value: Number(match[5]) });
    }
    while ((match = suffixPattern.exec(text)) !== null) {
        const pointType = (match[1] || match[2] || match[3] || "").replace(/\\(["'\\])/g, "$1");
        if (!pointTypes.has(pointType)) continue;
        thresholds.push({ pointType, operator: ">=", value: Number(match[4]) });
    }
    return thresholds;
}

function firstSelectableIdsInCategory(engine, categoryName) {
    const category = engine.findCategoryByRequirementName(categoryName);
    if (!category) return [];
    const ids = [];
    (category.options || []).forEach(option => ids.push(option.id));
    walkSubcategories(category.subcategories, subcat => {
        (subcat.options || []).forEach(option => ids.push(option.id));
    });
    return ids;
}

function firstSelectableIdsInSubcategory(engine, subcategoryName) {
    const subcat = engine.findSubcategoryByRequirementName(subcategoryName);
    if (!subcat) return [];
    const ids = [];
    (subcat.options || []).forEach(option => ids.push(option.id));
    walkSubcategories(subcat.subcategories, child => {
        (child.options || []).forEach(option => ids.push(option.id));
    });
    return ids;
}

function extractPositiveScopeUnlockIds(engine, requirement, bannedIds = new Set()) {
    const text = requirementToText(requirement);
    if (!text) return [];
    const ids = [];
    const scopePattern = /(category|subcategory)\(\s*(["'])((?:\\.|(?!\2).)*)\2\s*\)/g;
    let match;
    while ((match = scopePattern.exec(text)) !== null) {
        const before = text.slice(0, match.index).trimEnd();
        if (before.endsWith("!")) continue;
        const scopeType = match[1];
        const scopeName = match[3].replace(/\\(["'\\])/g, "$1");
        const candidates = scopeType === "category"
            ? firstSelectableIdsInCategory(engine, scopeName)
            : firstSelectableIdsInSubcategory(engine, scopeName);
        const candidate = candidates.find(id => !bannedIds.has(id));
        if (candidate && !ids.includes(candidate)) ids.push(candidate);
    }
    return ids;
}

function collectUnlockIds(engine, option, costOptionIndex = null) {
    const pointTypes = new Set(Object.keys(engine.pointsEntry.values || {}));
    const optionIds = new Set(engine.optionMap.keys());
    const requirements = [option.prerequisites];
    const nextSelection = (engine.selectedOptions[option.id] || 0) + 1;
    if (Array.isArray(option.prerequisitesBySelection)) {
        requirements.push(option.prerequisitesBySelection[nextSelection - 1]);
    }
    const info = engine.findSubcategoryInfo(option.id);
    requirements.push(info.category?.requiresOption);
    (info.subcatPath || []).forEach(subcat => requirements.push(subcat.requiresOption));
    const costOptions = engine.normalizeCostOptions(option, {
        selectionNumber: nextSelection,
        includeUnavailable: true
    });
    const selectedCostOption = costOptionIndex === null || costOptionIndex === undefined
        ? costOptions[0]
        : costOptions.find(entry => entry.index === Number(costOptionIndex));
    if (selectedCostOption) {
        const configured = engine.configuredCostOptions(option)[selectedCostOption.index];
        requirements.push(configured?.prerequisites);
    }
    const bannedIds = new Set(requirements.flatMap(req => extractNegatedRequirementIds(req, optionIds)));
    return [...new Set(requirements.flatMap(req => [
        ...extractPositiveRequirementIds(req, optionIds, pointTypes),
        ...extractPositiveScopeUnlockIds(engine, req, bannedIds)
    ]))]
        .filter(id => id !== option.id && !bannedIds.has(id));
}

function collectRequirementsForOption(engine, option, costOptionIndex = null) {
    const requirements = [option.prerequisites];
    const nextSelection = (engine.selectedOptions[option.id] || 0) + 1;
    if (Array.isArray(option.prerequisitesBySelection)) {
        requirements.push(option.prerequisitesBySelection[nextSelection - 1]);
    }
    const info = engine.findSubcategoryInfo(option.id);
    requirements.push(info.category?.requiresOption);
    (info.subcatPath || []).forEach(subcat => requirements.push(subcat.requiresOption));
    const costOptions = engine.normalizeCostOptions(option, {
        selectionNumber: nextSelection,
        includeUnavailable: true
    });
    const selectedCostOption = costOptionIndex === null || costOptionIndex === undefined
        ? costOptions[0]
        : costOptions.find(entry => entry.index === Number(costOptionIndex));
    if (selectedCostOption) {
        const configured = engine.configuredCostOptions(option)[selectedCostOption.index];
        requirements.push(configured?.prerequisites);
    }
    return requirements.filter(Boolean);
}

function satisfyPointThresholds(engine, option, costOptionIndex = null) {
    const pointTypes = new Set(Object.keys(engine.pointsEntry.values || {}));
    const thresholds = collectRequirementsForOption(engine, option, costOptionIndex)
        .flatMap(requirement => extractPointThresholds(requirement, pointTypes));
    thresholds.forEach(({ pointType, operator, value }) => {
            if (!Number.isFinite(value)) return;
            let nextValue = value;
            if (operator === ">") nextValue = value + 1;
            if (operator === "<") nextValue = value - 1;
            if (operator === "<=") nextValue = Math.min(Number(engine.points[pointType]) || 0, value);
            const current = Number(engine.points[pointType]) || 0;
            if ((operator === ">=" || operator === ">" || operator === "==" || operator === "=") && current >= nextValue) return;
            if (Object.prototype.hasOwnProperty.call(engine.pointsEntry.attributeRanges || {}, pointType)) {
                engine.setSliderBaseValue(pointType, nextValue);
            } else {
                engine.points[pointType] = nextValue;
            }
        });
    engine.applySliderModifiers();
    thresholds.forEach(({ pointType, operator, value }) => {
        if (![">=", ">"].includes(operator) || !Number.isFinite(value)) return;
        const required = operator === ">" ? value + 1 : value;
        if ((Number(engine.pointRequirementValue(pointType)) || 0) >= required) return;
        const rangeMax = Number(engine.pointsEntry.attributeRanges?.[pointType]?.max);
        if (Number.isFinite(rangeMax)) {
            engine.setSliderBaseValue(pointType, rangeMax);
        } else {
            engine.points[pointType] = required;
        }
    });
    engine.applySliderModifiers();
}

function trySelectUnlocks(engine, option, costOptionIndex = null) {
    const attempted = new Set();
    for (let pass = 0; pass < 10; pass += 1) {
        if (engine.canSelect(option, { costOptionIndex })) return true;
        const ids = collectUnlockIds(engine, option, costOptionIndex).filter(id => !engine.selectedOptions[id] && !attempted.has(id));
        if (!ids.length) return false;
        let progressed = false;
        ids.forEach(id => {
            attempted.add(id);
            const dependency = engine.optionMap.get(id);
            if (!dependency) return;
            trySelectUnlocks(engine, dependency);
            if (engine.canSelect(dependency)) {
                try {
                    engine.select(id, { skipCostModifierAffectedRemoval: true });
                    progressed = true;
                } catch (_) {
                    // Some prerequisite helpers trigger auto-grants or limits that are not valid
                    // in this isolated setup. Leave the target path blocked instead of treating
                    // dependency setup as the option under test.
                }
            }
        });
        if (!progressed && !engine.canSelect(option, { costOptionIndex })) return false;
    }
    return engine.canSelect(option, { costOptionIndex });
}

function seedPlayerChoices(engine, option) {
    const allocation = engine.normalizePointAllocationConfig(option);
    if (allocation) {
        engine.setPointAllocation(option, { [allocation.types[0]]: allocation.total });
    }
    const effects = engine.normalizeSliderModifiers(option);
    if (effects.some(effect => effect.selectable)) {
        const rows = [];
        const count = Math.max(1, engine.selectedOptions[option.id] || 1);
        for (let index = 0; index < count; index += 1) {
            rows.push(effects.map(effect => effect.selectable ? effect.choices[0] : effect.attribute));
        }
        engine.setSliderModifierSelectionRows(option.id, rows);
    }
}

function assertRandomResults(engine, option) {
    const tables = engine.normalizeRandomTables(option);
    if (!tables.length || !engine.selectedOptions[option.id]) return;
    const rolls = engine.randomRollResults[option.id];
    assert(Array.isArray(rolls) && rolls.length >= 1, `${engine.filename}: ${option.id} should record random roll results`);
    rolls.forEach(selection => {
        assert(Array.isArray(selection.results), `${engine.filename}: ${option.id} random result should include results`);
        selection.results.forEach(result => {
            assert(Number.isFinite(Number(result.roll)), `${engine.filename}: ${option.id} random roll should be finite`);
            assert(result.outcome, `${engine.filename}: ${option.id} random result should include an outcome label`);
        });
    });
}

function explainBlockedSelection(engine, option, costOptionIndex = null) {
    const nextSelectionNumber = (engine.selectedOptions[option.id] || 0) + 1;
    const subcat = engine.findSubcategoryOfOption(option.id);
    const subcatMax = subcat?.maxSelections || Infinity;
    const subcatCount = engine.subcategorySelectionCount(subcat, option.id);
    const category = engine.findSubcategoryInfo(option.id).category;
    const categoryMax = Number(category?.maxSelections);
    const choices = engine.normalizeCostOptions(option, { selectionNumber: nextSelectionNumber });
    const info = engine.findSubcategoryInfo(option.id);
    const hasDirectOptionCost = option?.cost && typeof option.cost === "object" && Object.keys(option.cost).length > 0;
    const hasConfiguredCostOptions = (Array.isArray(option.costOptions) && option.costOptions.length > 0)
        || (!hasDirectOptionCost && Array.isArray(info.subcat?.costOptions) && info.subcat.costOptions.length > 0);
    const selectedChoice = costOptionIndex === null || costOptionIndex === undefined
        ? choices[0]
        : choices.find(choice => choice.index === Number(costOptionIndex));
    const cost = selectedChoice
        ? engine.effectiveCost(option, { costOptionIndex: selectedChoice.index, selectionNumber: nextSelectionNumber })
        : engine.effectiveCost(option, { selectionNumber: nextSelectionNumber });

    const reasons = [];
    if (!engine.structuralRequirementsMet(option)) {
        const structural = [];
        if (!engine.prerequisiteMet(info.category?.requiresOption)) {
            structural.push(`category requires ${requirementToText(info.category?.requiresOption) || "an unmet option"}`);
        }
        (info.subcatPath || []).forEach(subcatEntry => {
            if (!engine.prerequisiteMet(subcatEntry.requiresOption)) {
                structural.push(`subcategory "${subcatEntry.name || "Unnamed Subcategory"}" requires ${requirementToText(subcatEntry.requiresOption) || "an unmet option"}`);
            }
        });
        reasons.push(structural.length ? structural.join("; ") : "category/subcategory structural requirement is unmet");
    }
    if (!engine.optionPrerequisitesMet(option, nextSelectionNumber)) {
        const requirements = engine.displayRequirementLines(option, nextSelectionNumber);
        const failed = requirements.filter(line => String(line).startsWith("❌"));
        reasons.push(`unmet prerequisite${failed.length === 1 ? "" : "s"}: ${(failed.length ? failed : requirements).join(" | ") || requirementToText(option.prerequisites)}`);
    }
    if (!engine.hasNoConflicts(option)) {
        const selectedConflict = Object.keys(engine.selectedOptions).find(id => {
            const selected = engine.optionMap.get(id);
            return option.conflictsWith?.includes(id) || selected?.conflictsWith?.includes(option.id);
        });
        reasons.push(selectedConflict
            ? `conflicts with selected option ${engine.optionMap.get(selectedConflict)?.label || selectedConflict}`
            : "conflicts with an already selected option");
    }
    if (subcatCount > subcatMax && !(subcatMax !== Infinity && engine.hasRemovableSelection(subcat))) {
        reasons.push(`subcategory max selections reached (${subcatCount}/${subcatMax})`);
    }
    const maxPerOption = engine.optionMaxSelections(option);
    if ((engine.selectedOptions[option.id] || 0) >= maxPerOption) {
        reasons.push(`option max selections reached (${engine.selectedOptions[option.id] || 0}/${maxPerOption})`);
    }
    if (Number.isFinite(categoryMax) && categoryMax > 0 && engine.categorySelectionCount(category) >= categoryMax) {
        reasons.push(`category max selections reached (${engine.categorySelectionCount(category)}/${categoryMax})`);
    }
    if (hasConfiguredCostOptions && !selectedChoice) {
        reasons.push(costOptionIndex === null || costOptionIndex === undefined
            ? "no available payment option"
            : `payment option ${Number(costOptionIndex) + 1} is unavailable`);
    }

    engine.normalizeEnabledPointTypeSelections();
    const pointIssues = Object.entries(cost).flatMap(([type, rawCost]) => {
        const value = Number(rawCost);
        if (!Number.isFinite(value) || value === 0 || value < 0) return [];
        if (!engine.isPointTypeEnabled(type)) return [`${type} is disabled by point enablement`];
        const current = Number(engine.points[type]);
        const projected = (Number.isFinite(current) ? current : 0) - value;
        if (projected < 0 && !engine.allowNegativeTypes.has(type)) return [`${type} has ${current || 0}, needs ${value}`];
        return [];
    });
    if (pointIssues.length) reasons.push(`point gate: ${pointIssues.join("; ")}`);

    return reasons.length ? reasons : ["blocked by an unresolved runtime gate"];
}

function exerciseOption(data, file, entry, costChoice = null) {
    const engine = new CyoaEngine(data, file);
    seedLargePointBalances(engine);
    enableAllowedPointSubtypes(engine);

    const option = engine.option(entry.option.id);
    const costOptionIndex = costChoice?.index ?? null;
    trySelectUnlocks(engine, option, costOptionIndex);
    satisfyPointThresholds(engine, option, costOptionIndex);

    if (engine.selectedOptions[option.id] > 0) {
        engine.assertFinitePoints();
        assertRandomResults(engine, option);
        const state = engine.buildPackedExportState();
        assert(state && typeof state === "object", `${file}: ${option.id} should build packed export state`);
        return { selected: true, autoSelected: true };
    }

    const cost = engine.effectiveCost(option, {
        costOptionIndex,
        selectionNumber: (engine.selectedOptions[option.id] || 0) + 1,
        includeUnavailable: true
    });
    assertFiniteMap(`${file}: ${option.id} effective cost`, cost);

    if (!engine.canSelect(option, { costOptionIndex })) {
        const selectedSetup = Object.keys(engine.selectedOptions)
            .filter(id => id !== option.id)
            .map(id => engine.optionMap.get(id)?.label || id);
        const setupSuffix = selectedSetup.length ? `; setup selected: ${selectedSetup.join(", ")}` : "";
        return { selected: false, reason: `${explainBlockedSelection(engine, option, costOptionIndex).join("; ")}${setupSuffix}` };
    }

    seedPlayerChoices(engine, option);
    assert.strictEqual(engine.select(option.id, { costOptionIndex, skipCostModifierAffectedRemoval: true }), true);
    assert(engine.selectedOptions[option.id] >= 1, `${file}: ${option.id} should be selected after select()`);
    engine.assertFinitePoints();
    assertRandomResults(engine, option);

    const state = engine.buildPackedExportState();
    assert(state && typeof state === "object", `${file}: ${option.id} should build packed export state`);

    if (!engine.isOptionSelectionLocked(option)) {
        const before = engine.selectedOptions[option.id] || 0;
        assert.strictEqual(engine.remove(option.id, { skipCostModifierAffectedRemoval: true }), true);
        assert((engine.selectedOptions[option.id] || 0) < before, `${file}: ${option.id} should decrement on removal`);
        engine.assertFinitePoints();
    }

    return { selected: true };
}

function costChoicesFor(engine, option) {
    const choices = engine.normalizeCostOptions(option, { includeUnavailable: true });
    return choices.length ? choices : [{ index: null }];
}

function runFile(file) {
    const data = readJson(file);
    const validation = validateCyoaData(file, data);
    assert.deepStrictEqual(validation.errors, [], `${file}: validation errors:\n${validation.errors.join("\n")}`);

    const baseEngine = new CyoaEngine(data, file);
    const entries = collectOptions(data);
    const failures = [];
    const blocked = [];
    let selected = 0;
    let attempts = 0;

    entries.forEach(entry => {
        let choices;
        try {
            choices = costChoicesFor(baseEngine, entry.option);
        } catch (err) {
            failures.push({ entry, message: err.message });
            return;
        }
        choices.forEach(choice => {
            attempts += 1;
            try {
                const result = exerciseOption(data, file, entry, choice);
                if (result.selected) selected += 1;
                else blocked.push({ entry, choice, reason: result.reason });
            } catch (err) {
                failures.push({ entry, choice, message: err.stack || err.message || String(err) });
            }
        });
    });

    if (failures.length) {
        const detail = failures.slice(0, 25).map(({ entry, choice, message }) => {
            const suffix = choice?.index === null || choice?.index === undefined ? "" : ` payment option ${choice.index + 1}`;
            return `- ${entry.path.join(" > ")} > ${entry.option.label || entry.option.id}${suffix}: ${message}`;
        }).join("\n");
        throw new Error(`${file}: ${failures.length} exhaustive option failure(s)\n${detail}`);
    }

    console.log(`ok - ${file}: exercised ${selected}/${attempts} option/payment path(s); ${blocked.length} blocked path(s) were evaluated without runtime failures.`);
    if (REPORT_BLOCKED && blocked.length) {
        console.log(`blocked paths for ${file}:`);
        blocked.forEach(({ entry, choice, reason }) => {
            const suffix = choice?.index === null || choice?.index === undefined ? "" : ` payment option ${choice.index + 1}`;
            console.log(`- ${entry.path.join(" > ")} > ${entry.option.label || entry.option.id}${suffix}: ${reason}`);
        });
    }
}

function main() {
    const files = selectedFiles();
    files.forEach(file => {
        const fullPath = path.join(CYOA_DIR, file);
        if (!fs.existsSync(fullPath)) throw new Error(`CYOA file not found: ${file}`);
        runFile(file);
    });
    console.log(`Passed exhaustive CYOA coverage for ${files.length} file(s).`);
}

main();
