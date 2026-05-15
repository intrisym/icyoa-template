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
npm test
```

The same verification suite is also configured in GitHub Actions under [`.github/workflows/ci.yml`](https://github.com/intrisym/icyoa-template/blob/main/.github/workflows/ci.yml), so pushes to `main` / `master` and pull requests will run the repository checks automatically.

This runs JavaScript syntax checks, validates every existing `CYOAs/*.json` file as a regression fixture, and runs functional scenario tests against a self-contained synthetic CYOA fixture. The functional tests simulate selecting and removing options, gaining and spending points, subcategory max-selection replacement, max-selection bypass options, prerequisite unlocks, conditional pricing priority, absolute modified costs, relative modified costs, discount slots, and min/max cost clamps.

The CYOA validator checks that files parse, required core entries exist, option IDs are unique, referenced IDs exist, point maps are valid, prerequisite expressions are safe, modified-cost rules are coherent, and theme settings use supported values.

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
- Subcategory `defaultCost`.
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
5. The file will automatically be saved to the `CYOAs` directory. You may modify or delete it directly if you prefer.

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
* **Payment Options:** Use an option's **Payment options** editor to define its cost. Each option has `Payment Option 1` by default, and additional payment options let players choose one of several payment maps each time they select that option.
* **Text Formatting:** Use Markdown syntax such as `# Heading`, `- list item`, `[link](https://example.com)`, `` `code` ``, `*italic*`, and `**bold**`. Legacy `[weight=...]...[/weight]`, `[color=...]...[/color]`, and `[size=...]...[/size]` tags remain supported.
* **Automatic Grants:** Use the option editor's **Automatically grants options** section to make one option select another option at no extra point cost. Each granted option can be locked, or marked as user-deselectable.
* **Modified Costs:** Use per-option or subcategory-wide `modifiedCosts` rules to change costs conditionally. Rules can set absolute replacement costs with `cost`, apply flat relative changes with `costDelta`, apply rounded-up percentage changes with `costPercent` (for example `{ "Points": -15 }` for 15% off), and define optional `minCost` / `maxCost` maps to clamp the final modified price. Legacy `discounts` rules are still supported for older CYOAs.
* **Modified Cost Priority:** Conditional modified cost rules can set a priority. If any option-level rule matches, option-level rules win over subcategory-wide rules; within the winning scope, only the highest-priority matching rule is applied.
* **Player-Facing Rule Display:** The player shows prerequisites, incompatibilities, conditional costs, and automatic grants directly on each option so users can inspect rule interactions before selecting.
* **Sharing Builds:** Players can export and import their selections through the app's import/export modal.

---

## License

This project is open-source and available under the MIT License. Feel free to use, modify, and share!
