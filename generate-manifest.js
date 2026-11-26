const fs = require("fs/promises");
const path = require("path");
const { createVersionStore } = require("./cyoaVersions");

async function generateManifest(directory = path.join(__dirname, "CYOAs")) {
    const cyoas = await createVersionStore(directory).list();
    await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(cyoas, null, 2) + "\n");
    return cyoas;
}

if (require.main === module) {
    generateManifest().then(cyoas => {
        console.log(`Generated manifest with ${cyoas.length} playable CYOAs.`);
    }).catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { generateManifest };
