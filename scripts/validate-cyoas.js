const fs = require("fs");
const path = require("path");
const { evaluatePrereqExpr } = require("../logicExpr");

const ROOT = path.join(__dirname, "..");
const CYOAS_DIR = path.join(ROOT, "CYOAs");
const RESERVED_EXPR_IDENTIFIERS = new Set([
    "true",
    "false",
    "null",
    "undefined",
    "if",
    "else",
    "return",
    "let",
    "var",
    "const",
    "function",
    "while",
    "for",
    "do",
    "switch",
    "case",
    "break",
    "continue",
    "default"
]);

function readJsonFiles(dir) {
    return fs.readdirSync(dir)
        .filter(file => file.endsWith(".json") && file !== "manifest.json")
        .sort();
}

function pushIssue(issues, file, message) {
    issues.push(`${file}: ${message}`);
}

function normalizeIdList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
    if (typeof value === "string") return value.split(",").map(v => v.trim()).filter(Boolean);
    return [];
}

function extractExpressionIds(expr) {
    if (typeof expr !== "string") return [];
    const ids = new Set();
    const tokens = expr.match(/!?[A-Za-z_][A-Za-z0-9_]*(?:__\d+)?/g) || [];
    tokens.forEach(token => {
        const core = token.startsWith("!") ? token.slice(1) : token;
        const [id] = core.split("__");
        if (id && !RESERVED_EXPR_IDENTIFIERS.has(id)) ids.add(id);
    });
    return Array.from(ids);
}

function extractRequirementIds(requirement) {
    const ids = new Set();
    const visit = value => {
        if (!value) return;
        if (typeof value === "string") {
            extractExpressionIds(value).forEach(id => ids.add(id));
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(item => {
                if (typeof item === "string") {
                    const [id] = item.split("__");
                    if (id) ids.add(id);
                } else {
                    visit(item);
                }
            });
            return;
        }
        if (typeof value === "object") {
            visit(value.and);
            visit(value.or);
            visit(value.not);
        }
    };
    visit(requirement);
    return Array.from(ids);
}

function validateRequirementExpression(file, context, requirement, errors) {
    if (typeof requirement !== "string") return;
    try {
        evaluatePrereqExpr(requirement, () => 0);
    } catch (err) {
        pushIssue(errors, file, `${context} has invalid prerequisite expression "${requirement}": ${err.message}`);
    }
}

function walkSubcategories(subcategories, visitor, pathParts = []) {
    if (!Array.isArray(subcategories)) return;
    subcategories.forEach((subcat, index) => {
        const label = subcat?.name || `subcategory[${index}]`;
        const nextPath = [...pathParts, label];
        visitor(subcat, nextPath);
        walkSubcategories(subcat?.subcategories, visitor, nextPath);
    });
}

function collectOptions(data) {
    const options = [];
    const categories = data.filter(entry => !entry.type || entry.name);
    categories.forEach((category, categoryIndex) => {
        const categoryName = category.name || `category[${categoryIndex}]`;
        (category.options || []).forEach((option, optionIndex) => {
            options.push({ option, path: `${categoryName} > option[${optionIndex}]` });
        });
        walkSubcategories(category.subcategories, (subcat, pathParts) => {
            (subcat.options || []).forEach((option, optionIndex) => {
                options.push({
                    option,
                    path: `${categoryName} > ${pathParts.join(" > ")} > option[${optionIndex}]`
                });
            });
        });
    });
    return options;
}

function collectSubcategories(data) {
    const subcategories = [];
    const categories = data.filter(entry => !entry.type || entry.name);
    categories.forEach((category, categoryIndex) => {
        const categoryName = category.name || `category[${categoryIndex}]`;
        walkSubcategories(category.subcategories, (subcat, pathParts) => {
            subcategories.push({
                subcat,
                path: `${categoryName} > ${pathParts.join(" > ")}`
            });
        });
    });
    return subcategories;
}

function validatePointMap(file, context, map, pointTypes, errors, warnings) {
    if (map === undefined || map === null) return;
    if (typeof map !== "object" || Array.isArray(map)) {
        pushIssue(errors, file, `${context} must be an object map of point type to number.`);
        return;
    }
    Object.entries(map).forEach(([type, value]) => {
        if (!Number.isFinite(Number(value))) {
            pushIssue(errors, file, `${context}.${type} must be numeric.`);
            return;
        }
        if (!pointTypes.has(type)) {
            const issue = `${context} references unknown point type "${type}".`;
            if (Number(value) === 0) pushIssue(warnings, file, `${issue} Ignored because the value is 0.`);
            else pushIssue(errors, file, issue);
        }
    });
}

function validateIdRefs(file, context, ids, optionIds, errors) {
    ids.forEach(rawId => {
        const [id] = String(rawId).split("__");
        if (id && !optionIds.has(id)) {
            pushIssue(errors, file, `${context} references unknown option ID "${rawId}".`);
        }
    });
}

function validateModifiedCostRules(file, context, rules, optionIds, pointTypes, errors, warnings) {
    if (rules === undefined) return;
    if (!Array.isArray(rules)) {
        pushIssue(errors, file, `${context} must be an array.`);
        return;
    }
    rules.forEach((rule, index) => {
        const ruleContext = `${context}[${index}]`;
        if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
            pushIssue(errors, file, `${ruleContext} must be an object.`);
            return;
        }

        const ids = [
            ...normalizeIdList(rule.ids),
            ...normalizeIdList(rule.idsAny),
            ...normalizeIdList(rule.id ? [rule.id] : [])
        ];
        if (!ids.length) {
            pushIssue(errors, file, `${ruleContext} must reference at least one trigger option ID.`);
        }
        validateIdRefs(file, `${ruleContext} trigger`, ids, optionIds, errors);

        validatePointMap(file, `${ruleContext}.cost`, rule.cost, pointTypes, errors, warnings);
        validatePointMap(file, `${ruleContext}.costDelta`, rule.costDelta, pointTypes, errors, warnings);
        validatePointMap(file, `${ruleContext}.minCost`, rule.minCost, pointTypes, errors, warnings);
        validatePointMap(file, `${ruleContext}.maxCost`, rule.maxCost, pointTypes, errors, warnings);

        Object.keys(rule.minCost || {}).forEach(type => {
            const min = Number(rule.minCost[type]);
            const max = Number(rule.maxCost?.[type]);
            if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
                pushIssue(errors, file, `${ruleContext} has minCost greater than maxCost for "${type}".`);
            }
        });

        if (rule.priority !== undefined && !Number.isFinite(Number(rule.priority))) {
            pushIssue(errors, file, `${ruleContext}.priority must be numeric.`);
        }
        if (rule.minSelected !== undefined && (!Number.isInteger(Number(rule.minSelected)) || Number(rule.minSelected) < 1)) {
            pushIssue(errors, file, `${ruleContext}.minSelected must be a positive integer.`);
        }
    });
}

function validateAutoGrants(file, context, grants, optionIds, errors) {
    if (grants === undefined) return;
    if (!Array.isArray(grants)) {
        pushIssue(errors, file, `${context} must be an array.`);
        return;
    }
    grants.forEach((grant, index) => {
        const grantContext = `${context}[${index}]`;
        if (!grant || typeof grant !== "object" || Array.isArray(grant)) {
            pushIssue(errors, file, `${grantContext} must be an object.`);
            return;
        }
        const ids = [
            ...normalizeIdList(grant.targetIds),
            ...normalizeIdList(grant.targets),
            ...normalizeIdList(grant.targetId ? [grant.targetId] : []),
            ...normalizeIdList(grant.id ? [grant.id] : [])
        ];
        if (!ids.length) {
            pushIssue(errors, file, `${grantContext} must reference at least one granted option ID.`);
        }
        validateIdRefs(file, `${grantContext} target`, ids, optionIds, errors);
    });
}

function validateThemeSettings(file, settings, errors) {
    if (!settings) return;
    const mode = settings.themeMode;
    if (mode !== undefined && !["toggle", "light", "dark"].includes(mode)) {
        pushIssue(errors, file, `settings.themeMode must be "toggle", "light", or "dark".`);
    }
}

function validateCyoa(file) {
    const errors = [];
    const warnings = [];
    const filePath = path.join(CYOAS_DIR, file);
    let data;

    try {
        data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
        pushIssue(errors, file, `invalid JSON: ${err.message}`);
        return { errors, warnings };
    }

    if (!Array.isArray(data)) {
        pushIssue(errors, file, "root must be a JSON array.");
        return { errors, warnings };
    }

    const titleEntry = data.find(entry => entry.type === "title");
    if (!titleEntry || typeof titleEntry.text !== "string" || !titleEntry.text.trim()) {
        pushIssue(errors, file, "missing non-empty title entry.");
    }

    const pointsEntry = data.find(entry => entry.type === "points");
    if (!pointsEntry || typeof pointsEntry.values !== "object" || Array.isArray(pointsEntry.values)) {
        pushIssue(errors, file, "missing points entry with values map.");
    }
    const pointTypes = new Set(Object.keys(pointsEntry?.values || {}));
    Object.entries(pointsEntry?.values || {}).forEach(([type, value]) => {
        if (!Number.isFinite(Number(value))) {
            pushIssue(errors, file, `points.values.${type} must be numeric.`);
        }
    });

    validateThemeSettings(file, data.find(entry => entry.type === "settings"), errors);

    const options = collectOptions(data);
    const optionIds = new Set();
    options.forEach(({ option, path: optionPath }) => {
        if (!option || typeof option !== "object") {
            pushIssue(errors, file, `${optionPath} must be an object.`);
            return;
        }
        if (!option.id || typeof option.id !== "string") {
            pushIssue(errors, file, `${optionPath} missing string id.`);
            return;
        }
        if (optionIds.has(option.id)) {
            pushIssue(errors, file, `duplicate option ID "${option.id}".`);
        }
        optionIds.add(option.id);
    });

    options.forEach(({ option, path: optionPath }) => {
        if (!option || typeof option !== "object" || !option.id) return;
        const context = `${optionPath} (${option.id})`;

        validatePointMap(file, `${context}.cost`, option.cost || {}, pointTypes, errors, warnings);
        validateRequirementExpression(file, `${context}.prerequisites`, option.prerequisites, errors);
        validateIdRefs(file, `${context}.prerequisites`, extractRequirementIds(option.prerequisites), optionIds, errors);
        validateIdRefs(file, `${context}.conflictsWith`, normalizeIdList(option.conflictsWith), optionIds, errors);
        validateModifiedCostRules(file, `${context}.modifiedCosts`, option.modifiedCosts, optionIds, pointTypes, errors, warnings);
        validateModifiedCostRules(file, `${context}.discounts`, option.discounts, optionIds, pointTypes, errors, warnings);
        validateAutoGrants(file, `${context}.autoGrants`, option.autoGrants, optionIds, errors);
        validateAutoGrants(file, `${context}.discountGrants`, option.discountGrants, optionIds, errors);

        if (option.maxSelections !== undefined && Number(option.maxSelections) < 1) {
            pushIssue(errors, file, `${context}.maxSelections must be at least 1.`);
        }
        if (option.bypassSubcategoryMaxSelections !== undefined && typeof option.bypassSubcategoryMaxSelections !== "boolean") {
            pushIssue(errors, file, `${context}.bypassSubcategoryMaxSelections must be a boolean.`);
        }
    });

    collectSubcategories(data).forEach(({ subcat, path: subcatPath }) => {
        validatePointMap(file, `${subcatPath}.defaultCost`, subcat.defaultCost, pointTypes, errors, warnings);
        validatePointMap(file, `${subcatPath}.discountAmount`, subcat.discountAmount, pointTypes, errors, warnings);
        validateRequirementExpression(file, `${subcatPath}.requiresOption`, subcat.requiresOption, errors);
        validateIdRefs(file, `${subcatPath}.requiresOption`, extractRequirementIds(subcat.requiresOption), optionIds, errors);
        validateModifiedCostRules(file, `${subcatPath}.modifiedCosts`, subcat.modifiedCosts, optionIds, pointTypes, errors, warnings);
        validateModifiedCostRules(file, `${subcatPath}.discounts`, subcat.discounts, optionIds, pointTypes, errors, warnings);
        if (subcat.maxSelections !== undefined && Number(subcat.maxSelections) < 1) {
            pushIssue(errors, file, `${subcatPath}.maxSelections must be at least 1.`);
        }
    });

    const categories = data.filter(entry => !entry.type || entry.name);
    categories.forEach((category, index) => {
        const context = category.name || `category[${index}]`;
        validateRequirementExpression(file, `${context}.requiresOption`, category.requiresOption, errors);
        validateIdRefs(file, `${context}.requiresOption`, extractRequirementIds(category.requiresOption), optionIds, errors);
        validatePointMap(file, `${context}.discountAmount`, category.discountAmount, pointTypes, errors, warnings);
        if (category.maxSelections !== undefined && Number(category.maxSelections) < 1) {
            pushIssue(errors, file, `${context}.maxSelections must be at least 1.`);
        }
    });

    return { errors, warnings };
}

function main() {
    const files = readJsonFiles(CYOAS_DIR);
    const results = files.map(validateCyoa);
    const allErrors = results.flatMap(result => result.errors);
    const allWarnings = results.flatMap(result => result.warnings);

    if (allWarnings.length) {
        console.warn(`CYOA validation warnings (${allWarnings.length}):`);
        allWarnings.forEach(warning => console.warn(`- ${warning}`));
    }

    if (allErrors.length) {
        console.error(`CYOA validation failed with ${allErrors.length} issue(s):`);
        allErrors.forEach(error => console.error(`- ${error}`));
        process.exit(1);
    }

    console.log(`Validated ${files.length} CYOA fixture(s): ${files.join(", ")}.`);
}

main();
