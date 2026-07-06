# Auto-Buy Precursor Excess Spend Design

## Goal
Implement a new feature in the auto-buy script that automatically crafts uncapped resources from precursors when those precursors are at maximum storage capacity. This prevents production waste while ensuring that enqueued building and research items are never starved of their required precursor resources.

## Requirements
1. **Precursor Detection**: Monitor precursors used in crafting recipes. Detect when their current amount is at or near maximum capacity (`amount >= 0.999 * max`).
2. **Horizon-Based Queue Protection**: Do not spend precursors needed by the active queue items (up to their defined queue horizons) and any active money/knowledge target.
3. **Static Mapping**: Safely map each precursor to a specific uncapped craftable item to avoid wasting rare/precious resources (e.g. `Lumber` -> `Plywood`, `Iron` -> `Wrought_Iron`).
4. **Project Check / Game Version Compatibility**: Verify that our static mapping matches the recipe definitions of the core game repository version `1.4.10`. Prevent running tests or building if the game version changes, alerting developers to update the mapping.

## Proposed Design

### 1. Queue Protection in `getQueueNeeds()`
We will define a module-scoped map `currentReservedPrecursors` inside `evolve_autobuy.user.js`:
```javascript
let currentReservedPrecursors = {};
```
In `getQueueNeeds()`, we reset `currentReservedPrecursors = {}`. 
Within the main loop of `getQueueNeeds()`, for each queue entry `entry` where `entry.originalIndex < entry.horizon` (active items):
- **Craftable Cost (`res`)**: If it needs crafting (`missingAmt > 0`), calculate total precursor actions required: `craftActionsNeeded = Math.ceil(missingAmt / mult)`. Add `craftActionsNeeded * ingredient.a` to `currentReservedPrecursors[ingredient.r]` for each ingredient.
- **Non-Craftable Cost (`res`)**: Add `costVal` to `currentReservedPrecursors[res]`.

### 2. Excess Precursor Auto-Crafting in `autoCraftPrecursorExcess()`
We define a new tick-based function `autoCraftPrecursorExcess()` called in the main loop:
- Defines `PRECURSOR_TO_CRAFTABLE` mapping:
  - `Lumber` -> `Plywood`
  - `Stone` -> `Brick`
  - `Cement` -> `Brick`
  - `Iron` -> `Wrought_Iron`
  - `Aluminium` -> `Sheet_Metal`
  - `Iridium` -> `Mythril`
  - `Alloy` -> `Mythril`
  - `Graphene` -> `Aerogel`
  - `Infernite` -> `Aerogel`
  - `Nano_Tube` -> `Nanoweave`
  - `Vitreloy` -> `Nanoweave`
  - `Adamantite` -> `Scarletite`
  - `Orichalcum` -> `Scarletite`
  - `Elerium` -> `Quantium`
- For each precursor `P` at capacity (`amount >= 0.999 * max`):
  - Find target `C` and ensure `document.getElementById('res' + C)?.__vue__` is present.
  - Determine spending limits for recipe ingredients:
    - For precursor `P`: `maxSpend = Math.min(0.75 * max, amount - reserved[P])`.
    - For secondary ingredients `S`: `maxSpend = amount - reserved[S]`.
  - Calculate allowed actions: `actions = Math.min(... ingredients.map(ing => Math.floor(maxSpend[ing.r] / ing.a)))`.
  - If `actions > 0`, call `craft(C, actions)`.

### 3. Project-Level Game Version Check
Create `.agent/tests/check-game-version-compat.js` using Node.js to:
- Assert `global['version'] === '1.4.10'` in `c:/Users/xtrap/source_code/Evolve/src/vars.js`.
- Assert that recipes for our mapped craftables exist in `c:/Users/xtrap/source_code/Evolve/src/resources.js` and contain the expected ingredients.
- Integrate into `.agent/tests/run-tests.sh`.
