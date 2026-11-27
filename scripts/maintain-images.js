const { createImageMaintenance } = require("../imageMaintenance");

async function main() {
    const [action = "repair", ...args] = process.argv.slice(2);
    const maintenance = createImageMaintenance();
    if (action === "check-links") {
        const result = await maintenance.checkLinks();
        console.log(`Image links passed: ${result.links} mapping(s), ${result.files} CYOA files.`);
        return;
    }
    const options = { action, onProgress: message => console.log(message) };
    const names = { "--file": "file", "--id": "id", "--source-file": "sourceFile", "--source-id": "sourceId", "--url": "url" };
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === "--dry-run") options.dryRun = true;
        else {
            const name = names[args[index]];
            if (!name || args[index + 1] === undefined) throw new Error(`Unknown/missing argument: ${args[index]}`);
            options[name] = args[++index];
        }
    }
    const result = await maintenance.repair(options);
    console.log(result.message);
    for (const edit of result.edits) console.log(`${edit.file} / ${edit.id}\n  ${edit.before}\n  -> ${edit.url} (from ${edit.sourceFile})`);
    for (const image of result.unresolved) console.error(`NEEDS INPUT: ${image.file} / ${image.id} (${image.label})\n  ${image.url}\n  Use images:replace with --file, --id, --url, or images:link with --source-file and --source-id.`);
    if (result.unresolved.length) process.exitCode = 1;
}
main().catch(error => { console.error(`IMAGE MAINTENANCE FAILED: ${error.message}`); process.exitCode = 1; });
