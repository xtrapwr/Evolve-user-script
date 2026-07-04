// ==UserScript==
// @name         Evolve MAD Farm Companion
// @namespace    http://tampermonkey.net/
// @version      1.1.4
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

    const CORE_EVO_KEYS = [
        'rna', 'dna', 'membrane', 'organelles', 'nucleus', 'eukaryotic_cell',
        'mitochondria', 'sexual_reproduction', 'multicellular', 'sentience'
    ];

    const FORK_GENUS_MAP = {
        // Kingdom level
        chitin: ['fungi'],
        spores: ['fungi'],
        chloroplasts: ['plant'],
        poikilohydric: ['plant'],
        bryophyte: ['plant'],
        phagocytosis: [
            'humanoid', 'giant', 'small', 'carnivore', 'herbivore', 'insectoid',
            'reptilian', 'avian', 'aquatic', 'fey', 'heat', 'polar', 'sand',
            'demonic', 'angelic'
        ],
        bilateral_symmetry: [
            'humanoid', 'giant', 'small', 'carnivore', 'herbivore', 'insectoid',
            'reptilian', 'avian', 'aquatic', 'fey', 'heat', 'polar', 'sand',
            'demonic', 'angelic'
        ],
        // Animal sub-branches (under phagocytosis -> bilateral_symmetry / vertebrates)
        athropods: ['insectoid'],
        eggshell: ['reptilian', 'avian'],
        ectothermic: ['reptilian'],
        endothermic: ['avian'],
        aquatic: ['aquatic'],
        fey: ['fey'],
        heat: ['heat'],
        polar: ['polar'],
        sand: ['sand'],
        mammals: ['humanoid', 'giant', 'small', 'carnivore', 'herbivore', 'demonic', 'angelic'],
        // Mammal sub-branches
        humanoid: ['humanoid'],
        gigantism: ['giant'],
        dwarfism: ['small'],
        animalism: ['carnivore', 'herbivore'],
        carnivore: ['carnivore'],
        herbivore: ['herbivore'],
        demonic: ['demonic'],
        celestial: ['angelic']
    };

    // Userscript Settings (LocalStorage cached)
    let settings = {
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

    let realGlobal = null;
    const originalStringify = JSON.stringify;
    try {
        JSON.stringify = function(value) {
            if (value && typeof value === 'object' && value.version && value.resource && value.city) {
                if (!window.evolve || value !== window.evolve.global) {
                    realGlobal = value;
                }
            }
            return originalStringify.apply(this, arguments);
        };
    } catch (e) {
        console.error("[MAD Companion] Error hooking JSON.stringify:", e);
    }

    function getRealGlobal() {
        if (realGlobal) return realGlobal;
        if (!window.evolve || !window.exportGame) return null;
        try {
            window.exportGame();
        } catch (e) {
            console.error("[MAD Companion] Error calling exportGame:", e);
        }
        return realGlobal || window.evolve?.global;
    }

    // ==========================================
    // 3. CORE LOGIC ENGINE
    // ==========================================
    function getUniverseAffix() {
        const global = getRealGlobal();
        const u = global?.race?.universe || 'standard';
        if (u === 'evil') return 'e';
        if (u === 'antimatter') return 'a';
        if (u === 'heavy') return 'h';
        if (u === 'micro') return 'm';
        if (u === 'magic') return 'mg';
        return 'l';
    }

    function isGenusBioseeded(genus) {
        const global = getRealGlobal();
        const ach = global?.stats?.achieve?.[`genus_${genus}`];
        return ach && ach.l >= 1;
    }

    function isSpeciesReset(species) {
        const global = getRealGlobal();
        const affix = getUniverseAffix();
        const ach = global?.stats?.achieve?.[`extinct_${species}`];
        return ach && ach[affix] && ach[affix] > 0;
    }

    function isSpeciesResetGlobally(species) {
        const global = getRealGlobal();
        const ach = global?.stats?.achieve?.[`extinct_${species}`];
        return ach && ach.l && ach.l >= 1;
    }

    function getAvailableSpecies(biome) {
        const global = getRealGlobal();
        if (!global) return [];

        // 1. Generate the base list of all species compatible with this biome
        const baseList = [
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
                    if (GENUS_MAP[species] === genus && !baseList.includes(species)) {
                        baseList.push(species);
                    }
                });
            }
        });

        // 2. Apply prebiotic kingdom and sub-branch filters if chosen in current run
        let list = baseList;
        if (global.tech) {
            // Kingdom restriction
            if (global.tech.evo_animal) {
                list = list.filter(species => GENUS_MAP[species] !== 'plant' && GENUS_MAP[species] !== 'fungi');
            } else if (global.tech.evo_plant) {
                list = list.filter(species => GENUS_MAP[species] === 'plant');
            } else if (global.tech.evo_fungi) {
                list = list.filter(species => GENUS_MAP[species] === 'fungi');
            }

            // Animal sub-branch restriction (only if they chose Animal and have progressed to evo >= 5)
            if (global.tech.evo_animal && global.tech.evo >= 5) {
                if (global.tech.evo_humanoid >= 1 || global.tech.evo_giant >= 1 || global.tech.evo_small >= 1 || global.tech.evo_demonic >= 1 || global.tech.evo_angelic >= 1 || global.tech.evo_animalism >= 1) {
                    const mammalsGenuses = ['humanoid', 'giant', 'small', 'carnivore', 'herbivore', 'demonic', 'angelic'];
                    list = list.filter(species => mammalsGenuses.includes(GENUS_MAP[species]));
                } else if (global.tech.evo_sand >= 2) {
                    list = list.filter(species => GENUS_MAP[species] === 'sand');
                } else if (global.tech.evo_eggshell >= 2) {
                    const eggshellGenuses = ['reptilian', 'avian'];
                    list = list.filter(species => eggshellGenuses.includes(GENUS_MAP[species]));
                } else if (global.tech.evo_insectoid >= 2) {
                    list = list.filter(species => GENUS_MAP[species] === 'insectoid');
                } else if (global.tech.evo_aquatic >= 2) {
                    list = list.filter(species => GENUS_MAP[species] === 'aquatic');
                } else if (global.tech.evo_fey >= 2) {
                    list = list.filter(species => GENUS_MAP[species] === 'fey');
                } else if (global.tech.evo_heat >= 2) {
                    list = list.filter(species => GENUS_MAP[species] === 'heat');
                } else if (global.tech.evo_polar >= 2) {
                    list = list.filter(species => GENUS_MAP[species] === 'polar');
                }
            }
        }

        // 3. Apply game mechanics restrictions (mass extinction achievements check)
        const hasMassExtinction = global.stats?.achieve?.['mass_extinction']?.l >= 1;
        const isSeededRun = global.race?.seeded;

        // If they don't have mass_extinction but it IS a seeded run, they are locked to the planet's native genus:
        const srace = global.race?.srace;
        if (!hasMassExtinction && isSeededRun && srace && GENUS_MAP[srace]) {
            const nativeGenus = GENUS_MAP[srace];
            return list.filter(species => GENUS_MAP[species] === nativeGenus);
        }

        return list;
    }

    function getNeedsT2Map(uncompletedList) {
        const needsT2Map = {};
        const genusGroups = {};
        uncompletedList.forEach(sp => {
            const genus = GENUS_MAP[sp];
            if (!genusGroups[genus]) {
                genusGroups[genus] = [];
            }
            genusGroups[genus].push(sp);
        });
        uncompletedList.forEach(sp => {
            const genus = GENUS_MAP[sp];
            let needsT2 = false;
            if (TARGET_GENUSES.includes(genus) && !isGenusBioseeded(genus)) {
                const group = genusGroups[genus];
                const t2Target = group[group.length - 1];
                if (sp === t2Target) {
                    needsT2 = true;
                }
            }
            needsT2Map[sp] = needsT2;
        });
        return needsT2Map;
    }

    function getUncompletedSpeciesOnPlanet(biome) {
        const available = getAvailableSpecies(biome);
        const uncompleted = available.filter(species => !isSpeciesReset(species));
        
        const needsT2Map = getNeedsT2Map(uncompleted);
        
        return uncompleted.sort((a, b) => {
            const aNeedsT2 = needsT2Map[a];
            const bNeedsT2 = needsT2Map[b];
            
            if (aNeedsT2 && !bNeedsT2) return 1;
            if (!aNeedsT2 && bNeedsT2) return -1;
            return 0;
        });
    }


    function isFinalEvolutionButton(key) {
        return key === 'sentience' || 
               key === 'custom' || 
               key === 'hybrid' || 
               key.startsWith('s-') || 
               GENUS_MAP.hasOwnProperty(key);
    }

    function getQueueAction(item) {
        if (!window.evolve || !getRealGlobal()) return null;
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
    // 4. AUTOMATION LOOPS (Removed in v1.0.0)
    // ==========================================

    // ==========================================
    // 5. UI GENERATION & OVERLAYS
    // ==========================================
    function injectStyles() {
        if (document.getElementById('mad-companion-styles')) return;
        const style = document.createElement('style');
        style.id = 'mad-companion-styles';
        style.textContent = `
            #mad-companion-panel {
                border-top: 1px solid rgba(128, 128, 128, 0.25);
                border-bottom: 1px solid rgba(128, 128, 128, 0.25);
                padding: 10px 0;
                font-size: 0.85rem;
                background-color: transparent;
                margin-bottom: 0;
            }
            .queueCol #mad-companion-panel {
                padding: 10px 1rem;
            }
            .queueCol #mad-companion-panel:first-child {
                margin-top: 2.625rem;
            }
            #mad-companion-panel + #buildQueue,
            #mad-companion-panel + #msgQueue {
                border-top: none !important;
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
        if (!window.evolve) return;
        const global = getRealGlobal();
        if (!global) return;



        const isPrehistoric = document.querySelector('#race .name')?.textContent.toLowerCase().includes('prehistoric');
        const isPrebiotic = isPrehistoric || global.race.species === 'protoplasm' || !global.race.species;
        const planetContainers = Array.from(document.querySelectorAll('#evolution .action a.button'));
        const biomesList = ['desert', 'forest', 'grassland', 'tundra', 'oceanic', 'volcanic', 'ashland', 'swamp', 'taiga', 'savanna', 'hellscape', 'eden'];
        const isPlanetScreen = planetContainers.length > 0 && planetContainers.some(card => {
            const txt = card.textContent.toLowerCase();
            return biomesList.some(b => txt.includes(b));
        });

        const shouldShowUI = isPrebiotic || isPlanetScreen;

        let panel = document.getElementById('mad-companion-panel');
        if (!shouldShowUI) {
            if (panel) {
                panel.style.display = 'none';
            }
            return;
        }

        const msgQueue = document.getElementById('msgQueue');
        if (!msgQueue) return;
        const container = msgQueue.parentNode;
        if (!container) return;

        const buildQueue = document.getElementById('buildQueue');
        const targetElement = buildQueue || msgQueue;

        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'mad-companion-panel';
        }
        panel.style.display = '';
        
        // Ensure panel is placed immediately before targetElement (above building queue if present, otherwise above event log)
        if (panel.parentNode !== container || panel.nextSibling !== targetElement) {
            container.insertBefore(panel, targetElement);
        }

        const species = isPrebiotic ? 'protoplasm' : (global.race.species || 'Unknown');
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

        // Challenge reminder
        let challengeReminderHTML = '';
        if (missingChallenge) {
            if (isPrebiotic) {
                challengeReminderHTML = `<div class="challenge-alert">⚠️ WARNING: CHALLENGE GENES NOT ENABLED!<br>Ensure No Free Trade & Weak CRISPR are ON before evolving!</div>`;
            } else {
                challengeReminderHTML = `<div class="challenge-alert">⚠️ CHALLENGE GENES MISSED!<br>Ensure No Free Trade & Weak CRISPR are ON!</div>`;
            }
        }

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
            ${challengeReminderHTML}
            <div class="mad-title" id="mad-companion-toggle">
                <span>MAD Farm Companion v1.1.4</span>
                <span>${settings.collapsed ? '▼' : '▲'}</span>
            </div>
            <div id="mad-companion-body" style="display: ${settings.collapsed ? 'none' : 'block'};">
                <div style="margin-bottom: 5px;"><strong>Universe:</strong> ${universe.toUpperCase()}</div>
                <div style="margin-bottom: 5px;"><strong>Biome:</strong> ${biome.toUpperCase()}</div>
                <div style="margin-bottom: 5px;"><strong>Active Run:</strong> ${species.toUpperCase()}</div>
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
            </div>
        `;

        // Bind events
        document.getElementById('mad-companion-toggle').addEventListener('click', () => {
            settings.collapsed = !settings.collapsed;
            saveSettings();
            updateDashboard();
        });
    }

    // ==========================================
    // 6. EVOLUTION & PLANET SCREEN GUIDES
    // ==========================================
    function applyGuides() {
        if (!window.evolve) return;
        const global = getRealGlobal();
        if (!global) return;

        const isPrehistoric = document.querySelector('#race .name')?.textContent.toLowerCase().includes('prehistoric');
        const isPrebiotic = isPrehistoric || global.race.species === 'protoplasm' || !global.race.species;
        const planetContainers = Array.from(document.querySelectorAll('#evolution .action a.button'));
        const biomesList = ['desert', 'forest', 'grassland', 'tundra', 'oceanic', 'volcanic', 'ashland', 'swamp', 'taiga', 'savanna', 'hellscape', 'eden'];
        const isPlanetScreen = planetContainers.length > 0 && planetContainers.some(card => {
            const txt = card.textContent.toLowerCase();
            return biomesList.some(b => txt.includes(b));
        });

        const shouldShowUI = isPrebiotic || isPlanetScreen;

        let guidesStyle = document.getElementById('mad-companion-guides-style');
        if (!shouldShowUI) {
            if (guidesStyle) {
                guidesStyle.textContent = '';
            }
            if (planetContainers.length > 0) {
                planetContainers.forEach(card => {
                    card.style.border = '';
                    card.style.boxShadow = '';
                    card.style.opacity = '';
                });
            }
            return;
        }

        const affix = getUniverseAffix();

        // 1. Evolution Page Species/Genus/Fork Guides
        let cssRules = [];
        const elements = document.querySelectorAll('[id^="evolution-"]');
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

            // We want to highlight the path to targetSpecies.
            const pendingOnPlanet = getUncompletedSpeciesOnPlanet(global.city.biome || 'Unknown');
            let targetSpecies = null;
            let targetGenus = null;
            if (pendingOnPlanet.length > 0 && isPrebiotic) {
                targetSpecies = pendingOnPlanet[0];
                targetGenus = GENUS_MAP[targetSpecies];
            }

            if (!targetSpecies) {
                // No target, dim everything except base UI buttons like bunker/challenge
                if (['bunker', 'trade', 'crispr', 'junk'].includes(key) || key.startsWith('s-') || CORE_EVO_KEYS.includes(key)) {
                    // Let it be
                } else {
                    cssRules.push(`#${el.id} a.button, #${el.id} button { border: 1px dashed #7a7a7a !important; box-shadow: none !important; opacity: 0.5 !important; }`);
                }
                return;
            }

            // Exclude CORE_EVO_KEYS from ANY styling (leave default Evolve styling)
            if (CORE_EVO_KEYS.includes(key)) {
                return;
            }

            let shouldHighlight = false;

            if (key === targetSpecies) {
                shouldHighlight = true;
            } else if (FORK_GENUS_MAP[key] && FORK_GENUS_MAP[key].includes(targetGenus)) {
                shouldHighlight = true;
            } else if (key === targetGenus) { 
                shouldHighlight = true;
            }

            if (shouldHighlight) {
                const needsBioseed = TARGET_GENUSES.includes(targetGenus) && !isGenusBioseeded(targetGenus);
                if (needsBioseed) {
                    cssRules.push(`#${el.id} a.button, #${el.id} button { border: 2px solid #ffdd57 !important; box-shadow: 0 0 5px #ffdd57 !important; opacity: 1.0 !important; }`);
                } else {
                    cssRules.push(`#${el.id} a.button, #${el.id} button { border: 2px solid #3ec48c !important; box-shadow: 0 0 5px #3ec48c !important; opacity: 1.0 !important; }`);
                }
            } else {
                if (!['bunker', 'trade', 'crispr', 'junk'].includes(key)) {
                    cssRules.push(`#${el.id} a.button, #${el.id} button { border: 1px dashed #7a7a7a !important; box-shadow: none !important; opacity: 0.5 !important; }`);
                }
            }
        });

        // Apply generated CSS rules to the dynamic style block
        if (!guidesStyle) {
            guidesStyle = document.createElement('style');
            guidesStyle.id = 'mad-companion-guides-style';
            document.head.appendChild(guidesStyle);
        }
        guidesStyle.textContent = cssRules.join('\n');

        // 2. Planet Selection Guides
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
                let isPriority = false;

                if (text.includes('oceanic') || text.includes('swamp')) {
                    if (missingAquatic) {
                        priorityText = 'Priority 1';
                        isPriority = true;
                    }
                } else if (text.includes('volcanic') || text.includes('ashland')) {
                    if (missingHeat) {
                        priorityText = 'Priority 2';
                        isPriority = true;
                    }
                } else if (text.includes('tundra') || text.includes('taiga')) {
                    if (missingPolar) {
                        priorityText = 'Priority 3';
                        isPriority = true;
                    }
                } else if (text.includes('desert')) {
                    if (missingSand) {
                        priorityText = 'Priority 4';
                        isPriority = true;
                    }
                }

                if (!priorityText && (text.includes('forest') || text.includes('grassland') || text.includes('savanna'))) {
                    priorityText = 'Priority 5';
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
