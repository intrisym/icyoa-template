(function (root) {
    const quoted = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`;
    const identifier = String.raw`[A-Za-z_][A-Za-z0-9_]*`;
    const name = `(?:${quoted}|${identifier})`;
    const scope = String.raw`\b(?:category|subcategory|group)\s*\(\s*${quoted}\s*\)(?:\s*(?:>=|<=|==|=|>|<)\s*-?\d+(?:\.\d+)?)?`;
    const threshold = String.raw`${name}\s*(?:(?:>=|<=|==|=|>|<)\s*-?\d+(?:\.\d+)?|\s+-?\d+(?:\.\d+)?\+)`;

    function replaceId(value, changes) {
        if (typeof value !== "string") return value;
        if (changes.has(value)) return changes.get(value);
        const count = value.match(/^(.*)(__\d+)$/);
        return count && changes.has(count[1]) ? changes.get(count[1]) + count[2] : value;
    }

    function rewriteRequirement(value, changes, scopeChanges = []) {
        if (typeof value === "string") {
            const tokens = new RegExp(`${scope}|${threshold}|${quoted}|${identifier}`, "g");
            return value.replace(tokens, token => {
                if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) return replaceId(token, changes);
                const predicate = token.match(new RegExp(String.raw`^(category|subcategory)\s*\(\s*(${quoted})\s*\)`));
                if (!predicate) return token;
                const originalName = predicate[2].slice(1, -1).replace(/\\(.)/g, "$1");
                const change = scopeChanges.find(entry => entry.kind === predicate[1]
                    && (entry.before === originalName || predicate[1] === "subcategory" && originalName.startsWith(entry.before + " > ")));
                if (!change) return token;
                const nextName = change.after + originalName.slice(change.before.length);
                return token.replace(predicate[2], JSON.stringify(nextName));
            });
        }
        if (Array.isArray(value)) return value.map(item => rewriteRequirement(item, changes, scopeChanges));
        if (value && typeof value === "object") {
            const result = { ...value };
            for (const key of ["and", "or", "not", "all", "any", "none"]) {
                if (Object.prototype.hasOwnProperty.call(result, key)) result[key] = rewriteRequirement(result[key], changes, scopeChanges);
            }
            return result;
        }
        return value;
    }

    function rewriteFormula(value, changes) {
        if (typeof value !== "string") return value;
        const tokens = new RegExp(String.raw`\bselected\s*\(\s*(${quoted})\s*\)|${quoted}`, "g");
        return value.replace(tokens, (token, argument) => {
            if (!argument) return token;
            const oldId = argument.slice(1, -1).replace(/\\(.)/g, "$1");
            if (!changes.has(oldId)) return token;
            return token.replace(argument, argument[0] + changes.get(oldId) + argument[0]);
        });
    }

    function visitNodes(data, visit) {
        const walk = node => {
            if (!node || typeof node !== "object") return;
            visit(node);
            for (const key of ["options", "subcategories", "costOptions"]) {
                if (Array.isArray(node[key])) node[key].forEach(walk);
            }
        };
        data.forEach(walk);
    }

    function updateReferences(data, changes, scopeChanges = []) {
        const updateList = value => Array.isArray(value) ? value.map(item => replaceId(item, changes)) : replaceId(value, changes);
        visitNodes(data, node => {
            for (const key of ["prerequisites", "prerequisitesBySelection", "requiresOption", "discountRequires"]) {
                if (Object.prototype.hasOwnProperty.call(node, key)) node[key] = rewriteRequirement(node[key], changes, scopeChanges);
            }
            if (node.conflictsWith !== undefined) node.conflictsWith = updateList(node.conflictsWith);
            for (const key of ["modifiedCosts", "discounts"]) {
                for (const rule of node[key] || []) {
                    for (const field of ["id", "ids", "idsAny"]) {
                        if (rule[field] !== undefined) rule[field] = updateList(rule[field]);
                    }
                }
            }
            for (const key of ["autoGrants", "discountGrants"]) {
                for (const grant of node[key] || []) {
                    for (const field of ["id", "targetId", "targetIds", "targets"]) {
                        if (grant[field] !== undefined) grant[field] = updateList(grant[field]);
                    }
                }
            }
            if (node.type === "points") {
                for (const group of node.optionGroups || []) group.optionIds = updateList(group.optionIds);
                for (const derived of node.derivedValues || []) {
                    for (const field of ["formula", "min", "max"]) {
                        if (derived[field] !== undefined) derived[field] = rewriteFormula(derived[field], changes);
                    }
                }
                for (const set of node.enableablePointSets || []) {
                    if (set.limitFormula !== undefined) set.limitFormula = rewriteFormula(set.limitFormula, changes);
                }
            }
        });
    }

    function regenerate(data, targets, getBaseId, scopeChanges = []) {
        if (data.some(entry => entry?.type === "publication" && entry.status === "published")) return new Map();
        const targetOptions = new Set(targets.map(target => target.option));
        const used = new Set();
        visitNodes(data, node => {
            for (const option of node.options || []) {
                if (option.id && !targetOptions.has(option)) used.add(option.id);
            }
            if (node.type === "points") {
                for (const group of node.optionGroups || []) if (group.id) used.add(group.id);
            }
        });
        const changes = new Map();
        const assignments = targets.map(({ option, path }) => {
            const base = getBaseId(option, path);
            let nextId = base;
            let suffix = 1;
            while (used.has(nextId)) nextId = `${base}${++suffix}`;
            used.add(nextId);
            if (option.id && option.id !== nextId) changes.set(option.id, nextId);
            return { option, nextId };
        });
        assignments.forEach(({ option, nextId }) => { option.id = nextId; });
        updateReferences(data, changes, scopeChanges);
        return changes;
    }

    const api = { rewriteRequirement, rewriteFormula, updateReferences, regenerate };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.CyoaOptionIds = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
