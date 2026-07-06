# MAD Research Guiding Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Implement visual research guiding and a semi-automatic hybrid auto-research/auto-queue engine inside the MAD companion script to expedite the path to MAD resets.

**Architecture:** We will hook into the main update loop of `evolve_mad_companion.user.js` to dynamically inject the panel when the research tab is active. We will calculate the next uncompleted technology on the MAD milestone path, highlight it in the DOM, dim other research cards, and optionally auto-purchase/auto-queue it depending on resource availability.

**Tech Stack:** Vanilla JavaScript, Vue.js DOM properties, Tampermonkey API.

---

### Task 1: Version Bump & Settings Preparation

**Files:**
- Modify: `c:/Users/xtrap/source_code/Evolve-user-script/evolve_mad_companion.user.js` (lines 1-15, 130-147)

**Step 1: Write version bump and settings structure**
Update the metadata block to `1.3.0` and extend the settings object to include `autoResearch: false`.

Target modification:
```javascript
// ==UserScript==
// @name         Evolve MAD Farm Companion
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// ...
```

Update settings initialization and load/save methods:
```javascript
    let settings = {
        collapsed: false,
        autoResearch: false
    };
```

**Step 2: Verify syntax**
Run: `node -c c:/Users/xtrap/source_code/Evolve-user-script/evolve_mad_companion.user.js`
Expected: Success (no output/errors)

**Step 3: Commit**
```bash
git add evolve_mad_companion.user.js
git commit -m "feat: bump version to 1.3.0 and add autoResearch settings"
```

---

### Task 2: Define Critical Tech Milestone Paths & Helpers

**Files:**
- Modify: `c:/Users/xtrap/source_code/Evolve-user-script/evolve_mad_companion.user.js` (under CONSTANTS & MAPPINGS section)

**Step 1: Add tech milestone constant array**
Define the 12 core technologies and their key attributes/dependencies.

```javascript
    const MAD_TECH_PATH = [
        { key: 'mad_science', id: 'tech-mad_science' },
        { key: 'electricity', id: 'tech-electricity' },
        { key: 'industrialization', id: 'tech-industrialization' },
        { key: 'electronics', id: 'tech-electronics' },
        { key: 'uranium', id: 'tech-uranium' },
        { key: 'fission', id: 'tech-fission' },
        { key: 'arpa', id: 'tech-arpa' },
        { key: 'rocketry', id: 'tech-rocketry' },
        { key: 'black_powder', id: 'tech-black_powder' },
        { key: 'dynamite', id: 'tech-dynamite' },
        { key: 'anfo', id: 'tech-anfo' },
        { key: 'mad', id: 'tech-mad' }
    ];
```

**Step 2: Add progress helper functions**
Add functions to check if a tech is completed.
```javascript
    function isTechResearched(techKey) {
        const global = getRealGlobal();
        if (!global || !global.tech) return false;
        
        // Progression level checks
        if (techKey === 'black_powder') return global.tech.explosives >= 1;
        if (techKey === 'dynamite') return global.tech.explosives >= 2;
        if (techKey === 'anfo') return global.tech.explosives >= 3;
        
        if (techKey === 'mad_science') return global.tech.high_tech >= 1;
        if (techKey === 'electricity') return global.tech.high_tech >= 2;
        if (techKey === 'industrialization') return global.tech.high_tech >= 3;
        if (techKey === 'electronics') return global.tech.high_tech >= 4;
        if (techKey === 'fission') return global.tech.high_tech >= 5;
        if (techKey === 'arpa') return global.tech.high_tech >= 6;
        if (techKey === 'rocketry') return global.tech.high_tech >= 7;
        
        return !!global.tech[techKey];
    }
```

**Step 3: Verify syntax**
Run: `node -c c:/Users/xtrap/source_code/Evolve-user-script/evolve_mad_companion.user.js`
Expected: Success

**Step 4: Commit**
```bash
git add evolve_mad_companion.user.js
git commit -m "feat: define MAD critical tech path constants and helpers"
```

---

### Task 3: Build and Inject Research Panel UI

**Files:**
- Modify: `c:/Users/xtrap/source_code/Evolve-user-script/evolve_mad_companion.user.js` (UI section)

**Step 1: Inject research panel HTML**
Create a method `updateResearchPanel()` that:
- Finds `#mTabResearch`.
- If not present (or if current species is already extinct/completed), removes the panel if it exists and returns.
- Otherwise, inserts a styled box at the top of `#mTabResearch`.
- Binds event listener to the `Auto-Research` checkbox.

```javascript
    function updateResearchPanel() {
        const mTab = document.getElementById('mTabResearch');
        if (!mTab) {
            const existing = document.getElementById('mad-companion-research-panel');
            if (existing) existing.remove();
            return;
        }
        
        const global = getRealGlobal();
        if (!global) return;
        
        // Only show if current species has not done MAD yet
        const biome = global.city.biome || 'Unknown';
        const pendingOnPlanet = getUncompletedSpeciesOnPlanet(biome);
        const species = global.race.species || 'Unknown';
        if (!pendingOnPlanet.includes(species)) {
            const existing = document.getElementById('mad-companion-research-panel');
            if (existing) existing.remove();
            return;
        }
        
        let panel = document.getElementById('mad-companion-research-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'mad-companion-research-panel';
            mTab.insertBefore(panel, mTab.firstChild);
        }
        
        // Build checklist HTML
        let milestonesHTML = '';
        MAD_TECH_PATH.forEach(tech => {
            const done = isTechResearched(tech.key);
            const label = tech.key.substring(0, 7).toUpperCase();
            milestonesHTML += `
                <span class="mad-badge ${done ? 'mad-complete' : 'mad-warn'}" style="margin: 2px; font-size: 0.7rem;">
                    ${done ? '✓' : '○'} ${label}
                </span>
            `;
        });
        
        panel.innerHTML = `
            <div class="mad-res-header">
                <span>MAD Research Guide v1.3.0</span>
                <label style="cursor:pointer; font-weight:normal; font-size:0.8rem;">
                    <input type="checkbox" id="mad-auto-research-chk" ${settings.autoResearch ? 'checked' : ''}> Auto-Research (Hybrid)
                </label>
            </div>
            <div style="display:flex; flex-wrap:wrap; align-items:center; gap:5px;">
                <strong>Path:</strong>
                ${milestonesHTML}
            </div>
        `;
        
        document.getElementById('mad-auto-research-chk').addEventListener('change', (e) => {
            settings.autoResearch = e.target.checked;
            saveSettings();
        });
    }
```

**Step 2: Verify syntax**
Run: `node -c c:/Users/xtrap/source_code/Evolve-user-script/evolve_mad_companion.user.js`
Expected: Success

**Step 3: Commit**
```bash
git add evolve_mad_companion.user.js
git commit -m "feat: implement research guide dashboard injection"
```

---

### Task 4: Research Button Highlighting and Dimming

**Files:**
- Modify: `c:/Users/xtrap/source_code/Evolve-user-script/evolve_mad_companion.user.js` (applyGuides method)

**Step 1: Inject styling for active research highlights**
Add styling classes to the injected stylesheet and write highlighting logic in `applyGuides()`.

Add to `injectStyles()`:
```javascript
    /* Highlight styles */
    #mad-companion-research-panel {
        border: 1px solid rgba(128, 128, 128, 0.25);
        background-color: rgba(20, 20, 20, 0.9);
        border-radius: 4px;
        padding: 8px 12px;
        margin-bottom: 12px;
        font-size: 0.85rem;
    }
    .mad-res-header {
        display: flex;
        justify-content: space-between;
        font-weight: bold;
        border-bottom: 1px solid rgba(128, 128, 128, 0.15);
        padding-bottom: 4px;
        margin-bottom: 6px;
    }
```

Add logic to `applyGuides()`:
```javascript
        // Research guides highlighting
        const mTab = document.getElementById('mTabResearch');
        if (mTab) {
            let nextTech = null;
            for (let i = 0; i < MAD_TECH_PATH.length; i++) {
                if (!isTechResearched(MAD_TECH_PATH[i].key)) {
                    nextTech = MAD_TECH_PATH[i];
                    break;
                }
            }
            
            let researchCssRules = [];
            if (nextTech) {
                // Highlight next target button in the Research container
                const targetId = nextTech.id;
                researchCssRules.push(`#${targetId} a.button, #${targetId} button { border: 2px solid #3ec48c !important; box-shadow: 0 0 5px #3ec48c !important; opacity: 1.0 !important; }`);
                
                // Dim other technologies currently visible
                researchCssRules.push(`#tech .action:not(#${targetId}) a.button, #tech .action:not(#${targetId}) button { opacity: 0.4 !important; border: 1px dashed #7a7a7a !important; box-shadow: none !important; }`);
            }
            
            let resStyleEl = document.getElementById('mad-companion-research-guides-style');
            if (!resStyleEl) {
                resStyleEl = document.createElement('style');
                resStyleEl.id = 'mad-companion-research-guides-style';
                document.head.appendChild(resStyleEl);
            }
            resStyleEl.textContent = researchCssRules.join('\n');
        } else {
            const resStyleEl = document.getElementById('mad-companion-research-guides-style');
            if (resStyleEl) resStyleEl.textContent = '';
        }
```

**Step 2: Verify syntax**
Run: `node -c c:/Users/xtrap/source_code/Evolve-user-script/evolve_mad_companion.user.js`
Expected: Success

**Step 3: Commit**
```bash
git add evolve_mad_companion.user.js
git commit -m "feat: add research card highlighting and dimming"
```

---

### Task 5: Implement Hybrid Auto-Research Action Logic

**Files:**
- Modify: `c:/Users/xtrap/source_code/Evolve-user-script/evolve_mad_companion.user.js` (New section)

**Step 1: Write pricing and affordable helper**
```javascript
    function checkTechAffordable(techKey) {
        if (!window.evolve || !window.evolve.actions || !window.evolve.actions.tech) return false;
        const action = window.evolve.actions.tech[techKey];
        if (!action) return false;
        
        // Use adjustCosts from game engine
        if (typeof window.adjustCosts !== 'function') return false;
        
        const costs = window.adjustCosts(action);
        const global = getRealGlobal();
        if (!global || !global.resource) return false;
        
        // Verify all costs are met
        for (const res in costs) {
            if (costs.hasOwnProperty(res)) {
                const costVal = costs[res]();
                let actualRes = res;
                if (res === 'Money') actualRes = 'Money'; // standard map
                if (global.resource[actualRes] && global.resource[actualRes].amount < costVal) {
                    return false;
                }
            }
        }
        return true;
    }
```

**Step 2: Write purchase/queue injection logic**
```javascript
    function runAutoResearch() {
        if (!settings.autoResearch) return;
        const global = getRealGlobal();
        if (!global || !window.evolve) return;
        
        // Find next target tech
        let nextTech = null;
        for (let i = 0; i < MAD_TECH_PATH.length; i++) {
            if (!isTechResearched(MAD_TECH_PATH[i].key)) {
                nextTech = MAD_TECH_PATH[i];
                break;
            }
        }
        if (!nextTech) return;
        
        const techKey = nextTech.key;
        
        // Check if the DOM button is present and affordable
        const element = document.getElementById(nextTech.id);
        if (!element) return; // not available for research yet
        
        if (!checkTechAffordable(techKey)) return;
        
        // Hybrid logic
        if (global.r_queue && global.r_queue.display) {
            // Check if already in queue
            const isQueued = global.r_queue.queue && global.r_queue.queue.some(q => q === techKey);
            if (!isQueued) {
                global.r_queue.queue.push(techKey);
                console.log(`[MAD Companion] Injected ${techKey} into research queue.`);
                // Trigger vue update on queue
                const rqVm = document.getElementById('resQueue')?.__vue__;
                if (rqVm && typeof rqVm.$forceUpdate === 'function') rqVm.$forceUpdate();
            }
        } else {
            // Queue not active, purchase directly
            const actionObj = window.evolve.actions.tech[techKey];
            if (actionObj && typeof actionObj.action === 'function') {
                const success = actionObj.action();
                if (success) {
                    console.log(`[MAD Companion] Direct purchased technology: ${techKey}`);
                }
            }
        }
    }
```

**Step 3: Hook functions into intervals**
In the main initialization `init()`, register the loop execution.
Update the loop interval:
```javascript
        setInterval(() => {
            updateDashboard();
            applyGuides();
            updateResearchPanel();
            runAutoResearch();
        }, 500);
```

**Step 4: Verify syntax**
Run: `node -c c:/Users/xtrap/source_code/Evolve-user-script/evolve_mad_companion.user.js`
Expected: Success

**Step 5: Commit**
```bash
git add evolve_mad_companion.user.js
git commit -m "feat: integrate auto-research hybrid engine and loop hooks"
```

---

### Task 6: Final Integration and UI Review

**Files:**
- Modify: `c:/Users/xtrap/source_code/Evolve-user-script/docs/plans/task.md`

**Step 1: Check task list**
Mark all tasks as completed in `task.md`.

**Step 2: Commit**
```bash
git add docs/plans/task.md
git commit -m "docs: finalize task checklist"
```
