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

GitHub Actions runs the same shell script in `.github/workflows/ci.yml` on pull requests targeting `main` / `master`, pushes to those branches, merge-queue checks, and manual runs.

In Actions, CYOA errors also appear as file-associated error annotations and in an **Errors to fix** table on the workflow run's job summary, with columns for file, option, field, and problem. Passing-suite logs are grouped so their details can be expanded without burying the failures.

### Blocking Invalid Changes Before Main

GitHub Actions runs after code reaches GitHub. To block invalid changes from merging into `main`, configure a branch protection rule or ruleset in the repository settings:

1. Target `main` and require a pull request before merging.
2. Require the **Verify** status check from the **CI** workflow to pass.
3. Require the branch to be up to date, and restrict bypasses if administrators should also be subject to the checks.

These GitHub settings are not enabled by adding a workflow file. See [GitHub's protected branch documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

Local pre-push validation runs before every push, including feature branches and tags. The hook in `.githooks/pre-push` runs the full check automatically and stops the push on failure. Configure it once in each clone with:

```bash
git config --local core.hooksPath .githooks
```

If you already use a custom hooks path, integrate the hook into that setup instead of replacing it. The hook checks the current working copy once per push, regardless of the destination branch or number of refs being pushed. Commit the content you validated before pushing. Git does not share local configuration with new clones, so each clone needs this setup. Local hooks can be bypassed; required GitHub checks provide enforcement for all contributors.

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
- Add optional release notes and confirm. Publication validates the CYOA and creates a separate release file, leaving existing releases and the working draft intact. Equivalent existing numbers such as `1` and `1.0` cannot be reused.
- Players see one entry per CYOA, with the newest release selected by default and older versions available in its version picker. Drafts are omitted from the player list but remain previewable by direct link; they are not private files.
- **Choose Version** in the editor switches between the current CYOA's drafts and published releases, including when opened from the live preview. In the player, **Choose Version** sits beside the other action buttons and lists only published releases of the current CYOA. **Select CYOA** in the editor still opens the full adventure list.
- Each release has a permanent link such as `index.html?cyoa=adventure_v1_2.json`. The **Latest release** link uses the series identifier, for example `index.html?latest=adventure.json`, and opens whichever published version has the highest version number.
- Exported player builds record their exact CYOA filename. Importing into a different version is rejected; open the matching version first. Older exports without a filename ask for confirmation.
- Creating a draft and opening a CYOA preserve existing option IDs. When you rename a category, subcategory, or option label, leaving the name field regenerates affected option IDs and updates prerequisites, conflicts, grants, groups, and selected-option formulas within that CYOA. Nested option paths and category/subcategory scope predicates update too. Published releases remain read-only.
- Run `node generate-manifest.js` before deploying to static hosting. The manifest includes published releases and existing unversioned CYOAs, and excludes drafts. Publishing locally does not deploy changes to your hosted site.

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
2. **Commit & Push:** Save your CYOA and refreshed manifest (`git commit -am "My CYOA"`) and push them to GitHub (`git push`).
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
