# Precursor Excess Spend Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Auto-craft uncapped items using 75% of precursor capacity when a precursor is full, preserving precursor requirements for the active queue horizon.

**Architecture:** Modify the existing `getQueueNeeds()` function to track active queue precursor consumption into a module-scoped variable `currentReservedPrecursors`. Create a new tick-based function `autoCraftPrecursorExcess()` that evaluates precursor levels, calculates allowed actions against the queue-protected levels, and performs crafting. Add a Node.js project-level check to verify compatibility with Evolve game version 1.4.10.

**Tech Stack:** JavaScript, Node.js, Bash (for test runner).

---

### Task 1: Project Compatibility Check Test Script

**Files:**
- Create: `.agent/tests/check-game-version-compat.js`
- Modify: `.agent/tests/run-tests.sh`

**Step 1: Create compatibility check script**

Write the following Node.js code to `.agent/tests/check-game-version-compat.js`:
```javascript
const fs = require('fs');
const path = require('path');

const gameDir = 'c:/Users/xtrap/source_code/Evolve';
const varsPath = path.join(gameDir, 'src/vars.js');
const resourcesPath = path.join(gameDir, 'src/resources.js');
const packagePath = path.join(gameDir, 'package.json');

console.log("Checking Evolve Game Version Compatibility...");

if (!fs.existsSync(packagePath)) {
    console.error("FAIL: package.json not found at " + packagePath);
    process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (pkg.version !== '1.4.10') {
    console.error(`FAIL: Expected game version 1.4.10, but found ${pkg.version}`);
    process.exit(1);
}
console.log(`PASS: Game version is ${pkg.version}`);

if (!fs.existsSync(varsPath)) {
    console.error("FAIL: src/vars.js not found at " + varsPath);
    process.exit(1);
}
const varsContent = fs.readFileSync(varsPath, 'utf8');
if (!varsContent.includes("global['version'] = '1.4.10';")) {
    console.error("FAIL: global['version'] assignment not found in src/vars.js");
    process.exit(1);
}
console.log("PASS: global['version'] in vars.js matches '1.4.10'");

if (!fs.existsSync(resourcesPath)) {
    console.error("FAIL: src/resources.js not found");
    process.exit(1);
}
const resourcesContent = fs.readFileSync(resourcesPath, 'utf8');
if (!resourcesContent.includes("export function craftCost(manual=false){") && !resourcesContent.includes("function craftCost(")) {
    console.error("FAIL: craftCost function not found in src/resources.js");
    process.exit(1);
}

const expectedRecipes = [
    "Plywood: [{ r: 'Lumber', a: 100 }]",
    "Wrought_Iron: [{ r: 'Iron', a: 80 }]",
    "Sheet_Metal: [{ r: 'Aluminium', a: 120 }]"
];

for (const recipe of expectedRecipes) {
    const strippedRecipe = recipe.replace(/\s+/g, '');
    const strippedFile = resourcesContent.replace(/\s+/g, '');
    if (!strippedFile.includes(strippedRecipe)) {
        console.error(`FAIL: Recipe definition not found for: ${recipe}`);
        process.exit(1);
    }
}
console.log("PASS: Recipes match expectations.");
console.log("Game compatibility check passed successfully!");
```

**Step 2: Run test to verify it passes**

Run: `node .agent/tests/check-game-version-compat.js`
Expected: PASS

**Step 3: Modify test runner**

Append compatibility check to `.agent/tests/run-tests.sh` before profile checks:
```bash
node "$SCRIPT_DIR/check-game-version-compat.js"
```

**Step 4: Run test runner to verify it passes**

Run: `bash .agent/tests/run-tests.sh`
Expected: PASS

**Step 5: Commit**

```bash
git add .agent/tests/check-game-version-compat.js .agent/tests/run-tests.sh
git commit -m "test: add Evolve game version compatibility checks"
```

---

### Task 2: Version Bumping

**Files:**
- Modify: `evolve_autobuy.user.js`

**Step 1: Modify version metadata and UI label**

Update `@version` and UI dashboard version to `1.21.0`.

**Step 2: Commit**

```bash
git add evolve_autobuy.user.js
git commit -m "build: bump script version to 1.21.0"
```

---

### Task 3: Queue Precursor Protection Tracking

**Files:**
- Modify: `evolve_autobuy.user.js`

**Step 1: Declare module-scoped variable**

Add `let currentReservedPrecursors = {};` below `let currentPrimaryNeeds = {};`.

**Step 2: Integrate tracking in `getQueueNeeds()`**

In `getQueueNeeds()`, reset `currentReservedPrecursors = {};` at the start.
Inside the loop in `getQueueNeeds()`, check if `entry.originalIndex < entry.horizon` (active target):
- For craftable resource `res`, if `missingAmt > 0`, calculate `craftActionsNeeded = Math.ceil(missingAmt / mult)` and for each ingredient in `craftCosts[res]` add `craftActionsNeeded * ingredient.a` to `currentReservedPrecursors[ingredient.r]`.
- For non-craftable resource `res`, add `costVal` to `currentReservedPrecursors[res]`.

**Step 3: Commit**

```bash
git add evolve_autobuy.user.js
git commit -m "feat: track active queue precursor requirements"
```

---

### Task 4: Auto-Craft Excess Precursors

**Files:**
- Modify: `evolve_autobuy.user.js`

**Step 1: Implement `autoCraftPrecursorExcess()`**

Add `autoCraftPrecursorExcess()` to the script:
```javascript
    function autoCraftPrecursorExcess() {
        if (!window.evolve || !window.evolve.global) return;
        const global = window.evolve.global;
        if (!settings.enabled || global.settings.pause || global.race['no_craft']) return;

        const craftCosts = window.evolve.craftCost || {};

        const PRECURSOR_TO_CRAFTABLE = {
            Lumber: 'Plywood',
            Stone: 'Brick',
            Cement: 'Brick',
            Iron: 'Wrought_Iron',
            Aluminium: 'Sheet_Metal',
            Iridium: 'Mythril',
            Alloy: 'Mythril',
            Graphene: 'Aerogel',
            Infernite: 'Aerogel',
            Nano_Tube: 'Nanoweave',
            Vitreloy: 'Nanoweave',
            Adamantite: 'Scarletite',
            Orichalcum: 'Scarletite',
            Elerium: 'Quantium'
        };

        Object.keys(PRECURSOR_TO_CRAFTABLE).forEach(precursor => {
            const resObj = global.resource[precursor];
            if (!resObj || !(resObj.max > 0)) return;

            const isAtCapacity = resObj.amount >= 0.999 * resObj.max;
            if (!isAtCapacity) return;

            const craftRes = PRECURSOR_TO_CRAFTABLE[precursor];
            const recipe = craftCosts[craftRes];
            if (!recipe || !Array.isArray(recipe)) return;

            const resEl = document.getElementById('res' + craftRes);
            if (!resEl || !resEl.__vue__) return;

            // Determine maximum craft actions based on recipe spending limits
            let maxActions = Infinity;

            for (let ingredient of recipe) {
                const reqRes = ingredient.r;
                const reqAmt = ingredient.a;
                const currentAmt = global.resource[reqRes] ? global.resource[reqRes].amount : 0;
                const reservedAmt = currentReservedPrecursors[reqRes] || 0;

                let allowedSpend;
                if (reqRes === precursor) {
                    // Spend up to 75% of precursor capacity, protected by queue requirement
                    allowedSpend = Math.min(0.75 * resObj.max, currentAmt - reservedAmt);
                } else {
                    // Protect enqueued requirements for secondary precursors
                    allowedSpend = currentAmt - reservedAmt;
                }

                if (allowedSpend <= 0) {
                    maxActions = 0;
                    break;
                }

                const actionsForIngredient = Math.floor(allowedSpend / reqAmt);
                maxActions = Math.min(maxActions, actionsForIngredient);
            }

            if (maxActions > 0) {
                let origMKeysVal = global.settings.mKeys;
                try {
                    global.settings.mKeys = false;
                    logDebug(`    Executing excess precursor craft for ${craftRes}: actions = ${maxActions}`);
                    resEl.__vue__.craft(craftRes, maxActions);
                    let produced = maxActions * getCraftMultiplier(craftRes);
                    console.log(`[Evolve Auto-Buy] Auto-crafted ${produced.toFixed(0)} ${craftRes} from excess precursor ${precursor}.`);
                } catch (e) {
                    console.error(`[Evolve Auto-Buy] Error crafting excess precursor ${craftRes}:`, e);
                } finally {
                    global.settings.mKeys = origMKeysVal;
                }
            }
        });
    }
```

**Step 2: Call `autoCraftPrecursorExcess()` in `runAutoBuy()`**

In `runAutoBuy()`, call `autoCraftPrecursorExcess()` directly after `autoCraftForQueue()`.

**Step 3: Commit**

```bash
git add evolve_autobuy.user.js
git commit -m "feat: implement excess precursor auto-crafting"
```

---

### Task 5: Verification

**Files:**
- Test: Run validation suite

**Step 1: Run tests**

Run: `bash .agent/tests/run-tests.sh`
Expected: PASS

**Step 2: Commit**

No files to commit.
