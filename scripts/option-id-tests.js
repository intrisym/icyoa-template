const test = require("node:test");
const assert = require("node:assert/strict");
const { regenerate, rewriteRequirement, rewriteFormula } = require("../optionIds");
const { validateCyoaData } = require("./validate-cyoas");

test("requirements rename exact IDs and count suffixes without changing point names or prose", () => {
    const changes = new Map([["old", "newId"]]);
    assert.equal(rewriteRequirement("old && !old__2 || oldExtra", changes), "newId && !newId__2 || oldExtra");
    assert.equal(rewriteRequirement('old && old >= 2 && "old" 3+ && group("old") >= 2 && category("old")', changes),
        'newId && old >= 2 && "old" 3+ && group("old") >= 2 && category("old")');
    assert.deepEqual(rewriteRequirement({ and: ["old", { not: "old__3" }], or: "old", all: ["old"], any: "old", none: ["old"] }, changes),
        { and: ["newId", { not: "newId__3" }], or: "newId", all: ["newId"], any: "newId", none: ["newId"] });
});

test("formula renaming changes selected option arguments while preserving point types", () => {
    const changes = new Map([["old", "newId"]]);
    assert.equal(rewriteFormula('old + selected("old") + selected(\'old\') + "old"', changes),
        'old + selected("newId") + selected(\'newId\') + "old"');
    assert.equal(rewriteFormula('"selected(\'old\')" + 1', changes), '"selected(\'old\')" + 1');
});

test("a rename updates every supported option reference across the current CYOA", () => {
    const source = { id: "old", label: "Speed", cost: { Points: 1 } };
    const target = {
        id: "dependent", label: "Upgrade", description: "old is mentioned in prose", image: "https://example.com/old.png",
        prerequisites: { and: ["old", { not: "old__2" }] }, prerequisitesBySelection: ["old"],
        conflictsWith: ["old"], discountRequires: { all: ["old"], none: ["old__2"] },
        costOptions: [{ cost: { Points: 2 }, prerequisites: "old" }],
        modifiedCosts: [{ id: "old", ids: ["old"], idsAny: ["old"], cost: { Points: 0 } }],
        discounts: [{ ids: ["old"], cost: { Points: 0 } }],
        autoGrants: [{ id: "old", targetId: "old", targetIds: ["old"], targets: ["old"] }],
        discountGrants: [{ targetIds: ["old"], discountAmount: { Points: 1 } }]
    };
    const subcategory = { name: "Physical", requiresOption: "old", options: [source, target],
        costOptions: [{ cost: { Points: 1 }, prerequisites: "old" }],
        modifiedCosts: [{ ids: ["old"], cost: { Points: 0 } }] };
    const points = { type: "points", values: { Points: 10 },
        optionGroups: [{ id: "groupA", label: "Group", optionIds: ["old"] }],
        derivedValues: [{ pointType: "Points", formula: 'selected("old")', min: 'selected("old")', max: 'selected("old") + 10' }],
        enableablePointSets: [{ id: "setA", limitFormula: 'selected("old")' }] };
    const category = { name: "Weapons", requiresOption: "old", subcategories: [subcategory] };
    const data = [points, category];
    regenerate(data, [{ option: source, path: ["Weapons", "Athletics"] }], () => "weaponsAthleticsSpeed");
    const nextId = "weaponsAthleticsSpeed";
    assert.equal(source.id, nextId);
    assert.equal(category.requiresOption, nextId);
    assert.equal(subcategory.requiresOption, nextId);
    assert.equal(subcategory.costOptions[0].prerequisites, nextId);
    assert.deepEqual(target.prerequisites, { and: [nextId, { not: nextId + "__2" }] });
    assert.deepEqual(target.prerequisitesBySelection, [nextId]);
    assert.deepEqual(target.conflictsWith, [nextId]);
    assert.deepEqual(target.discountRequires, { all: [nextId], none: [nextId + "__2"] });
    assert.equal(target.costOptions[0].prerequisites, nextId);
    for (const rule of [target.modifiedCosts[0], target.discounts[0], subcategory.modifiedCosts[0]]) {
        assert.deepEqual(rule.ids, [nextId]);
    }
    assert.equal(target.modifiedCosts[0].id, nextId);
    assert.deepEqual(target.modifiedCosts[0].idsAny, [nextId]);
    assert.deepEqual(target.autoGrants[0], { id: nextId, targetId: nextId, targetIds: [nextId], targets: [nextId] });
    assert.deepEqual(target.discountGrants[0].targetIds, [nextId]);
    assert.deepEqual(points.optionGroups[0].optionIds, [nextId]);
    assert.equal(points.derivedValues[0].formula, `selected("${nextId}")`);
    assert.equal(points.derivedValues[0].min, `selected("${nextId}")`);
    assert.equal(points.derivedValues[0].max, `selected("${nextId}") + 10`);
    assert.equal(points.enableablePointSets[0].limitFormula, `selected("${nextId}")`);
    assert.equal(target.description, "old is mentioned in prose");
    assert.equal(target.image, "https://example.com/old.png");
    assert.deepEqual(source.cost, { Points: 1 });
});

test("batch ID swaps update references once and avoid collisions with untouched options and groups", () => {
    const first = { id: "first", label: "First", prerequisites: "second" };
    const second = { id: "second", label: "Second", prerequisites: "first" };
    const duplicate = { id: "third", label: "Third" };
    const data = [
        { type: "points", optionGroups: [{ id: "occupied", optionIds: ["first", "second"] }] },
        { name: "Category", subcategories: [{ options: [first, second, duplicate, { id: "occupied2" }] }] }
    ];
    regenerate(data, [{ option: first }, { option: second }, { option: duplicate }], option =>
        option === first ? "second" : option === second ? "first" : "occupied");
    assert.equal(first.id, "second");
    assert.equal(second.id, "first");
    assert.equal(first.prerequisites, "first");
    assert.equal(second.prerequisites, "second");
    assert.equal(duplicate.id, "occupied3");
    assert.deepEqual(data[0].optionGroups[0].optionIds, ["second", "first"]);
});

test("scope predicates follow renamed categories and nested subcategories", () => {
    const requirement = 'category("Weapons") && subcategory("Weapons > Physical > Advanced") && group("Weapons")';
    assert.equal(rewriteRequirement(requirement, new Map(), [
        { kind: "category", before: "Weapons", after: "Arsenal" },
        { kind: "subcategory", before: "Weapons", after: "Arsenal" }
    ]), 'category("Arsenal") && subcategory("Arsenal > Physical > Advanced") && group("Weapons")');
    assert.equal(rewriteRequirement(requirement, new Map(), [
        { kind: "subcategory", before: "Weapons > Physical", after: "Weapons > Athletics" }
    ]), 'category("Weapons") && subcategory("Weapons > Athletics > Advanced") && group("Weapons")');
});

test("renamed nested options retain valid prerequisites and published releases are unchanged", () => {
    const source = { id: "old", label: "Speed" };
    const data = [
        { type: "title", text: "ID rename test" },
        { type: "points", values: { Points: 5 } },
        { name: "Weapons", subcategories: [{ name: "Athletics", subcategories: [{ name: "Advanced", options: [source] }],
            options: [{ id: "upgrade", prerequisites: "old" }] }] }
    ];
    regenerate(data, [{ option: source, path: ["Weapons", "Athletics", "Advanced"] }], () => "weaponsAthleticsAdvancedSpeed");
    assert.deepEqual(validateCyoaData("draft.json", data).errors, []);
    data.push({ type: "publication", status: "published", version: "1.0" });
    const original = structuredClone(data);
    assert.equal(regenerate(data, [{ option: source }], () => "shouldNotChange").size, 0);
    assert.deepEqual(data, original);
});
