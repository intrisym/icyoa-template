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

function extractRequirementScopes(requirement) {
    const scopes = [];
    const visit = value => {
        if (!value) return;
        if (typeof value === "string") {
            value.replace(getScopeRequirementPattern(), (_, scopeType, rawName) => {
                scopes.push({ type: scopeType, name: unquoteRequirementPointName(rawName) });
                return "";
            });
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (typeof value === "object") {
            visit(value.and);
            visit(value.or);
            visit(value.not);
        }
    };
    visit(requirement);
    return scopes;
}

function extractRequirementPointTypes(requirement) {
    const pointTypes = new Set();
    const visit = value => {
        if (!value) return;
        if (typeof value === "string") {
            value.replace(getPointRequirementPattern(), (_, rawName) => {
                pointTypes.add(unquoteRequirementPointName(rawName));
                return "";
            });
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (typeof value === "object") {
            visit(value.and);
            visit(value.or);
            visit(value.not);
        }
    };
    visit(requirement);
    return Array.from(pointTypes);
}

function extractExpressionIds(expr) {
    if (typeof expr !== "string") return [];
    const ids = new Set();
    const expressionWithoutPointRequirements = expr
        .replace(getPointRequirementPattern(), "")
        .replace(getScopeRequirementPattern(), "");
    const tokens = expressionWithoutPointRequirements.match(/!?[A-Za-z_][A-Za-z0-9_]*(?:__\d+)?/g) || [];
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
        evaluatePrereqExpr(requirement, () => 0, () => 0, () => false);
    } catch (err) {
        pushIssue(errors, file, `${context} has invalid prerequisite expression "${requirement}": ${err.message}`);
    }
}

function validatePointRequirementRefs(file, context, requirement, pointTypes, errors) {
    extractRequirementPointTypes(requirement).forEach(pointType => {
        if (!pointTypes.has(pointType)) {
            pushIssue(errors, file, `${context} references unknown point type "${pointType}".`);
        }
    });
}

function collectRequirementScopes(data) {
    const categoryNames = new Set();
    const subcategoryNames = new Set();
    const walk = (category, subcategories, path = []) => {
        if (!Array.isArray(subcategories)) return;
        subcategories.forEach((subcat, index) => {
            const nextPath = [...path, subcat?.name || `subcategory[${index}]`];
            if (subcat?.name) subcategoryNames.add(subcat.name);
            if (category?.name && nextPath.length) subcategoryNames.add([category.name, ...nextPath].join(" > "));
            walk(category, subcat?.subcategories, nextPath);
        });
    };
    data.filter(entry => !entry.type || entry.name).forEach((category, index) => {
        if (category?.name) categoryNames.add(category.name);
        else categoryNames.add(`category[${index}]`);
        walk(category, category?.subcategories);
    });
    return { categoryNames, subcategoryNames };
}

function validateScopeRequirementRefs(file, context, requirement, scopes, errors) {
    extractRequirementScopes(requirement).forEach(scope => {
        if (scope.type === "category" && !scopes.categoryNames.has(scope.name)) {
            pushIssue(errors, file, `${context} references unknown category "${scope.name}".`);
        }
        if (scope.type === "subcategory" && !scopes.subcategoryNames.has(scope.name)) {
            pushIssue(errors, file, `${context} references unknown subcategory "${scope.name}".`);
        }
    });
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
        validatePointMap(file, `${ruleContext}.costPercent`, rule.costPercent, pointTypes, errors, warnings);
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

function validateRandomTable(file, context, table, errors) {
    if (!table || typeof table !== "object" || Array.isArray(table)) {
        pushIssue(errors, file, `${context} must be an object.`);
        return;
    }
    if (table.label !== undefined && typeof table.label !== "string") {
        pushIssue(errors, file, `${context}.label must be a string.`);
    }
    const die = Number(table.die);
    if (!Number.isInteger(die) || die < 1) {
        pushIssue(errors, file, `${context}.die must be a positive integer.`);
    }
    if (!Array.isArray(table.outcomes) || !table.outcomes.length) {
        pushIssue(errors, file, `${context}.outcomes must be a non-empty array.`);
        return;
    }
    table.outcomes.forEach((outcome, index) => {
        const outcomeContext = `${context}.outcomes[${index}]`;
        if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) {
            pushIssue(errors, file, `${outcomeContext} must be an object.`);
            return;
        }
        const min = Number(outcome.min);
        const max = Number(outcome.max);
        if (!Number.isInteger(min)) {
            pushIssue(errors, file, `${outcomeContext}.min must be an integer.`);
        }
        if (!Number.isInteger(max)) {
            pushIssue(errors, file, `${outcomeContext}.max must be an integer.`);
        }
        if (Number.isInteger(min) && Number.isInteger(max) && min > max) {
            pushIssue(errors, file, `${outcomeContext}.min must be less than or equal to max.`);
        }
        if (typeof outcome.label !== "string" || !outcome.label.trim()) {
            pushIssue(errors, file, `${outcomeContext}.label must be a non-empty string.`);
        }
        if (outcome.table !== undefined) {
            validateRandomTable(file, `${outcomeContext}.table`, outcome.table, errors);
        }
    });
}

function validateRandomTables(file, context, tables, errors) {
    if (tables === undefined) return;
    if (!Array.isArray(tables)) {
        pushIssue(errors, file, `${context}.randomTables must be an array.`);
        return;
    }
    tables.forEach((table, index) => validateRandomTable(file, `${context}.randomTables[${index}]`, table, errors));
}

function validateCostOptions(file, context, costOptions, pointTypes, errors, warnings, optionIds = null, scopes = null) {
    if (costOptions === undefined) return;
    if (!Array.isArray(costOptions)) {
        pushIssue(errors, file, `${context}.costOptions must be an array.`);
        return;
    }
    costOptions.forEach((costOption, index) => {
        const optionContext = `${context}.costOptions[${index}]`;
        if (!costOption || typeof costOption !== "object" || Array.isArray(costOption)) {
            pushIssue(errors, file, `${optionContext} must be an object.`);
            return;
        }
        if (costOption.label !== undefined && typeof costOption.label !== "string") {
            pushIssue(errors, file, `${optionContext}.label must be a string.`);
        }
        if (costOption.minSelected !== undefined) {
            const minSelected = Number(costOption.minSelected);
            if (!Number.isInteger(minSelected) || minSelected < 0) {
                pushIssue(errors, file, `${optionContext}.minSelected must be a non-negative integer.`);
            }
        }
        if (costOption.maxSelections !== undefined) {
            const maxSelections = Number(costOption.maxSelections);
            if (!Number.isInteger(maxSelections) || maxSelections < 0) {
                pushIssue(errors, file, `${optionContext}.maxSelections must be a non-negative integer.`);
            }
        }
        if (costOption.requiresCostOption !== undefined) {
            const requiredIndex = Number(costOption.requiresCostOption);
            if (!Number.isInteger(requiredIndex) || requiredIndex < 0 || requiredIndex >= costOptions.length) {
                pushIssue(errors, file, `${optionContext}.requiresCostOption must reference another cost option index.`);
            } else if (requiredIndex === index) {
                pushIssue(errors, file, `${optionContext}.requiresCostOption cannot reference itself.`);
            }
        }
        validateRequirementExpression(file, `${optionContext}.prerequisites`, costOption.prerequisites, errors);
        validatePointRequirementRefs(file, `${optionContext}.prerequisites`, costOption.prerequisites, pointTypes, errors);
        if (scopes) validateScopeRequirementRefs(file, `${optionContext}.prerequisites`, costOption.prerequisites, scopes, errors);
        if (optionIds) {
            validateIdRefs(file, `${optionContext}.prerequisites`, extractRequirementIds(costOption.prerequisites), optionIds, errors);
        }
        validatePointMap(file, `${optionContext}.cost`, costOption.cost || {}, pointTypes, errors, warnings);
        if (costOption.costBySelection !== undefined) {
            if (!Array.isArray(costOption.costBySelection)) {
                pushIssue(errors, file, `${optionContext}.costBySelection must be an array.`);
            } else {
                costOption.costBySelection.forEach((tierCost, tierIndex) => {
                    validatePointMap(file, `${optionContext}.costBySelection[${tierIndex}]`, tierCost || {}, pointTypes, errors, warnings);
                });
            }
        }
    });
}

function validatePointAllocation(file, context, allocation, pointTypes, errors) {
    if (allocation === undefined) return;
    if (!allocation || typeof allocation !== "object" || Array.isArray(allocation)) {
        pushIssue(errors, file, `${context}.pointAllocation must be an object.`);
        return;
    }
    const total = Number(allocation.total);
    if (!Number.isInteger(total) || total < 1) {
        pushIssue(errors, file, `${context}.pointAllocation.total must be a positive integer.`);
    }
    if (!Array.isArray(allocation.types) || allocation.types.length < 2) {
        pushIssue(errors, file, `${context}.pointAllocation.types must include at least two point types.`);
        return;
    }
    allocation.types.forEach(type => {
        if (typeof type !== "string" || !type.trim()) {
            pushIssue(errors, file, `${context}.pointAllocation.types includes an invalid point type.`);
        } else if (!pointTypes.has(type)) {
            pushIssue(errors, file, `${context}.pointAllocation references unknown point type "${type}".`);
        }
    });
}

function validateSliderModifiers(file, context, effects, pointTypes, errors, fieldName = "sliderModifiers") {
    if (effects === undefined) return;
    if (!Array.isArray(effects)) {
        pushIssue(errors, file, `${context}.${fieldName} must be an array.`);
        return;
    }
    effects.forEach((effect, index) => {
        const effectContext = `${context}.${fieldName}[${index}]`;
        if (!effect || typeof effect !== "object" || Array.isArray(effect)) {
            pushIssue(errors, file, `${effectContext} must be an object.`);
            return;
        }
        if (!["multiply", "cap", "add", "subtract"].includes(effect.type)) {
            pushIssue(errors, file, `${effectContext}.type must be "multiply", "cap", "add", or "subtract".`);
        }
        const selectable = effect.selectable === true || !effect.attribute;
        if (!selectable && (typeof effect.attribute !== "string" || !pointTypes.has(effect.attribute))) {
            pushIssue(errors, file, `${effectContext}.attribute references unknown point type "${effect.attribute}".`);
        }
        const rawValue = effect.type === "multiply" ? effect.multiplier : effect.value;
        if (!Number.isFinite(Number(rawValue))) {
            pushIssue(errors, file, `${effectContext}.${effect.type === "multiply" ? "multiplier" : "value"} must be numeric.`);
        }
        if (effect.retroactive !== undefined && typeof effect.retroactive !== "boolean") {
            pushIssue(errors, file, `${effectContext}.retroactive must be a boolean.`);
        }
        if (effect.choices !== undefined) {
            if (!Array.isArray(effect.choices)) {
                pushIssue(errors, file, `${effectContext}.choices must be an array when present.`);
            } else {
                effect.choices.forEach(choice => {
                    if (typeof choice !== "string" || !pointTypes.has(choice)) {
                        pushIssue(errors, file, `${effectContext}.choices references unknown point type "${choice}".`);
                    }
                });
            }
        }
    });
}

function validateThemeSettings(file, settings, errors) {
    if (!settings) return;
    const mode = settings.themeMode;
    if (mode !== undefined && !["toggle", "light", "dark"].includes(mode)) {
        pushIssue(errors, file, `settings.themeMode must be "toggle", "light", or "dark".`);
    }
    validateAlignmentValue(file, "settings.optionAlignment", settings.optionAlignment, errors);
    validateAlignmentValue(file, "settings.optionTitleAlignment", settings.optionTitleAlignment, errors);
    validateAlignmentValue(file, "settings.optionMetaAlignment", settings.optionMetaAlignment, errors);
    validateAlignmentValue(file, "settings.optionDescriptionAlignment", settings.optionDescriptionAlignment, errors);
}

function validateAlignmentValue(file, context, value, errors) {
    if (value === undefined) return;
    if (typeof value !== "string" || !["left", "center", "right", "justify"].includes(value)) {
        pushIssue(errors, file, `${context} must be "left", "center", "right", or "justify".`);
    }
}

function isSafeColorValue(value = "") {
    const color = String(value).trim();
    return /^#[0-9a-f]{3,8}$/i.test(color)
        || /^rgba?\(\s*(\d{1,3}%?\s*,\s*){2}\d{1,3}%?(\s*,\s*(0|1|0?\.\d+|[1-9]\d*%))?\s*\)$/i.test(color)
        || /^hsla?\(\s*-?\d+(\.\d+)?(deg|rad|turn)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(\s*,\s*(0|1|0?\.\d+|[1-9]\d*%))?\s*\)$/i.test(color)
        || /^[a-z]+$/i.test(color);
}

function validateOptionalColor(file, context, value, errors) {
    if (value === undefined) return;
    if (typeof value !== "string" || !isSafeColorValue(value)) {
        pushIssue(errors, file, `${context} must be a safe CSS color string.`);
    }
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

function validateDerivedValues(file, pointsEntry, pointTypes, optionIds, errors) {
    if (pointsEntry?.derivedValues === undefined) return;
    if (!Array.isArray(pointsEntry.derivedValues)) {
        pushIssue(errors, file, "points.derivedValues must be an array.");
        return;
    }
    const validateFormula = (context, formula) => {
        try {
            evaluateDerivedFormula(
                formula,
                pointType => {
                    if (!pointTypes.has(pointType)) throw new Error(`Unknown point type "${pointType}"`);
                    return 0;
                },
                optionId => {
                    if (!optionIds.has(optionId)) throw new Error(`Unknown selected option ID "${optionId}"`);
                    return 0;
                }
            );
        } catch (err) {
            pushIssue(errors, file, `${context} is invalid: ${err.message}`);
        }
    };
    pointsEntry.derivedValues.forEach((entry, index) => {
        const context = `points.derivedValues[${index}]`;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            pushIssue(errors, file, `${context} must be an object.`);
            return;
        }
        if (typeof entry.pointType !== "string" || !pointTypes.has(entry.pointType)) {
            pushIssue(errors, file, `${context}.pointType references unknown point type "${entry.pointType}".`);
        }
        if (typeof entry.formula !== "string" || !entry.formula.trim()) {
            pushIssue(errors, file, `${context}.formula must be a non-empty string.`);
            return;
        }
        if (entry.round !== undefined && !["none", "floor", "ceil", "round"].includes(entry.round)) {
            pushIssue(errors, file, `${context}.round must be one of none, floor, ceil, or round.`);
        }
        ["min", "max"].forEach(key => {
            if (entry[key] !== undefined) {
                if (typeof entry[key] !== "string" && !Number.isFinite(Number(entry[key]))) {
                    pushIssue(errors, file, `${context}.${key} must be a number or formula string when present.`);
                    return;
                }
                if (typeof entry[key] === "string" && !entry[key].trim()) {
                    pushIssue(errors, file, `${context}.${key} must not be blank when present.`);
                    return;
                }
                validateFormula(`${context}.${key}`, String(entry[key]));
            }
        });
        validateFormula(`${context}.formula`, entry.formula);
    });
}

function validateEnableablePointSets(file, pointsEntry, pointTypes, optionIds, errors) {
    if (pointsEntry?.enableablePointSets === undefined) return;
    if (!Array.isArray(pointsEntry.enableablePointSets)) {
        pushIssue(errors, file, "points.enableablePointSets must be an array.");
        return;
    }
    const assignedSubtypes = new Set();
    pointsEntry.enableablePointSets.forEach((set, index) => {
        const context = `points.enableablePointSets[${index}]`;
        if (!set || typeof set !== "object" || Array.isArray(set)) {
            pushIssue(errors, file, `${context} must be an object.`);
            return;
        }
        if (typeof set.pointType !== "string" || !set.pointType.trim()) {
            pushIssue(errors, file, `${context}.pointType must be a non-empty parent point type.`);
        } else if (!pointTypes.has(set.pointType)) {
            pushIssue(errors, file, `${context}.pointType references unknown point type "${set.pointType}".`);
        }
        if (!Array.isArray(set.subtypes) || !set.subtypes.length) {
            pushIssue(errors, file, `${context}.subtypes must include at least one sub-point type.`);
        } else {
            set.subtypes.forEach((type, subtypeIndex) => {
                const subtypeContext = `${context}.subtypes[${subtypeIndex}]`;
                if (typeof type !== "string" || !pointTypes.has(type)) {
                    pushIssue(errors, file, `${subtypeContext} references unknown point type "${type}".`);
                } else if (type === set.pointType) {
                    pushIssue(errors, file, `${subtypeContext} cannot include its parent point type "${type}".`);
                } else if (assignedSubtypes.has(type)) {
                    pushIssue(errors, file, `${subtypeContext} assigns point type "${type}" to more than one enableable point set.`);
                } else {
                    assignedSubtypes.add(type);
                }
            });
        }
        if (set.expandedByDefault !== undefined && typeof set.expandedByDefault !== "boolean") {
            pushIssue(errors, file, `${context}.expandedByDefault must be a boolean when present.`);
        }
        const limitFormula = String(set.limitFormula ?? set.limit ?? "").trim();
        if (!limitFormula) {
            pushIssue(errors, file, `${context}.limitFormula must be a non-empty formula string.`);
            return;
        }
        try {
            evaluateDerivedFormula(
                limitFormula,
                pointType => {
                    if (!pointTypes.has(pointType)) throw new Error(`Unknown point type "${pointType}"`);
                    return 0;
                },
                optionId => {
                    if (!optionIds.has(optionId)) throw new Error(`Unknown selected option ID "${optionId}"`);
                    return 0;
                }
            );
        } catch (err) {
            pushIssue(errors, file, `${context}.limitFormula is invalid: ${err.message}`);
        }
    });
}

function validateCyoaData(file, data) {
    const errors = [];
    const warnings = [];

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
    if (pointsEntry?.pointTooltips !== undefined) {
        if (!pointsEntry.pointTooltips || typeof pointsEntry.pointTooltips !== "object" || Array.isArray(pointsEntry.pointTooltips)) {
            pushIssue(errors, file, "points.pointTooltips must be an object map of point type names to tooltip strings.");
        } else {
            Object.entries(pointsEntry.pointTooltips).forEach(([type, tooltip]) => {
                if (!pointTypes.has(type)) {
                    pushIssue(errors, file, `points.pointTooltips references unknown point type "${type}".`);
                }
                if (typeof tooltip !== "string") {
                    pushIssue(errors, file, `points.pointTooltips.${type} must be a string.`);
                }
            });
        }
    }
    if (pointsEntry?.pointCategories !== undefined) {
        if (!pointsEntry.pointCategories || typeof pointsEntry.pointCategories !== "object" || Array.isArray(pointsEntry.pointCategories)) {
            pushIssue(errors, file, "points.pointCategories must be an object map of category names to point type arrays.");
        } else {
            const categoryNames = new Set();
            const categorizedPointTypes = new Set();
            Object.entries(pointsEntry.pointCategories).forEach(([category, types]) => {
                if (!String(category).trim()) {
                    pushIssue(errors, file, "points.pointCategories includes an empty category name.");
                } else {
                    categoryNames.add(category);
                }
                if (!Array.isArray(types)) {
                    pushIssue(errors, file, `points.pointCategories.${category} must be an array of point types.`);
                    return;
                }
                types.forEach(type => {
                    if (typeof type !== "string" || !pointTypes.has(type)) {
                        pushIssue(errors, file, `points.pointCategories.${category} references unknown point type "${type}".`);
                    } else if (categorizedPointTypes.has(type)) {
                        pushIssue(errors, file, `points.pointCategories assigns point type "${type}" to more than one category.`);
                    } else {
                        categorizedPointTypes.add(type);
                    }
                });
            });
            if (pointsEntry?.pointCategoryDefaults !== undefined) {
                if (!pointsEntry.pointCategoryDefaults || typeof pointsEntry.pointCategoryDefaults !== "object" || Array.isArray(pointsEntry.pointCategoryDefaults)) {
                    pushIssue(errors, file, "points.pointCategoryDefaults must be an object map of category names to booleans.");
                } else {
                    Object.entries(pointsEntry.pointCategoryDefaults).forEach(([category, isVisible]) => {
                        if (!categoryNames.has(category) && category !== "Uncategorized") {
                            pushIssue(errors, file, `points.pointCategoryDefaults references unknown point category "${category}".`);
                        }
                        if (typeof isVisible !== "boolean") {
                            pushIssue(errors, file, `points.pointCategoryDefaults.${category} must be a boolean.`);
                        }
                    });
                }
            }
        }
    }

    validateThemeSettings(file, data.find(entry => entry.type === "settings"), errors);

    const options = collectOptions(data);
    const requirementScopes = collectRequirementScopes(data);
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

    validateDerivedValues(file, pointsEntry, pointTypes, optionIds, errors);
    validateEnableablePointSets(file, pointsEntry, pointTypes, optionIds, errors);

    options.forEach(({ option, path: optionPath }) => {
        if (!option || typeof option !== "object" || !option.id) return;
        const context = `${optionPath} (${option.id})`;

        validatePointMap(file, `${context}.cost`, option.cost || {}, pointTypes, errors, warnings);
        validateCostOptions(file, context, option.costOptions, pointTypes, errors, warnings, optionIds, requirementScopes);
        validatePointAllocation(file, context, option.pointAllocation, pointTypes, errors);
        validateSliderModifiers(file, context, option.sliderModifiers, pointTypes, errors);
        validateSliderModifiers(file, context, option.attributeEffects, pointTypes, errors, "attributeEffects");
        validateRandomTables(file, context, option.randomTables, errors);
        validateAlignmentValue(file, `${context}.alignment`, option.alignment, errors);
        validateAlignmentValue(file, `${context}.titleAlignment`, option.titleAlignment, errors);
        validateAlignmentValue(file, `${context}.metaAlignment`, option.metaAlignment, errors);
        validateAlignmentValue(file, `${context}.descriptionAlignment`, option.descriptionAlignment, errors);
        validateOptionalColor(file, `${context}.borderColor`, option.borderColor, errors);
        validateOptionalColor(file, `${context}.darkBorderColor`, option.darkBorderColor, errors);
        validateRequirementExpression(file, `${context}.prerequisites`, option.prerequisites, errors);
        validatePointRequirementRefs(file, `${context}.prerequisites`, option.prerequisites, pointTypes, errors);
        validateScopeRequirementRefs(file, `${context}.prerequisites`, option.prerequisites, requirementScopes, errors);
        validateIdRefs(file, `${context}.prerequisites`, extractRequirementIds(option.prerequisites), optionIds, errors);
        (option.prerequisitesBySelection || []).forEach((requirement, index) => {
            validateRequirementExpression(file, `${context}.prerequisitesBySelection[${index}]`, requirement, errors);
            validatePointRequirementRefs(file, `${context}.prerequisitesBySelection[${index}]`, requirement, pointTypes, errors);
            validateScopeRequirementRefs(file, `${context}.prerequisitesBySelection[${index}]`, requirement, requirementScopes, errors);
            validateIdRefs(file, `${context}.prerequisitesBySelection[${index}]`, extractRequirementIds(requirement), optionIds, errors);
        });
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
        if (option.lockSelection !== undefined && typeof option.lockSelection !== "boolean") {
            pushIssue(errors, file, `${context}.lockSelection must be a boolean.`);
        }
        if (option.cannotDeselect !== undefined && typeof option.cannotDeselect !== "boolean") {
            pushIssue(errors, file, `${context}.cannotDeselect must be a boolean.`);
        }
    });

    collectSubcategories(data).forEach(({ subcat, path: subcatPath }) => {
        if (subcat.defaultCost !== undefined) {
            pushIssue(errors, file, `${subcatPath}.defaultCost is no longer supported; use costOptions instead.`);
        }
        if (subcat.mergeDefaultCostOptions !== undefined && typeof subcat.mergeDefaultCostOptions !== "boolean") {
            pushIssue(errors, file, `${subcatPath}.mergeDefaultCostOptions must be boolean when present.`);
        }
        validateCostOptions(file, subcatPath, subcat.costOptions, pointTypes, errors, warnings, optionIds, requirementScopes);
        validatePointMap(file, `${subcatPath}.discountAmount`, subcat.discountAmount, pointTypes, errors, warnings);
        validateRequirementExpression(file, `${subcatPath}.requiresOption`, subcat.requiresOption, errors);
        validatePointRequirementRefs(file, `${subcatPath}.requiresOption`, subcat.requiresOption, pointTypes, errors);
        validateScopeRequirementRefs(file, `${subcatPath}.requiresOption`, subcat.requiresOption, requirementScopes, errors);
        validateIdRefs(file, `${subcatPath}.requiresOption`, extractRequirementIds(subcat.requiresOption), optionIds, errors);
        validateModifiedCostRules(file, `${subcatPath}.modifiedCosts`, subcat.modifiedCosts, optionIds, pointTypes, errors, warnings);
        validateModifiedCostRules(file, `${subcatPath}.discounts`, subcat.discounts, optionIds, pointTypes, errors, warnings);
        if (subcat.maxSelections !== undefined && Number(subcat.maxSelections) < 1) {
            pushIssue(errors, file, `${subcatPath}.maxSelections must be at least 1.`);
        }
        if (subcat.defaultOptionMaxSelections !== undefined && Number(subcat.defaultOptionMaxSelections) < 1) {
            pushIssue(errors, file, `${subcatPath}.defaultOptionMaxSelections must be at least 1.`);
        }
    });

    const categories = data.filter(entry => !entry.type || entry.name);
    categories.forEach((category, index) => {
        const context = category.name || `category[${index}]`;
        validateRequirementExpression(file, `${context}.requiresOption`, category.requiresOption, errors);
        validatePointRequirementRefs(file, `${context}.requiresOption`, category.requiresOption, pointTypes, errors);
        validateScopeRequirementRefs(file, `${context}.requiresOption`, category.requiresOption, requirementScopes, errors);
        validateIdRefs(file, `${context}.requiresOption`, extractRequirementIds(category.requiresOption), optionIds, errors);
        validatePointMap(file, `${context}.discountAmount`, category.discountAmount, pointTypes, errors, warnings);
        if (category.maxSelections !== undefined && Number(category.maxSelections) < 1) {
            pushIssue(errors, file, `${context}.maxSelections must be at least 1.`);
        }
    });

    return { errors, warnings };
}

function validateCyoa(file) {
    const filePath = path.join(CYOAS_DIR, file);
    let data;

    try {
        data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
        return { errors: [`${file}: invalid JSON: ${err.message}`], warnings: [] };
    }

    return validateCyoaData(file, data);
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

if (require.main === module) {
    main();
}

module.exports = {
    validateCyoaData,
    validateCyoa,
    extractRequirementIds
};
