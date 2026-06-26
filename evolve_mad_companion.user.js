// ==UserScript==
// @name         Evolve MAD Farm Companion
// @namespace    http://tampermonkey.net/
// @version      0.5.0
// @description  Automates and guides MAD farming runs in the Evil Universe to maximize idle time.
// @author       Antigravity
// @license      MIT
// @match        https://pmotschmann.github.io/Evolve/*
// @match        https://*.github.io/Evolve/*
// @match        http://localhost:*/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/xtrapwr/Evolve-user-script/main/evolve_mad_companion.user.js
// @downloadURL  https://raw.githubusercontent.com/xtrapwr/Evolve-user-script/main/evolve_mad_companion.user.js
// ==/UserScript==

(function() {
    'use strict';

    window.isEvolveMadCompanionActive = true;

    // ==========================================
    // 1. SYNCHRONOUS SAVE INTERCEPTION
    // ==========================================
    if (!localStorage.getItem.isEvolveIntercepted) {
        const originalGetItem = localStorage.getItem;
        localStorage.getItem = function(key) {
            let val = originalGetItem.apply(this, arguments);
            if (key === 'evolved' && val) {
                try {
                    if (window.LZString) {
                        let decompressed = window.LZString.decompressFromUTF16(val);
                        let state = JSON.parse(decompressed);
                        if (state && state.settings && !state.settings.expose) {
                            state.settings.expose = true;
                            let compressed = window.LZString.compressToUTF16(JSON.stringify(state));
                            localStorage.setItem('evolved', compressed);
                            val = compressed;
                            console.log("[MAD Companion] Intercepted save and forced settings.expose = true");
                        }
                    }
                } catch (e) {
                    console.error("[MAD Companion] Interception failed:", e);
                }
            }
            return val;
        };
        localStorage.getItem.isEvolveIntercepted = true;
    }

    // ==========================================
    // 2. CONSTANTS & MAPPINGS
    // ==========================================
    const TARGET_GENUSES = ['humanoid', 'plant', 'reptilian', 'small'];

    const GENUS_MAP = {
        human: 'humanoid', elven: 'humanoid', orc: 'humanoid', dwarf: 'humanoid',
        cath: 'carnivore', wolven: 'carnivore', vulpine: 'carnivore',
        centaur: 'herbivore', rhinotaur: 'herbivore', capybara: 'herbivore',
        kobold: 'small', goblin: 'small', gnome: 'small',
        ogre: 'giant', cyclops: 'giant', troll: 'giant',
        tortoisan: 'reptilian', gecko: 'reptilian', slitheryn: 'reptilian',
        arraak: 'avian', pterodacti: 'avian', dracnid: 'avian',
        entish: 'plant', cacti: 'plant', pinguicula: 'plant',
        sporgar: 'fungi', shroomi: 'fungi', moldling: 'fungi',
        mantis: 'insectoid', scorpid: 'insectoid', antid: 'insectoid',
        sharkin: 'aquatic', octigoran: 'aquatic',
        dryad: 'fey', satyr: 'fey',
        phoenix: 'heat', salamander: 'heat',
        yeti: 'polar', wendigo: 'polar',
        tuskin: 'sand', kamel: 'sand',
        balorg: 'demonic', imp: 'demonic',
        seraph: 'angelic', unicorn: 'angelic'
    };

    const BIOME_RESTRICTIONS = {
        aquatic: ['oceanic', 'swamp'],
        heat: ['volcanic', 'ashland'],
        polar: ['tundra', 'taiga'],
        sand: ['desert', 'ashland'],
        fey: ['forest', 'swamp', 'taiga'],
        demonic: ['hellscape'],
        angelic: ['eden']
    };

    const FORK_GENUS_MAP = {
        // Kingdom level
        chitin: ['fungi'],
        chloroplasts: ['plant'],
        phagocytosis: [
            'humanoid', 'giant', 'small', 'carnivore', 'herbivore', 'insectoid',
            'reptilian', 'avian', 'aquatic', 'fey', 'heat', 'polar', 'sand',
            'demonic', 'angelic'
        ],
        // Animal sub-branches (under phagocytosis -> bilateral_symmetry / vertebrates)
        athropods: ['insectoid'],
        eggshell: ['reptilian', 'avian'],
        aquatic: ['aquatic'],
        fey: ['fey'],
        heat: ['heat'],
        polar: ['polar'],
        sand: ['sand'],
        mammals: ['humanoid', 'giant', 'small', 'carnivore', 'herbivore', 'demonic', 'angelic']
    };

    // Userscript Settings (LocalStorage cached)
    let settings = {
        enabled: true,
        autoResearch: true,
        autoBuild: true,
        autoJobs: true,
        autoCraft: true,
        autoMarket: true,
        collapsed: false
    };

    function loadSettings() {
        const stored = localStorage.getItem('evolve_mad_companion_settings');
        if (stored) {
            try {
                settings = Object.assign(settings, JSON.parse(stored));
            } catch(e) {}
        }
    }

    function saveSettings() {
        localStorage.setItem('evolve_mad_companion_settings', JSON.stringify(settings));
    }

    // ==========================================
    // 3. CORE LOGIC ENGINE
    // ==========================================
    function getUniverseAffix() {
        const u = window.evolve?.global?.race?.universe || 'standard';
        if (u === 'evil') return 'e';
        if (u === 'antimatter') return 'a';
        if (u === 'heavy') return 'h';
        if (u === 'micro') return 'm';
        if (u === 'magic') return 'mg';
        return 'l';
    }

    function isGenusBioseeded(genus) {
        const ach = window.evolve?.global?.stats?.achieve?.[`genus_${genus}`];
        return ach && ach.l >= 1;
    }

    function isSpeciesReset(species) {
        const affix = getUniverseAffix();
        const ach = window.evolve?.global?.stats?.achieve?.[`extinct_${species}`];
        return ach && ach[affix] && ach[affix] > 0;
    }

    function getAvailableSpecies(biome) {
        const list = [
            'human', 'elven', 'orc', 'dwarf',
            'cath', 'wolven', 'vulpine',
            'centaur', 'rhinotaur', 'capybara',
            'kobold', 'goblin', 'gnome',
            'ogre', 'cyclops', 'troll',
            'tortoisan', 'gecko', 'slitheryn',
            'arraak', 'pterodacti', 'dracnid',
            'entish', 'cacti', 'pinguicula',
            'sporgar', 'shroomi', 'moldling',
            'mantis', 'scorpid', 'antid'
        ];
        
        Object.keys(BIOME_RESTRICTIONS).forEach(genus => {
            if (BIOME_RESTRICTIONS[genus].includes(biome)) {
                Object.keys(GENUS_MAP).forEach(species => {
                    if (GENUS_MAP[species] === genus && !list.includes(species)) {
                        list.push(species);
                    }
                });
            }
        });
        return list;
    }

    function getUncompletedSpeciesOnPlanet(biome) {
        const available = getAvailableSpecies(biome);
        return available.filter(species => !isSpeciesReset(species));
    }

    function isFinalEvolutionButton(key) {
        return key === 'sentience' || 
               key === 'custom' || 
               key === 'hybrid' || 
               key.startsWith('s-') || 
               GENUS_MAP.hasOwnProperty(key);
    }

    function getQueueAction(item) {
        if (!window.evolve || !window.evolve.global) return null;
        const actions = window.evolve.actions;
        const segments = item.id ? item.id.split("-") : [];
        
        // 1. ARPA Projects
        if (item.action === 'arpa' || (segments[0] && segments[0].substring(0, 4) === 'arpa')) {
            const projectType = item.type || (segments[0] ? segments[0].substring(4) : '');
            return actions.arpa ? actions.arpa[projectType] : null;
        }

        // 2. Category-Key structure
        if (segments.length >= 2) {
            const cat = segments[0];
            const structKey = segments[1];
            if (actions[cat]) {
                if (cat === 'city' || cat === 'evolution' || cat === 'starDock') {
                    return actions[cat][structKey];
                } else {
                    let foundAction = null;
                    Object.keys(actions[cat]).forEach(function(region) {
                        if (actions[cat][region] && actions[cat][region].hasOwnProperty(structKey)) {
                            foundAction = actions[cat][region][structKey];
                        }
                    });
                    return foundAction;
                }
            }
        }
        return null;
    }

    // ==========================================
    // 4. AUTOMATION LOOPS
    // ==========================================
    function runAutomation() {
        if (window.isEvolveAutobuyActive || document.getElementById('autobuy-dashboard')) {
            console.warn("[MAD Companion] Auto-Buy detected! Companion automation is paused to prevent conflicts.");
            return;
        }
        if (!settings.enabled || !window.evolve || !window.evolve.global) return;
        const global = window.evolve.global;
        if (global.settings.pause) return;

        // Skip automation if in prebiotic phase
        if (global.race.species === 'protoplasm' || !global.race.species) return;

        if (settings.autoJobs) performAutoJobs();
        if (settings.autoCraft) performAutoCraft();
        if (settings.autoMarket) performAutoMarketBuy();
        if (settings.autoResearch) performAutoResearch();

        // Sync Evolve's native building queue pause state with autoBuild setting
        if (global.queue && global.queue.pause !== undefined) {
            global.queue.pause = !settings.autoBuild;
        }
    }

    function performAutoResearch() {
        if (!window.evolve || !window.evolve.global || !window.evolve.actions || !window.evolve.actions.tech) return;

        const global = window.evolve.global;
        const actions = window.evolve.actions;

        // 1. Replicated tech checks helpers
        function skipRequirement(req) {
            if (global.race && global.race['flier'] && req === 'cement') {
                return true;
            }
            return false;
        }

        function checkTechPath(tech_name) {
            const path = global.race && global.race['truepath'] ? 'truepath' : 'standard';
            const action = actions.tech[tech_name];
            if (!action) return false;
            const techPath = {
                standard: ['primitive', 'discovery', 'civilized', 'industrialized', 'globalized', 'early_space', 'deep_space', 'interstellar', 'intergalactic'],
                truepath: ['primitive', 'discovery', 'civilized', 'industrialized', 'globalized', 'early_space', 'deep_space', 'solar', 'tauceti'],
            };
            if ((!techPath[path].includes(action.era) && !action.hasOwnProperty('path')) || (action.hasOwnProperty('path') && !action.path.includes(path))) {
                return false;
            }
            return true;
        }

        function checkOldTech(tech_name) {
            const action = actions.tech[tech_name];
            if (!action || !action.grant) return false;
            const tch = action.grant[0];
            const val = action.grant[1];
            if (global.tech[tch] && global.tech[tch] >= val) {
                switch (tech_name) {
                    case 'fanaticism':
                        return Boolean(global.tech['fanaticism']);
                    case 'anthropology':
                        return Boolean(global.tech['anthropology']);
                    case 'deify':
                        return Boolean(global.tech['ancient_deify']);
                    case 'study':
                        return Boolean(global.tech['ancient_study']);
                    case 'isolation_protocol':
                        return Boolean(global.tech['isolation']);
                    case 'focus_cure':
                        return Boolean(global.tech['focus_cure']);
                    case 'vax_strat1':
                        return Boolean(global.tech['vax_p']);
                    case 'vax_strat2':
                        return Boolean(global.tech['vax_f']);
                    default:
                        return true;
                }
            }
            return false;
        }

        function checkTechQualifications(action, tech_name) {
            if (action['condition'] && !action.condition()) {
                return false;
            }
            if (action['not_trait']) {
                for (let i = 0; i < action.not_trait.length; i++) {
                    if (global.race && global.race[action.not_trait[i]]) {
                        return false;
                    }
                }
            }
            if (action['trait']) {
                for (let i = 0; i < action.trait.length; i++) {
                    if (global.race && !global.race[action.trait[i]]) {
                        return false;
                    }
                }
            }
            if (action['not_gene']) {
                for (let i = 0; i < action.not_gene.length; i++) {
                    if (global.genes && global.genes[action.not_gene[i]]) {
                        return false;
                    }
                }
            }
            if (action['gene']) {
                for (let i = 0; i < action.gene.length; i++) {
                    if (global.genes && !global.genes[action.gene[i]]) {
                        return false;
                    }
                }
            }
            if (action['not_tech']) {
                for (let i = 0; i < action.not_tech.length; i++) {
                    if (global.tech && global.tech[action.not_tech[i]]) {
                        return false;
                    }
                }
            }
            return true;
        }

        function checkTechRequirements(tech_name, predList) {
            const action = actions.tech[tech_name];
            if (!action) return false;
            let isMet = true;
            let precog = false;
            let failChecks = {};

            if (action.reqs) {
                Object.keys(action.reqs).forEach(req => {
                    if (skipRequirement(req)) return;
                    if (!global.tech[req] || global.tech[req] < action.reqs[req]) {
                        isMet = false;
                        failChecks[req] = action.reqs[req];
                    }
                });
            }

            if (predList && typeof predList === 'object' && global.genes && global.genes.queue >= 3) {
                precog = true;
                if (global.r_queue && global.r_queue.queue) {
                    global.r_queue.queue.forEach(q => {
                        if (checkTechRequirements(q.type, null)) {
                            const qAction = actions[q.action]?.[q.type];
                            if (qAction && qAction.grant) {
                                predList[qAction.grant[0]] = { v: qAction.grant[1], a: q.type };
                            }
                        }
                    });
                }
                Object.keys(failChecks).forEach(req => {
                    const cTech = global.tech[req] || 0;
                    if (skipRequirement(req)) return;
                    if (!predList[req] || predList[req].v < action.reqs[req] || predList[req].v > cTech + 1) {
                        precog = false;
                    }
                });
            }

            if ((isMet || precog) && (!global.tech[action.grant[0]] || global.tech[action.grant[0]] < action.grant[1])) {
                return isMet ? 'ok' : 'precog';
            }
            return false;
        }

        // 2. Scan all techs
        const predList = {};
        const isQueueUnlocked = global.tech && global.tech['r_queue'] && global.r_queue && global.r_queue.display;

        for (const tech_name of Object.keys(actions.tech)) {
            const action = actions.tech[tech_name];
            if (!action) continue;

            // Basic checks
            if (!checkTechPath(tech_name)) continue;
            if (checkOldTech(tech_name)) continue;
            if (!checkTechQualifications(action, tech_name)) continue;
            if (!checkTechRequirements(tech_name, predList)) continue;

            // Affordability check
            if (!window.evolve.checkAffordable(action, false)) continue;

            // 3. Execution
            if (isQueueUnlocked) {
                // Check if already in queue
                const isAlreadyQueued = global.r_queue.queue.some(q => q.id === action.id);
                if (!isAlreadyQueued && global.r_queue.queue.length < global.r_queue.max) {
                    global.r_queue.queue.push({
                        id: action.id,
                        action: 'tech',
                        type: tech_name,
                        label: typeof action.title === 'string' ? action.title : action.title(),
                        cna: false,
                        time: 0,
                        bres: false,
                        req: true
                    });
                    console.log(`[MAD Companion] Queued research: ${tech_name}`);
                    break; // Process one per tick
                }
            } else {
                // Early game: no research queue, trigger immediately
                if (action.action({isQueue: false})) {
                    const tech_grant_key = action.grant[0];
                    const tech_grant_val = action.grant[1];
                    global.tech[tech_grant_key] = tech_grant_val;
                    if (action['post']) {
                        try {
                            action.post();
                        } catch (e) {
                            console.error(`[MAD Companion] Error in post callback for ${tech_name}:`, e);
                        }
                    }
                    console.log(`[MAD Companion] Researched: ${tech_name}`);
                    break; // Process one per tick to prevent money cap issue
                }
            }
        }
    }

    function performAutoJobs() {
        if (!window.evolve || !window.evolve.global) return;
        const global = window.evolve.global;
        const defaultJob = global.civic.d_job || 'unemployed';
        const unemployedCount = global.civic[defaultJob]?.workers || 0;
        if (unemployedCount <= 0) return;

        // Prevent Starvation
        const foodRate = global.resource.Food?.rate || 0;
        if (foodRate <= 2 && global.civic.farmer && global.civic.farmer.display) {
            const farmerMax = global.civic.farmer.max !== undefined ? global.civic.farmer.max : -1;
            if (farmerMax === -1 || global.civic.farmer.workers < farmerMax) {
                global.civic.farmer.workers++;
                global.civic[defaultJob].workers--;
                global.civic.farmer.assigned = global.civic.farmer.workers;
                console.log(`[MAD Companion] Auto-assigned worker to farmer to prevent starvation.`);
                return;
            }
        }

        const jobTargets = {
            scholar: 0.40,
            farmer: 0.20,
            lumberjack: 0.20,
            miner: 0.20
        };

        const activeJobs = Object.keys(jobTargets).filter(j => global.civic[j]?.display);
        if (activeJobs.length === 0) return;

        let totalWorkers = 0;
        activeJobs.forEach(j => {
            totalWorkers += global.civic[j].workers || 0;
        });

        let bestJob = null;
        let worstDiff = -Infinity;

        activeJobs.forEach(j => {
            const count = global.civic[j].workers || 0;
            const share = totalWorkers > 0 ? (count / totalWorkers) : 0;
            const diff = jobTargets[j] - share;
            if (diff > worstDiff) {
                const max = global.civic[j].max !== undefined ? global.civic[j].max : -1;
                if (max === -1 || count < max) {
                    worstDiff = diff;
                    bestJob = j;
                }
            }
        });

        if (bestJob) {
            global.civic[bestJob].workers++;
            global.civic[defaultJob].workers--;
            global.civic[bestJob].assigned = global.civic[bestJob].workers;
            console.log(`[MAD Companion] Auto-assigned worker to ${bestJob}.`);
        }
    }

    function performAutoCraft() {
        if (!window.evolve || !window.evolve.global) return;
        const global = window.evolve.global;

        const craftResource = (resName) => {
            const resEl = document.getElementById('res' + resName);
            if (resEl && resEl.__vue__ && typeof resEl.__vue__.craft === 'function') {
                resEl.__vue__.craft(resName, 10);
                return true;
            }
            return false;
        };

        // Wood -> Plywood
        if (global.resource.Wood && global.resource.Wood.max > 0 && global.resource.Wood.amount >= 0.90 * global.resource.Wood.max) {
            craftResource('Plywood');
        }

        // Stone -> Brick
        if (global.resource.Stone && global.resource.Stone.max > 0 && global.resource.Stone.amount >= 0.90 * global.resource.Stone.max) {
            craftResource('Brick');
        }

        // Iron -> Alloy
        if (global.resource.Iron && global.resource.Iron.max > 0 && global.resource.Iron.amount >= 0.90 * global.resource.Iron.max) {
            craftResource('Alloy');
        }
    }

    function performAutoMarketBuy() {
        if (!window.evolve || !window.evolve.global) return;
        const global = window.evolve.global;
        const money = global.resource.Money;
        if (!money || money.amount < 0.90 * money.max) return;

        if (!global.queue || !global.queue.queue || global.queue.queue.length === 0) return;
        const nextItem = global.queue.queue[0];

        const action = getQueueAction(nextItem);
        if (!action || !action.cost) return;

        function isResourceBuyable(resName) {
            if (!global || !global.resource || !global.resource[resName]) return false;
            if (global.resource[resName].trade !== undefined) return true;
            const galacticBuyResources = new Set(['Deuterium', 'Neutronium', 'Adamantite', 'Elerium', 'Nano_Tube', 'Graphene', 'Stanene', 'Bolognium', 'Vitreloy']);
            return galacticBuyResources.has(resName);
        }

        let targetRes = null;
        let maxMissing = 0;

        Object.keys(action.cost).forEach(res => {
            if (res === 'Money') return;
            const costFn = action.cost[res];
            const cost = typeof costFn === 'function' ? costFn(0) : costFn;
            const current = global.resource[res]?.amount || 0;
            const max = global.resource[res]?.max || 0;

            if (cost > current && current < max) {
                const missing = cost - current;
                if (missing > maxMissing) {
                    maxMissing = missing;
                    targetRes = res;
                }
            }
        });

        if (targetRes && isResourceBuyable(targetRes)) {
            const resObj = global.resource[targetRes];
            if (resObj) {
                const price = resObj.value || 1;
                const amount = Math.min(
                    Math.ceil(resObj.max * 0.10),
                    Math.floor((money.amount * 0.20) / price),
                    resObj.max - resObj.amount
                );
                if (amount > 0) {
                    resObj.amount += amount;
                    global.resource.Money.amount -= Math.round(price * amount);
                    resObj.value += Number((amount / 5000).toFixed(2));
                    console.log(`[MAD Companion] Auto-bought ${amount} ${targetRes} to unlock queue bottleneck.`);
                }
            }
        }
    }

    // ==========================================
    // 5. UI GENERATION & OVERLAYS
    // ==========================================
    function injectStyles() {
        if (document.getElementById('mad-companion-styles')) return;
        const style = document.createElement('style');
        style.id = 'mad-companion-styles';
        style.textContent = `
            #mad-companion-panel {
                border: 1px solid rgba(128, 128, 128, 0.2);
                border-radius: 4px;
                padding: 10px;
                margin-bottom: 15px;
                font-size: 0.85rem;
                background-color: rgba(0, 0, 0, 0.1);
            }
            .mad-title {
                font-weight: bold;
                margin-bottom: 8px;
                display: flex;
                justify-content: space-between;
                cursor: pointer;
            }
            .mad-section {
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid rgba(128, 128, 128, 0.15);
            }
            .mad-badge {
                font-size: 0.72rem;
                font-weight: bold;
                padding: 2px 5px;
                border-radius: 3px;
                margin-left: 5px;
            }
            .mad-pending {
                background-color: #3ec48c;
                color: #fff;
            }
            .mad-complete {
                background-color: #7a7a7a;
                color: #fff;
            }
            .mad-warn {
                background-color: #ffdd57;
                color: #363636;
            }
            .challenge-alert {
                animation: flash-border 1.5s infinite alternate;
                border: 1px solid #ff3860 !important;
                padding: 8px;
                margin-bottom: 10px;
                border-radius: 4px;
                background-color: rgba(255, 56, 96, 0.1);
                color: #ff3860;
                font-weight: bold;
                text-align: center;
            }
            @keyframes flash-border {
                from { border-color: #ff3860; box-shadow: 0 0 2px #ff3860; }
                to { border-color: rgba(255, 56, 96, 0.2); box-shadow: 0 0 10px rgba(255, 56, 96, 0.6); }
            }
        `;
        document.head.appendChild(style);
    }

    function updateDashboard() {
        if (!window.evolve || !window.evolve.global) return;
        
        const msgQueue = document.getElementById('msgQueue');
        if (!msgQueue) return;
        const container = msgQueue.parentNode;
        if (!container) return;

        let panel = document.getElementById('mad-companion-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'mad-companion-panel';
        }
        
        // Ensure panel is placed immediately before msgQueue (below building queue, above event log)
        if (panel.parentNode !== container || panel.nextSibling !== msgQueue) {
            container.insertBefore(panel, msgQueue);
        }

        const global = window.evolve.global;
        const species = global.race.species || 'Unknown';
        const biome = global.city.biome || 'Unknown';
        const universe = global.race.universe || 'Standard';

        // Count completed Evil MAD resets
        const achievements = global.stats.achieve || {};
        const affix = getUniverseAffix();
        
        let completedMADCount = 0;
        const allRaces = Object.keys(GENUS_MAP);
        allRaces.forEach(r => {
            if (achievements[`extinct_${r}`]?.[affix] > 0) {
                completedMADCount++;
            }
        });

        // Genus custom trait resets status
        let traitGenusesHTML = '';
        TARGET_GENUSES.forEach(g => {
            const done = isGenusBioseeded(g);
            traitGenusesHTML += `
                <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
                    <span>${g.charAt(0).toUpperCase() + g.slice(1)} Trait:</span>
                    <span class="mad-badge ${done ? 'mad-complete' : 'mad-warn'}">${done ? 'Unlocked (T2)' : 'Locked'}</span>
                </div>
            `;
        });

        // Determine Next Goal
        const pendingOnPlanet = getUncompletedSpeciesOnPlanet(biome);
        let goalText = '';
        let goalClass = '';
        let targetSpeciesHTML = '';
        
        const isPrebiotic = global.race.species === 'protoplasm' || !global.race.species;
        const missingChallenge = !global.race.no_trade || !global.race.no_crispr;

        if (isPrebiotic) {
            // Check if final evolution screen is active (either Sentience button or specific species buttons are in the DOM)
            const hasSentienceBtn = !!document.getElementById('evolution-sentience');
            const activeSpeciesKeys = Array.from(document.querySelectorAll('[id^="evolution-"]'))
                .map(el => el.id.replace('evolution-', ''))
                .filter(k => GENUS_MAP.hasOwnProperty(k));
            const isFinalEvolutionScreen = hasSentienceBtn || activeSpeciesKeys.length > 0;

            if (missingChallenge && isFinalEvolutionScreen) {
                goalText = `⚠️ ENABLE CHALLENGE GENES FIRST!`;
                goalClass = 'mad-warn';
            } else if (pendingOnPlanet.length > 0) {
                const targetSpecies = pendingOnPlanet[0];
                const targetGenus = GENUS_MAP[targetSpecies];
                
                // Find all prehistoric fork buttons currently in the DOM
                const activeForkKeys = Array.from(document.querySelectorAll('[id^="evolution-"]'))
                    .map(el => el.id.replace('evolution-', ''))
                    .filter(k => FORK_GENUS_MAP.hasOwnProperty(k));

                let recommendedBranchName = 'Unknown';
                activeForkKeys.forEach(k => {
                    if (FORK_GENUS_MAP[k].includes(targetGenus)) {
                        const el = document.getElementById('evolution-' + k);
                        const aTitle = el?.querySelector('.aTitle')?.textContent || k;
                        recommendedBranchName = `${aTitle.trim()} (${k})`;
                    }
                });

                if (recommendedBranchName === 'Unknown') {
                    // Fallback to kingdom fork if not rendered on screen yet
                    let recommendedForkName = 'Animals (Phagocytosis)';
                    if (targetGenus === 'plant') recommendedForkName = 'Plants (Chloroplasts)';
                    else if (targetGenus === 'fungi') recommendedForkName = 'Fungi (Chitin)';
                    recommendedBranchName = recommendedForkName;
                }

                goalText = `Evolve: target ${targetSpecies.toUpperCase()}`;
                goalClass = 'mad-pending';
                targetSpeciesHTML = `
                    <div class="mad-section">
                        <div style="font-weight:bold; margin-bottom:2px;">Target Branch:</div>
                        <div style="font-size:0.8rem; color:#3ec48c; margin-bottom:6px; font-weight:bold;">${recommendedBranchName}</div>
                        <div style="font-weight:bold; margin-bottom:4px;">Uncompleted Species:</div>
                        <div style="display:flex; flex-wrap:wrap; gap:4px;">
                            ${pendingOnPlanet.map(sp => {
                                const genus = GENUS_MAP[sp];
                                const needsBioseed = TARGET_GENUSES.includes(genus) && !isGenusBioseeded(genus);
                                const badgeClass = needsBioseed ? 'mad-warn' : 'mad-pending';
                                const badgeLabel = needsBioseed ? 'Needs T2' : 'Pending';
                                return `<span class="mad-badge ${badgeClass}" style="margin:0; font-size:0.65rem; padding: 2px 4px;">${sp.toUpperCase()} (${badgeLabel})</span>`;
                            }).join('')}
                        </div>
                    </div>
                `;
            } else {
                goalText = `⚠️ RESET BIOSEED! All species done.`;
                goalClass = 'mad-warn';
            }
        } else if (pendingOnPlanet.length > 0) {
            const curPending = !isSpeciesReset(species);
            if (curPending) {
                goalText = `Grind MAD: ${species.toUpperCase()} (Pending)`;
                goalClass = 'mad-pending';
            } else {
                goalText = `Current MAD Done. Pick next uncompleted species.`;
                goalClass = 'mad-warn';
            }
        } else {
            goalText = `⚠️ RESET BIOSEED! All species on this planet are MAD completed.`;
            goalClass = 'mad-warn';
        }
        const isConflict = window.isEvolveAutobuyActive || document.getElementById('autobuy-dashboard');
        let conflictHTML = '';
        if (isConflict) {
            conflictHTML = `<div class="challenge-alert">⚠️ CONFLICT DETECTED!<br>Evolve Auto-Buy is active! Disable it to use Evolve MAD Farm Companion.</div>`;
        }

        // Challenge reminder
        let challengeReminderHTML = '';
        if (missingChallenge) {
            if (isPrebiotic) {
                challengeReminderHTML = `<div class="challenge-alert">⚠️ WARNING: CHALLENGE GENES NOT ENABLED!<br>Ensure No Free Trade & Weak CRISPR are ON before evolving!</div>`;
            } else {
                challengeReminderHTML = `<div class="challenge-alert">⚠️ CHALLENGE GENES MISSED!<br>Ensure No Free Trade & Weak CRISPR are ON!</div>`;
            }
        }

        // Check if planet selection screen is active and retrieve choices
        const planetContainers = Array.from(document.querySelectorAll('#evolution .action a.button'));
        const biomesList = ['desert', 'forest', 'grassland', 'tundra', 'oceanic', 'volcanic', 'ashland', 'swamp', 'taiga', 'savanna', 'hellscape', 'eden'];
        const isPlanetScreen = planetContainers.length > 0 && planetContainers.some(card => {
            const txt = card.textContent.toLowerCase();
            return biomesList.some(b => txt.includes(b));
        });

        let planetSectionHTML = '';
        if (isPlanetScreen) {
            const missingAquatic = !isSpeciesReset('sharkin') || !isSpeciesReset('octigoran');
            const missingHeat = !isSpeciesReset('phoenix') || !isSpeciesReset('salamander');
            const missingPolar = !isSpeciesReset('yeti') || !isSpeciesReset('wendigo');
            const missingSand = !isSpeciesReset('tuskin') || !isSpeciesReset('kamel');

            let planetChoices = [];
            planetContainers.forEach((card, idx) => {
                const text = card.textContent.trim();
                const textLower = text.toLowerCase();
                let priorityText = '';
                let priorityClass = '';
                let isPriority = false;

                if (textLower.includes('oceanic') || textLower.includes('swamp')) {
                    if (missingAquatic) {
                        priorityText = 'Priority 1: Aquatic';
                        priorityClass = 'mad-pending';
                        isPriority = true;
                    }
                } else if (textLower.includes('volcanic') || textLower.includes('ashland')) {
                    if (missingHeat) {
                        priorityText = 'Priority 2: Heat';
                        priorityClass = 'mad-pending';
                        isPriority = true;
                    }
                } else if (textLower.includes('tundra') || textLower.includes('taiga')) {
                    if (missingPolar) {
                        priorityText = 'Priority 3: Polar';
                        priorityClass = 'mad-pending';
                        isPriority = true;
                    }
                } else if (textLower.includes('desert')) {
                    if (missingSand) {
                        priorityText = 'Priority 4: Sand';
                        priorityClass = 'mad-pending';
                        isPriority = true;
                    }
                }

                if (!priorityText && (textLower.includes('forest') || textLower.includes('grassland') || textLower.includes('savanna'))) {
                    priorityText = 'Priority 5: Fallback';
                    priorityClass = 'mad-complete';
                }

                if (!priorityText) {
                    priorityText = 'Other Biome';
                    priorityClass = 'mad-complete';
                }

                // Extract planet name
                const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
                const planetName = lines[0] || 'Unknown Planet';

                planetChoices.push({
                    name: planetName,
                    priorityText: priorityText,
                    priorityClass: priorityClass,
                    isPriority: isPriority
                });
            });

            planetSectionHTML = `
                <div class="mad-section">
                    <div style="font-weight:bold; margin-bottom:4px;">Planet Choices:</div>
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        ${planetChoices.map(c => `
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:5px; border: 1px solid rgba(128,128,128,0.2); padding: 3px; border-radius:3px;">
                                <span style="font-weight:${c.isPriority ? 'bold' : 'normal'}; color:${c.isPriority ? '#3ec48c' : 'inherit'};">${c.name}</span>
                                <span class="mad-badge ${c.priorityClass}" style="margin:0; font-size:0.65rem;">${c.priorityText}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        panel.innerHTML = `
            ${conflictHTML}
            ${isConflict ? '' : challengeReminderHTML}
            <div class="mad-title" id="mad-companion-toggle">
                <span>MAD Farm Companion v0.5.0</span>
                <span>${settings.collapsed ? '▼' : '▲'}</span>
            </div>
            <div id="mad-companion-body" style="display: ${settings.collapsed ? 'none' : 'block'};">
                ${isConflict ? '<div style="color: #ff3860; font-weight: bold; text-align: center; padding: 10px;">Companion is paused due to Auto-Buy conflict.</div>' : `
                <div style="margin-bottom: 5px;"><strong>Universe:</strong> ${universe.toUpperCase()}</div>
                <div style="margin-bottom: 5px;"><strong>Biome:</strong> ${biome.toUpperCase()}</div>
                <div style="margin-bottom: 5px;"><strong>Active Run:</strong> ${species.toUpperCase()}</div>`}
                <div style="margin-bottom: 8px;"><strong>Farmed MADs:</strong> ${completedMADCount} Completed</div>

                <div class="mad-section">
                    <div style="font-weight:bold; margin-bottom:4px;">Next Action:</div>
                    <div class="mad-badge ${goalClass}" style="margin:0; display:block; text-align:center; padding: 4px;">${goalText}</div>
                </div>

                ${targetSpeciesHTML}

                ${planetSectionHTML}

                <div class="mad-section">
                    <div style="font-weight:bold; margin-bottom:4px;">Genelab Custom Traits:</div>
                    ${traitGenusesHTML}
                </div>

                <div class="mad-section" style="display:flex; flex-direction:column; gap:4px;">
                    <div style="font-weight:bold;">Automation Options:</div>
                    <label style="display:flex; align-items:center; gap:5px; cursor:pointer;">
                        <input type="checkbox" id="mad-opt-master" ${settings.enabled ? 'checked' : ''}>
                        <span>Master Enable</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; cursor:pointer;">
                        <input type="checkbox" id="mad-opt-research" ${settings.autoResearch ? 'checked' : ''}>
                        <span>Auto-Research</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; cursor:pointer;">
                        <input type="checkbox" id="mad-opt-build" ${settings.autoBuild ? 'checked' : ''}>
                        <span>Auto-Build (Queue)</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; cursor:pointer;">
                        <input type="checkbox" id="mad-opt-jobs" ${settings.autoJobs ? 'checked' : ''}>
                        <span>Auto-Jobs</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; cursor:pointer;">
                        <input type="checkbox" id="mad-opt-craft" ${settings.autoCraft ? 'checked' : ''}>
                        <span>Auto-Craft Capped</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; cursor:pointer;">
                        <input type="checkbox" id="mad-opt-market" ${settings.autoMarket ? 'checked' : ''}>
                        <span>Auto-Market Queue Help</span>
                    </label>
                </div>
            </div>
        `;

        // Bind events
        document.getElementById('mad-companion-toggle').addEventListener('click', () => {
            settings.collapsed = !settings.collapsed;
            saveSettings();
            updateDashboard();
        });
        
        const bindToggle = (id, key) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', (e) => {
                    settings[key] = e.target.checked;
                    saveSettings();
                });
            }
        };

        bindToggle('mad-opt-master', 'enabled');
        bindToggle('mad-opt-research', 'autoResearch');
        bindToggle('mad-opt-build', 'autoBuild');
        bindToggle('mad-opt-jobs', 'autoJobs');
        bindToggle('mad-opt-craft', 'autoCraft');
        bindToggle('mad-opt-market', 'autoMarket');
    }

    // ==========================================
    // 6. EVOLUTION & PLANET SCREEN GUIDES
    // ==========================================
    function applyGuides() {
        if (!window.evolve || !window.evolve.global) return;
        const global = window.evolve.global;
        const affix = getUniverseAffix();

        // 1. Evolution Page Species/Genus/Fork Guides
        let cssRules = [];
        const elements = document.querySelectorAll('[id^="evolution-"]');
        const isPrebiotic = global.race.species === 'protoplasm' || !global.race.species;
        const missingChallenge = !global.race.no_trade || !global.race.no_crispr;

        // Check if final evolution screen is active (either Sentience button or specific species buttons are in the DOM)
        const hasSentienceBtn = !!document.getElementById('evolution-sentience');
        const activeSpeciesKeys = Array.from(elements)
            .map(el => el.id.replace('evolution-', ''))
            .filter(k => GENUS_MAP.hasOwnProperty(k));
        const isFinalEvolutionScreen = hasSentienceBtn || activeSpeciesKeys.length > 0;

        elements.forEach(el => {
            // Safely remove old badges if they exist
            const oldBadge = el.querySelector('.mad-companion-badge');
            if (oldBadge) {
                oldBadge.remove();
            }

            const key = el.id.replace('evolution-', '');

            // Special handling if final evolution screen is active but challenge genes are missing
            if (isFinalEvolutionScreen && missingChallenge) {
                if (isFinalEvolutionButton(key)) {
                    // Force skip styling on final species/sentience to block premature evolution
                    cssRules.push(`#${el.id} a.button, #${el.id} button { border: 1px dashed #7a7a7a !important; box-shadow: none !important; opacity: 0.5 !important; }`);
                } else if (key === 'bunker') {
                    // Highlight the "Challenge Gene" button
                    cssRules.push(`#${el.id} a.button, #${el.id} button { border: 2px solid #ffdd57 !important; box-shadow: 0 0 5px #ffdd57 !important; opacity: 1.0 !important; }`);
                } else if (key === 'trade' && !global.race['no_trade']) {
                    // Highlight No Free Trade if missing
                    cssRules.push(`#${el.id} a.button, #${el.id} button { border: 2px solid #3ec48c !important; box-shadow: 0 0 5px #3ec48c !important; opacity: 1.0 !important; }`);
                } else if (key === 'crispr' && !global.race['no_crispr']) {
                    // Highlight Weak CRISPR if missing
                    cssRules.push(`#${el.id} a.button, #${el.id} button { border: 2px solid #3ec48c !important; box-shadow: 0 0 5px #3ec48c !important; opacity: 1.0 !important; }`);
                } else if (key === 'trade' || key === 'crispr') {
                    // Skip completed challenge buttons
                    cssRules.push(`#${el.id} a.button, #${el.id} button { border: 1px dashed #7a7a7a !important; box-shadow: none !important; opacity: 0.5 !important; }`);
                }
                return;
            }

            if (GENUS_MAP[key]) {
                // It is a species!
                const isReset = isSpeciesReset(key);
                const genus = GENUS_MAP[key];
                const needsBioseed = TARGET_GENUSES.includes(genus) && !isGenusBioseeded(genus);

                if (isReset) {
                    cssRules.push(`#${el.id} a.button, #${el.id} button { border: 1px dashed #7a7a7a !important; box-shadow: none !important; opacity: 0.5 !important; }`);
                } else {
                    if (needsBioseed) {
                        cssRules.push(`#${el.id} a.button, #${el.id} button { border: 2px solid #ffdd57 !important; box-shadow: 0 0 5px #ffdd57 !important; opacity: 1.0 !important; }`);
                    } else {
                        cssRules.push(`#${el.id} a.button, #${el.id} button { border: 2px solid #3ec48c !important; box-shadow: 0 0 5px #3ec48c !important; opacity: 1.0 !important; }`);
                    }
                }
            } else if (TARGET_GENUSES.includes(key)) {
                // It is a genus!
                const done = isGenusBioseeded(key);
                if (done) {
                    cssRules.push(`#${el.id} a.button, #${el.id} button { border: 1px dashed #7a7a7a !important; box-shadow: none !important; opacity: 0.5 !important; }`);
                } else {
                    cssRules.push(`#${el.id} a.button, #${el.id} button { border: 2px solid #ffdd57 !important; box-shadow: 0 0 5px #ffdd57 !important; opacity: 1.0 !important; }`);
                }
            } else if (FORK_GENUS_MAP.hasOwnProperty(key)) {
                // Prehistoric Kingdom & Sub-branch Fork buttons
                const pendingOnPlanet = getUncompletedSpeciesOnPlanet(global.city.biome || 'Unknown');
                if (pendingOnPlanet.length > 0 && (global.race.species === 'protoplasm' || !global.race.species)) {
                    const targetSpecies = pendingOnPlanet[0];
                    const targetGenus = GENUS_MAP[targetSpecies];

                    if (FORK_GENUS_MAP[key].includes(targetGenus)) {
                        cssRules.push(`#${el.id} a.button, #${el.id} button { border: 2px solid #3ec48c !important; box-shadow: 0 0 5px #3ec48c !important; opacity: 1.0 !important; }`);
                    } else {
                        cssRules.push(`#${el.id} a.button, #${el.id} button { border: 1px dashed #7a7a7a !important; box-shadow: none !important; opacity: 0.5 !important; }`);
                    }
                }
            }
        });

        // Apply generated CSS rules to the dynamic style block
        let guidesStyle = document.getElementById('mad-companion-guides-style');
        if (!guidesStyle) {
            guidesStyle = document.createElement('style');
            guidesStyle.id = 'mad-companion-guides-style';
            document.head.appendChild(guidesStyle);
        }
        guidesStyle.textContent = cssRules.join('\n');

        // 2. Planet Selection Guides
        const planetContainers = Array.from(document.querySelectorAll('#evolution .action a.button'));
        const biomesList = ['desert', 'forest', 'grassland', 'tundra', 'oceanic', 'volcanic', 'ashland', 'swamp', 'taiga', 'savanna', 'hellscape', 'eden'];
        const isPlanetScreen = planetContainers.length > 0 && planetContainers.some(card => {
            const txt = card.textContent.toLowerCase();
            return biomesList.some(b => txt.includes(b));
        });

        if (isPlanetScreen) {
            // Find all missing genuses/biomes
            const missingAquatic = !isSpeciesReset('sharkin') || !isSpeciesReset('octigoran');
            const missingHeat = !isSpeciesReset('phoenix') || !isSpeciesReset('salamander');
            const missingPolar = !isSpeciesReset('yeti') || !isSpeciesReset('wendigo');
            const missingSand = !isSpeciesReset('tuskin') || !isSpeciesReset('kamel');

            planetContainers.forEach(card => {
                // Safely remove any previously injected elements if they exist
                const oldBadge = card.querySelector('.companion-priority');
                if (oldBadge) {
                    oldBadge.remove();
                }

                const text = card.textContent.toLowerCase();
                let priorityText = '';
                let priorityClass = '';
                let isPriority = false;

                if (text.includes('oceanic') || text.includes('swamp')) {
                    if (missingAquatic) {
                        priorityText = 'Priority 1';
                        priorityClass = 'mad-pending';
                        isPriority = true;
                    }
                } else if (text.includes('volcanic') || text.includes('ashland')) {
                    if (missingHeat) {
                        priorityText = 'Priority 2';
                        priorityClass = 'mad-pending';
                        isPriority = true;
                    }
                } else if (text.includes('tundra') || text.includes('taiga')) {
                    if (missingPolar) {
                        priorityText = 'Priority 3';
                        priorityClass = 'mad-pending';
                        isPriority = true;
                    }
                } else if (text.includes('desert')) {
                    if (missingSand) {
                        priorityText = 'Priority 4';
                        priorityClass = 'mad-pending';
                        isPriority = true;
                    }
                }

                if (!priorityText && (text.includes('forest') || text.includes('grassland') || text.includes('savanna'))) {
                    priorityText = 'Priority 5';
                    priorityClass = 'mad-complete';
                }

                if (isPriority) {
                    card.style.border = '2px solid #3ec48c';
                    card.style.boxShadow = '0 0 5px #3ec48c';
                    card.style.opacity = '1.0';
                } else {
                    card.style.border = '1px dashed #7a7a7a';
                    card.style.boxShadow = 'none';
                    card.style.opacity = '0.7';
                }
            });
        } else {
            planetContainers.forEach(card => {
                card.style.border = '';
                card.style.boxShadow = '';
                card.style.opacity = '';
            });
        }
    }

    // ==========================================
    // 7. INITIALIZATION & LOOP BINDING
    // ==========================================
    function init() {
        loadSettings();
        injectStyles();
        
        // Automation ticks every 2 seconds
        setInterval(runAutomation, 2000);
        
        // UI rendering loop (every 500ms for fast feedback)
        setInterval(() => {
            updateDashboard();
            applyGuides();
        }, 500);
    }

    // Wait for document to load fully
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init);
    }

})();
