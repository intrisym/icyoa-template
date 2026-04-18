# ICYOA Template

An open-source **Interactive Choose Your Own Adventure (ICYOA)** template. Build, visualize, and share interactive stories entirely in your browser.

## Features

- Browser-based player and visual editor.
- Multiple CYOA files stored as JSON in `CYOAs/`.
- Categories, nested subcategories, options, costs, prerequisites, conflicts, and modified costs.
- Automatic option grants, where selecting one option can select other options for free.
- Multiple point systems and configurable starting values.
- Light and dark themes, with creator control over whether players can toggle themes or are locked to one mode.
- Import/export support for sharing builds.
- Safe inline text formatting for CYOA descriptions, including italic, bold, weight, color, and size.

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

This runs JavaScript syntax checks, validates every existing `CYOAs/*.json` file as a regression fixture, and runs functional scenario tests against real CYOA data. The functional tests simulate selecting and removing options, gaining and spending points, subcategory max-selection replacement, max-selection bypass options, prerequisite unlocks, absolute modified costs, relative modified costs, and min-cost clamps.

The CYOA validator checks that files parse, required core entries exist, option IDs are unique, referenced IDs exist, point maps are valid, prerequisite expressions are safe, modified-cost rules are coherent, and theme settings use supported values.

Current functional coverage includes:

- Loading every CYOA fixture and computing selectable state/effective costs without crashes.
- Point spending, point gains, refunds, and allow-negative point types.
- Single-select options, multi-select options, option `maxSelections`, and subcategory `maxSelections`.
- `countsAsOneSelection` behavior for subcategory limits.
- Option-level `bypassSubcategoryMaxSelections` behavior for choices that should not consume subcategory limit slots.
- String, array, object, negated, OR, AND, and count-suffix prerequisites.
- Automatic removal when an already-selected option's prerequisites become false.
- One-way and two-way incompatibility/conflict enforcement.
- Subcategory `defaultCost`.
- Absolute option-level modified costs.
- Subcategory-wide relative modified costs.
- `minCost` and `maxCost` clamps.
- Option modified costs overriding subcategory modified costs.
- Legacy `discounts` compatibility for older CYOAs.
- `idsAny` / `minSelected` conditional-cost rules.
- Automatic option grants, locked grants, and free granted selections.
- Packed export/import state round trips.
- Safe text formatting for color, size, weight, bold, italic, nesting, escaping, and plain-label stripping.

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
Description fields support a small, safe markup syntax. This lets you format text without enabling arbitrary HTML.

#### Italic And Bold

```text
Normal text, then *italic text*, then normal text again.
Normal text, then **bold text**, then normal text again.
```

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

1. **Commit & Push:** Save your changes (`git commit -am "My CYOA"`) and push them to GitHub (`git push`).
2. **Update Manifest:** Run `node generate-manifest.js` to refresh the list of available adventures. This ensures your new CYOA is correctly indexed and visible on the live site.
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
* **Light & Dark Themes:** CYOAs can define both `theme` and `darkTheme` values. The player preserves the default dark theme when a CYOA does not define its own.
* **Theme Availability:** Use the visual editor's **Theme Availability** section to allow the light/dark toggle, force light mode only, or force dark mode only. Existing CYOAs default to allowing the toggle.
* **Point Systems:** You can have multiple types of points (e.g., Health, Mana, Gold) by editing the `points` section in the editor.
* **Text Formatting:** Use `*italic*`, `**bold**`, `[weight=...]...[/weight]`, `[color=...]...[/color]`, and `[size=...]...[/size]` in description text for local emphasis.
* **Automatic Grants:** Use the option editor's **Automatically grants options** section to make one option select another option at no extra point cost. Each granted option can be locked, or marked as user-deselectable.
* **Modified Costs:** Use per-option or subcategory-wide `modifiedCosts` rules to change costs conditionally. Rules can set absolute replacement costs with `cost`, apply relative changes with `costDelta`, and define optional `minCost` / `maxCost` maps to clamp the final modified price. Legacy `discounts` rules are still supported for older CYOAs.
* **Modified Cost Priority:** Conditional modified cost rules can set a priority. Subcategory rules apply first, then option rules apply on top; within the same scope, higher-priority matching rules determine the final modified cost.
* **Sharing Builds:** Players can export and import their selections through the app's import/export modal.

---

## License

This project is open-source and available under the MIT License. Feel free to use, modify, and share!
