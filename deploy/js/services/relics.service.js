import { state } from "../state.js";
import { loadRelicsData } from "../repositories/api.repository.js";


/**
 * Builds state.ducatsDatabase from an array of item objects with components.
 * @param {Array} itemsArray
 */
export function updateDucatsDB(itemsArray) {
    if (!state.ducatsDatabase) state.ducatsDatabase = {};
    const COMPONENT_NAMES = new Set([
        "Blueprint", "Barrel", "Receiver", "Stock", "Blade", "Hilt",
        "Chassis", "Neuroptics", "Systems", "Carapace", "Cerebrum",
        "Harness", "Wings", "Link", "Pouch", "Stars", "Head", "Motor",
        "Grip", "String", "Limb", "Upper Limb", "Lower Limb", "Guard",
        "Disc", "Boot", "Gauntlet", "Chain", "Handle", "Ornament",
        "Buckle", "Band",
    ]);
    const BP_NAMES = new Set(["Chassis", "Neuroptics", "Systems", "Harness", "Wings"]);

    itemsArray.forEach((item) => {
        item.components?.forEach((comp) => {
            if (comp.ducats <= 0) return;
            const fullName = COMPONENT_NAMES.has(comp.name)
                ? `${item.name} ${comp.name}`
                : comp.name;
            state.ducatsDatabase[fullName] = { name: fullName, ducats: comp.ducats };
            if (BP_NAMES.has(comp.name)) {
                const bpName = `${fullName} Blueprint`;
                state.ducatsDatabase[bpName] = { name: bpName, ducats: comp.ducats };
            }
        });
    });
}

function processMissionRewards(rawData, activeDropsSet, addSource) {
    if (!rawData.missionRewards) return;
    for (const planet in rawData.missionRewards) {
        for (const node in rawData.missionRewards[planet]) {
            const d = rawData.missionRewards[planet][node];
            if (!d.rewards) continue;
            for (const rot in d.rewards) {
                const rewardsList = d.rewards[rot];
                if (!Array.isArray(rewardsList)) continue;
                rewardsList.forEach((i) => {
                    if (i.itemName?.includes("Relic")) {
                        activeDropsSet.add(i.itemName);
                        addSource(i.itemName, {
                            type: "mission",
                            location: `${node} (${planet})`,
                            mission: d.gameMode,
                            rotation: rot,
                            chance: i.chance,
                        });
                    }
                });
            }
        }
    }
}

function processBountySources(rawData, activeDropsSet, addSource) {
    const sources = [
        { data: rawData.cetusBountyRewards, name: "Cetus" },
        { data: rawData.solarisBountyRewards, name: "Fortuna" },
        { data: rawData.zarimanRewards, name: "Zariman" },
        { data: rawData.deimosRewards, name: "Deimos" },
    ];
    sources.forEach((src) => {
        if (!Array.isArray(src.data)) return;
        src.data.forEach((b) => {
            if (!b.rewards) return;
            for (const stage in b.rewards) {
                const rewardsList = b.rewards[stage];
                if (!Array.isArray(rewardsList)) continue;
                rewardsList.forEach((i) => {
                    if (i.itemName?.includes("Relic")) {
                        activeDropsSet.add(i.itemName);
                        addSource(i.itemName, {
                            type: "bounty",
                            location: `${src.name} Bounty`,
                            mission: b.bountyLevel || "Contrato",
                            rotation: stage,
                            chance: i.chance,
                        });
                    }
                });
            }
        });
    });
}

function processRelicDatabase(rawData, activeDropsSet) {
    state.allRelicNames = [];
    state.relicsDatabase = {};
    state.itemsDatabase = {};
    state.relicStatusDB = {};

    const ducatMap = {};
    if (state.ducatsDatabase) {
        Object.values(state.ducatsDatabase).forEach((item) => {
            ducatMap[item.name.toLowerCase().trim()] = item.ducats;
        });
    }

    if (!rawData.relics) return;

    rawData.relics.forEach((r) => {
        if (r.state !== "Intact") return;
        const rName = r.relicName || r.name;
        if (!rName || !r.tier) return;

        const tierName = `${r.tier} ${rName}`;
        state.allRelicNames.push(tierName);

        state.relicsDatabase[tierName] = r.rewards.map((rw) => ({
            name: rw.itemName,
            chance: rw.chance,
            rarity: rw.rarity,
            ducats: ducatMap[rw.itemName.toLowerCase().trim()] || 0,
        }));

        r.rewards.forEach((rw) => {
            if (!state.itemsDatabase[rw.itemName]) state.itemsDatabase[rw.itemName] = [];
            state.itemsDatabase[rw.itemName].push({
                relic: tierName,
                tier: r.tier,
                chance: rw.chance,
                ducats: ducatMap[rw.itemName.toLowerCase().trim()] || 0,
            });
        });

        const isAya = state.activeResurgenceList.has(tierName.toUpperCase());
        const dropsInGame = activeDropsSet.has(`${tierName} Relic`);
        if (isAya) state.relicStatusDB[tierName] = "aya";
        else if (r.tier === "Requiem" || dropsInGame) state.relicStatusDB[tierName] = "active";
        else state.relicStatusDB[tierName] = "vaulted";
    });

    state.allRelicNames.sort((a, b) => a.localeCompare(b));

    state.setsDatabase = {};
    const getSetName = (fullName) => {
        const match = fullName.match(/(.*?) (Prime|Vandal|Wraith)/);
        return match ? match[0].trim() : "Otros";
    };
    Object.keys(state.itemsDatabase).forEach((itemName) => {
        const setName = getSetName(itemName);
        if (setName !== "Otros" && !itemName.endsWith(" Set")) {
            if (!state.setsDatabase[setName]) state.setsDatabase[setName] = [];
            state.setsDatabase[setName].push(itemName);
        }
    });
}


/**
 * Loads raw data, processes relics/missions/bounties, and updates the app state.
 * Shows/hides the loading indicator automatically.
 */
export async function downloadRelics() {
    const loadEl = document.getElementById("loading");
    if (loadEl) loadEl.style.display = "flex";

    const CACHE_KEY = "voidstonks_weapons_v6_full_data";
    const CACHE_TIME = 48 * 60 * 60 * 1000;

    try {
        const rawData = await loadRelicsData(CACHE_KEY, CACHE_TIME);
        if (!rawData) throw new Error("Failed to load relics data");

        const { fetchActiveResurgence } = await import("../repositories/api.repository.js");
        fetchActiveResurgence?.().catch(console.warn);

        const activeDropsSet = new Set();
        state.relicSourcesDatabase = {};

        const cleanRelicName = (name) => name.replaceAll(" Relic", "").trim();
        const addSource = (relicFull, sourceData) => {
            const name = cleanRelicName(relicFull);
            if (!state.relicSourcesDatabase[name]) state.relicSourcesDatabase[name] = [];
            state.relicSourcesDatabase[name].push(sourceData);
        };

        processMissionRewards(rawData, activeDropsSet, addSource);
        processBountySources(rawData, activeDropsSet, addSource);
        processRelicDatabase(rawData, activeDropsSet);

        globalThis.finishLoading?.();
    } catch (e) {
        console.error("Error crítico descarga:", e);
        globalThis.showToast?.("Error de datos. Recarga la página.");
        if (loadEl) loadEl.style.display = "none";
    }
}
