# ICYOA Template

An open-source **Interactive Choose Your Own Adventure (ICYOA)** template. Build, visualize, and share interactive stories entirely in your browser.

## Features

- Browser-based player and visual editor.
- Multiple CYOA files stored as JSON in `CYOAs/`.
- Categories, nested subcategories, options, costs, prerequisites, conflicts, and modified costs.
- Automatic option grants, where selecting one option can select other options for free.
- Multiple point systems and configurable starting values.
- Optional alternate cost choices, so one option can be paid for with one of several point maps.
- Light and dark themes, with creator control over whether players can toggle themes or are locked to one mode.
- Player-facing option detail panels for prerequisites, incompatibilities, conditional costs, and automatic grants.
- Import/export support for sharing builds.
- Safe Markdown-style text formatting for CYOA descriptions, with legacy weight, color, and size tags.

---

## Quick Start

1. **Install Node.js:** Download it from [nodejs.org](https://nodejs.org/) if you don't have it.
2. **Download & Run:**
   ```bash
   node server.js
   ```
3. **Explore:**
   - **Main App:** [http://localhost:3000](http://localhost:3000) (What your players see)
   - **Visual Editor:** [http://localhost:3000/editor.html](http://localhost:3000/editor.html) (Where you build)

---

## Testing

Run the full pre-push verification suite before publishing changes:

```bash
sh scripts/check.sh
```

The script works from any working directory when invoked using its path, requires Node.js 22 or newer and npm, and does not change CYOA files. CYOA validation runs first. Each error identifies the file, option label/ID, field, and problem, and the errors repeat at the end so they remain visible after other checks finish. Passing suites produce compact `PASS` lines; failed suites print their details. It runs every check and exits nonzero if any check fails. Drafts are checked too. `npm test` also runs the verification suite, stopping at the first failed command.

GitHub Actions runs the same shell script in `.github/workflows/ci.yml` on pushes to every branch/tag, branch/tag creation, pull requests to any branch (including title edits), merge-queue checks, and manual runs.

In Actions, CYOA errors also appear as file-associated error annotations and in an **Errors to fix** table on the workflow run's job summary, with columns for file, option, field, and problem. Passing-suite logs are grouped so their details can be expanded without burying the failures.

### Blocking Invalid Changes Before Main

GitHub Actions runs after code reaches GitHub. To block invalid changes from merging into `main`, configure a branch protection rule or ruleset in the repository settings:

1. Target `main` and require a pull request before merging.
2. Require both **Verify** and **Conventional Commits** status checks from the **CI** workflow to pass.
3. Require the branch to be up to date, and restrict bypasses if administrators should also be subject to the checks.

These GitHub settings are not enabled by adding a workflow file. See [GitHub's protected branch documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

Local pre-push validation runs before every push, including feature branches and tags. The hook in `.githooks/pre-push` runs the full check automatically and stops the push on failure. Configure it once in each clone with:

```bash
git config --local core.hooksPath .githooks
```

If you already use a custom hooks path, integrate the hook into that setup instead of replacing it. The hook checks the current working copy once per push, regardless of the destination branch or number of refs being pushed. Commit the content you validated before pushing. Git does not share local configuration with new clones, so each clone needs this setup. Local hooks can be bypassed; required GitHub checks provide enforcement for all contributors.

### Conventional Commit Messages

The `commit-msg` hook validates every new commit and amend on every branch against [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). It uses the same configured `.githooks` directory as the pre-push hook; no extra installation or npm dependency is required.

```text
fix(versioning): archive completed drafts after publication
feat(editor): add a version picker
feat(api)!: replace the save format
```

Messages require a type, an optional scope and/or `!`, a colon and space, and a non-empty description. Bodies need a blank line after the header. Footer values must not be empty, and breaking-change footers must use uppercase `BREAKING CHANGE:` or `BREAKING-CHANGE:`. Custom types and mixed case are accepted, and there is no arbitrary header-length limit. The check validates syntax; authors remain responsible for choosing `feat` for features and `fix` for fixes.

The pre-push hook validates commits newly introduced to the target remote, including on newly created branches. CI validates commits introduced by a push or contributed by a PR relative to its base. PR titles are unrestricted because the specification governs commit messages. When squashing or merging, give the resulting commit a conventional message. New merge/revert/fixup messages receive no exemption; GitHub's temporary merge-queue commits are excluded from the merge-queue check because they are generated by the platform.

The project additionally requires branch names in lowercase `<type>/<description>` form, for example `feat/image-url-validation`, `fix/editor-preview`, or `ci/image-checks`. Custom types are allowed; description words use hyphens, with optional nested paths. Do not include `codex` anywhere in the name. `main` and `master` are permanent branch exceptions. This is a project convention inspired by Conventional Commits, which does not itself specify branch names. Run `npm run lint:branch` to check the current name. The pre-push hook rejects invalid destination branch names, and the **Branch naming** CI job checks branch creation, pushes, and PR source branches. Git has no built-in branch-creation hook, so arbitrary local Git commands can still create a branch; validation happens on push. Existing nonconforming branches may be deleted, but must be renamed before pushing updates. Tag names and generated merge-queue refs are excluded. Make **Branch naming** a required CI check to enforce it before merging when local hooks are bypassed.

Historical commits through `.commit-conventions.json` are excluded. Push and PR checks also exclude history already present at their destination, so an already-published merge does not block subsequent updates. CI checks out full history to resolve these ranges.

Run `npm run lint:commits` to audit the current branch's entire history after the configured baseline, including published commits, or `npm run test:commits` to test the validator and real Git-hook integration. The full verification script includes those integration tests. This local setup does not change GitHub branch protection settings; require both CI checks in GitHub to enforce the policy when local hooks are bypassed.

### Image Loading Checks

To test a single candidate URL from GitHub's runner, use **Actions → Test image URL → Run workflow**, paste the direct image URL, and start the run. The summary shows whether it loaded and decoded under both localhost and GitHub Pages origins, or whether the result was broken/inconclusive. The JSON report is downloadable as **image-url-test-report**. This tests just the supplied image; it does not scan CYOAs, change URLs, or use saved manual confirmations.

GitHub requires the workflow to be on the default branch before its manual input form is available. Until this feature is merged, you can trigger the same test on the feature branch by updating the single URL in `.github/image-url-to-test.txt` and pushing that file. It initially contains the ImgChest URL supplied for testing. Subsequent changes to that file trigger **Test image URL** automatically; normal code pushes do not trigger this extra workflow unless that file changes.

Use an individual image URL such as `https://cdn.imgchest.com/files/39c64342c3e9.jpg`, rather than an ImgChest post/gallery page. No ImgChest account credentials or API integration are needed to test a public URL.

The same one-URL test is available locally after installing dependencies and Chromium:

```sh
npm run test:image-url -- 'https://cdn.imgchest.com/files/39c64342c3e9.jpg'
```

The visual editor marks blocked image hosts with a red outline and an inline explanation on header and option image URL fields, including URLs already present when a CYOA is loaded. Feedback updates as you type and clears when you replace or remove the URL. This indicates editor validity; it does not automatically remove existing URLs or prevent saving/exporting CYOA data.

Edit `blockedDomains` in `imageUrlPolicy.js` to maintain the blocklist. Each entry has a `domain` and a user-facing `reason`; domain matches include subdomains, but not similarly named domains or mentions inside paths/query strings. WallpaperCave is the initial entry because its URLs failed DNS resolution in the reported checks. This is a project policy, not a claim that the host fails on every network. Unlisted hosts still need the image-loading checks below.

Install the browser once, then run the image checks locally:

```sh
npm install
npx playwright install chromium
sh scripts/check-images.sh
```

To check only one CYOA:

```sh
sh scripts/check-images.sh CYOAs/blue_lock___wild_card_project_v1_1.json
```

`npm run test:images` runs the same check. It checks every header and option image in all local CYOA JSON files, including nested subcategories and drafts. Each distinct URL is tested per origin; unsuccessful loads are retried once with a ten-second timeout per attempt. A loaded, decoded image passes automatically. Invalid URLs, policy violations, and consistent confirmed missing/invalid image responses block the check. ORB/security blocks, access restrictions, timeouts, DNS failures and transient server errors are **inconclusive**, rather than proof that an image is down. Inconclusive results require a current manual verification. Every result identifies its URL, file and affected header/option. Full diagnostics, including accepted manual verifications, are written to `image-check-report.json` (ignored by Git).

Each URL is tested from localhost and from the production page's origin. The checker serves a minimal document at the production URL using Playwright request interception; external image requests are real, with the browser's normal referrer and mixed-content behavior. This tests the current files before deploying them. Relative image paths are served from this checkout. It does not deploy anything or store external images in the repository.

The production directory defaults to `https://intrisym.github.io/icyoa-template/`. For a fork or a different deployment, set `IMAGE_CHECK_PRODUCTION_URL` to your HTTPS player directory URL, ending in `/`.

CI runs this as the separate **Image loading** job on pushes and PRs, with file annotations and a downloadable JSON report. It also runs `npm run test:images:unit`, which checks the checker against controlled responses, including referrer behavior. `sh scripts/check.sh` stays offline and validates saved image connections. The pre-push hook additionally requires real browser image checks on every pushed commit snapshot, including all older CYOA versions. A working-tree-only fix cannot make an unfixed committed image pass. Hook reports are saved as `image-check-report-<commit>.json`; the hook never edits CYOAs. Install Chromium before pushing. To require image checks before merging, add **Image loading** to the required status checks in GitHub branch protection.

These checks verify availability at test time. External hosts can change later, and the simulated production origin does not replace testing the deployed site in your browser.

The **Image loading** job's GitHub Actions summary lists affected **CYOAs, option names, IDs, errors and image URLs** in a table. The CYOA name links to its live player page and the filename identifies the exact version to edit. Confirmed failures appear first, followed by inconclusive images requiring manual verification; each section explains the next step. Localhost and production results for the same image/option are combined into one row. Currently accepted manual verifications are collapsed separately so they do not clutter the blocking errors. The regular CYOA validation summary also has a dedicated option ID column. Full JSON diagnostics remain available as the downloadable artifact.

### Manual Verification for Inconclusive Images

Some hosts allow ordinary browsers while blocking the automated checker. These results are never used to automatically replace images or as automatic repair sources. The mandatory push check and CI accept them only with a manual confirmation from the previous **seven days**, scoped to the **exact URL, option ID, CYOA filename and production page**. Changing any of those, expiry, or a future timestamp requires verification again. Confirmations cannot override confirmed failures or the blocked-domain policy.

In **Repair Images Across Versions**, an inconclusive image offers **Open the live CYOA**. Open it in your normal browser, reload without cache, and check that the exact image shown in the dialog actually renders on the page (opening the raw image URL is insufficient). Check the confirmation box and click **Save verification for 7 days**. Prefer a private window when checking what a new visitor would see. Only confirm an image that is actually present on the deployed page; an unpublished change needs a deployed preview or an automatically verifiable URL first.

The confirmation is recorded in `image-verifications.json`. **Commit that file before pushing**: the push hook reads confirmations from the pushed commit, never uncommitted working-tree confirmations. CI reports **PASS WITH MANUAL VERIFICATION**, retaining warnings and the automated inconclusive diagnostics. The editor also distinguishes manually accepted results from fully automatic passes. A human confirmation establishes what you observed; it cannot guarantee availability for every visitor or throughout the seven-day window.

The equivalent CLI command requires explicit confirmation and the exact current URL:

```sh
npm run images:verify -- --file CYOA_FILENAME.json --id OPTION_ID --url 'https://example.com/image.png' --confirm-live-image
```

Use this only after performing the browser check described above. The command refuses stale URLs and confirmed failures. It rechecks the series and saves a confirmation if the automated result remains inconclusive; it does not convert the result into an automated success.

### Image Repairs Across Versions

In the local visual editor, select a CYOA and click **Repair Images Across Versions**. The sync check starts immediately, checking every version in that CYOA series and repairing failed or blocklisted images from working connected images. Matching option IDs connect automatically within a series; headers also connect automatically. When several replacements work, the newest version is preferred. Working images keep their existing URLs, even if another version uses different artwork.

If discrepancies remain, the dialog walks through them one at a time, showing the option name and version. Choose **It moved or was renamed**, select the version with the matching option, and enter its new ID (suggestions are provided). **Connect and repair** saves that connection in `image-links.json` and runs the repairs. Connections use the series and option IDs, so they survive publishing a draft under a new filename. Connections that would merge two distinct options in the same version are rejected.

If an option was deleted or has no working counterpart, choose **Use a new image URL** and click **Verify URL and repair**. The replacement must load from both test origins and pass the domain policy before anything is written. The same operation repairs other failed images connected to that option, then advances to the next unresolved image. Headers ask directly for a URL. **Skip to the next image** leaves an issue pending; only fixing every discrepancy produces the **All images are up to date** result. Filenames, IDs and network errors remain available under **Image details**, while successful changes are listed under **View repairs**.

These tools can repair images in published versions without changing their gameplay data or publication metadata. They write only header/option image fields plus saved connections and explicit manual confirmations; they do not publish or push Git changes. Concurrent edits detected during a scan abort the operation so you can rerun it against current data. Commit repaired files, `image-links.json` and `image-verifications.json`, then push. The mandatory push check blocks confirmed failures, invalid connections and inconclusive results without a current manual confirmation.

Equivalent local commands (use `@header` as the ID for a header image):

```sh
# Inspect proposed repairs without changing files.
npm run images:repair -- --file CYOA_FILENAME.json --dry-run

# Repair failed images using working counterparts across every version of Blue Lock.
npm run images:repair -- --file blue_lock___wild_card_project_v1_1.json

# Connect Balance after its move from Technical to Physical.
npm run images:link -- --file blue_lock___wild_card_project.json --id weaponsTechnicalBalance --source-file blue_lock___wild_card_project_v1_1.json --source-id weaponsPhysicalBalance

# Supply a URL for a historical option with no surviving counterpart.
npm run images:replace -- --file CYOA_FILENAME.json --id OPTION_ID --url 'https://example.com/replacement.png'

# Validate saved connections without network requests.
npm run check:image-links
```

Filenames are relative to `CYOAs/`. Omit `--file` from `images:repair` to check and repair all series. Repair commands exit with failure when manual input is still needed, while reporting any verified repairs already applied. The visual repair dialog needs the local Node server; GitHub Pages cannot write repository files.

### Validation Coverage

This runs JavaScript syntax checks, validates every existing `CYOAs/*.json` file as a regression fixture, and runs functional scenario tests against a self-contained synthetic CYOA fixture. The functional tests simulate selecting and removing options, gaining and spending points, subcategory max-selection replacement, max-selection bypass options, prerequisite unlocks, conditional pricing priority, absolute modified costs, relative modified costs, discount slots, and min/max cost clamps.

The CYOA validator checks that files parse, required core entries exist, option IDs are unique, referenced IDs exist, point maps are valid, prerequisite expressions are safe, modified-cost rules are coherent, and theme settings use supported values.

This includes nested prerequisite objects and arrays, malformed incompatibility inputs, references to removed or renamed IDs, unknown currencies/groups/scopes, malformed node structures, and invalid selection limits. These checks validate supported structure and rules; they do not prove gameplay balance or that every possible build is reachable.

Current functional coverage includes:

- Computing selectable state/effective costs against the synthetic integration fixture without crashes.
- Point spending, point gains, refunds, and allow-negative point types.
- Single-select options, multi-select options, option `maxSelections`, and subcategory `maxSelections`.
- `countsAsOneSelection` behavior for subcategory limits.
- Option-level `bypassSubcategoryMaxSelections` behavior for choices that should not consume subcategory limit slots.
- String, array, object, negated, OR, AND, and count-suffix prerequisites.
- Automatic removal when an already-selected option's prerequisites become false.
- One-way and two-way incompatibility/conflict enforcement.
- Category `requiresOption` gates and category `maxSelections`.
- Category and nested subcategory display-mode metadata.
- Adding and removing categories, subcategories, and options.
- Subcategory `requiresOption` gates, including inherited gates for nested options.
- Subcategory `discountFirstN` with `discountAmount`.
- Subcategory and category manual discount slots with eligibility ceilings and option-level opt-outs.
- Subcategory default `costOptions`, inherited by nested options from the nearest ancestor subcategory.
- Subcategory `columnsPerRow` metadata.
- Option-level and subcategory-level freeform text input persistence and import sanitization.
- Absolute option-level modified costs.
- Subcategory-wide relative modified costs.
- `minCost` and `maxCost` clamps.
- Option modified costs overriding subcategory modified costs.
- Highest-priority matching conditional-cost rule selection within the winning scope.
- Conditional-cost display rows in option details.
- Legacy `discounts` compatibility for older CYOAs.
- `idsAny` / `minSelected` conditional-cost rules.
- Automatic option grants, locked grants, and free granted selections.
- Automatic-grant display rows in option details, including can-deselect grants.
- Option-granted discount slots across target options.
- Theme-setting coverage for option metadata section colors.
- Custom JSON option fields being preserved without changing runtime selection logic.
- Packed export/import state round trips.
- Safe Markdown-style text formatting for headings, lists, links, inline code, color, size, weight, escaping, and plain-label stripping.

Useful focused commands:

```bash
npm run check:js
npm run test:cyoas
npm run test:functional
npm run test:versions
npm run verify
```

Validation warnings are non-blocking compatibility notes. Validation errors should be fixed before pushing to GitHub.

---

## How to Create Your Own CYOA

Follow these simple steps to go from a template to your own unique adventure.

### 1. Set Up Your Project
* **Fork this repo:** Click the **Fork** button at the top right of this page to save a copy to your own GitHub account.
* **Clone it:** Download your fork to your computer.
* **Open in VS Code:** (Or your favorite code editor).

### 2. Use the Visual Editor (Easiest Way)
The Visual Editor lets you build and manage your CYOAs without touching code.

1. Run `node server.js` in your terminal.
2. Open **[localhost:3000/editor.html](http://localhost:3000/editor.html)**.
3. **Manage your projects:**
   - Click **Select CYOA** to switch between different adventures.
   - **Create New:** Enter a title and click "Create New" to start a fresh adventure.
   - **Delete:** Click the trash icon next to a CYOA to move it to the trash (found in `CYOAs/.trash/`).
4. **Build your world:**
   - Add **Categories** (like "Background", "Powers", or "Equipment").
   - Add **Options** inside categories. Give them names, descriptions, and costs.
   - Set **Starting Points** (e.g., "100 Gold").
   - Use the theme controls to customize colors, fonts, light/dark mode values, and whether players can switch modes.
5. Edits automatically save to the selected file in `CYOAs`. New CYOAs start as drafts and appear in the player selector after publication.

#### Drafts and Published Versions

- Select an existing CYOA and click **Create Draft From This Version**. For an unversioned CYOA, this first preserves the original file as published **v0.1**, keeping its existing player URL, then opens a separate editable draft.
- Changes autosave only to the draft. Published versions are read-only in the editor and cannot be overwritten or moved to trash through the API.
- Click **Publish Version** when ready. The dialog suggests the next version, which you can edit: releases `1`, `1.1`, and `1.2` suggest `1.3`; you can instead enter `1.2.1` or `2.0`. The first release of a new CYOA defaults to `0.1`.
- Add optional release notes and confirm. Publication validates the CYOA, creates a separate release file, and moves the completed draft to `CYOAs/.trash/`. Existing releases stay intact, and equivalent existing numbers such as `1` and `1.0` cannot be reused. Create a new draft from the published release when starting the next update.
- Players see one entry per CYOA, with the newest release selected by default and older versions available in its version picker. Drafts are omitted from the player list but remain previewable by direct link; they are not private files.
- **Choose Version** in the editor switches between the current CYOA's drafts and published releases, including when opened from the live preview. In the player, **Choose Version** sits beside the other action buttons and lists only published releases of the current CYOA. **Select CYOA** in the editor still opens the full adventure list.
- The version picker uses selectable cards with Draft/Published badges, a Current marker, and one action area. It follows the editor or CYOA theme, adapts to small screens, supports arrow-key radio selection and Escape to cancel, and returns focus to the button that opened it.
- Each release has a permanent link such as `index.html?cyoa=adventure_v1_2.json`. The **Latest release** link uses the series identifier, for example `index.html?latest=adventure.json`, and opens whichever published version has the highest version number.
- Exported player builds record their exact CYOA filename. Importing into a different version is rejected; open the matching version first. Older exports without a filename ask for confirmation.
- Creating a draft and opening a CYOA preserve existing option IDs. When you rename a category, subcategory, or option label, leaving the name field regenerates affected option IDs and updates prerequisites, conflicts, grants, groups, and selected-option formulas within that CYOA. Nested option paths and category/subcategory scope predicates update too. Published releases remain read-only.
- Run `node generate-manifest.js` before deploying to static hosting. The manifest includes published releases and existing unversioned CYOAs, and excludes drafts and Git-ignored local files. It is replaced atomically only after the new JSON is fully written. Publishing locally does not deploy changes to your hosted site.

Existing unversioned CYOAs stay editable until you create their first draft. Published protection applies to the editor and API; direct filesystem or Git edits can still change files.

### 3. Logic & Requirements
Want one choice to depend on another?
* **Prerequisites:** In the editor, you can set an "ID" for an option (e.g., `super_strength`). Another option can then require `super_strength` to be selected.
* **Conflicts:** Stop players from picking two incompatible things (e.g., `Fire_Magic` and `Ice_Magic`).

### 4. Formatting Text
Description fields support a safe Markdown-style syntax. This lets you format text without enabling arbitrary HTML. Existing CYOA tags for color, size, and weight are still supported for compatibility.

#### Markdown

```text
# Heading

Normal text, then *italic text*, then normal text again.
Normal text, then **bold text**, then normal text again.
Use `inline code` for short literals.

- First bullet
- Second bullet

1. First numbered item
2. Second numbered item

[Project link](https://example.com)
> Quoted text
```

Links are limited to safe URL forms such as `https:`, `http:`, `mailto:`, page anchors, and relative paths.

#### Legacy Weight

For more control over boldness, use numeric weight tags:

```text
[weight=400]Normal weight text[/weight]
[weight=600]Semi-bold text[/weight]
[weight=700]Bold text[/weight]
[weight=900]Extra-bold text[/weight]
```

Supported weights are `100`, `200`, `300`, `400`, `500`, `600`, `700`, `800`, and `900`. The `**bold**` shortcut is equivalent to normal browser bold styling.

#### Color

```text
Normal text, then [color=#d32f2f]red text[/color], then normal text again.
```

Named colors, hex colors, `rgb(...)`, `rgba(...)`, `hsl(...)`, and `hsla(...)` values are supported.

#### Size

```text
[size=28px]Large text[/size]
[size=1.25em]Relative em text[/size]
[size=120%]Percentage-sized text[/size]
[size=-2px]Slightly smaller than the surrounding text[/size]
[size=+4px]Slightly larger than the surrounding text[/size]
```

Supported size units are `px`, `em`, `rem`, and `%`. Unsigned sizes are applied directly; signed sizes are relative to the surrounding text.

#### Nesting

Color and size tags can be nested:

```text
[color=red]Red text with [size=28px]large red text[/size] inside.[/color]
[size=1.4em]Large text with [color=blue]blue text[/color] inside.[/size]
**Bold text with [color=blue]blue bold text[/color] inside.**
*Italic text with [weight=700]bold italic text[/weight] inside.*
[weight=900]Extra-bold text with [size=120%]larger text[/size] inside.[/weight]
```

Tags and emphasis markers should be closed in the reverse order they were opened.

### 5. Publish Your Creation
Sharing your CYOA is free and easy with GitHub Pages:

1. **Update Manifest:** Run `node generate-manifest.js` to refresh the list of available adventures. This ensures your new CYOA is correctly indexed and visible on the live site.
2. **Stage, Commit & Push:** Published releases create new JSON files. Stage the release and refreshed manifest together so the deployed picker never points to a missing file. Replace the example release filename below with your actual filename:
   ```bash
   git add -- CYOAs/my_adventure_v0_1.json CYOAs/manifest.json
   git commit -m "feat(cyoa): publish the first release"
   git push
   ```
   If the completed draft was tracked by Git, stage its deletion too. Using `git commit -am` alone does not include new, untracked release files.
3. **Enable Pages:**
   - Go to your repo settings on GitHub.
   - Click **Pages** in the left sidebar.
   - Under "Build and deployment", select the **main** branch and click **Save**.
4. **Done!** Your site will be live at `https://your-username.github.io/your-repo-name/`.

---

## Project Structure

For those curious about how it works under the hood:

```text
icyoa-template/
├── CYOAs/               # All CYOA configuration files (.json)
├── index.html           # The main player interface
├── editor.html          # The visual creator tool
├── cyoa-manifest.json   # Generated list of available CYOAs
├── script.js            # Logic for the player interface
├── editor.js            # Logic for the visual tool
├── style.css            # Look and feel for the player interface
├── generate-manifest.js # Rebuilds the CYOA manifest
└── server.js            # Simple server to help you edit locally
```

---

## Advanced Customization

* **Colors & Fonts:** You can modify the theme in either the visual editor or in the theme block in the JSON.
* **Subcategory Colors:** Individual subcategories can define `backgroundColor`, `textColor`, and `accentColor` to style only that opened section. These fields are available in the editor's subcategory advanced fields.
* **Light & Dark Themes:** CYOAs can define both `theme` and `darkTheme` values. The player preserves the default dark theme when a CYOA does not define its own.
* **Theme Availability:** Use the visual editor's **Theme Availability** section to allow the light/dark toggle, force light mode only, or force dark mode only. Existing CYOAs default to allowing the toggle.
* **Point Systems:** You can have multiple types of points (e.g., Health, Mana, Gold) by editing the `points` section in the editor. Point type names support the same safe inline formatting as option labels, so a name like `[color=gold]Gold[/color]` keeps its styling in the tracker and option cost displays.
* **Payment Options:** Use an option's **Payment options** editor to define one or more cost maps. Players see generated gain/cost text for each payment choice, so separate payment labels are not needed.
* **Selection-Specific Costs:** Repeatable options can define selection-specific payment costs, such as selection 1 costing `1` point and selection 2 costing `2` points. If later selections do not have their own cost, the final defined selection cost repeats.
* **Text Formatting:** Use Markdown syntax such as `# Heading`, `- list item`, `[link](https://example.com)`, `` `code` ``, `*italic*`, and `**bold**`. Legacy `[weight=...]...[/weight]`, `[color=...]...[/color]`, and `[size=...]...[/size]` tags remain supported.
* **Automatic Grants:** Use the option editor's **Automatically grants options** section to make one option select another option at no extra point cost. Each granted option can be locked, or marked as user-deselectable.
* **Modified Costs:** Use per-option or subcategory-wide `modifiedCosts` rules to change costs conditionally. Rules can set absolute replacement costs with `cost`, apply flat relative changes with `costDelta`, apply rounded-up percentage changes with `costPercent` (for example `{ "Points": -15 }` for 15% off), and define optional `minCost` / `maxCost` maps to clamp the final modified price. Legacy `discounts` rules are still supported for older CYOAs.
* **Modified Cost Priority:** Conditional modified cost rules can set a priority. If any option-level rule matches, option-level rules win over subcategory-wide rules; within the winning scope, only the highest-priority matching rule is applied.
* **Player-Facing Rule Display:** The player shows prerequisites, incompatibilities, conditional costs, and automatic grants directly on each option so users can inspect rule interactions before selecting.
* **Sharing Builds:** Players can export and import their selections through the app's import/export modal.

---

## License

This project is open-source and available under the MIT License. Feel free to use, modify, and share!
