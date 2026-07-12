// Minimal safe logical expression evaluator for prerequisites
// Supports: &&, ||, parentheses, variable names (option IDs), point thresholds,
// scope predicates like category("Powers") or subcategory("Powers > Flight"),
// and option group predicates like group("martialClasses").
// Point thresholds use point type names directly, e.g. Strength >= 13 or "Caster Level" >= 5.
// Usage: evaluatePrereqExpr(expr, optionLookupFn, pointLookupFn, scopeLookupFn, groupLookupFn)

function unquotePointName(rawName = "") {
    const text = String(rawName).trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        return text.slice(1, -1).replace(/\\(["'\\])/g, "$1");
    }
    return text;
}

function comparePointValue(actualValue, operator, requiredValue) {
    const actual = Number(actualValue) || 0;
    const required = Number(requiredValue);
    if (!Number.isFinite(required)) return false;
    if (operator === ">=") return actual >= required;
    if (operator === ">") return actual > required;
    if (operator === "<=") return actual <= required;
    if (operator === "<") return actual < required;
    return actual === required;
}

function evaluatePrereqExpr(expr, lookupFn, pointLookupFn = () => 0, scopeLookupFn = () => false, groupLookupFn = () => 0) {
    if (typeof expr !== 'string') {
        throw new Error('Prerequisite expression must be a string');
    }

    const pointNamePattern = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[a-zA-Z_][a-zA-Z0-9_]*)`;
    const quotedNamePattern = String.raw`("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`;
    const scopePattern = new RegExp(`\\b(category|subcategory)\\s*\\(\\s*${quotedNamePattern}\\s*\\)`, "g");
    const groupPattern = new RegExp(`\\bgroup\\s*\\(\\s*${quotedNamePattern}\\s*\\)`, "g");
    const comparisonPattern = new RegExp(`(${pointNamePattern})\\s*(>=|<=|>|<|==|=)\\s*(-?\\d+(?:\\.\\d+)?)`, "g");
    const shorthandPattern = new RegExp(`(${pointNamePattern})\\s+(-?\\d+(?:\\.\\d+)?)\\+`, "g");

    const withGroupPredicates = expr.replace(groupPattern, (_, rawName) => {
        const result = Number(groupLookupFn(unquotePointName(rawName)) || 0) > 0;
        return result ? "true" : "false";
    });

    const withScopePredicates = withGroupPredicates.replace(scopePattern, (_, scopeType, rawName) => {
        const result = !!scopeLookupFn(scopeType, unquotePointName(rawName));
        return result ? "true" : "false";
    });

    const withPointComparisons = withScopePredicates
        .replace(comparisonPattern, (_, rawName, operator, rawValue) => {
            const result = comparePointValue(pointLookupFn(unquotePointName(rawName)), operator, rawValue);
            return result ? "true" : "false";
        })
        .replace(shorthandPattern, (_, rawName, rawValue) => {
            const result = comparePointValue(pointLookupFn(unquotePointName(rawName)), ">=", rawValue);
            return result ? "true" : "false";
        });

    const replaced = withPointComparisons.replace(/!?[a-zA-Z_][a-zA-Z0-9_]*(?:__\d+)?/g, (token) => {
        if (token === "true" || token === "false") return token;
        const isNegated = token.startsWith('!');
        const core = isNegated ? token.slice(1) : token;

        const [id, minSuffix] = core.split('__');
        const rawValue = lookupFn(id);
        const numericValue = Number(rawValue) || 0;
        const meetsCount = minSuffix ? numericValue >= Number(minSuffix) : numericValue > 0;
        const result = isNegated ? !meetsCount : meetsCount;
        return result ? 'true' : 'false';
    });

    if (/[^truefals()&|! \t]/.test(replaced.replace(/true|false/g, ''))) {
        throw new Error('Unsafe characters in prerequisite expression');
    }
    // Evaluate using Function constructor (safe after replacement)
    // eslint-disable-next-line no-new-func
    return Function('return (' + replaced + ')')();
}

// Export for browser
if (typeof window !== 'undefined') {
    window.evaluatePrereqExpr = evaluatePrereqExpr;
}

// Export for Node/CommonJS (useful for testing)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        evaluatePrereqExpr
    };
}
