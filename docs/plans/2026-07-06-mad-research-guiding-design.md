# Design Doc: MAD Research Guiding in Evolve MAD Farm Companion

## Overview
This document outlines the design for adding research guiding to the Evolve MAD Farm Companion script (`evolve_mad_companion.user.js`). The goal is to guide players to the target research needed to trigger a Mutual Assured Destruction (MAD) reset as quickly as possible. This includes visual highlighting of critical path research buttons and a semi-automatic hybrid auto-research/auto-queue engine.

---

## 1. Scope & UI Visibility
*   **Sidebar Panel:** Remains active only during the prebiotic phase and the planet selection screen. During the main gameplay phase, the sidebar panel is hidden to preserve screen real estate.
*   **Research Panel (`#mad-companion-research-panel`):**
    *   Visible **only** when the "Research" tab is currently active (the DOM element `#mTabResearch` is present in the document).
    *   Only injected if the current run is an active MAD run (current species is not yet extinct/MAD completed in the current universe).

---

## 2. Layout & UI Structure
We will inject a compact, style-integrated dashboard at the top of `#mTabResearch`:

```
+-----------------------------------------------------------+
|  MAD Research Guide v1.3.0  [ ] Auto-Research (Hybrid)    |
|  Milestones: [x] MAD Sci  [x] Elec  [/] Indus  [ ] Electron |
|              [ ] Uranium  [ ] Fiss  [ ] ARPA   [ ] Rocket   |
|  Explosives: [x] BlackPow [ ] Dynam  [ ] ANFO   [ ] MAD      |
+-----------------------------------------------------------+
```

### CSS Styling System
```css
#mad-companion-research-panel {
    background-color: rgba(20, 20, 20, 0.85);
    border: 1px solid rgba(128, 128, 128, 0.25);
    border-radius: 4px;
    padding: 10px;
    margin-bottom: 12px;
    font-size: 0.85rem;
}
.mad-res-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: bold;
    margin-bottom: 6px;
    border-bottom: 1px solid rgba(128, 128, 128, 0.15);
    padding-bottom: 4px;
}
.mad-res-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
}
.mad-res-label {
    font-weight: bold;
    min-width: 80px;
}
```

---

## 3. Technology Critical Path
The linear technology milestones required for MAD resets are:
1.  `tech-mad_science` (gives `high_tech: 1`, requires `science: 2, smelting: 2`)
2.  `tech-electricity` (gives `high_tech: 2`, requires `high_tech: 1`)
3.  `tech-industrialization` (gives `high_tech: 3`, requires `high_tech: 2, cement: 2, steel_container: 1`)
4.  `tech-electronics` (gives `high_tech: 4`, requires `high_tech: 3, titanium: 1`)
5.  `tech-uranium` (requires `high_tech: 4`)
6.  `tech-fission` (gives `high_tech: 5`, requires `high_tech: 4, uranium: 1`)
7.  `tech-arpa` (gives `high_tech: 6`, requires `high_tech: 5`)
8.  `tech-rocketry` (gives `high_tech: 7`, requires `high_tech: 6`)
9.  `tech-black_powder` (gives `explosives: 1`, requires `mining: 4`)
10. `tech-dynamite` (gives `explosives: 2`, requires `explosives: 1`)
11. `tech-anfo` (gives `explosives: 3`, requires `explosives: 2, oil: 1`)
12. `tech-mad` (requires `uranium: 1, explosives: 3, high_tech: 7`)

---

## 4. Visual Highlighting Logic
When the Research screen is open, the script will:
1.  Filter the 12 critical-path technologies to find the first uncompleted ones.
2.  Add high-visibility styling to the available button in the DOM:
    ```css
    /* Primary Target Tech Highlight */
    #tech-<target_key> a.button, #tech-<target_key> button {
        border: 2px solid #3ec48c !important;
        box-shadow: 0 0 5px #3ec48c !important;
    }
    ```
3.  Dim non-essential technologies currently visible to reduce UI clutter:
    ```css
    /* Dim Non-Milestone Tech */
    #tech:not(#tech-<target_key>) .action a.button {
        opacity: 0.5 !important;
        border: 1px dashed #7a7a7a !important;
    }
    ```

---

## 5. Semi-Auto Research (Hybrid Mode)
If `Auto-Research` is enabled in settings:
1.  **Identify Target:** Find the first uncompleted milestone technology currently rendered in the DOM.
2.  **Resource Check:**
    *   Evaluate resource costs for the target tech.
    *   Compare costs against the player's current available resource counts (e.g. `global.resource.Knowledge.amount` and other cost fields).
3.  **Action Execution:**
    *   **If Research Queue is unlocked:** Append the target tech to `global.r_queue.queue` if not already present.
    *   **If Queue is locked or empty:** Direct-buy by calling the tech's action method (e.g., `actions.tech[tech_key].action()`).
