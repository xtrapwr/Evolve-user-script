// ==UserScript==
// @name         Evolve Idle Auto-Buy Automation
// @namespace    http://tampermonkey.net/
// @version      1.14.0
// @description  Automatically buys market items in Evolve Idle based on price, stock, funds, and build queue needs.
// @author       Antigravity
// @match        https://pmotschmann.github.io/Evolve/*
// @match        https://*.github.io/Evolve/*
// @match        http://localhost:*/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/xtrapwr/Evolve-user-script/main/evolve_autobuy.user.js
// @downloadURL  https://raw.githubusercontent.com/xtrapwr/Evolve-user-script/main/evolve_autobuy.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 1. SYNCHRONOUS SAVE INTERCEPTION (document-start)
    // ==========================================
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
                        console.log("[Evolve Auto-Buy] Intercepted save and forced settings.expose = true");
                    }
                }
            } catch (e) {
                console.error("[Evolve Auto-Buy] Interception failed:", e);
            }
        }
        return val;
    };

    // ==========================================
    // 2. SETTINGS MANAGEMENT
    // ==========================================
    let settings = {
        enabled: false,
        purchaseStrategy: 'time_saved',
        manageTradeRoutes: false,
        manageGalacticTradeRoutes: false,
        minGalacticTradePiracy: 0.5,
        showSettings: false,
        showDetails: false,
        resources: {}
    };

    try {
        let savedSettings = localStorage.getItem('evolve_autobuy_settings');
        if (savedSettings) {
            settings = Object.assign(settings, JSON.parse(savedSettings));
        }
    } catch (e) {
        console.error("[Evolve Auto-Buy] Failed to load settings", e);
    }

    function saveSettings() {
        localStorage.setItem('evolve_autobuy_settings', JSON.stringify(settings));
    }

    // Price tracking & queue state
    const priceHistory = {};
    const lastPurchasePrice = {};
    let currentQueueNeeds = {};
    let currentFirstNeededIndex = {};
    let currentPrimaryNeeds = {};
    let currentAllowedCrafts = {};
    let queueNeedsHistory = [];

    const defaultMultipliers = {
        Plywood: 1.5, Brick: 1.5, Wrought_Iron: 1.5, Sheet_Metal: 1.5,
        Mythril: 1.0, Aerogel: 1.0, Nanoweave: 1.0, Scarletite: 1.0,
        Quantium: 1.0, Thermite: 1.0
    };
    const measuredMultipliers = {};

    function getCraftingMultiplierViaFakeCraft(resName) {
        const resEl = document.getElementById('res' + resName);
        if (!resEl || !resEl.__vue__) return null;
        
        if (!window.evolve || !window.evolve.global) return null;
        const global = window.evolve.global;
        const craftCosts = window.evolve.craftCost || {};
        const recipe = craftCosts[resName];
        if (!recipe || recipe.length === 0) return null;
        
        // Save original values
        const originalPrecursors = {};
        const originalCrafted = global.resource[resName] ? global.resource[resName].amount : 0;
        
        let interceptedCraftBonus = null;
        try {
            // Set precursors to a very high amount to ensure they don't bottleneck
            recipe.forEach(ing => {
                const ingRes = ing.r;
                if (global.resource[ingRes]) {
                    originalPrecursors[ingRes] = global.resource[ingRes].amount;
                    global.resource[ingRes].amount = ing.a * 1000;
                }
            });
            
            // Set crafted to a baseline of 0
            if (global.resource[resName]) {
                global.resource[resName].amount = 0;
            }
            
            // Trigger craft (with vol = 1, which crafts 1 * keyMultiplier())
            resEl.__vue__.craft(resName, 1);
            
            // Since crafted amount was 0, the new amount is exactly: keyMult * craft_bonus
            let produced = global.resource[resName] ? global.resource[resName].amount : 0;
            
            // Calculate keyMult by checking how many precursors were consumed
            let firstIng = recipe[0];
            if (global.resource[firstIng.r]) {
                let consumed = (firstIng.a * 1000) - global.resource[firstIng.r].amount;
                let keyMult = consumed / firstIng.a;
                if (keyMult > 0) {
                    interceptedCraftBonus = produced / keyMult;
                }
            }
        } catch (e) {
            console.error(`[Evolve Auto-Buy] Error calculating crafting multiplier for ${resName}:`, e);
        } finally {
            // Restore original values
            recipe.forEach(ing => {
                const ingRes = ing.r;
                if (originalPrecursors.hasOwnProperty(ingRes) && global.resource[ingRes]) {
                    global.resource[ingRes].amount = originalPrecursors[ingRes];
                }
            });
            if (global.resource[resName]) {
                global.resource[resName].amount = originalCrafted;
            }
        }
        
        return interceptedCraftBonus;
    }

    const lastMultiplierMeasureTime = {};
    function getCraftMultiplier(resName) {
        const now = Date.now();
        const lastTime = lastMultiplierMeasureTime[resName] || 0;
        if (measuredMultipliers[resName] && (now - lastTime < 60000)) {
            return measuredMultipliers[resName];
        }
        const parsed = getCraftingMultiplierViaFakeCraft(resName);
        if (parsed !== null && parsed > 0) {
            measuredMultipliers[resName] = parsed;
            lastMultiplierMeasureTime[resName] = now;
            return parsed;
        }
        return defaultMultipliers[resName] || 1.0;
    }

    function isResourceCooledDown(resName, currentPrice, basePrice) {
        const lastPrice = lastPurchasePrice[resName];
        if (lastPrice === undefined) {
            return true; // No prior purchase, always cooled down
        }
        
        // 1. If the price is still exactly the same as the post-purchase price,
        // it means the game's fluctuation loop hasn't ticked yet.
        if (currentPrice === lastPrice) {
            return false;
        }
        
        // 2. If the price is still above the game's wrap-around limit (3x base),
        // it means the spike hasn't corrected yet (or we spiked it multiple times).
        if (currentPrice > basePrice * 3.0) {
            return false;
        }
        
        return true;
    }

    function recordPrices() {
        if (!window.evolve || !window.evolve.global) return;
        const global = window.evolve.global;
        Object.keys(global.resource).forEach(resName => {
            const currentPrice = getUnitPrice(resName);
            if (currentPrice !== null && resourceBaselines.hasOwnProperty(resName)) {
                if (!priceHistory[resName]) {
                    priceHistory[resName] = [];
                }
                priceHistory[resName].push(currentPrice);
                if (priceHistory[resName].length > 20) {
                    priceHistory[resName].shift();
                }
            }
        });
    }

    function isPriceDecaying(resName) {
        const history = priceHistory[resName];
        if (!history || history.length < 10) {
            return false;
        }
        const curPrice = history[history.length - 1];
        const oldPrice = history[history.length - 10];
        
        const decayThreshold = Math.max(0.002 * oldPrice, 0.1);
        if (curPrice < oldPrice - decayThreshold) {
            return true;
        }
        return false;
    }

    // ==========================================
    // 3. GAME PRICE & LOGIC CONSTANTS
    // ==========================================
    const resourceBaselines = {
        Food: 5, Lumber: 5, Chrysotile: 5, Stone: 5, Crystal: 6, Furs: 8,
        Copper: 25, Iron: 40, Aluminium: 50, Cement: 15, Coal: 20, Oil: 75,
        Uranium: 550, Steel: 100, Titanium: 150, Alloy: 350, Polymer: 250,
        Iridium: 420, Helium_3: 620, Deuterium: 950, Elerium: 2000, Water: 2,
        Neutronium: 1500, Adamantite: 2250, Infernite: 2750, Nano_Tube: 750,
        Graphene: 3000, Stanene: 3600, Bolognium: 9000, Vitreloy: 10200,
        Orichalcum: 99000, Asphodel_Powder: 249000
    };

    function getBasePrice(res, global) {
        let r_val = resourceBaselines[res] || (global.resource && global.resource[res] ? global.resource[res].value : 0);
        if (global.race && global.race['truepath']) {
            r_val *= 2;
        }
        if (res === 'Copper' && global.tech && global.tech['high_tech'] && global.tech['high_tech'] >= 2){
            r_val *= 2;
        }
        if (res === 'Titanium'){
            if (global.tech && global.tech['titanium'] && global.tech['titanium'] > 0){
                r_val *= (global.resource && global.resource.Alloy && global.resource.Alloy.display) ? 1 : 2.5;
            } else {
                r_val *= 5;
            }
        }
        return r_val;
    }

    function getFathomCheck(race, raceObj, cityObj, statsObj) {
        if (raceObj && raceObj['unfathomable'] && cityObj && cityObj['surfaceDwellers'] && cityObj.surfaceDwellers.includes(race) && cityObj['captive_housing']){
            let idx = cityObj.surfaceDwellers.indexOf(race);
            let active = cityObj.captive_housing[`race${idx}`];
            if (active > 100){ active = 100; }
            if (cityObj.torturer && active > cityObj.torturer.workers){
                let unsupervised = active - cityObj.torturer.workers;
                active -= Math.ceil(unsupervised / 3);
            }
            let rank = (statsObj && statsObj.achieve && statsObj.achieve.nightmare && statsObj.achieve.nightmare.mg ? statsObj.achieve.nightmare.mg : 0) / 5;
            return active / 100 * rank;
        }
        return 0;
    }

    function getUnitPrice(resName) {
        if (!window.evolve || !window.evolve.global) return null;
        const global = window.evolve.global;
        const traits = window.evolve.traits;

        if (!global.resource || !global.resource[resName]) return null;

        let value = global.resource[resName].value;

        // Apply Arrogant trait (+25% buy price)
        if (global.race && global.race['arrogant'] && traits && traits.arrogant){
            value *= 1 + (traits.arrogant.vars()[0] / 100);
        }

        // Apply Conniving trait (-10% buy price)
        if (global.race && global.race['conniving'] && traits && traits.conniving){
            value *= 1 - (traits.conniving.vars()[0] / 100);
        }

        // Apply Imp fathom check
        let fathom = getFathomCheck('imp', global.race, global.city, global.stats);
        if (fathom > 0 && traits && traits.conniving){
            value *= 1 - (traits.conniving.vars(1)[0] / 100 * fathom);
        }

        return value;
    }

    // ==========================================
    // 4. BUILDING QUEUE RESOURCE UTILS
    // ==========================================
    function calculateMechCost(size, infernal, standardize) {
        let soul = 9999;
        let cost = 10000000;
        const global = window.evolve.global;

        switch (size){
            case 'small':
                {
                    let baseCost = global.blood['prepared'] && global.blood.prepared >= 2 ? 50000 : 75000;
                    cost = infernal ? baseCost * 2.5 : baseCost;
                    soul = infernal ? 20 : 1;
                }
                break;
            case 'medium':
                {
                    cost = infernal ? 450000 : 180000;
                    soul = infernal ? 100 : 4;
                }
                break;
            case 'large':
                {
                    cost = infernal ? 925000 : 375000;
                    soul = infernal ? 500 : 20;
                }
                break;
            case 'titan':
                {
                    cost = infernal ? 1500000 : 750000;
                    soul = infernal ? 1500 : 75;
                }
                break;
            case 'collector':
                {
                    let baseCost = global.blood['prepared'] && global.blood.prepared >= 2 ? 8000 : 10000;
                    cost = infernal ? baseCost * 2.5 : baseCost;
                    soul = 1;
                }
                break;
            case 'minion':
                {
                    let baseCost = global.blood['prepared'] && global.blood.prepared >= 2 ? 30000 : 50000;
                    cost = infernal ? baseCost * 2.5 : baseCost;
                    soul = infernal ? 10 : 1;
                }
                break;
            case 'fiend':
                {
                    cost = infernal ? 300000 : 125000;
                    soul = infernal ? 40 : 4;
                }
                break;
            case 'cyberdemon':
                {
                    cost = infernal ? 625000 : 250000;
                    soul = infernal ? 120 : 12;
                }
                break;
            case 'archfiend':
                {
                    cost = infernal ? 1200000 : 600000;
                    soul = infernal ? 250 : 25;
                }
                break;
        }
        if (standardize) {
            return {
                Soul_Gem: soul,
                Supply: cost
            };
        }
        return { s: soul, c: cost };
    }

    function getQueueItemCosts(item) {
        if (!window.evolve || !window.evolve.global) return {};
        const actions = window.evolve.actions;
        const global = window.evolve.global;

        let c_action = null;
        let segments = item.id.split("-");

        // 1. ARPA Projects
        if (segments[0].substring(0, 4) === 'arpa') {
            const projectKey = segments[0].substring(4);
            const project = actions.arpa ? actions.arpa[projectKey] : null;
            if (project && project.cost) {
                let complete = global.arpa[projectKey] ? global.arpa[projectKey].complete : 0;
                let inc = Math.min(1, 100 - complete);

                let creativeCosts = {};
                let fathom = getFathomCheck('human', global.race, global.city, global.stats);
                Object.keys(project.cost).forEach(res => {
                    creativeCosts[res] = function() {
                        let cost = project.cost[res](undefined, false);
                        if (global.race['creative']) {
                            const traits = window.evolve.traits;
                            if (traits && traits.creative) {
                                cost *= (1 - traits.creative.vars()[1] / 100);
                            }
                        }
                        if (fathom > 0) {
                            const traits = window.evolve.traits;
                            if (traits && traits.creative) {
                                cost *= 1 - (traits.creative.vars(1)[1] / 100 * fathom);
                            }
                        }
                        return cost;
                    }
                });

                let final_costs = {};
                let adjusted = window.evolve.adjustCosts({ cost: creativeCosts });
                Object.keys(adjusted).forEach(res => {
                    let costVal = Math.round(adjusted[res]() * (inc / 100));
                    if (costVal > 0) {
                        final_costs[res] = costVal;
                    }
                });
                return final_costs;
            }
        }
        // 2. Space Ships
        else if (item.action === 'tp-ship') {
            if (window.evolve.shipCosts) {
                let raw = window.evolve.shipCosts(item.type);
                let final_costs = {};
                Object.keys(raw).forEach(res => {
                    final_costs[res] = raw[res];
                });
                return final_costs;
            }
        }
        // 3. Hell Mechs
        else if (item.action === 'hell-mech') {
            let raw = calculateMechCost(item.type.size, item.type.infernal, true);
            let final_costs = {};
            Object.keys(raw).forEach(res => {
                final_costs[res] = raw[res];
            });
            return final_costs;
        }
        // 4. Standard City / Evolution Buildings / Tech
        else if (segments[0] === 'city' || segments[0] === 'evolution' || segments[0] === 'starDock' || segments[0] === 'tech') {
            c_action = actions[segments[0]] ? actions[segments[0]][segments[1]] : null;
        }
        // 5. Space or Portal structures
        else {
            if (actions[segments[0]]) {
                Object.keys(actions[segments[0]]).forEach(region => {
                    if (actions[segments[0]][region] && typeof actions[segments[0]][region] === 'object' && actions[segments[0]][region].hasOwnProperty(segments[1])) {
                        c_action = actions[segments[0]][region][segments[1]];
                    }
                });
            }
        }

        let final_costs = {};
        if (c_action && c_action.cost) {
            let costs = window.evolve.adjustCosts(c_action);
            Object.keys(costs).forEach(res => {
                let cost = costs[res]();
                if (cost > 0) {
                    final_costs[res] = cost;
                }
            });
        }
        return final_costs;
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
        console.error("[Evolve Auto-Buy] Error hooking JSON.stringify:", e);
    }

    function getRealGlobal() {
        if (realGlobal) return realGlobal;
        if (!window.evolve || !window.exportGame) return null;
        try {
            window.exportGame();
        } catch (e) {
            console.error("[Evolve Auto-Buy] Error calling exportGame:", e);
        }
        return realGlobal;
    }

    function isResourceBuyable(resName, global) {
        if (!global || !global.resource || !global.resource[resName]) return false;
        if (global.resource[resName].trade !== undefined) return true;
        const galacticBuyResources = new Set(['Deuterium', 'Neutronium', 'Adamantite', 'Elerium', 'Nano_Tube', 'Graphene', 'Stanene', 'Bolognium', 'Vitreloy']);
        return galacticBuyResources.has(resName);
    }

    function getQueueNeeds() {
        if (!window.evolve || !window.evolve.global) return { needs: {}, firstNeededIndex: {}, primaryNeeds: {} };
        const global = window.evolve.global;

        const buildQueue = (global.queue && global.queue.queue) ? global.queue.queue : [];
        const researchQueue = (global.r_queue && global.r_queue.queue) ? global.r_queue.queue : [];

        if (buildQueue.length === 0 && researchQueue.length === 0) {
            window.autobuy_blocked_resources = null;
            currentAllowedCrafts = {};
            queueNeedsHistory = [];
            return { needs: {}, firstNeededIndex: {}, primaryNeeds: {} };
        }

        // Build combined queue putting building queue first (to prioritize building over research)
        const combinedQueue = [];
        for (let i = 0; i < buildQueue.length; i++) {
            combinedQueue.push({
                item: buildQueue[i],
                type: 'build',
                originalIndex: i,
                horizon: global.queue.max || 3
            });
        }
        for (let i = 0; i < researchQueue.length; i++) {
            combinedQueue.push({
                item: researchQueue[i],
                type: 'research',
                originalIndex: i,
                horizon: global.r_queue.max || 3
            });
        }

        // Clone current resource amounts to simulate progressive accumulation
        let virtualAmounts = {};
        Object.keys(global.resource).forEach(res => {
            virtualAmounts[res] = global.resource[res].amount;
        });

        let queueNeeds = {};
        let firstNeededIndex = {};
        let primaryNeeds = {};
        let allowedCrafts = {};
        let blockedResources = new Set();
        const craftCosts = window.evolve.craftCost || {};

        const scanLength = combinedQueue.length;
        queueNeedsHistory = []; // Reset history at start of scan

        for (let i = 0; i < scanLength; i++) {
            let entry = combinedQueue[i];
            let item = entry.item;
            let costs = getQueueItemCosts(item);

            // Check for hard blocks on direct costs only (precursors can be crafted in batches)
            let hasHardBlock = false;
            for (let res of Object.keys(costs)) {
                let costVal = costs[res];
                if (global.resource[res] && global.resource[res].max > 0 && costVal > global.resource[res].max) {
                    hasHardBlock = true;
                    blockedResources.add(global.resource[res].name || res);
                }
            }

            if (hasHardBlock) {
                // Skip this item because its direct cost exceeds max storage capacity.
                continue;
            }

            // Create temp transaction state for this item
            let tempVirtualAmounts = Object.assign({}, virtualAmounts);
            let tempQueueNeeds = Object.assign({}, queueNeeds);
            let tempAllowedCrafts = Object.assign({}, allowedCrafts);
            let tempFirstNeededIndex = Object.assign({}, firstNeededIndex);
            let tempPrimaryNeeds = Object.assign({}, primaryNeeds);

            // Helper to record when a resource is first needed in the queue
            function recordNeed(resName, amt) {
                if (amt > 0) {
                    tempQueueNeeds[resName] = (tempQueueNeeds[resName] || 0) + amt;
                    if (tempFirstNeededIndex[resName] === undefined) {
                        tempFirstNeededIndex[resName] = i;
                        tempPrimaryNeeds[resName] = entry.originalIndex < entry.horizon;
                    }
                }
            }

            // Resolve costs for this queue item
            let itemFailed = false;
            const resKeys = Object.keys(costs);
            for (let j = 0; j < resKeys.length; j++) {
                let res = resKeys[j];
                let costVal = costs[res];
                if (craftCosts.hasOwnProperty(res) && !global.race['no_craft']) {
                    let missingAmt = costVal - (tempVirtualAmounts[res] || 0);
                    if (missingAmt > 0) {
                        recordNeed(res, missingAmt);

                        let mult = getCraftMultiplier(res);
                        let craftActionsNeeded = Math.ceil(missingAmt / mult);
                        
                        let recipe = craftCosts[res];
                        let maxAllowedActions = craftActionsNeeded;
                        recipe.forEach(ingredient => {
                            let surplusP = tempVirtualAmounts[ingredient.r] || 0;
                            let allowedForP = Math.floor(Math.max(0, surplusP) / ingredient.a);
                            maxAllowedActions = Math.min(maxAllowedActions, allowedForP);
                        });

                        if (maxAllowedActions > 0) {
                            if (entry.originalIndex < entry.horizon) {
                                tempAllowedCrafts[res] = (tempAllowedCrafts[res] || 0) + maxAllowedActions;
                            }
                            recipe.forEach(ingredient => {
                                tempVirtualAmounts[ingredient.r] = (tempVirtualAmounts[ingredient.r] || 0) - (maxAllowedActions * ingredient.a);
                            });
                            tempVirtualAmounts[res] = (tempVirtualAmounts[res] || 0) + (maxAllowedActions * mult);
                        }

                        let remainingActions = craftActionsNeeded - maxAllowedActions;
                        if (remainingActions > 0) {
                            for (let k = 0; k < recipe.length; k++) {
                                let ingredient = recipe[k];
                                // Check if a single craft action's precursor requirement exceeds its max capacity
                                if (global.resource[ingredient.r] && global.resource[ingredient.r].max > 0 && ingredient.a > global.resource[ingredient.r].max) {
                                    itemFailed = true;
                                    blockedResources.add(global.resource[ingredient.r].name || ingredient.r);
                                }
                                let precursorCost = remainingActions * ingredient.a;
                                let missingP = precursorCost - (tempVirtualAmounts[ingredient.r] || 0);
                                if (missingP > 0) {
                                    const isBuyable = isResourceBuyable(ingredient.r, global);
                                    if (isBuyable) {
                                        recordNeed(ingredient.r, missingP);
                                    }
                                }
                                tempVirtualAmounts[ingredient.r] = (tempVirtualAmounts[ingredient.r] || 0) - precursorCost;
                            }
                            tempVirtualAmounts[res] = (tempVirtualAmounts[res] || 0) + (remainingActions * mult);
                        }
                    }
                    tempVirtualAmounts[res] = Math.max(0, (tempVirtualAmounts[res] || 0) - costVal);
                } else {
                    let missingAmt = costVal - (tempVirtualAmounts[res] || 0);
                    if (missingAmt > 0) {
                        const isBuyable = isResourceBuyable(res, global);
                        if (isBuyable) {
                            recordNeed(res, missingAmt);
                        }
                    }
                    tempVirtualAmounts[res] = (tempVirtualAmounts[res] || 0) - costVal;
                }

                if (itemFailed) {
                    break;
                }
            }

            if (itemFailed) {
                continue;
            }

            // Commit transaction
            virtualAmounts = tempVirtualAmounts;
            queueNeeds = tempQueueNeeds;
            allowedCrafts = tempAllowedCrafts;
            firstNeededIndex = tempFirstNeededIndex;
            primaryNeeds = tempPrimaryNeeds;

            queueNeedsHistory[i] = Object.assign({}, queueNeeds);
        }

        window.autobuy_blocked_resources = Array.from(blockedResources);
        currentAllowedCrafts = allowedCrafts;
        return { needs: queueNeeds, firstNeededIndex: firstNeededIndex, primaryNeeds: primaryNeeds };
    }

    function autoCraftForQueue() {
        if (!window.evolve || !window.evolve.global) return;
        const global = window.evolve.global;
        
        if (!settings.enabled || global.settings.pause || global.race['no_craft']) return;

        const craftCosts = window.evolve.craftCost || {};
        
        Object.keys(currentAllowedCrafts).forEach(resName => {
            let allowedActions = currentAllowedCrafts[resName];
            if (allowedActions <= 0) return;
            
            const resEl = document.getElementById('res' + resName);
            if (!resEl || !resEl.__vue__) return;
            
            let amountBefore = global.resource[resName].amount;
            let origMKeysVal = global.settings.mKeys;
            try {
                global.settings.mKeys = false;
                resEl.__vue__.craft(resName, allowedActions);
                let amountAfter = global.resource[resName].amount;
                let produced = amountAfter - amountBefore;
                if (produced > 0) {
                    console.log(`[Evolve Auto-Buy] Auto-crafted ${produced.toFixed(0)} ${resName} to fulfill queue needs.`);
                }
            } catch (e) {
                console.error(`[Evolve Auto-Buy] Error crafting ${resName}:`, e);
            } finally {
                global.settings.mKeys = origMKeysVal;
            }
        });
    }

    function getActionById(bId) {
        if (!window.evolve || !window.evolve.actions) return null;
        const actions = window.evolve.actions;
        
        let normId = bId;
        if (bId.startsWith('arpa') && !bId.startsWith('arpa-')) {
            normId = 'arpa-' + bId.substring(4);
        }

        const segments = normId.split("-");
        const cat = segments[0];
        const type = segments[1];

        if (cat === 'city' || cat === 'evolution' || cat === 'starDock' || cat === 'arpa') {
            return actions[cat] ? actions[cat][type] : null;
        }

        if (actions[cat]) {
            if (actions[cat].hasOwnProperty(type)) {
                return actions[cat][type];
            }
            let found = null;
            Object.keys(actions[cat]).forEach(region => {
                if (actions[cat][region] && typeof actions[cat][region] === 'object' && actions[cat][region].hasOwnProperty(type)) {
                    found = actions[cat][region][type];
                }
            });
            return found;
        }
        return null;
    }

    function getStorageIncreasingBuildingsForResource(resName) {
        const buildings = [];
        if (!window.evolve || !window.evolve.actions) return buildings;
        const actions = window.evolve.actions;

        const scanCategory = (catObj) => {
            Object.keys(catObj).forEach(key => {
                const action = catObj[key];
                if (action && typeof action.res === 'function') {
                    try {
                        const resList = action.res();
                        if (Array.isArray(resList) && resList.includes(resName)) {
                            buildings.push(action.id);
                        }
                    } catch (e) {}
                }
            });
        };

        if (actions.city) scanCategory(actions.city);
        if (actions.space) {
            Object.keys(actions.space).forEach(region => {
                const regionObj = actions.space[region];
                if (regionObj && typeof regionObj === 'object') {
                    scanCategory(regionObj);
                }
            });
        }
        if (actions.portal) scanCategory(actions.portal);

        const hardcoded = {
            Oil: ['city-oil_well', 'city-oil_depot', 'space-propellant_depot', 'space-gas_storage'],
            Uranium: ['city-oil_depot', 'space-gas_storage', 'galaxy-gateway_depot'],
            Helium_3: ['city-oil_depot', 'space-propellant_depot', 'space-gas_storage'],
            Elerium: ['space-elerium_contain', 'galaxy-gateway_depot'],
            Crates: ['city-storage_yard', 'interstellar-cargo_yard', 'galaxy-gateway_depot'],
            Containers: ['city-warehouse', 'interstellar-cargo_yard', 'galaxy-gateway_depot'],
            Knowledge: ['city-library', 'city-university', 'space-red_university'],
            Mana: ['space-pylon'],
            Neutronium: ['interstellar-cargo_yard', 'galaxy-gateway_depot'],
            Infernite: ['interstellar-cargo_yard', 'galaxy-gateway_depot'],
            Nano_Tube: ['galaxy-gateway_depot']
        };

        if (hardcoded[resName]) {
            hardcoded[resName].forEach(id => {
                if (!buildings.includes(id)) {
                    buildings.push(id);
                }
            });
        }

        return buildings;
    }

    const MAX_TIME_TO_BUY = 28800; // 8 hours threshold

    function getBuildingCosts(c_action) {
        if (!c_action) return {};
        if (!window.evolve || !window.evolve.global) return {};
        const global = window.evolve.global;
        let costs = {};
        try {
            if (c_action.id.startsWith('arpa-') || (c_action.id.startsWith('arpa') && !c_action.id.startsWith('arpa-'))) {
                let projectKey = c_action.id.startsWith('arpa-') ? c_action.id.substring(5) : c_action.id.substring(4);
                let complete = global.arpa && global.arpa[projectKey] ? global.arpa[projectKey].complete : 0;
                let inc = Math.min(1, 100 - complete);
                if (inc <= 0) return {};

                let creativeCosts = {};
                let fathom = getFathomCheck('human', global.race, global.city, global.stats);
                Object.keys(c_action.cost).forEach(res => {
                    creativeCosts[res] = function() {
                        let cost = c_action.cost[res](undefined, false);
                        if (global.race['creative']) {
                            const traits = window.evolve.traits;
                            if (traits && traits.creative) {
                                cost *= (1 - traits.creative.vars()[1] / 100);
                            }
                        }
                        if (fathom > 0) {
                            const traits = window.evolve.traits;
                            if (traits && traits.creative) {
                                cost *= 1 - (traits.creative.vars(1)[1] / 100 * fathom);
                            }
                        }
                        return cost;
                    }
                });

                let adjusted = window.evolve.adjustCosts({ cost: creativeCosts });
                Object.keys(adjusted).forEach(res => {
                    let costVal = Math.round(adjusted[res]() * (inc / 100));
                    if (costVal > 0) {
                        costs[res] = costVal;
                    }
                });
            } else {
                let adjusted = window.evolve.adjustCosts(c_action);
                Object.keys(adjusted).forEach(res => {
                    let costVal = adjusted[res]();
                    if (costVal > 0) {
                        costs[res] = costVal;
                    }
                });
            }
        } catch (e) {}
        return costs;
    }

    function getTimeToBuyBuilding(c_action) {
        if (!c_action) return Infinity;
        if (!window.evolve || !window.evolve.global) return Infinity;
        const global = window.evolve.global;

        let costs = getBuildingCosts(c_action);
        let maxTime = 0;

        for (let res of Object.keys(costs)) {
            let costVal = costs[res];
            let amount = global.resource[res] ? global.resource[res].amount : 0;
            let diff = global.resource[res] ? global.resource[res].diff : 0;

            let missing = costVal - amount;
            if (missing > 0) {
                if (diff > 0) {
                    let t = missing / diff;
                    if (t > maxTime) {
                        maxTime = t;
                    }
                } else {
                    return Infinity;
                }
            }
        }

        return maxTime;
    }

    function compareBuildings(actionA, actionB) {
        let timeA = getTimeToBuyBuilding(actionA);
        let timeB = getTimeToBuyBuilding(actionB);
        if (Math.abs(timeA - timeB) > 1) {
            return timeA - timeB;
        }
        return getBuildingCostMetric(actionA) - getBuildingCostMetric(actionB);
    }

    function isBuildingBuyable(c_action) {
        if (!c_action) return false;
        if (!window.evolve || !window.evolve.global) return false;
        const global = window.evolve.global;

        if (c_action.reqs) {
            for (let req of Object.keys(c_action.reqs)) {
                if (!global.tech[req] || global.tech[req] < c_action.reqs[req]) {
                    return false;
                }
            }
        }

        let path = global.race['truepath'] ? 'truepath' : 'standard';
        if (c_action.path && !c_action.path.includes(path)) {
            return false;
        }

        if (c_action.hasOwnProperty('condition') && !c_action.condition()) {
            return false;
        }

        if (c_action.not_trait) {
            for (let trait of c_action.not_trait) {
                if (global.race[trait]) {
                    return false;
                }
            }
        }

        if (c_action.trait) {
            for (let trait of c_action.trait) {
                if (!global.race[trait]) {
                    return false;
                }
            }
        }

        if (c_action.not_gene) {
            for (let gene of c_action.not_gene) {
                if (global.genes[gene]) {
                    return false;
                }
            }
        }

        if (c_action.gene) {
            for (let gene of c_action.gene) {
                if (!global.genes[gene]) {
                    return false;
                }
            }
        }

        if (c_action.not_tech) {
            for (let tech of c_action.not_tech) {
                if (global.tech[tech]) {
                    return false;
                }
            }
        }

        if (c_action.power_reqs) {
            for (let req of Object.keys(c_action.power_reqs)) {
                if (!global.tech[req] || global.tech[req] < c_action.power_reqs[req]) {
                    return false;
                }
            }
        }

        if (c_action.grant && global.tech[c_action.grant[0]] >= c_action.grant[1]) {
            return false;
        }

        let costs = getBuildingCosts(c_action);
        if (Object.keys(costs).length === 0) return false;

        for (let res of Object.keys(costs)) {
            let costVal = costs[res];
            if (res !== 'Money' && global.resource[res] && global.resource[res].max > 0 && costVal > global.resource[res].max) {
                return false;
            }
        }

        return true;
    }

    function getBuildingCostMetric(c_action) {
        let total = 0;
        if (!window.evolve || !window.evolve.global) return total;
        const global = window.evolve.global;
        try {
            let costs = {};
            if (c_action.id.startsWith('arpa-') || (c_action.id.startsWith('arpa') && !c_action.id.startsWith('arpa-'))) {
                let projectKey = c_action.id.startsWith('arpa-') ? c_action.id.substring(5) : c_action.id.substring(4);
                let complete = global.arpa && global.arpa[projectKey] ? global.arpa[projectKey].complete : 0;
                let inc = Math.min(1, 100 - complete);
                
                let creativeCosts = {};
                let fathom = getFathomCheck('human', global.race, global.city, global.stats);
                Object.keys(c_action.cost).forEach(res => {
                    creativeCosts[res] = function() {
                        let cost = c_action.cost[res](undefined, false);
                        if (global.race['creative']) {
                            const traits = window.evolve.traits;
                            if (traits && traits.creative) {
                                cost *= (1 - traits.creative.vars()[1] / 100);
                            }
                        }
                        if (fathom > 0) {
                            const traits = window.evolve.traits;
                            if (traits && traits.creative) {
                                cost *= 1 - (traits.creative.vars(1)[1] / 100 * fathom);
                            }
                        }
                        return cost;
                    }
                });

                let adjusted = window.evolve.adjustCosts({ cost: creativeCosts });
                Object.keys(adjusted).forEach(res => {
                    let costVal = Math.round(adjusted[res]() * (inc / 100));
                    if (costVal > 0) {
                        costs[res] = costVal;
                    }
                });
            } else {
                let adjusted = window.evolve.adjustCosts(c_action);
                Object.keys(adjusted).forEach(res => {
                    let costVal = adjusted[res]();
                    if (costVal > 0) {
                        costs[res] = costVal;
                    }
                });
            }

            Object.keys(costs).forEach(res => {
                let basePrice = resourceBaselines[res] || 1;
                total += costs[res] * basePrice;
            });
        } catch (e) {}
        return total;
    }

    // ==========================================
    // 5. TRANSACTION ENGINE
    // ==========================================
    function purchaseResource(resName) {
        const topBarVm = document.querySelector('#topBar') ? document.querySelector('#topBar').__vue__ : null;
        if (!topBarVm) return false;

        const race = topBarVm.race;
        const city = topBarVm.city;
        const s = topBarVm.s;

        if (race['no_trade'] || s.pause) return false;

        const resEl = document.getElementById('res' + resName);
        const moneyEl = document.getElementById('resMoney');
        if (!resEl || !moneyEl || !resEl.__vue__ || !moneyEl.__vue__) return false;

        const resVm = resEl.__vue__;
        const moneyVm = moneyEl.__vue__;

        let qty = city.market.qty;
        let value = resVm.value;

        // Apply Arrogant trait
        if (race['arrogant']) {
            const traits = window.evolve.traits;
            if (traits && traits.arrogant) {
                value *= 1 + (traits.arrogant.vars()[0] / 100);
            }
        }

        // Apply Conniving trait
        if (race['conniving']) {
            const traits = window.evolve.traits;
            if (traits && traits.conniving) {
                value *= 1 - (traits.conniving.vars()[0] / 100);
            }
        }

        // Apply Imp fathom
        let fathom = getFathomCheck('imp', race, city, window.evolve.global.stats);
        if (fathom > 0) {
            const traits = window.evolve.traits;
            if (traits && traits.conniving) {
                value *= 1 - (traits.conniving.vars(1)[0] / 100 * fathom);
            }
        }

        let amount = Math.floor(Math.min(qty, moneyVm.amount / value, resVm.max - resVm.amount));
        if (amount > 0) {
            resVm.amount += amount;
            moneyVm.amount -= Math.round(value * amount);

            // Price increase matching the game engine
            const randVal = Math.rand ? Math.rand(1000, 10000) : (1000 + Math.random() * 9000);
            resVm.value += Number((amount / randVal).toFixed(2));

            // Record purchase price for cooldown
            lastPurchasePrice[resName] = resVm.value;

            console.log(`[Evolve Auto-Buy] Purchased ${amount} ${resName} at $${value.toFixed(2)}/unit`);
            return true;
        }
        return false;
    }

    function getImportVolumePerRoute(resName, global) {
        if (!window.evolve || !window.evolve.tradeRatio) return 0;
        let rate = window.evolve.tradeRatio[resName] || 0;
        if (rate === 0) return 0;
        
        let dealVal = 0;
        if (window.evolve.govActive) {
            dealVal = window.evolve.govActive('dealmaker', 0);
        }
        if (dealVal) {
            rate *= 1 + (dealVal / 100);
        }
        if (global.race['persuasive'] && window.evolve.traits && window.evolve.traits.persuasive) {
            rate *= 1 + (window.evolve.traits.persuasive.vars()[0] * global.race['persuasive'] / 100);
        }
        if (global.race['merchant'] && window.evolve.traits && window.evolve.traits.merchant) {
            rate *= 1 + (window.evolve.traits.merchant.vars()[1] / 100);
        }
        if (global.race['ocular_power'] && global.race['ocularPowerConfig'] && global.race.ocularPowerConfig.c && window.evolve.traits && window.evolve.traits.ocular_power) {
            let trade = 70 * (window.evolve.traits.ocular_power.vars()[1] / 100);
            rate *= 1 + (trade / 100);
        }
        let fathom = 0;
        if (window.evolve.fathomCheck) {
            fathom = window.evolve.fathomCheck('goblin');
        }
        if (fathom > 0 && window.evolve.traits && window.evolve.traits.merchant) {
            rate *= 1 + (window.evolve.traits.merchant.vars(1)[1] / 100 * fathom);
        }
        if (global.stats.achieve && global.stats.achieve.hasOwnProperty('trade')) {
            let rank = global.stats.achieve.trade.l * 2;
            if (rank > 10) rank = 10;
            rate *= 1 + (rank / 100);
        }
        if (global.race['devious'] && window.evolve.traits && window.evolve.traits.devious) {
            rate *= 1 - (window.evolve.traits.devious.vars()[0] / 100);
        }
        if (global.genes && global.genes['trader']) {
            let mastery = 0;
            if (global.stats.achieve) {
                Object.keys(global.stats.achieve).forEach(k => {
                    if (global.stats.achieve[k].c) {
                        mastery += global.stats.achieve[k].l || 0;
                    }
                });
            }
            rate *= 1 + (mastery / 100);
            if (global.genes.trader >= 2 && global.prestige.Supercoiled) {
                let coiled = global.prestige.Supercoiled.count || 0;
                rate *= 1 + (coiled / (coiled + 500));
            }
        }
        return rate;
    }

    function getPriorityScore(cand, strategy, global) {
        let ratio = cand.ratio;
        let resName = cand.name;
        
        let genRate = global.resource[resName] ? global.resource[resName].diff : 0;
        let totalNeed = currentQueueNeeds[resName] || 0;
        let maxStorage = global.resource[resName] ? global.resource[resName].max : 1;
        
        // Effective need is capped at storage capacity
        let effectiveNeed = Math.max(1, Math.min(totalNeed, maxStorage));
        
        // Strategy weight
        let w = 0.0;
        if (strategy === 'balanced') {
            w = 0.5;
        } else if (strategy === 'time_saved') {
            w = 1.0;
        }
        
        if (w === 0.0) {
            return ratio; // Reverts to legacy ratio-only priority
        }
        
        // Time to Generate Need
        let amount = global.resource[resName] ? global.resource[resName].amount : 0;
        let missing = Math.max(0, effectiveNeed - amount);
        let timeToGen = 0;
        if (missing <= 0) {
            timeToGen = 0;
        } else if (genRate <= 0) {
            // Negative or zero generation means it is a major bottleneck (only get via buying/crafting)
            // Assign a huge virtual time to generate (giving it extremely high priority / lowest score)
            timeToGen = 1e9;
        } else {
            timeToGen = missing / genRate;
        }
        
        // Priority score: ratio / (timeToGen^w)
        // Lower score = higher priority
        return ratio / Math.pow(timeToGen + 1e-3, w);
    }



    function getLiveResource(resName) {
        const el = document.getElementById('res' + resName);
        return el ? el.__vue__ : null;
    }

    function getLiveMarket() {
        const topBarVm = document.querySelector('#topBar') ? document.querySelector('#topBar').__vue__ : null;
        if (topBarVm && topBarVm.city && topBarVm.city.market) {
            return topBarVm.city.market;
        }
        return null;
    }

    function getLiveGalaxyTrade() {
        const el = document.getElementById('galaxyTrade') || document.getElementById('specialModal');
        if (el && el.__vue__ && el.__vue__.g && el.__vue__.g.hasOwnProperty('f0')) {
            return el.__vue__;
        }
        return null;
    }

    function updateTradeRouteColorInUI(resName, tradeValue) {
        const el = document.querySelector(`#market-${resName} .trade .current`);
        if (el) {
            el.classList.remove('has-text-warning', 'has-text-danger', 'has-text-success');
            if (tradeValue > 0) {
                el.classList.add('has-text-success');
            } else if (tradeValue < 0) {
                el.classList.add('has-text-danger');
            } else {
                el.classList.add('has-text-warning');
            }
        }
    }

    function resetImportRoutes() {
        if (!window.evolve || !window.evolve.global) return;
        const global = window.evolve.global;
        const liveGlobal = getRealGlobal() || global;
        let changed = false;
        const liveMarket = getLiveMarket();

        Object.keys(liveGlobal.resource).forEach(resName => {
            const res = liveGlobal.resource[resName];
            if (res.trade !== undefined && res.trade > 0) {
                res.trade = 0;
                if (global.resource[resName]) {
                    global.resource[resName].trade = 0;
                }
                const liveRes = getLiveResource(resName);
                if (liveRes) {
                    liveRes.trade = 0;
                }
                updateTradeRouteColorInUI(resName, 0);
                changed = true;
            }
        });
        if (changed) {
            let totalRoutesUsed = 0;
            Object.keys(liveGlobal.resource).forEach(r => {
                if (liveGlobal.resource[r].trade) {
                    totalRoutesUsed += Math.abs(liveGlobal.resource[r].trade);
                }
            });
            liveGlobal.city.market.trade = totalRoutesUsed;
            global.city.market.trade = totalRoutesUsed;
            if (liveMarket) {
                liveMarket.trade = totalRoutesUsed;
            }
            console.log("[Evolve Auto-Buy] Reset auto-managed import trade routes to 0.");
        }
    }

    // ==========================================
    // GALACTIC TRADE ROUTE HELPERS & MANAGEMENT
    // ==========================================
    function getShipRating(shipType, global) {
        let rating = 0;
        const wish = global.race['wish'] && global.race['wishStats'] && global.race.wishStats.ship;
        const isBanana = global.race['banana'];
        
        switch (shipType) {
            case 'scout_ship':
                rating = isBanana ? 7 : 10;
                if (wish) rating += isBanana ? 1 : 5;
                break;
            case 'corvette_ship':
                rating = isBanana ? 21 : 30;
                if (wish) rating += isBanana ? 4 : 10;
                break;
            case 'frigate_ship':
                rating = isBanana ? 56 : 80;
                if (wish) rating += isBanana ? 14 : 20;
                break;
            case 'cruiser_ship':
                rating = isBanana ? 175 : 250;
                if (wish) rating += isBanana ? 25 : 50;
                break;
            case 'dreadnought':
                rating = isBanana ? 1260 : 1800;
                if (wish) rating += isBanana ? 140 : 200;
                break;
            case 'armed_miner':
                rating = isBanana ? 4 : 5;
                if (wish) rating += isBanana ? 2 : 5;
                break;
            case 'minelayer':
                rating = isBanana ? 35 : 50;
                if (wish) rating += isBanana ? 15 : 25;
                break;
            case 'raider':
                rating = isBanana ? 9 : 12;
                if (wish) rating += isBanana ? 3 : 6;
                break;
        }
        return rating;
    }

    function getPiracyMultiplier(region, global) {
        if (!global.tech || !global.tech['piracy'] || global.race['truepath']) {
            return 1;
        }
        
        let armada = 0;
        const gatewayArmada = ['scout_ship', 'corvette_ship', 'frigate_ship', 'cruiser_ship', 'dreadnought'];
        if (global.galaxy && global.galaxy.defense && global.galaxy.defense[region]) {
            const regionDef = global.galaxy.defense[region];
            for (let i = 0; i < gatewayArmada.length; i++) {
                let ship = gatewayArmada[i];
                let count = regionDef[ship] || 0;
                armada += count * getShipRating(ship, global);
            }
        }
        
        let pirate = 0;
        let pillage = 0.75;
        const instinct = global.race['instinct'];
        switch(region) {
            case 'gxy_stargate':
                pirate = 0.1 * (instinct ? global.tech.piracy * 0.9 : global.tech.piracy);
                pillage = 0.5;
                break;
            case 'gxy_gateway':
                pirate = 0.1 * (instinct ? global.tech.piracy * 0.9 : global.tech.piracy);
                pillage = 1;
                break;
            case 'gxy_gorddon':
                pirate = instinct ? 720 : 800;
                break;
            case 'gxy_alien1':
                pirate = instinct ? 900 : 1000;
                break;
            case 'gxy_alien2':
                pirate = instinct ? 2250 : 2500;
                pillage = 1;
                break;
            case 'gxy_chthonian':
                pirate = instinct ? 7000 : 7500;
                pillage = 1;
                break;
        }
        
        if (global.race['chicken'] && window.evolve && window.evolve.traits && window.evolve.traits.chicken) {
            pirate *= 1 + (window.evolve.traits.chicken.vars()[1] / 100);
        }
        
        if (global.race['ocular_power'] && global.race['ocularPowerConfig'] && global.race.ocularPowerConfig.f && window.evolve && window.evolve.traits && window.evolve.traits.ocular_power) {
            pirate *= 1 - (window.evolve.traits.ocular_power.vars()[1] / 500);
        }
        
        let num_def_plat_on = global.galaxy && global.galaxy.defense_platform ? global.galaxy.defense_platform.on : 0;
        if (region === 'gxy_stargate' && num_def_plat_on) {
            armada += num_def_plat_on * 20;
        }
        
        let num_starbase_on = global.galaxy && global.galaxy.starbase ? global.galaxy.starbase.on : 0;
        if (region === 'gxy_gateway' && num_starbase_on) {
            armada += num_starbase_on * 25;
        }
        
        let num_foothold_on = global.galaxy && global.galaxy.foothold ? global.galaxy.foothold.on : 0;
        if (region === 'gxy_alien2' && num_foothold_on) {
            armada += num_foothold_on * 50;
            let num_armed_miner_on = global.galaxy.armed_miner ? global.galaxy.armed_miner.on : 0;
            if (num_armed_miner_on) {
                armada += num_armed_miner_on * getShipRating('armed_miner', global);
            }
        }
        
        if (region === 'gxy_chthonian') {
            let num_minelayer_on = global.galaxy.minelayer ? global.galaxy.minelayer.on : 0;
            if (num_minelayer_on) {
                armada += num_minelayer_on * getShipRating('minelayer', global);
            }
            let num_raider_on = global.galaxy.raider ? global.galaxy.raider.on : 0;
            if (num_raider_on) {
                armada += num_raider_on * getShipRating('raider', global);
            }
        }
        
        if (region !== 'gxy_stargate') {
            let patrol = armada > pirate ? pirate : armada;
            let selfMultiplier = ((1 - (pirate - patrol) / pirate) * pillage + (1 - pillage));
            let stargateMultiplier = getPiracyMultiplier('gxy_stargate', global);
            return selfMultiplier * stargateMultiplier;
        } else {
            let patrol = armada > pirate ? pirate : armada;
            return (1 - (pirate - patrol) / pirate) * pillage + (1 - pillage);
        }
    }

    function getGalacticOffers(global) {
        let sellRes = (global.race['kindling_kindred'] || global.race['smoldering']) ? (global.race['smoldering'] ? 'Chrysotile' : 'Stone') : 'Lumber';
        return [
            { buy: 'Deuterium', sell: 'Helium_3', buyVol: 5, sellVol: 25 },
            { buy: 'Neutronium', sell: 'Copper', buyVol: 2.5, sellVol: 200 },
            { buy: 'Adamantite', sell: 'Iron', buyVol: 3, sellVol: 300 },
            { buy: 'Elerium', sell: 'Oil', buyVol: 1, sellVol: 125 },
            { buy: 'Nano_Tube', sell: 'Titanium', buyVol: 10, sellVol: 20 },
            { buy: 'Graphene', sell: sellRes, buyVol: 25, sellVol: 1000 },
            { buy: 'Stanene', sell: 'Aluminium', buyVol: 40, sellVol: 800 },
            { buy: 'Bolognium', sell: 'Uranium', buyVol: 0.75, sellVol: 4 },
            { buy: 'Vitreloy', sell: 'Infernite', buyVol: 1, sellVol: 1 }
        ];
    }

    function getGalacticSellVol(idx, global) {
        const vueEl = document.querySelector('#galaxyTrade');
        if (vueEl && vueEl.__vue__ && vueEl.__vue__.$options && vueEl.__vue__.$options.filters && vueEl.__vue__.$options.filters.s_vol) {
            try {
                return vueEl.__vue__.$options.filters.s_vol(idx);
            } catch (e) {}
        }
        const offers = getGalacticOffers(global);
        let sell_vol = offers[idx].sellVol;
        if (global.stats && global.stats.achieve && global.stats.achieve.hasOwnProperty('trade')) {
            let rank = global.stats.achieve.trade.l;
            if (rank > 5) rank = 5;
            sell_vol *= 1 - (rank / 100);
        }
        return Number(sell_vol.toFixed(2));
    }

    function getGalacticBuyVol(idx, global) {
        const vueEl = document.querySelector('#galaxyTrade');
        if (vueEl && vueEl.__vue__ && vueEl.__vue__.$options && vueEl.__vue__.$options.filters && vueEl.__vue__.$options.filters.t_vol) {
            try {
                return vueEl.__vue__.$options.filters.t_vol(idx);
            } catch (e) {}
        }
        const offers = getGalacticOffers(global);
        let buy_vol = offers[idx].buyVol;
        
        if (global.race['persuasive']) {
            buy_vol *= 1 + (global.race['persuasive'] / 100);
        }
        if (global.race['devious'] && window.evolve && window.evolve.traits && window.evolve.traits.devious) {
            buy_vol *= 1 - (window.evolve.traits.devious.vars()[0] / 100);
        }
        if (global.race['merchant'] && window.evolve && window.evolve.traits && window.evolve.traits.merchant) {
            buy_vol *= 1 + (window.evolve.traits.merchant.vars()[1] / 100);
        }
        
        let fathom = getFathomCheck('goblin', global.race, global.city, global.stats);
        if (fathom > 0 && window.evolve && window.evolve.traits && window.evolve.traits.merchant) {
            buy_vol *= 1 + (window.evolve.traits.merchant.vars(1)[1] / 100 * fathom);
        }
        
        if (global.genes && global.genes['trader']) {
            let mastery = 0;
            if (global.stats && global.stats.achieve) {
                Object.keys(global.stats.achieve).forEach(k => {
                    if (global.stats.achieve[k].c) {
                        mastery += global.stats.achieve[k].l || 0;
                    }
                });
            }
            buy_vol *= 1 + (mastery / 100);
        }
        
        if (global.stats && global.stats.achieve && global.stats.achieve.hasOwnProperty('trade')) {
            let rank = global.stats.achieve.trade.l;
            if (rank > 5) rank = 5;
            buy_vol *= 1 + (rank / 50);
        }
        return Number(buy_vol.toFixed(2));
    }

    function resetGalacticRoutes() {
        if (!window.evolve || !window.evolve.global || !window.evolve.global.galaxy || !window.evolve.global.galaxy.trade) return;
        const global = window.evolve.global;
        const liveGlobal = getRealGlobal() || global;
        let changed = false;
        for (let i = 0; i < 9; i++) {
            if (liveGlobal.galaxy.trade['f' + i] > 0) {
                liveGlobal.galaxy.trade['f' + i] = 0;
                global.galaxy.trade['f' + i] = 0;
                changed = true;
            }
        }
        if (changed) {
            liveGlobal.galaxy.trade.cur = 0;
            global.galaxy.trade.cur = 0;

            const liveTradeVm = getLiveGalaxyTrade();
            if (liveTradeVm) {
                if (liveTradeVm.g) {
                    for (let i = 0; i < 9; i++) {
                        liveTradeVm.g['f' + i] = 0;
                    }
                    liveTradeVm.g.cur = 0;
                }
                liveTradeVm.$forceUpdate();
            }

            console.log("[Evolve Auto-Buy] Reset auto-managed galactic trade routes to 0.");
        }
    }

    function manageGalacticTradeRoutes() {
        if (!settings.manageGalacticTradeRoutes) return;
        if (!window.evolve || !window.evolve.global) return;
        const global = window.evolve.global;
        const liveGlobal = getRealGlobal() || global;
        if (!liveGlobal.galaxy || !liveGlobal.galaxy.trade) return;

        const maxRoutes = liveGlobal.galaxy.trade.max || 0;
        if (maxRoutes <= 0) return;

        // 1. Piracy check
        const piracyMult = getPiracyMultiplier('gxy_gorddon', liveGlobal);
        const minPiracy = settings.minGalacticTradePiracy !== undefined ? settings.minGalacticTradePiracy : 0.5;
        if (piracyMult < minPiracy) {
            resetGalacticRoutes();
            return;
        }

        const offers = getGalacticOffers(liveGlobal);

        // 2. Identify candidate offers and categorize them
        const primaryCandidates = [];
        const secondaryCandidates = [];
        const fallbackCandidates = [];

        for (let i = 0; i < offers.length; i++) {
            let offer = offers[i];
            let buyRes = offer.buy;
            
            if (liveGlobal.resource[buyRes]) {
                let curAmt = liveGlobal.resource[buyRes].amount;
                let maxAmt = liveGlobal.resource[buyRes].max;
                if (maxAmt > 0) {
                    const isImporting = (liveGlobal.galaxy.trade['f' + i] || 0) > 0;
                    const capThreshold = isImporting ? 0.998 : 0.95;
                    if (curAmt >= capThreshold * maxAmt) {
                        continue; // Skip if already at cap (with hysteresis)
                    }
                }
            }

            let currentPrice = getUnitPrice(buyRes) || getBasePrice(buyRes, liveGlobal);
            let basePrice = getBasePrice(buyRes, liveGlobal);
            let ratio = currentPrice / basePrice;
            
            const cand = {
                idx: i,
                buy: buyRes,
                sell: offer.sell,
                ratio: ratio,
                firstNeededIndex: currentFirstNeededIndex[buyRes] !== undefined ? currentFirstNeededIndex[buyRes] : 999
            };

            if (currentQueueNeeds[buyRes] > 0) {
                if (currentPrimaryNeeds[buyRes]) {
                    primaryCandidates.push(cand);
                } else {
                    secondaryCandidates.push(cand);
                }
            } else {
                fallbackCandidates.push(cand);
            }
        }

        // Sort candidates
        const sortGalacticCandidates = (list) => {
            list.sort((a, b) => {
                if (a.firstNeededIndex !== b.firstNeededIndex) {
                    return a.firstNeededIndex - b.firstNeededIndex;
                }
                let scoreA = getPriorityScore(a, settings.purchaseStrategy, liveGlobal);
                let scoreB = getPriorityScore(b, settings.purchaseStrategy, liveGlobal);
                return scoreA - scoreB;
            });
        };

        sortGalacticCandidates(primaryCandidates);
        sortGalacticCandidates(secondaryCandidates);
        
        // Sort fallback by price ratio (cheapest first)
        fallbackCandidates.sort((a, b) => a.ratio - b.ratio);

        // 3. Determine allocations
        let targetRoutes = {};
        for (let i = 0; i < 9; i++) {
            targetRoutes[i] = 0;
        }
        let remainingRoutes = maxRoutes;

        const allocateFreighters = (list) => {
            for (let cand of list) {
                if (remainingRoutes <= 0) break;

                let idx = cand.idx;
                let sellRes = cand.sell;
                let sellVol = getGalacticSellVol(idx, liveGlobal);
                
                // Retrieve reserved stock for higher-priority items
                let targetIndex = cand.firstNeededIndex;
                let reservedAmt = 0;
                if (targetIndex === 999) {
                    // Fallback candidate: protect needs of the entire queue
                    if (queueNeedsHistory.length > 0) {
                        reservedAmt = queueNeedsHistory[queueNeedsHistory.length - 1][sellRes] || 0;
                    }
                } else if (targetIndex > 0 && queueNeedsHistory[targetIndex - 1]) {
                    reservedAmt = queueNeedsHistory[targetIndex - 1][sellRes] || 0;
                }

                let curAmt = liveGlobal.resource[sellRes] ? liveGlobal.resource[sellRes].amount : 0;
                let safeStock = Math.max(0, curAmt - reservedAmt);

                let maxSafeRoutes = 0;
                if (liveGlobal.resource[sellRes]) {
                    let maxAmt = liveGlobal.resource[sellRes].max;
                    const isExporting = (liveGlobal.galaxy.trade['f' + idx] || 0) > 0;
                    const exportStopThreshold = isExporting ? 0.05 : 0.10;
                    if (maxAmt > 0 && curAmt < exportStopThreshold * maxAmt) {
                        maxSafeRoutes = 0; // Stop exports under 5%, don't resume until over 10% (hysteresis)
                    } else if (reservedAmt > 0 && safeStock <= 0) {
                        maxSafeRoutes = 0;
                    } else if (maxAmt > 0 && safeStock >= 0.5 * maxAmt) {
                        maxSafeRoutes = remainingRoutes;
                    } else {
                        let currentRoutes = liveGlobal.galaxy.trade['f' + idx] || 0;
                        let baseDiff = (liveGlobal.resource[sellRes].diff || 0) + currentRoutes * sellVol;
                        maxSafeRoutes = Math.floor(baseDiff / sellVol);
                    }
                }
                if (maxSafeRoutes < 0) maxSafeRoutes = 0;

                let assign = Math.min(remainingRoutes, maxSafeRoutes);
                if (assign > 0) {
                    targetRoutes[idx] = assign;
                    remainingRoutes -= assign;
                }
            }
        };

        allocateFreighters(primaryCandidates);
        allocateFreighters(secondaryCandidates);
        allocateFreighters(fallbackCandidates);

        // 4. Apply changes
        let changed = false;
        for (let i = 0; i < 9; i++) {
            let current = liveGlobal.galaxy.trade['f' + i] || 0;
            let target = targetRoutes[i] || 0;
            if (current !== target) {
                liveGlobal.galaxy.trade['f' + i] = target;
                global.galaxy.trade['f' + i] = target;
                changed = true;
            }
        }

        if (changed) {
            let totalRoutesUsed = 0;
            for (let i = 0; i < 9; i++) {
                totalRoutesUsed += liveGlobal.galaxy.trade['f' + i];
            }
            liveGlobal.galaxy.trade.cur = totalRoutesUsed;
            global.galaxy.trade.cur = totalRoutesUsed;

            const liveTradeVm = getLiveGalaxyTrade();
            if (liveTradeVm) {
                if (liveTradeVm.g) {
                    for (let i = 0; i < 9; i++) {
                        liveTradeVm.g['f' + i] = liveGlobal.galaxy.trade['f' + i];
                    }
                    liveTradeVm.g.cur = totalRoutesUsed;
                }
                liveTradeVm.$forceUpdate();
            }

            let routeSummary = Object.keys(targetRoutes)
                .filter(k => targetRoutes[k] > 0)
                .map(k => `${offers[k].buy}/${offers[k].sell}: +${targetRoutes[k]}`)
                .join(', ');
            console.log(`[Evolve Auto-Buy] Auto-managed galactic trade routes: [ ${routeSummary || 'None'} ]`);
        }
    }

    function manageTradeRoutes() {
        if (!settings.manageTradeRoutes) return;
        if (!window.evolve || !window.evolve.global) return;
        const global = window.evolve.global;
        const liveGlobal = getRealGlobal() || global;
        const topBarVm = document.querySelector('#topBar') ? document.querySelector('#topBar').__vue__ : null;
        if (!topBarVm || topBarVm.race['no_trade'] || liveGlobal.race['terrifying'] || global.settings.pause) return;

        const hasTradeTech = !!liveGlobal.tech['trade'];
        const hasBananaTrait = !!liveGlobal.race['banana'];
        if (!hasTradeTech && !hasBananaTrait) return;

        const maxRoutes = liveGlobal.city.market.mtrade || 0;
        if (maxRoutes <= 0) return;

        // 1. Identify export routes (we do not modify these) and manual check boxes
        let exportRoutes = {};
        let totalExportRoutes = 0;
        Object.keys(liveGlobal.resource).forEach(resName => {
            const res = liveGlobal.resource[resName];
            if (res.trade && res.trade < 0) {
                exportRoutes[resName] = res.trade;
                totalExportRoutes += Math.abs(res.trade);
            }
        });

        // 2. Identify and categorize candidates
        const primaryCandidates = [];
        const secondaryCandidates = [];
        const fallbackCandidates = [];

        Object.keys(liveGlobal.resource).forEach(resName => {
            const res = liveGlobal.resource[resName];
            if (!res.display) return;
            if (res.max > 0) {
                const isImporting = (res.trade || 0) > 0;
                const capThreshold = isImporting ? 0.998 : 0.95;
                if (res.amount >= capThreshold * res.max) return;
            }
            const isBuyable = res.trade !== undefined;
            const isRouteAllowed = hasTradeTech || (hasBananaTrait && resName === 'Food');
            if (isBuyable && isRouteAllowed) {
                let currentPrice = getUnitPrice(resName);
                if (currentPrice === null) return;
                let basePrice = getBasePrice(resName, liveGlobal);
                let ratio = currentPrice / basePrice;
                
                const cand = {
                    name: resName,
                    ratio: ratio,
                    firstNeededIndex: currentFirstNeededIndex[resName] !== undefined ? currentFirstNeededIndex[resName] : 999
                };

                if (currentQueueNeeds[resName] > 0) {
                    if (currentPrimaryNeeds[resName]) {
                        primaryCandidates.push(cand);
                    } else {
                        secondaryCandidates.push(cand);
                    }
                } else {
                    fallbackCandidates.push(cand);
                }
            }
        });

        // Sort queue candidates by priority (firstNeededIndex, then priority score)
        const sortQueueCandidates = (list) => {
            list.sort((a, b) => {
                if (a.firstNeededIndex !== b.firstNeededIndex) {
                    return a.firstNeededIndex - b.firstNeededIndex;
                }
                let scoreA = getPriorityScore(a, settings.purchaseStrategy, liveGlobal);
                let scoreB = getPriorityScore(b, settings.purchaseStrategy, liveGlobal);
                return scoreA - scoreB;
            });
        };

        sortQueueCandidates(primaryCandidates);
        sortQueueCandidates(secondaryCandidates);

        // Sort fallback candidates by price ratio (cheapest first)
        fallbackCandidates.sort((a, b) => a.ratio - b.ratio);

        // 3. Determine route assignments
        let targetImportRoutes = {};
        let remainingRoutes = maxRoutes - totalExportRoutes;

        // Dealmaker safety
        if (liveGlobal.race && liveGlobal.race.governor && liveGlobal.race.governor.g && liveGlobal.race.governor.g.bg === 'entrepreneur') {
            let totalImportAllowed = totalExportRoutes;
            if (remainingRoutes > totalImportAllowed) {
                remainingRoutes = totalImportAllowed;
            }
        }

        let routeCap = liveGlobal.tech.currency >= 6 ? 1000000 : (liveGlobal.tech.currency >= 4 ? 100 : 25);

        // Group candidates by firstNeededIndex
        let groups = {};
        const allCandidates = primaryCandidates.concat(secondaryCandidates).concat(fallbackCandidates);
        allCandidates.forEach(cand => {
            let idx = cand.firstNeededIndex !== undefined ? cand.firstNeededIndex : 999;
            if (!groups[idx]) {
                groups[idx] = [];
            }
            groups[idx].push(cand);
        });

        let sortedGroupIndices = Object.keys(groups).map(Number).sort((a, b) => a - b);

        for (let idx of sortedGroupIndices) {
            if (remainingRoutes <= 0) break;
            let group = groups[idx];
            
            if (group.length > 1 && idx < 999 && (settings.purchaseStrategy === 'time_saved' || settings.purchaseStrategy === 'balanced')) {
                let groupRoutes = {};
                group.forEach(cand => {
                    groupRoutes[cand.name] = 0;
                });
                
                let groupRemaining = remainingRoutes;
                while (groupRemaining > 0) {
                    let worstCand = null;
                    let worstTime = -1;
                    
                    for (let cand of group) {
                        let resName = cand.name;
                        if (groupRoutes[resName] >= routeCap) continue;
                        
                        let amount = liveGlobal.resource[resName] ? liveGlobal.resource[resName].amount : 0;
                        let maxStorage = liveGlobal.resource[resName] ? liveGlobal.resource[resName].max : 1;
                        let totalNeed = currentQueueNeeds[resName] || 0;
                        let effectiveNeed = Math.max(1, Math.min(totalNeed, maxStorage));
                        
                        let missing = Math.max(0, effectiveNeed - amount);
                        let genRate = liveGlobal.resource[resName] ? liveGlobal.resource[resName].diff : 0;
                        
                        let currentRoutes = (liveGlobal.resource[resName] && liveGlobal.resource[resName].trade > 0) ? liveGlobal.resource[resName].trade : 0;
                        let baseGenRate = genRate - (currentRoutes * getImportVolumePerRoute(resName, liveGlobal));
                        let simulatedGenRate = baseGenRate + (groupRoutes[resName] * getImportVolumePerRoute(resName, liveGlobal));
                        
                        let timeToGen = 0;
                        if (missing <= 0) {
                            timeToGen = 0;
                        } else if (simulatedGenRate <= 0) {
                            timeToGen = 1e9;
                        } else {
                            timeToGen = missing / simulatedGenRate;
                        }
                        
                        let ratio = cand.ratio;
                        let w = settings.purchaseStrategy === 'balanced' ? 0.5 : 1.0;
                        let score = ratio / Math.pow(timeToGen + 1e-3, w);
                        
                        if (worstCand === null || score < worstTime) {
                            worstCand = cand;
                            worstTime = score;
                        }
                    }
                    
                    if (worstCand === null) break;
                    groupRoutes[worstCand.name]++;
                    groupRemaining--;
                }
                
                group.forEach(cand => {
                    let assign = groupRoutes[cand.name] || 0;
                    if (assign > 0) {
                        targetImportRoutes[cand.name] = assign;
                        remainingRoutes -= assign;
                    }
                });
            } else {
                group.sort((a, b) => {
                    let scoreA = getPriorityScore(a, settings.purchaseStrategy, liveGlobal);
                    let scoreB = getPriorityScore(b, settings.purchaseStrategy, liveGlobal);
                    return scoreA - scoreB;
                });
                for (let cand of group) {
                    if (remainingRoutes <= 0) break;
                    let assign = Math.min(remainingRoutes, routeCap);
                    targetImportRoutes[cand.name] = assign;
                    remainingRoutes -= assign;
                }
            }
        }

        // 4. Apply route changes
        let changed = false;
        const liveMarket = getLiveMarket();

        Object.keys(liveGlobal.resource).forEach(resName => {
            const res = liveGlobal.resource[resName];
            if (res.trade !== undefined) {
                let currentTrade = res.trade || 0;
                let targetTrade = 0;
                
                if (currentTrade < 0) {
                    // Export route: keep it
                    targetTrade = currentTrade;
                } else {
                    // Import route: set to target if needed, else 0
                    targetTrade = targetImportRoutes[resName] || 0;
                }
                
                if (currentTrade !== targetTrade) {
                    res.trade = targetTrade;
                    if (global.resource[resName]) {
                        global.resource[resName].trade = targetTrade;
                    }
                    const liveRes = getLiveResource(resName);
                    if (liveRes) {
                        liveRes.trade = targetTrade;
                    }
                    updateTradeRouteColorInUI(resName, targetTrade);
                    changed = true;
                }
            }
        });

        // 5. Sync total active trade routes
        if (changed) {
            let totalRoutesUsed = 0;
            Object.keys(liveGlobal.resource).forEach(r => {
                if (liveGlobal.resource[r].trade) {
                    totalRoutesUsed += Math.abs(liveGlobal.resource[r].trade);
                }
            });
            liveGlobal.city.market.trade = totalRoutesUsed;
            global.city.market.trade = totalRoutesUsed;
            if (liveMarket) {
                liveMarket.trade = totalRoutesUsed;
            }
            
            // Log changes
            let routeSummary = Object.keys(targetImportRoutes)
                .map(k => `${k}: +${targetImportRoutes[k]}`)
                .concat(Object.keys(exportRoutes).map(k => `${k}: ${exportRoutes[k]}`))
                .join(', ');
            console.log(`[Evolve Auto-Buy] Auto-managed trade routes: [ ${routeSummary || 'None'} ]`);
        }
    }



    // ==========================================
    // 6. AUTOMATION LOOP & STATUS
    // ==========================================
    function updateStatus(text) {
        const statusEl = document.getElementById('autobuy-status');
        if (statusEl) {
            statusEl.innerText = `Status: ${text}`;
            if (text.startsWith("Buying") || text.startsWith("Cap-Safe") || text.startsWith("Building")) {
                statusEl.className = "tag is-success";
            } else if (text === "Disabled" || text.startsWith("Paused")) {
                statusEl.className = "tag is-danger";
            } else if (text.startsWith("Saving")) {
                statusEl.className = "tag is-warning";
            } else {
                statusEl.className = "tag is-dark";
            }
        }
    }

    function runAutoBuy() {
        // Record prices every tick of the core loop
        try {
            recordPrices();
        } catch (e) {
            console.error("[Evolve Auto-Buy] Error recording prices:", e);
        }

        if (!settings.enabled) {
            updateStatus("Disabled");
            return;
        }

        if (!window.evolve || !window.evolve.global) {
            updateStatus("Waiting for game...");
            const topBarVm = document.querySelector('#topBar') ? document.querySelector('#topBar').__vue__ : null;
            if (topBarVm && topBarVm.s && !topBarVm.s.expose) {
                topBarVm.s.expose = true;
                console.log("[Evolve Auto-Buy] Exposed debug setting dynamically.");
            }
            return;
        }

        const global = window.evolve.global;
        const topBarVm = document.querySelector('#topBar') ? document.querySelector('#topBar').__vue__ : null;

        if (!topBarVm) {
            updateStatus("Waiting for UI...");
            return;
        }

        const race = topBarVm.race;
        const city = topBarVm.city;
        const s = topBarVm.s;

        if (race['no_trade']) {
            updateStatus("Trade Disabled");
            return;
        }

        if (s.pause) {
            updateStatus("Game Paused");
            return;
        }

        const moneyEl = document.getElementById('resMoney');
        if (!moneyEl || !moneyEl.__vue__) {
            updateStatus("Waiting for Bank...");
            return;
        }

        const moneyVm = moneyEl.__vue__;
        const moneyAmount = moneyVm.amount;
        const moneyMax = moneyVm.max;
        const isCapSafeMode = moneyAmount >= 0.99 * moneyMax;

        let qty = city.market.qty;

        // 1. Fetch building queue requirements
        try {
            const queueScan = getQueueNeeds();
            currentQueueNeeds = queueScan.needs;
            currentFirstNeededIndex = queueScan.firstNeededIndex;
            currentPrimaryNeeds = queueScan.primaryNeeds || {};
        } catch (e) {
            console.error("[Evolve Auto-Buy] Error scanning queue needs:", e);
        }

        // 1.2 Auto-storage expansion logic when the build queue is empty
        if (settings.enabled && !s.pause && global.queue && global.queue.queue && global.queue.queue.length === 0) {
            try {
                let bestBuilding = null;

                // TIER 1: Non-Knowledge Storage Expansion (Combined Capped & Capping)
                const fillableResources = [];
                Object.keys(global.resource).forEach(resName => {
                    if (resName === 'Knowledge') return;
                    const res = global.resource[resName];
                    if (res.display && res.max > 0) {
                        let timeToCap = Infinity;
                        if (res.amount >= res.max) {
                            timeToCap = 0;
                        } else if (res.diff > 0) {
                            timeToCap = (res.max - res.amount) / res.diff;
                        }
                        
                        if (timeToCap < Infinity) {
                            fillableResources.push({
                                name: resName,
                                timeToCap: timeToCap
                            });
                        }
                    }
                });

                // Sort resources by time to cap ascending (fastest to cap first, 0 is already capped)
                fillableResources.sort((a, b) => a.timeToCap - b.timeToCap);

                for (let cand of fillableResources) {
                    const buildings = getStorageIncreasingBuildingsForResource(cand.name);
                    const validBuildings = [];

                    buildings.forEach(bId => {
                        const c_action = getActionById(bId);
                        if (c_action && isBuildingBuyable(c_action)) {
                            let tBuy = getTimeToBuyBuilding(c_action);
                            if (tBuy <= MAX_TIME_TO_BUY) {
                                validBuildings.push(c_action);
                            }
                        }
                    });

                    if (validBuildings.length > 0) {
                        validBuildings.sort(compareBuildings);
                        bestBuilding = validBuildings[0];
                        break; // Found the best building for the fastest capping resource
                    }
                }

                // TIER 2: Non-Library Knowledge / Supercollider
                if (!bestBuilding) {
                    const tier2Candidates = [];

                    // Non-Library Knowledge buildings
                    const knowledgeBuildings = getStorageIncreasingBuildingsForResource('Knowledge');
                    knowledgeBuildings.forEach(bId => {
                        if (bId !== 'city-library') {
                            const c_action = getActionById(bId);
                            if (c_action && isBuildingBuyable(c_action)) {
                                let tBuy = getTimeToBuyBuilding(c_action);
                                if (tBuy <= MAX_TIME_TO_BUY) {
                                    tier2Candidates.push(c_action);
                                }
                            }
                        }
                    });

                    // Supercollider (lhc)
                    const sc_action = getActionById('arpalhc');
                    if (sc_action && isBuildingBuyable(sc_action)) {
                        let tBuy = getTimeToBuyBuilding(sc_action);
                        if (tBuy <= MAX_TIME_TO_BUY) {
                            tier2Candidates.push(sc_action);
                        }
                    }

                    if (tier2Candidates.length > 0) {
                        tier2Candidates.sort(compareBuildings);
                        bestBuilding = tier2Candidates[0];
                    }
                }

                // TIER 3: Library Fallback
                if (!bestBuilding) {
                    const libraryAction = getActionById('city-library');
                    if (libraryAction && isBuildingBuyable(libraryAction)) {
                        let tBuy = getTimeToBuyBuilding(libraryAction);
                        if (tBuy <= MAX_TIME_TO_BUY) {
                            bestBuilding = libraryAction;
                        }
                    }
                }

                if (bestBuilding) {
                    const segments = bestBuilding.id.split("-");
                    const action = segments[0];
                    const type = segments[1];
                    const label = typeof bestBuilding.title === 'string' ? bestBuilding.title : bestBuilding.title();
                    
                    let queueId = bestBuilding.id;
                    if (action === 'arpa') {
                        queueId = `arpa${type}`;
                    }

                    const queueEl = document.getElementById('buildQueue');
                    const liveQueue = queueEl && queueEl.__vue__ ? queueEl.__vue__.$data.queue : null;
                    if (liveQueue) {
                        liveQueue.push({
                            id: queueId,
                            action: action,
                            type: type,
                            label: label,
                            cna: false,
                            time: 0,
                            q: 1,
                            qs: 1,
                            t_max: 0,
                            bres: false
                        });
                        console.log(`[Evolve Auto-Buy] Automatically enqueued storage expansion: ${label} (${queueId})`);
                        updateStatus(`Queued Storage: ${label}`);
                    } else {
                        global.queue.queue.push({
                            id: queueId,
                            action: action,
                            type: type,
                            label: label,
                            cna: false,
                            time: 0,
                            q: 1,
                            qs: 1,
                            t_max: 0,
                            bres: false
                        });
                        console.log(`[Evolve Auto-Buy] Automatically enqueued storage expansion (fallback): ${label} (${queueId})`);
                        updateStatus(`Queued Storage: ${label}`);
                    }
                    return;
                }
            } catch (e) {
                console.error("[Evolve Auto-Buy] Error in auto-storage expansion:", e);
            }
        }

        // 1.5 Check for build queue items that only need Money and protect funds / let them build
        let moneyTarget = null;
        let moneyTargetCost = 0;
        let moneyTargetName = "";

        if (global.queue && global.queue.queue && global.queue.queue.length > 0) {
            try {
                let item = global.queue.queue[0];
                let costs = getQueueItemCosts(item);

                // Skip capacity-blocked items
                let hasHardBlock = false;
                for (let res of Object.keys(costs)) {
                    let costVal = costs[res];
                    if (global.resource[res] && global.resource[res].max > 0 && costVal > global.resource[res].max) {
                        hasHardBlock = true;
                        break;
                    }
                }

                if (!hasHardBlock) {
                    // Check if all non-money resource costs are satisfied in stock
                    let onlyNeedsMoney = true;
                    let moneyCost = 0;

                    for (let res of Object.keys(costs)) {
                        let costVal = costs[res];
                        if (res === 'Money') {
                            moneyCost = costVal;
                        } else {
                            let curAmt = global.resource[res] ? global.resource[res].amount : 0;
                            if (curAmt < costVal) {
                                onlyNeedsMoney = false;
                                break;
                            }
                        }
                    }

                    if (onlyNeedsMoney && moneyCost > 0) {
                        if (moneyCost <= moneyMax) {
                            moneyTarget = item;
                            moneyTargetCost = moneyCost;
                            moneyTargetName = item.label || item.id;
                        }
                    }
                }
            } catch (e) {
                console.error("[Evolve Auto-Buy] Error scanning first queue item:", e);
            }
        }

        if (moneyTarget) {
            if (moneyAmount < moneyTargetCost) {
                // Pause auto-buying to save up money for this item
                updateStatus(`Saving: ${moneyTargetName} ($${moneyAmount.toFixed(0)}/$${moneyTargetCost.toFixed(0)})`);
                return;
            } else {
                // Let Evolve's native queue engine build the item, keeping the money protected
                updateStatus(`Building: ${moneyTargetName}`);
                return;
            }
        }

        // 2. Perform auto-crafting for the queue if needed
        try {
            autoCraftForQueue();
        } catch (e) {
            console.error("[Evolve Auto-Buy] Error performing auto-crafting:", e);
        }

        // 2.5 Manage trade routes to support queue clearing
        try {
            manageTradeRoutes();
        } catch (e) {
            console.error("[Evolve Auto-Buy] Error managing trade routes:", e);
        }

        // 2.6 Manage galactic trade routes
        try {
            manageGalacticTradeRoutes();
        } catch (e) {
            console.error("[Evolve Auto-Buy] Error managing galactic trade routes:", e);
        }

        // 3. Classify candidates
        const queueCandidates = [];
        const targetedCandidates = [];
        const fallbackCandidates = [];

        Object.keys(global.resource).forEach(resName => {
            const resEl = document.getElementById('res' + resName);
            if (!resEl || !resEl.__vue__) return;

            const resVm = resEl.__vue__;

            if (!resVm.display || (resVm.max > 0 && resVm.amount >= 0.99 * resVm.max)) return;

            let currentPrice = getUnitPrice(resName);
            if (currentPrice === null) return;

            let basePrice = getBasePrice(resName, global);
            let ratio = currentPrice / basePrice;

            const cand = {
                name: resName,
                vm: resVm,
                currentPrice: currentPrice,
                basePrice: basePrice,
                ratio: ratio
            };

            const isBuyable = global.resource[resName] && global.resource[resName].trade !== undefined;

            // Needs for the next buildable queue items
            if (currentQueueNeeds[resName] > 0 && isBuyable) {
                const qCand = Object.assign({}, cand);
                qCand.firstNeededIndex = currentFirstNeededIndex[resName] !== undefined ? currentFirstNeededIndex[resName] : 999;
                queueCandidates.push(qCand);
            }

            // Explicit user check boxes
            if (settings.resources[resName] && isBuyable) {
                targetedCandidates.push(cand);
            }

            // Universal market list
            if (resourceBaselines.hasOwnProperty(resName) && isBuyable) {
                fallbackCandidates.push(cand);
            }
        });

        // 4. Automation Decision Matrix
        if (isCapSafeMode) {
            // Cap-Safe Mode: Bypass safety ceilings and decay checks to prevent waste.
            // DO NOT bypass the post-purchase cooldown, to prevent double-buying at peak prices.
            // Priority: Targeted -> Queue Needs -> Fallback
            
            if (targetedCandidates.length > 0) {
                targetedCandidates.sort((a, b) => {
                    let scoreA = getPriorityScore(a, settings.purchaseStrategy, global);
                    let scoreB = getPriorityScore(b, settings.purchaseStrategy, global);
                    return scoreA - scoreB;
                });
                for (let cand of targetedCandidates) {
                    if (isResourceCooledDown(cand.name, cand.currentPrice, cand.basePrice)) {
                        let success = purchaseResource(cand.name);
                        if (success) {
                            updateStatus(`Cap-Safe (Buy Targeted: ${cand.name})`);
                            return;
                        }
                    }
                }
            }

            if (queueCandidates.length > 0) {
                queueCandidates.sort((a, b) => {
                    if (a.firstNeededIndex !== b.firstNeededIndex) {
                        return a.firstNeededIndex - b.firstNeededIndex;
                    }
                    let scoreA = getPriorityScore(a, settings.purchaseStrategy, global);
                    let scoreB = getPriorityScore(b, settings.purchaseStrategy, global);
                    return scoreA - scoreB;
                });
                for (let cand of queueCandidates) {
                    if (isResourceCooledDown(cand.name, cand.currentPrice, cand.basePrice)) {
                        let success = purchaseResource(cand.name);
                        if (success) {
                            updateStatus(`Cap-Safe (Buy Queue: ${cand.name})`);
                            return;
                        }
                    }
                }
            }

            if (fallbackCandidates.length > 0) {
                fallbackCandidates.sort((a, b) => {
                    let scoreA = getPriorityScore(a, settings.purchaseStrategy, global);
                    let scoreB = getPriorityScore(b, settings.purchaseStrategy, global);
                    return scoreA - scoreB;
                });
                for (let cand of fallbackCandidates) {
                    if (isResourceCooledDown(cand.name, cand.currentPrice, cand.basePrice)) {
                        let success = purchaseResource(cand.name);
                        if (success) {
                            updateStatus(`Cap-Safe (Buy Fallback: ${cand.name})`);
                            return;
                        }
                    }
                }
            }

            updateStatus("Cap-Safe (Storage Full)");
        } else {
            // Normal Mode: Respect safety ceiling (2.0x base), cooldown, and decay checks.
            // Priority: Targeted -> Queue Needs
            
            // A. Try Targeted Buy
            targetedCandidates.sort((a, b) => {
                let scoreA = getPriorityScore(a, settings.purchaseStrategy, global);
                let scoreB = getPriorityScore(b, settings.purchaseStrategy, global);
                return scoreA - scoreB;
            });
            for (let cand of targetedCandidates) {
                let safetyCeiling = cand.basePrice * 2.0;
                let isCooledDown = isResourceCooledDown(cand.name, cand.currentPrice, cand.basePrice);
                let isDecaying = isPriceDecaying(cand.name);
                
                // Allow purchase if under safety ceiling OR cash is >= 95% of max (to prevent waste)
                let priceAllowed = (cand.currentPrice <= safetyCeiling) || (moneyAmount >= 0.95 * moneyMax);
                
                if (priceAllowed && isCooledDown && !isDecaying) {
                    let success = purchaseResource(cand.name);
                    if (success) {
                        updateStatus(`Buying: ${cand.name}`);
                        return;
                    }
                }
            }

            // B. Try Queue Needs
            queueCandidates.sort((a, b) => {
                if (a.firstNeededIndex !== b.firstNeededIndex) {
                    return a.firstNeededIndex - b.firstNeededIndex;
                }
                let scoreA = getPriorityScore(a, settings.purchaseStrategy, global);
                let scoreB = getPriorityScore(b, settings.purchaseStrategy, global);
                return scoreA - scoreB;
            });
            for (let cand of queueCandidates) {
                let safetyCeiling = cand.basePrice * 2.0;
                let isCooledDown = isResourceCooledDown(cand.name, cand.currentPrice, cand.basePrice);
                let isDecaying = isPriceDecaying(cand.name);
                
                // Allow purchase if under safety ceiling OR cash is >= 95% of max (to prevent waste)
                let priceAllowed = (cand.currentPrice <= safetyCeiling) || (moneyAmount >= 0.95 * moneyMax);
                
                if (priceAllowed && isCooledDown && !isDecaying) {
                    let success = purchaseResource(cand.name);
                    if (success) {
                        updateStatus(`Buying (Queue): ${cand.name}`);
                        return;
                    }
                }
            }

            updateStatus("Monitoring");
        }
    }

    // ==========================================
    // 7. UI INJECTION & DISPLAY
    // ==========================================
    function injectUI() {
        const market = document.getElementById('market');
        if (!market) return;

        // Sync price visibility class
        if (!settings.showDetails) {
            market.classList.add('autobuy-hide-prices');
        } else {
            market.classList.remove('autobuy-hide-prices');
        }
 
        // Optimization: Skip injection work if dashboard is already fully built and checks injected
        {
            const dashboard = document.getElementById('autobuy-dashboard');
            const checkboxes = market.querySelectorAll('.autobuy-res-cb');
            const marketItems = market.querySelectorAll('.market-item[id^="market-"]');
            if (dashboard && checkboxes.length === marketItems.length && marketItems.length > 0) {
                return;
            }
        }

        // Inject Stylesheet if not already present
        if (!document.getElementById('autobuy-styles')) {
            const styles = document.createElement('style');
            styles.id = 'autobuy-styles';
            styles.textContent = `
                #autobuy-dashboard {
                    margin-bottom: 1rem;
                    padding: 0.75rem;
                    border-radius: 4px;
                    border: 1px solid rgba(128, 128, 128, 0.2);
                    background-color: rgba(0, 0, 0, 0.15);
                }
                html.dark #autobuy-dashboard,
                html.night #autobuy-dashboard,
                html.dracula #autobuy-dashboard,
                html.darkNight #autobuy-dashboard {
                    background-color: rgba(0, 0, 0, 0.25);
                    border-color: rgba(255, 255, 255, 0.1);
                }
                html.light #autobuy-dashboard {
                    background-color: rgba(255, 255, 255, 0.5);
                    border-color: rgba(0, 0, 0, 0.15);
                }
                #autobuy-dashboard h3.title {
                    color: inherit !important;
                }
                #autobuy-dashboard .checkbox {
                    color: inherit !important;
                    background-color: transparent !important;
                }
                #market.autobuy-hide-prices .autobuy-res-price {
                    display: none !important;
                }
            `;
            document.head.appendChild(styles);
        }

        // 1. Inject Main Dashboard
        if (!document.getElementById('autobuy-dashboard')) {
            const dashboard = document.createElement('div');
            dashboard.id = 'autobuy-dashboard';
            dashboard.className = ''; // No Bulma default box classes that force white background
            dashboard.style.cssText = `
                margin-bottom: 1rem;
                padding: 0.75rem;
            `;

            dashboard.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div style="display: inline-flex; align-items: center; gap: 6px;">
                        <span id="autobuy-settings-toggle-btn" style="cursor: pointer; font-size: 0.85rem; user-select: none; transition: transform 0.2s; transform: rotate(0deg); display: inline-block;">▶</span>
                        <h3 class="title is-5" style="margin: 0; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;" id="autobuy-title-clickable">
                            Auto-Buy Automation <span style="font-size: 0.75rem; color: #888; font-weight: normal;">v1.14.0</span>
                        </h3>
                    </div>
                    <div style="display: inline-flex; align-items: center; gap: 12px;">
                        <label class="checkbox" style="font-weight: 500; cursor: pointer; user-select: none; margin: 0; display: inline-flex; align-items: center; gap: 6px;">
                            <input id="autobuy-master-toggle" type="checkbox" style="width: 16px; height: 16px; cursor: pointer;" />
                            <span>Enabled</span>
                        </label>
                        <span id="autobuy-status" class="tag is-dark" style="font-weight: bold; margin: 0;">Status: Idle</span>
                    </div>
                </div>
                
                <!-- Settings Panel (Collapsible) -->
                <div id="autobuy-settings-panel" style="margin-top: 0.75rem; border-top: 1px solid rgba(128, 128, 128, 0.15); padding-top: 0.75rem; display: none; gap: 1rem; align-items: center; flex-wrap: wrap;">
                    <label class="checkbox" style="font-weight: 500; cursor: pointer; user-select: none; margin: 0; display: inline-flex; align-items: center; gap: 6px;">
                        <input id="autobuy-trade-toggle" type="checkbox" style="width: 16px; height: 16px; cursor: pointer;" />
                        <span>Trade Routes</span>
                    </label>

                    <label class="checkbox" style="font-weight: 500; cursor: pointer; user-select: none; margin: 0; display: inline-flex; align-items: center; gap: 6px;">
                        <input id="autobuy-galactic-toggle" type="checkbox" style="width: 16px; height: 16px; cursor: pointer;" />
                        <span>Galactic Routes</span>
                    </label>

                    <div style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem;">
                        <span style="font-weight: 500;">Min Route Efficiency:</span>
                        <div class="select is-small">
                            <select id="autobuy-min-piracy-select" style="cursor: pointer;">
                                <option value="0.0">No Limit (0%)</option>
                                <option value="0.25">25%</option>
                                <option value="0.5">50%</option>
                                <option value="0.6">60%</option>
                                <option value="0.7">70%</option>
                                <option value="0.8">80%</option>
                                <option value="0.9">90%</option>
                            </select>
                        </div>
                    </div>

                    <div style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem;">
                        <span style="font-weight: 500;">Strategy:</span>
                        <div class="select is-small">
                            <select id="autobuy-strategy-select" style="cursor: pointer;">
                                <option value="time_saved">Time-Saving Utility (Rec.)</option>
                                <option value="balanced">Balanced Bottleneck</option>
                                <option value="ratio">Price Ratio (Legacy)</option>
                            </select>
                        </div>
                    </div>

                    <button id="autobuy-toggle-all" class="button is-small" style="margin: 0;">
                        Toggle All Checkboxes
                    </button>

                    <div style="font-size: 0.8rem; color: #888; flex-grow: 1; text-align: right; line-height: 1.2;">
                        Normal Mode: Buys at price plateaus &le; 2.0x base (delayed up to 95% cash if above). <br/>
                        Capped Mode (Money &ge; 99%): Bypasses checks, buys best deal.
                    </div>
                </div>

                <!-- Live Details Panel (Collapsible) -->
                <div id="autobuy-details-panel" style="margin-top: 0.5rem; border-top: 1px solid rgba(128, 128, 128, 0.15); padding-top: 0.5rem; display: flex; flex-direction: column; gap: 0.3rem;">
                    <div style="font-size: 0.85rem; color: #888; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        <span id="autobuy-details-toggle-btn" style="cursor: pointer; font-size: 0.8rem; user-select: none; transition: transform 0.2s; transform: rotate(0deg); display: inline-block;">▶</span>
                        <span style="font-weight: bold; cursor: pointer; user-select: none;" class="has-text-info" id="autobuy-details-title-clickable">Price & Piracy Details</span>
                        <span style="color: rgba(128, 128, 128, 0.6);">|</span>
                        <span style="font-weight: bold;">Queue Focus:</span>
                        <span id="autobuy-queue-list">Scanning...</span>
                    </div>
                    <div id="autobuy-details-subpanel" style="font-size: 0.85rem; display: none; flex-direction: column; gap: 0.3rem; margin-left: 1rem;">
                        <span id="autobuy-piracy-display" style="font-weight: bold; display: none;">Gorddon Piracy: --</span>
                    </div>
                </div>
            `;
            market.prepend(dashboard);

            // Bind events
            const masterToggle = document.getElementById('autobuy-master-toggle');
            masterToggle.checked = settings.enabled;
            masterToggle.addEventListener('change', (e) => {
                settings.enabled = e.target.checked;
                saveSettings();
            });

            const tradeToggle = document.getElementById('autobuy-trade-toggle');
            tradeToggle.checked = !!settings.manageTradeRoutes;
            tradeToggle.addEventListener('change', (e) => {
                settings.manageTradeRoutes = e.target.checked;
                saveSettings();
                if (!settings.manageTradeRoutes) {
                    resetImportRoutes();
                }
            });

            const galacticToggle = document.getElementById('autobuy-galactic-toggle');
            if (galacticToggle) {
                galacticToggle.checked = !!settings.manageGalacticTradeRoutes;
                galacticToggle.addEventListener('change', (e) => {
                    settings.manageGalacticTradeRoutes = e.target.checked;
                    saveSettings();
                    if (!settings.manageGalacticTradeRoutes) {
                        resetGalacticRoutes();
                    }
                });
            }

            const minPiracySelect = document.getElementById('autobuy-min-piracy-select');
            if (minPiracySelect) {
                minPiracySelect.value = settings.minGalacticTradePiracy !== undefined ? settings.minGalacticTradePiracy : 0.5;
                minPiracySelect.addEventListener('change', (e) => {
                    settings.minGalacticTradePiracy = parseFloat(e.target.value);
                    saveSettings();
                    console.log(`[Evolve Auto-Buy] Changed min galactic trade piracy to: ${settings.minGalacticTradePiracy}`);
                });
            }

            const toggleAllBtn = document.getElementById('autobuy-toggle-all');
            toggleAllBtn.addEventListener('click', () => {
                const checkboxes = document.querySelectorAll('.autobuy-res-cb');
                const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
                checkboxes.forEach(cb => {
                    cb.checked = !anyChecked;
                    const res = cb.dataset.res;
                    settings.resources[res] = !anyChecked;
                });
                saveSettings();
            });

            const strategySelect = document.getElementById('autobuy-strategy-select');
            strategySelect.value = settings.purchaseStrategy || 'time_saved';
            strategySelect.addEventListener('change', (e) => {
                settings.purchaseStrategy = e.target.value;
                saveSettings();
                console.log(`[Evolve Auto-Buy] Changed purchase strategy to: ${settings.purchaseStrategy}`);
            });

            // Collapsible accordion panels sync & events
            const settingsPanel = document.getElementById('autobuy-settings-panel');
            const settingsArrow = document.getElementById('autobuy-settings-toggle-btn');
            if (settingsPanel && settingsArrow) {
                settingsPanel.style.display = settings.showSettings ? 'flex' : 'none';
                settingsArrow.style.transform = settings.showSettings ? 'rotate(90deg)' : 'rotate(0deg)';
            }

            const detailsPanel = document.getElementById('autobuy-details-subpanel');
            const detailsArrow = document.getElementById('autobuy-details-toggle-btn');
            if (detailsPanel && detailsArrow) {
                detailsPanel.style.display = settings.showDetails ? 'flex' : 'none';
                detailsArrow.style.transform = settings.showDetails ? 'rotate(90deg)' : 'rotate(0deg)';
            }

            const toggleSettings = () => {
                settings.showSettings = !settings.showSettings;
                saveSettings();
                if (settingsPanel && settingsArrow) {
                    settingsPanel.style.display = settings.showSettings ? 'flex' : 'none';
                    settingsArrow.style.transform = settings.showSettings ? 'rotate(90deg)' : 'rotate(0deg)';
                }
            };
            const settingsBtn = document.getElementById('autobuy-settings-toggle-btn');
            const settingsTitle = document.getElementById('autobuy-title-clickable');
            if (settingsBtn) settingsBtn.addEventListener('click', toggleSettings);
            if (settingsTitle) settingsTitle.addEventListener('click', toggleSettings);

            const toggleDetails = () => {
                settings.showDetails = !settings.showDetails;
                saveSettings();
                if (detailsPanel && detailsArrow) {
                    detailsPanel.style.display = settings.showDetails ? 'flex' : 'none';
                    detailsArrow.style.transform = settings.showDetails ? 'rotate(90deg)' : 'rotate(0deg)';
                }
                const marketEl = document.getElementById('market');
                if (marketEl) {
                    if (!settings.showDetails) {
                        marketEl.classList.add('autobuy-hide-prices');
                    } else {
                        marketEl.classList.remove('autobuy-hide-prices');
                    }
                }
            };
            const detailsBtn = document.getElementById('autobuy-details-toggle-btn');
            const detailsTitle = document.getElementById('autobuy-details-title-clickable');
            if (detailsBtn) detailsBtn.addEventListener('click', toggleDetails);
            if (detailsTitle) detailsTitle.addEventListener('click', toggleDetails);
        }

        // 2. Inject Checkboxes into Market Items
        const marketItems = market.querySelectorAll('.market-item[id^="market-"]');
        marketItems.forEach(item => {
            if (item.classList.contains('autobuy-injected')) return;

            const resName = item.id.replace('market-', '');

            const container = document.createElement('div');
            container.className = 'autobuy-item-control';
            container.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
                margin-left: auto;
                padding: 2px 0;
            `;

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'autobuy-res-cb';
            cb.dataset.res = resName;
            cb.checked = !!settings.resources[resName];
            cb.style.cssText = 'cursor: pointer; margin: 0; width: 13px; height: 13px;';
            cb.addEventListener('change', (e) => {
                settings.resources[resName] = e.target.checked;
                saveSettings();
            });

            const label = document.createElement('span');
            label.innerText = 'Auto';
            label.style.cssText = `
                font-size: 0.75rem;
                font-weight: 600;
                color: #888;
                cursor: pointer;
                user-select: none;
                margin-right: 4px;
            `;
            label.addEventListener('click', () => cb.click());

            const priceLabel = document.createElement('span');
            priceLabel.className = 'autobuy-res-price';
            priceLabel.style.cssText = 'font-size: 0.725rem; margin-left: 6px; font-family: monospace; padding-left: 6px;';
            priceLabel.innerText = 'Base: --';

            container.appendChild(cb);
            container.appendChild(label);
            container.appendChild(priceLabel);

            item.appendChild(container);
            item.classList.add('autobuy-injected');
        });
    }

    function updateItemLabels() {
        if (!window.evolve || !window.evolve.global) return;
        const global = window.evolve.global;

        const market = document.getElementById('market');
        if (!market) return;

        const items = market.querySelectorAll('.market-item[id^="market-"]');
        items.forEach(item => {
            const resName = item.id.replace('market-', '');
            let labelEl = item._priceLabelEl;
            if (!labelEl) {
                labelEl = item.querySelector('.autobuy-res-price');
                if (labelEl) {
                    item._priceLabelEl = labelEl;
                }
            }
            if (!labelEl) return;

            let currentPrice = getUnitPrice(resName);
            let basePrice = getBasePrice(resName, global);

            if (currentPrice !== null) {
                let statusText = "";
                let statusClass = "has-text-grey"; // Default grey
                
                let isCooledDown = isResourceCooledDown(resName, currentPrice, basePrice);
                let isDecaying = isPriceDecaying(resName);
                
                if (settings.resources[resName] || (currentQueueNeeds && currentQueueNeeds[resName] > 0)) {
                    if (!isCooledDown) {
                        statusText = " [Spiked]";
                        statusClass = "has-text-warning";
                    } else if (isDecaying) {
                        statusText = " [Decaying]";
                        statusClass = "has-text-info";
                    } else {
                        // Classify price
                        if (currentPrice < basePrice) {
                            statusText = " [Cheap]";
                            statusClass = "has-text-success"; // Green
                        } else if (currentPrice <= basePrice * 2.0) {
                            statusText = " [Allowable]";
                            statusClass = "has-text-info"; // Blue
                        } else {
                            statusText = " [High]";
                            statusClass = "has-text-danger"; // Red
                        }
                    }
                } else {
                    // Non-automated: show raw price classifications
                    if (currentPrice < basePrice) {
                        statusText = " [Cheap]";
                        statusClass = "has-text-success";
                    } else if (currentPrice <= basePrice * 2.0) {
                        statusText = " [Allowable]";
                        statusClass = "has-text-grey";
                    } else {
                        statusText = " [High]";
                        statusClass = "has-text-danger";
                    }
                }
                
                const newText = `Base: $${basePrice.toFixed(1)} | Cur: $${currentPrice.toFixed(1)}${statusText}`;
                const newClass = `autobuy-res-price ${statusClass}`;
                
                if (labelEl._lastText !== newText) {
                    labelEl.innerText = newText;
                    labelEl._lastText = newText;
                }
                if (labelEl._lastClass !== newClass) {
                    labelEl.className = newClass;
                    labelEl._lastClass = newClass;
                }
            }
        });
    }

    function updateQueueListUI() {
        const queueListEl = document.getElementById('autobuy-queue-list');
        if (!queueListEl) return;

        if (!window.evolve || !window.evolve.global) {
            queueListEl.innerText = "Waiting for game...";
            return;
        }

        const global = window.evolve.global;
        if (!global.queue || !global.queue.queue || global.queue.queue.length === 0) {
            queueListEl.innerText = "None (Queue is empty)";
            queueListEl.style.color = "#888";
            return;
        }

        let needs = currentQueueNeeds;
        let keys = Object.keys(needs);
        let listStr = "";

        if (keys.length === 0) {
            listStr = "Active (Next item fully funded / active)";
            queueListEl.style.color = "#00d1b2"; // Teal
        } else {
            listStr = keys.map(k => `${global.resource[k] ? global.resource[k].name : k}: ${needs[k].toFixed(0)}`).join(', ');
            queueListEl.style.color = "#fff";
        }

        if (window.autobuy_blocked_resources && window.autobuy_blocked_resources.length > 0) {
            listStr += ` (Skipped items needing storage cap for: ${window.autobuy_blocked_resources.join(', ')})`;
        }

        queueListEl.innerText = listStr;
    }

    function updatePiracyDisplay() {
        const displayEl = document.getElementById('autobuy-piracy-display');
        if (!displayEl) return;
        
        if (!window.evolve || !window.evolve.global || !window.evolve.global.galaxy || !window.evolve.global.galaxy.trade) {
            displayEl.style.display = 'none';
            return;
        }
        
        displayEl.style.display = 'inline';
        const global = window.evolve.global;
        const stargateMult = getPiracyMultiplier('gxy_stargate', global);
        const overallMult = getPiracyMultiplier('gxy_gorddon', global);
        const localMult = stargateMult > 0 ? (overallMult / stargateMult) : overallMult;
        
        const overallLoss = (1 - overallMult) * 100;
        const localLoss = (1 - localMult) * 100;
        const stargateLoss = (1 - stargateMult) * 100;
        
        displayEl.innerText = `Gorddon Piracy: ${overallLoss.toFixed(0)}% (Local: ${localLoss.toFixed(0)}% | Stargate: ${stargateLoss.toFixed(0)}%)`;
        
        const minPiracy = settings.minGalacticTradePiracy !== undefined ? settings.minGalacticTradePiracy : 0.5;
        if (overallMult < minPiracy) {
            displayEl.style.color = '#ff3860'; // red
        } else {
            displayEl.style.color = '#23d160'; // green
        }
    }

    // ==========================================
    // 8. TICK LOOPS INITIALIZATION
    // ==========================================
    setInterval(() => {
        try {
            injectUI();
            updateItemLabels();
            updateQueueListUI();
            updatePiracyDisplay();
        } catch (e) {
            console.error("[Evolve Auto-Buy] UI Loop error:", e);
        }
    }, 500);

    setInterval(() => {
        try {
            runAutoBuy();
        } catch (e) {
            console.error("[Evolve Auto-Buy] Core Loop error:", e);
        }
    }, 1000);

})();
