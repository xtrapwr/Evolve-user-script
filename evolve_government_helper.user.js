// ==UserScript==
// @name         Evolve Government Helper
// @namespace    http://tampermonkey.net/
// @version      0.2.3
// @description  Advises on the ideal government type in Evolve Idle based on game progression, ziggurats, priests, and controlled cities.
// @author       Antigravity
// @license      MIT
// @match        https://pmotschmann.github.io/Evolve/*
// @match        https://*.github.io/Evolve/*
// @match        http://localhost:*/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/xtrapwr/Evolve-user-script/main/evolve_government_helper.user.js
// @downloadURL  https://raw.githubusercontent.com/xtrapwr/Evolve-user-script/main/evolve_government_helper.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 1. SYNCHRONOUS SAVE INTERCEPTION (document-start)
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
                            console.log("[Evolve Interceptor] Intercepted save and forced settings.expose = true");
                        }
                    }
                } catch (e) {
                    console.error("[Evolve Interceptor] Interception failed:", e);
                }
            }
            return val;
        };
        localStorage.getItem.isEvolveIntercepted = true;
    }

    // ==========================================
    // 2. STYLE INJECTION (INJECTED ONCE DOM IS READY)
    // ==========================================
    function injectStyles() {
        if (!document.head || document.getElementById('gov-helper-styles')) return;
        const style = document.createElement('style');
        style.id = 'gov-helper-styles';
        style.textContent = `
            #gov-helper-tooltip-trigger {
                border-bottom: 1px dashed rgba(128, 128, 128, 0.6);
                cursor: help;
            }
        `;
        document.head.appendChild(style);
    }

    // ==========================================
    // 3. DECISION LOGIC ENGINE
    // ==========================================
    function getBestGovernment() {
        if (!window.evolve || !window.evolve.global || !window.evolve.global.race || !window.evolve.global.civic || !window.evolve.global.tech) {
            return { name: "Loading...", reason: "Waiting for game state to initialize." };
        }

        const g = window.evolve.global;
        const hasTech = (tech, level = 1) => g.tech && g.tech[tech] && g.tech[tech] >= level;

        const currentGov = g.civic && g.civic.govern ? g.civic.govern.type : 'autocracy';

        // 1. Magic Universe - Magocracy Focus
        const isMagicUniverse = g.race && g.race.universe === 'magic';
        const wizards = g.civic && g.civic.scientist ? g.civic.scientist.workers : 0;
        const crystalMiners = g.civic && g.civic.crystal_miner ? g.civic.crystal_miner.workers : 0;
        
        if (isMagicUniverse && hasTech('gov_mage') && (wizards > 0 || crystalMiners > 0)) {
            if (!hasTech('world_control')) {
                return {
                    name: "Magocracy",
                    reason: `In the Magic universe, Magocracy is superior pre-unification. It boosts Mana generation from your ${wizards} wizards by +25%–30% and Crystal production from your ${crystalMiners} miners by +25%–50%.`
                };
            }
        }

        // 2. Check late-game Deep Space Theocracy vs Federation
        const hasZiggurat = g.space && g.space.ziggurat && g.space.ziggurat.count > 0;
        const hasAncientsGene = g.genes && g.genes.ancients >= 2;
        const hasPriests = g.civic && g.civic.priest && g.civic.priest.display;
        
        if (hasTech('gov_theo') && hasTech('gov_fed') && hasZiggurat && hasAncientsGene && hasPriests) {
            let numTemples = (g.city && g.city.temple) ? g.city.temple.count : 0;
            if (!g.race.cataclysm && !g.race.orbit_decayed && !g.race.lone_survivor && !g.race.warlord) {
                if (g.race.wish && g.race.wishStats && g.race.wishStats.temple) {
                    numTemples++;
                }
                if (g.genes && g.genes.ancients >= 6) {
                    numTemples++;
                }
            }

            const numColonists = g.civic.colonist ? g.civic.colonist.workers : 0;
            const numPriests = g.civic.priest ? g.civic.priest.workers : 0;

            if (numTemples > 0 && numColonists > 0) {
                const zBase = hasTech('ancient_study') ? 0.006 : 0.004;
                let zDeify = 0;
                if (hasTech('ancient_deify', 2) && g.space && g.space.exotic_lab) {
                    zDeify = 0.0001 * g.space.exotic_lab.on;
                }
                
                const coefF = zBase + zDeify;
                const coefT = zBase + zDeify + (0.00002 * numPriests);

                const vF = 1 + (numTemples * numColonists * coefF);
                const vT = 1 + (numTemples * numColonists * coefT);
                const ratio = vT / vF;

                if (ratio > 1.18) {
                    return {
                        name: "Theocracy",
                        reason: `Space production multiplier under Theocracy is <strong>${ratio.toFixed(2)}x</strong> (+${((ratio - 1) * 100).toFixed(1)}%) from Ziggurats, Temples (${numTemples}), Colonists (${numColonists}), and Priests (${numPriests}). This outscales Federation's advantages.`
                    };
                }
            }
        }

        // 3. Federation (General Late-Game / Pre-unification expansion)
        if (hasTech('gov_fed')) {
            if (hasTech('world_control')) {
                let fedUnif = hasTech('high_tech', 16) ? 40 : (hasTech('high_tech', 12) ? 36 : 32);
                return {
                    name: "Federation",
                    reason: `Unification is complete. Federation Alt raises your global Unification production bonus to +${fedUnif}% (instead of 25%) and raises morale by +10%–20% with zero drawbacks.`
                };
            }

            let controlledCities = 0;
            if (g.civic && g.civic.foreign) {
                for (let i = 0; i < 3; i++) {
                    const fGov = g.civic.foreign[`gov${i}`];
                    if (fGov && (fGov.occ || fGov.anx || fGov.buy)) {
                        controlledCities++;
                    }
                }
            }
            if (controlledCities >= 1) {
                return {
                    name: "Federation",
                    reason: `You control ${controlledCities} rival city(ies). Federation eliminates the cash upkeep for purchased cities and stress for annexed cities, and gives +8% production per controlled city (total +${controlledCities * 8}%).`
                };
            }
        }

        // 4. Research Intensive Phase: Technocracy
        if (hasTech('govern', 3)) {
            const scientistWorkers = g.civic.scientist ? g.civic.scientist.workers : 0;
            if (scientistWorkers > 15) {
                return {
                    name: "Technocracy",
                    reason: `You have ${scientistWorkers} scientists active. Technocracy increases knowledge generation by +10%–18% and reduces research costs by 8%, making it ideal for pushing technology.`
                };
            }
        }

        // 5. Crafting Phase: Socialist
        if (hasTech('gov_soc')) {
            const blacksmiths = (g.civic.blacksmith ? g.civic.blacksmith.workers : 0);
            if (blacksmiths > 10) {
                return {
                    name: "Socialist",
                    reason: `You have ${blacksmiths} blacksmiths active. Socialist increases crafting/manufacturing speed by +35%–50% and factory production by +10%–12%, which is excellent for surface building rushes (note: money income is reduced by 10%–20%).`
                };
            }
        }

        // 6. Mid-Game Factory / Cash Push: Corpocracy
        if (hasTech('gov_corp')) {
            const factoriesOn = g.city && g.city.factory ? g.city.factory.on : 0;
            if (factoriesOn > 5 && !hasTech('world_control')) {
                return {
                    name: "Corpocracy",
                    reason: `You have ${factoriesOn} active factories. Corpocracy boosts factory/graphene output by +30%–40% and raises income from casinos (+200%–220%) and tourism (+100%–110%), at the cost of -5%–10% morale.`
                };
            }
        }

        // 7. Dictatorship (Wish Unlocked)
        if (g.race.wish && g.race.wishStats && g.race.wishStats.gov) {
            return {
                name: "Dictator",
                reason: "Dictatorship increases all production by +10%–12% and reduces common material costs by 4%–6% (at the cost of +25%–30% job stress). Ideal pre-unification generalist government."
            };
        }

        // 8. Early-mid game general: Republic
        if (hasTech('govern', 2)) {
            return {
                name: "Republic",
                reason: "Republic increases global morale by +20%–40% and banker cash generation by +25%–30%, providing an outstanding general-purpose production and economy boost with no penalties."
            };
        }
        
        // 9. Early game general: Democracy / Managed Democracy
        if (hasTech('govern')) {
            const isEvil = g.race && g.race.universe === 'evil';
            return {
                name: isEvil ? "Managed Democracy" : "Democracy",
                reason: "Provides general work efficiency bonuses and entertainer stress reduction early on."
            };
        }

        // 10. Military focus: Autocracy
        if (g.civic && g.civic.garrison && g.civic.garrison.workers > 0) {
            return {
                name: "Autocracy",
                reason: "Autocracy increases combat/attack ratings by +35%–40% and reduces stress from fighting, which is great for early expansion campaigns."
            };
        }

        return {
            name: "Autocracy",
            reason: "Best available default early game government for stability and basic combat ratings."
        };
    }

    // ==========================================
    // 4. INFLECTION POINT ENGINE
    // ==========================================
    function getInflectionPoint() {
        if (!window.evolve || !window.evolve.global || !window.evolve.global.race || !window.evolve.global.civic || !window.evolve.global.tech) {
            return null;
        }

        const g = window.evolve.global;
        const hasTech = (tech, level = 1) => g.tech && g.tech[tech] && g.tech[tech] >= level;
        const maxKnowledge = g.resource && g.resource.Knowledge ? g.resource.Knowledge.max : 0;

        // 1. Republic Inflection Point
        if (hasTech('govern') && !hasTech('govern', 2) && !hasTech('gov_soc')) {
            if (maxKnowledge >= 14000) {
                return `Republic / Socialist unlock is close (costs 17k max Knowledge; current max: ${Math.round(maxKnowledge).toLocaleString()})`;
            }
        }

        // 2. Federation Inflection Point
        if (hasTech('govern', 2) && !hasTech('gov_fed')) {
            if (maxKnowledge >= 24000) {
                return `Federation unlock is close (costs 30k max Knowledge + Unification/controlled city; current max: ${Math.round(maxKnowledge).toLocaleString()})`;
            }
        }

        // 3. Technocracy / Corpocracy Inflection Point
        if (hasTech('govern', 2) && !hasTech('govern', 3) && !hasTech('gov_corp')) {
            if (maxKnowledge >= 22000) {
                return `Technocracy / Corpocracy unlock is close (costs 26k max Knowledge; current max: ${Math.round(maxKnowledge).toLocaleString()})`;
            }
        }

        // 4. World Unification Complete (Federation Alt check)
        if (hasTech('gov_fed') && !hasTech('world_control')) {
            let controlledCities = 0;
            if (g.civic && g.civic.foreign) {
                for (let i = 0; i < 3; i++) {
                    const fGov = g.civic.foreign[`gov${i}`];
                    if (fGov && (fGov.occ || fGov.anx || fGov.buy)) {
                        controlledCities++;
                    }
                }
            }
            if (controlledCities >= 2) {
                return `Approaching World Unification (Federation Alt will boost global production by +32%–40% once unified)`;
            }
        }

        // 5. Theocracy space production outscaling Federation
        const hasZiggurat = g.space && g.space.ziggurat && g.space.ziggurat.count > 0;
        const hasAncientsGene = g.genes && g.genes.ancients >= 2;
        const hasPriests = g.civic && g.civic.priest && g.civic.priest.display;
        if (hasTech('gov_theo') && hasTech('gov_fed') && hasZiggurat && hasAncientsGene && hasPriests) {
            let numTemples = (g.city && g.city.temple) ? g.city.temple.count : 0;
            if (!g.race.cataclysm && !g.race.orbit_decayed && !g.race.lone_survivor && !g.race.warlord) {
                if (g.race.wish && g.race.wishStats && g.race.wishStats.temple) {
                    numTemples++;
                }
                if (g.genes && g.genes.ancients >= 6) {
                    numTemples++;
                }
            }
            const numColonists = g.civic.colonist ? g.civic.colonist.workers : 0;
            const numPriests = g.civic.priest ? g.civic.priest.workers : 0;

            if (numTemples > 0 && numColonists > 0) {
                const zBase = hasTech('ancient_study') ? 0.006 : 0.004;
                let zDeify = 0;
                if (hasTech('ancient_deify', 2) && g.space && g.space.exotic_lab) {
                    zDeify = 0.0001 * g.space.exotic_lab.on;
                }
                const coefF = zBase + zDeify;
                const coefT = zBase + zDeify + (0.00002 * numPriests);

                const vF = 1 + (numTemples * numColonists * coefF);
                const vT = 1 + (numTemples * numColonists * coefT);
                const ratio = vT / vF;

                if (ratio >= 1.05 && ratio <= 1.18) {
                    return `Approaching Theocracy space production threshold (Ziggurat ratio: ${ratio.toFixed(2)}x / 1.18x target. Assign more Priests or build Temples/Ziggurats)`;
                }
            }
        }

        return null;
    }

    // ==========================================
    // 5. NATIVE POPOVER INTEGRATION
    // ==========================================
    let govHelperPopperRef = null;
    let handlersBound = false;

    function clearHelperPopper() {
        const popper = document.getElementById('popper');
        if (popper && popper.getAttribute('data-id') === 'gov-helper') {
            popper.style.display = 'none';
            popper.remove();
        }
        if (govHelperPopperRef) {
            govHelperPopperRef.destroy();
            govHelperPopperRef = null;
        }
    }

    function bindHandlers() {
        if (handlersBound) return;
        
        const $ = window.jQuery || window.$;
        if (!$) return;

        $(document).on('mouseenter', '#gov-helper-tooltip-trigger', function() {
            clearHelperPopper();

            const reason = this.getAttribute('data-reason');
            if (!reason) return;

            // Create popover container matching Evolve Idle's native popper layout/classes
            const popper = document.createElement('div');
            popper.id = 'popper';
            popper.className = 'popper pop-desc has-background-light has-text-dark';
            popper.setAttribute('data-id', 'gov-helper');
            popper.style.display = 'block';
            popper.innerHTML = reason;

            // Attach to #main or body
            const mainEl = document.getElementById('main');
            if (mainEl) {
                mainEl.appendChild(popper);
            } else {
                document.body.appendChild(popper);
            }

            // Position using the global Popper engine loaded by the game
            if (window.Popper) {
                govHelperPopperRef = window.Popper.createPopper(this, popper, {
                    placement: 'bottom',
                    modifiers: [
                        { name: 'flip', enabled: true },
                        { name: 'offset', options: { offset: [0, 8] } }
                    ]
                });
            }
        });

        $(document).on('mouseleave', '#gov-helper-tooltip-trigger', function() {
            clearHelperPopper();
        });

        handlersBound = true;
    }

    // ==========================================
    // 6. UI INJECTION & DOM RUNNER
    // ==========================================
    function injectUI() {
        // Attempt to bind native Popper event listeners
        bindHandlers();

        injectStyles();

        const govTypeEl = document.getElementById('govType');
        if (!govTypeEl) return;

        // Create or find our container
        let helperEl = document.getElementById('gov-helper-container');
        if (!helperEl) {
            helperEl = document.createElement('div');
            helperEl.id = 'gov-helper-container';
            helperEl.style.cssText = `
                margin-top: 0.5rem;
                padding-top: 0.5rem;
                border-top: 1px dashed rgba(128, 128, 128, 0.2);
                font-size: 0.85rem;
                line-height: 1.3;
            `;
            govTypeEl.appendChild(helperEl);
        }

        const best = getBestGovernment();
        const activeGov = window.evolve?.global?.civic?.govern?.type;
        const currentName = activeGov ? (activeGov.charAt(0).toUpperCase() + activeGov.slice(1)) : "";
        
        // Highlight logic
        const isIdealActive = currentName.toLowerCase() === best.name.toLowerCase() ||
                              (currentName.toLowerCase() === "managed democracy" && best.name.toLowerCase() === "democracy") ||
                              (currentName.toLowerCase() === "democracy" && best.name.toLowerCase() === "managed democracy") ||
                              (currentName.toLowerCase() === "dictatorship" && best.name.toLowerCase() === "dictator");

        const statusClass = isIdealActive ? "has-text-success" : "has-text-warning";
        const statusLabel = isIdealActive ? " (Active)" : " (Recommended)";

        const inflection = getInflectionPoint();
        const inflectionHTML = inflection 
            ? `<div style="font-size: 0.75rem; color: #888; margin-top: 0.25rem; font-style: italic;"><strong>Alert:</strong> ${inflection}</div>`
            : "";

        // Build HTML with the tooltip trigger pointing to our native event listener
        helperEl.innerHTML = `
            <div>
                <strong>Ideal Government:</strong> 
                <span id="gov-helper-tooltip-trigger" class="${statusClass}" style="font-weight: bold;" data-reason="${best.reason.replace(/"/g, '&quot;')}">
                    ${best.name}
                </span>
                <span class="${statusClass}">${statusLabel}</span>
            </div>
            ${inflectionHTML}
        `;
    }

    // Tick loop
    setInterval(() => {
        try {
            injectUI();
        } catch (e) {
            console.error("[Evolve Government Helper] UI Loop error:", e);
        }
    }, 500);

})();
