const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CYOA_DIR = path.join(ROOT, "cyoas");
const ALLOWLIST_FILE = path.join(__dirname, "spellcheck-allowlist.txt");

const TEXT_KEYS = new Set(["name", "label", "description", "text", "inputLabel", "placeholder"]);
const args = new Set(process.argv.slice(2));
const shouldFix = args.has("--fix");
const showWarnings = args.has("--warnings");

const COMMON_CORRECTIONS = new Map(Object.entries({
    accomodate: "accommodate",
    accomodates: "accommodates",
    accomodated: "accommodated",
    accomodating: "accommodating",
    acheive: "achieve",
    acheives: "achieves",
    acheived: "achieved",
    acheiving: "achieving",
    accross: "across",
    adress: "address",
    agressive: "aggressive",
    alot: "a lot",
    apparant: "apparent",
    appearence: "appearance",
    arguement: "argument",
    basicly: "basically",
    begining: "beginning",
    beleive: "believe",
    beleives: "believes",
    beleived: "believed",
    bizzare: "bizarre",
    calender: "calendar",
    ca: "can",
    cemetry: "cemetery",
    collegue: "colleague",
    commited: "committed",
    concious: "conscious",
    definately: "definitely",
    dependant: "dependent",
    desparate: "desperate",
    dissapear: "disappear",
    dissapears: "disappears",
    embarrass: "embarrass",
    enviroment: "environment",
    etting: "setting",
    existance: "existence",
    familar: "familiar",
    finaly: "finally",
    foriegn: "foreign",
    fourty: "forty",
    freind: "friend",
    goverment: "government",
    grammer: "grammar",
    happend: "happened",
    harrass: "harass",
    hieght: "height",
    hippee: "hippie",
    iether: "either",
    independant: "independent",
    interupt: "interrupt",
    knowlege: "knowledge",
    lenght: "length",
    liason: "liaison",
    libary: "library",
    maintainance: "maintenance",
    miscellenois: "miscellaneous",
    neccessary: "necessary",
    noticable: "noticeable",
    occured: "occurred",
    occurence: "occurrence",
    ommitted: "omitted",
    oganization: "organization",
    oppurtunity: "opportunity",
    paralell: "parallel",
    persistant: "persistent",
    prefered: "preferred",
    priviledge: "privilege",
    publically: "publicly",
    pwoerful: "powerful",
    quantam: "quantum",
    recieve: "receive",
    recieves: "receives",
    recieved: "received",
    recomend: "recommend",
    refered: "referred",
    relevent: "relevant",
    remeber: "remember",
    resistence: "resistance",
    seperate: "separate",
    sieze: "seize",
    similiar: "similar",
    succesful: "successful",
    succesfully: "successfully",
    suprise: "surprise",
    tatoo: "tattoo",
    tatoos: "tattoos",
    teh: "the",
    thier: "their",
    thorugh: "through",
    thorughout: "throughout",
    treshold: "threshold",
    tommorow: "tomorrow",
    transfered: "transferred",
    truely: "truly",
    uaually: "usually",
    untill: "until",
    wierd: "weird",
    writting: "writing"
}));

function readAllowlist() {
    if (!fs.existsSync(ALLOWLIST_FILE)) return new Set();
    return new Set(
        fs.readFileSync(ALLOWLIST_FILE, "utf8")
            .split(/\r?\n/)
            .map(line => line.replace(/#.*/, "").trim().toLowerCase())
            .filter(Boolean)
    );
}

function loadDictionary() {
    const dictionaryPaths = [
        "/usr/share/dict/words",
        "/usr/share/dict/web2",
        "/usr/share/dict/propernames"
    ];
    const words = new Set();
    dictionaryPaths.forEach(file => {
        if (!fs.existsSync(file)) return;
        fs.readFileSync(file, "utf8")
            .split(/\r?\n/)
            .forEach(word => {
                const normalized = word.trim().toLowerCase();
                if (normalized) words.add(normalized);
            });
    });
    return words;
}

function preserveCase(original, replacement) {
    if (original.toUpperCase() === original) return replacement.toUpperCase();
    if (original[0]?.toUpperCase() === original[0]) {
        return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
}

function replacementFor(word) {
    const lower = word.toLowerCase();
    if (!COMMON_CORRECTIONS.has(lower)) return null;
    return preserveCase(word, COMMON_CORRECTIONS.get(lower));
}

function normalizeSpellcheckWord(word) {
    let normalized = String(word || "").replace(/^'+|'+$/g, "").toLowerCase();
    if (normalized.endsWith("'s")) normalized = normalized.slice(0, -2);
    return normalized;
}

function editDistanceWithinLimit(a, b, limit = 1) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        const current = [i];
        let rowMin = current[0];
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const value = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + cost
            );
            current[j] = value;
            rowMin = Math.min(rowMin, value);
        }
        if (rowMin > limit) return limit + 1;
        previous = current;
    }
    return previous[b.length];
}

function isSingleInsertedOrDeletedLetter(a, b) {
    if (Math.abs(a.length - b.length) !== 1) return false;
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    let skipped = false;
    for (let shortIndex = 0, longIndex = 0; longIndex < longer.length; longIndex += 1) {
        if (shorter[shortIndex] === longer[longIndex]) {
            shortIndex += 1;
            continue;
        }
        if (skipped) return false;
        skipped = true;
    }
    return true;
}

function buildVocabulary(entries, allowlist) {
    const vocabulary = new Map();
    const pattern = /\b[A-Za-z][A-Za-z'-]{2,}\b/g;
    entries.forEach(entry => {
        let match;
        while ((match = pattern.exec(entry.value))) {
            const word = normalizeSpellcheckWord(match[0]);
            if (!word || word.length < 3 || allowlist.has(word)) continue;
            vocabulary.set(word, (vocabulary.get(word) || 0) + 1);
        }
    });
    allowlist.forEach(word => vocabulary.set(word, Math.max(vocabulary.get(word) || 0, 100)));
    COMMON_CORRECTIONS.forEach(replacement => {
        normalizeSpellcheckWord(replacement)
            .split(/\s+/)
            .filter(Boolean)
            .forEach(word => vocabulary.set(word, Math.max(vocabulary.get(word) || 0, 100)));
    });
    return vocabulary;
}

function likelySuggestionFor(word, vocabulary, allowlist) {
    const lower = normalizeSpellcheckWord(word);
    if (!lower || lower.length < 4 || allowlist.has(lower)) return null;
    if (/[A-Z]/.test(String(word).slice(1))) return null;
    const currentCount = vocabulary.get(lower) || 0;
    let best = null;
    vocabulary.forEach((count, candidate) => {
        if (candidate === lower || candidate.length < 4 || count <= currentCount) return;
        if (candidate.length <= lower.length) return;
        if (count < 2 || !isSingleInsertedOrDeletedLetter(lower, candidate)) return;
        const distance = editDistanceWithinLimit(lower, candidate, 1);
        if (distance > 1) return;
        const score = distance * 1000 - count;
        if (!best || score < best.score) best = { word: candidate, score };
    });
    return best?.word ? preserveCase(word, best.word) : null;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fixKnownTypos(text) {
    let next = text;
    COMMON_CORRECTIONS.forEach((replacement, typo) => {
        const pattern = new RegExp(`\\b${escapeRegExp(typo)}\\b`, "gi");
        next = next.replace(pattern, match => preserveCase(match, replacement));
    });
    return next;
}

function collectTextEntries(node, file, jsonPath = "$", entries = []) {
    if (Array.isArray(node)) {
        node.forEach((value, index) => collectTextEntries(value, file, `${jsonPath}[${index}]`, entries));
        return entries;
    }
    if (!node || typeof node !== "object") return entries;
    Object.entries(node).forEach(([key, value]) => {
        const childPath = `${jsonPath}.${key}`;
        if (TEXT_KEYS.has(key) && typeof value === "string") {
            entries.push({ file, path: childPath, key, value });
        }
        collectTextEntries(value, file, childPath, entries);
    });
    return entries;
}

function findKnownTypos(entry, vocabulary, allowlist) {
    const issues = [];
    const pattern = /\b[A-Za-z][A-Za-z'-]*\b/g;
    let match;
    while ((match = pattern.exec(entry.value))) {
        const raw = match[0].replace(/^'+|'+$/g, "");
        const replacement = replacementFor(raw) || likelySuggestionFor(raw, vocabulary, allowlist);
        if (!replacement) continue;
        issues.push({
            ...entry,
            word: raw,
            suggestion: replacement,
            index: match.index
        });
    }
    return issues;
}

function unknownWordWarnings(entry, dictionary, allowlist) {
    if (!dictionary.size) return [];
    const warnings = [];
    const pattern = /\b[A-Za-z][A-Za-z'-]{3,}\b/g;
    let match;
    while ((match = pattern.exec(entry.value))) {
        let raw = match[0].replace(/^'+|'+$/g, "");
        if (!raw || /[A-Z]/.test(raw.slice(1))) continue;
        let lower = raw.toLowerCase();
        if (lower.endsWith("'s")) lower = lower.slice(0, -2);
        if (allowlist.has(lower) || dictionary.has(lower)) continue;
        warnings.push({ ...entry, word: raw, index: match.index });
    }
    return warnings;
}

function excerpt(text, index) {
    const start = Math.max(0, index - 45);
    const end = Math.min(text.length, index + 45);
    return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function readCyoaFiles() {
    return fs.readdirSync(CYOA_DIR)
        .filter(file => file.endsWith(".json"))
        .sort()
        .map(file => path.join(CYOA_DIR, file));
}

function main() {
    const allowlist = readAllowlist();
    const dictionary = showWarnings ? loadDictionary() : new Set();
    const knownIssues = [];
    const warnings = [];
    const changedFiles = [];

    readCyoaFiles().forEach(file => {
        const raw = fs.readFileSync(file, "utf8");
        const data = JSON.parse(raw);
        const entries = collectTextEntries(data, path.relative(ROOT, file));
        const vocabulary = buildVocabulary(entries, allowlist);
        entries.forEach(entry => {
            knownIssues.push(...findKnownTypos(entry, vocabulary, allowlist));
            if (showWarnings) warnings.push(...unknownWordWarnings(entry, dictionary, allowlist));
        });

        if (shouldFix) {
            const fixed = fixKnownTypos(raw);
            if (fixed !== raw) {
                fs.writeFileSync(file, fixed);
                changedFiles.push(path.relative(ROOT, file));
            }
        }
    });

    if (changedFiles.length) {
        console.log(`Fixed known typos in ${changedFiles.length} file(s): ${changedFiles.join(", ")}`);
    }

    if (knownIssues.length && !shouldFix) {
        console.error(`CYOA spellcheck failed with ${knownIssues.length} known typo(s):`);
        knownIssues.forEach(issue => {
            console.error(`- ${issue.file} ${issue.path}: "${issue.word}" -> "${issue.suggestion}"`);
            console.error(`  ${excerpt(issue.value, issue.index)}`);
        });
    }

    if (showWarnings && warnings.length) {
        console.warn(`CYOA spellcheck warning: ${warnings.length} unknown word(s). Add valid terms to scripts/spellcheck-allowlist.txt.`);
        warnings.slice(0, 100).forEach(issue => {
            console.warn(`- ${issue.file} ${issue.path}: "${issue.word}"`);
            console.warn(`  ${excerpt(issue.value, issue.index)}`);
        });
        if (warnings.length > 100) {
            console.warn(`...and ${warnings.length - 100} more warning(s).`);
        }
    }

    if (knownIssues.length && !shouldFix) process.exit(1);
    console.log("CYOA spellcheck passed.");
}

if (require.main === module) {
    main();
}
