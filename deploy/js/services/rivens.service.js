import { WORKER_URL } from "../config.js";
import { state } from "../state.js";
import { dbHelper } from "../repositories/storage.repository.js";
import { getRivenSlug } from "./slugs.service.js";

const EXCLUDED_COMPONENTS = new Set([
    // Zaw Grips
    "JAYAP", "KORB", "KROOSTRA", "KWATH", "LAKA", "PEYE", "SEEKALLA", "SHTUNG", "PLAGUE AKWIN", "PLAGUE BOKWIN",
    // Zaw Links
    "JAI", "RUHANG", "JAI II", "RUHANG II", "VARGEET JAI", "VARGEET RUHANG", "EKWANA JAI", "EKWANA RUHANG", 
    "VARGEET II JAI", "VARGEET II RUHANG", "EKWANA II JAI", "EKWANA II RUHANG", "VARGEET JAI II", "VARGEET RUHANG II", 
    "EKWANA JAI II", "EKWANA RUHANG II"
]);

/**
 * Loads weapon database, updates state.weaponMap and state.allRivenNames.
 */
export async function fetchRivenWeapons() {
    const CACHE_KEY = "voidstonkscache_weapons_v4";
    const ONE_DAY = 24 * 60 * 60 * 1000;
    try {
        const cached = await dbHelper.get(CACHE_KEY);
        if (cached?.data && cached?.timestamp && (Date.now() - cached.timestamp < ONE_DAY) && cached.data["Sydon"]) {
            state.weaponMap = cached.data;
            state.allRivenNames = Object.keys(state.weaponMap).sort((a, b) => a.localeCompare(b));
            
            // Trigger background dependent loaders
            fetchWeaponCombatStats();
            
            if (typeof globalThis.refreshCurrentRivenMetaStats === "function") {
                globalThis.refreshCurrentRivenMetaStats();
            }
            return;
        }
        const res = await fetch("assets/json/cleaned_weapons.json");
        if (!res.ok) throw new Error("Failed weapons.json");
        const data = await res.json();
        state.weaponDetailsDB = data;
        state.weaponMap = {};
        data.forEach((item) => {
            if (EXCLUDED_COMPONENTS.has(item.name.toUpperCase())) return;
            state.weaponMap[item.name] = {
                d: Number.parseFloat(item.omegaAttenuation || 1),
                t: item.type || "Rifle",
            };
        });

        // Fetch metastats from Soft Mountain 28 worker to add any missing Riven weapons (like Sydon)
        try {
            const metaRes = await fetch("https://soft-mountain-28fe.edelamf0.workers.dev/api/rivens");
            if (metaRes.ok) {
                const metaData = await metaRes.json();
                const statsObj = metaData.data ? metaData.data : metaData;
                Object.keys(statsObj).forEach((wName) => {
                    if (EXCLUDED_COMPONENTS.has(wName.toUpperCase())) return;
                    if (!state.weaponMap[wName]) {
                        const metaItem = statsObj[wName];
                        let type = "Rifle";
                        if (metaItem.category) {
                            type = metaItem.category;
                        } else {
                            const posArray = metaItem.pos ? (Array.isArray(metaItem.pos) ? metaItem.pos : (Array.isArray(metaItem.pos.best) ? metaItem.pos.best : [])) : [];
                            const negArray = metaItem.neg ? (Array.isArray(metaItem.neg) ? metaItem.neg : (Array.isArray(metaItem.neg.best) ? metaItem.neg.best : [])) : [];
                            const isMelee = posArray.includes("Initial Combo") || posArray.includes("Heavy Attack Efficiency") || posArray.includes("Range") ||
                                            negArray.includes("Initial Combo") || negArray.includes("Heavy Attack Efficiency") || negArray.includes("Range");
                            if (isMelee) type = "Melee";
                        }
                        state.weaponMap[wName] = {
                            d: Number.parseFloat(metaItem.disposition || metaItem.omegaAttenuation || 1.0),
                            t: type
                        };
                    }
                });
            }
        } catch (metaErr) {
            console.error("Error loading Riven weapons fallback from metastats:", metaErr);
        }

        state.allRivenNames = Object.keys(state.weaponMap).sort((a, b) => a.localeCompare(b));
        dbHelper.set(CACHE_KEY, { timestamp: Date.now(), data: state.weaponMap });
        
        // Refresh Riven Meta Stats display once weaponMap is hydrated
        if (typeof globalThis.refreshCurrentRivenMetaStats === "function") {
            globalThis.refreshCurrentRivenMetaStats();
        }
        
        const { updateDucatsDB } = await import("./relics.service.js");
        updateDucatsDB(data);
        
        // Fetch combat stats in background
        fetchWeaponCombatStats();
    } catch (e) {
        console.error("Error weapons local:", e);
    }
}

export async function fetchWeaponCombatStats() {
    const CACHE_KEY = "voidstonkscache_combat_stats_v6";
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    try {
        const cached = await dbHelper.get(CACHE_KEY);
        if (cached?.data && cached?.timestamp && (Date.now() - cached.timestamp < ONE_WEEK)) {
            state.combatStatsDB = cached.data;
            return;
        }

        const statsDB = {};
        const categories = ["Primary", "Secondary", "Melee", "Arch-Gun"];
        
        await Promise.all(categories.map(async (cat) => {
            const res = await fetch(`https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/${cat}.json`);
            if (res.ok) {
                const data = await res.json();
                data.forEach(item => {
                    if (item && item.name) {
                        // Extraer desglose de daño y daño radial de forma robusta
                        let damageTypes = null;
                        let radial = null;
                        
                        if (Array.isArray(item.attacks) && item.attacks.length > 0) {
                            // Buscar ataque principal/normal
                            const primaryAttack = item.attacks.find(a => 
                                a.name && (
                                    a.name.toLowerCase().includes("normal") || 
                                    a.name.toLowerCase().includes("shot") || 
                                    a.name.toLowerCase().includes("projectile") ||
                                    a.name.toLowerCase().includes("primary")
                                )
                            ) || item.attacks[0];
                            
                            if (primaryAttack && primaryAttack.damage) {
                                damageTypes = primaryAttack.damage;
                            }
                            
                            // Buscar ataque radial/explosión
                            const radialAttack = item.attacks.find(a => 
                                a.name && (
                                    a.name.toLowerCase().includes("radial") || 
                                    a.name.toLowerCase().includes("explosion") || 
                                    a.name.toLowerCase().includes("aoe") ||
                                    a.name.toLowerCase().includes("burst")
                                )
                            );
                            
                            if (radialAttack) {
                                radial = {
                                    damage: radialAttack.totalDamage || 0,
                                    radius: radialAttack.radius || radialAttack.falloff?.end || radialAttack.falloff?.radius || 0,
                                    damageFalloff: radialAttack.falloff?.reduction || radialAttack.damageFalloff || null,
                                    damageTypes: radialAttack.damage || null
                                };
                                
                                if (radial.damage === 0 && radial.damageTypes) {
                                    radial.damage = Object.values(radial.damageTypes).reduce((a, b) => a + b, 0);
                                }
                            }
                        } else {
                            damageTypes = item.damageTypes || item.damage || null;
                            if (typeof damageTypes === "number" || typeof damageTypes === "string") {
                                damageTypes = null;
                            }
                            
                            if (item.radialAttack) {
                                radial = {
                                    damage: item.radialAttack.damage || item.radialAttack.totalDamage || 0,
                                    radius: item.radialAttack.radius || item.radialAttack.falloff?.end || 0,
                                    damageFalloff: item.radialAttack.damageFalloff || item.radialAttack.falloff?.reduction || null,
                                    damageTypes: item.radialAttack.damageTypes || item.radialAttack.damage || null
                                };
                            }
                        }

                        // Calcular daño total como fallback
                        let totalDmg = item.totalDamage || 0;
                        if (totalDmg === 0 && damageTypes && typeof damageTypes === "object") {
                            totalDmg = Object.values(damageTypes).reduce((a, b) => a + b, 0);
                        }

                        let heavyAttackDmg = 0;
                        let slamAttackDmg = 0;
                        if (Array.isArray(item.attacks)) {
                            const heavy = item.attacks.find(a => a.name && a.name.toLowerCase().includes("heavy"));
                            if (heavy) {
                                heavyAttackDmg = heavy.totalDamage || 0;
                                if (heavyAttackDmg === 0 && heavy.damage) {
                                    heavyAttackDmg = Object.values(heavy.damage).reduce((x, y) => x + y, 0);
                                }
                            }
                            const slam = item.attacks.find(a => a.name && a.name.toLowerCase().includes("slam"));
                            if (slam) {
                                slamAttackDmg = slam.totalDamage || 0;
                                if (slamAttackDmg === 0 && slam.damage) {
                                    slamAttackDmg = Object.values(slam.damage).reduce((x, y) => x + y, 0);
                                }
                            }
                        }

                        statsDB[item.name] = {
                            damage: totalDmg,
                            critChance: (item.criticalChance * 100) || 0,
                            critMult: item.criticalMultiplier || 0,
                            statusChance: (item.procChance * 100) || 0,
                            fireRate: item.fireRate || 0,
                            magazine: item.magazineSize || 0,
                            reload: item.reloadTime || 0,
                            type: item.type || cat,
                            damageTypes: damageTypes,
                            radial: radial,
                            multishot: item.multishot || 1,
                            // Melee specific fields
                            range: item.range || 0,
                            comboDuration: item.comboDuration || 0,
                            blockAngle: item.blockAngle || 0,
                            followThrough: item.followThrough || 0,
                            heavyAttack: heavyAttackDmg,
                            slamAttack: slamAttackDmg
                        };
                    }
                });
            }
        }));

        state.combatStatsDB = statsDB;
        dbHelper.set(CACHE_KEY, { timestamp: Date.now(), data: statsDB });
    } catch (e) {
        console.error("Error fetching combat stats:", e);
    }
}

/**
 * Computes median, min, and max from a sorted price array, displays them, and persists to cache.
 */
async function computeAndDisplayPrices(prices, cacheKey) {
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 === 0
        ? (prices[mid - 1] + prices[mid]) / 2
        : prices[mid];
    const priceVal = Math.round(median);
    const minVal = prices[0];
    const maxVal = prices[prices.length - 1];

    const valSpan = document.getElementById("riven-avg-value");
    const minSpan = document.getElementById("riven-min-value");
    const maxSpan = document.getElementById("riven-max-value");

    if (valSpan) valSpan.innerText = priceVal;
    if (minSpan) minSpan.innerText = minVal;
    if (maxSpan) maxSpan.innerText = maxVal;

    await dbHelper.set(cacheKey, { val: priceVal, min: minVal, max: maxVal, time: Date.now() });
}

/**
 * Fetches the riven auction median price.
 * @param {string} weaponName
 */
export async function fetchRivenAverage(weaponName) {
    if (!weaponName) return;
    const box = document.getElementById("riven-avg-box");
    if (box) box.style.display = "block";

    const unrolledTitleEl = document.getElementById("riven-unrolled-title");
    const unrolledSubEl = document.getElementById("riven-unrolled-subtitle");
    const rerolledTitleEl = document.getElementById("riven-rerolled-title");
    const rerolledSubEl = document.getElementById("riven-rerolled-subtitle");
    const webTitleEl = document.getElementById("riven-web-title");
    const webSubEl = document.getElementById("riven-web-subtitle");

    const unrolledMedianEl = document.getElementById("riven-unrolled-median");
    const unrolledMinEl = document.getElementById("riven-unrolled-min");
    const unrolledMaxEl = document.getElementById("riven-unrolled-max");
    const rerolledMedianEl = document.getElementById("riven-rerolled-median");
    const rerolledMinEl = document.getElementById("riven-rerolled-min");
    const rerolledMaxEl = document.getElementById("riven-rerolled-max");
    const webAvgEl = document.getElementById("riven-web-avg");
    const webMinEl = document.getElementById("riven-web-min");
    const webOrdersEl = document.getElementById("riven-web-orders");

    const valSpan = document.getElementById("riven-avg-value");

    const isEs = state.currentLang === "es";

    if (unrolledTitleEl) unrolledTitleEl.innerText = isEs ? "Sin Ciclos" : "Unrolled";
    if (unrolledSubEl) unrolledSubEl.innerText = isEs ? "(DE Real)" : "(DE Real)";
    if (rerolledTitleEl) rerolledTitleEl.innerText = isEs ? "Con Ciclos" : "Rerolled";
    if (rerolledSubEl) rerolledSubEl.innerText = isEs ? "(DE Real)" : "(DE Real)";
    if (webTitleEl) webTitleEl.innerText = isEs ? "WFM Web" : "WFM Web";
    if (webSubEl) webSubEl.innerText = isEs ? "(Activo)" : "(Active)";

    const loadingText = isEs ? "Cargando..." : "Loading...";
    // Set loading placeholders
    if (unrolledMedianEl) unrolledMedianEl.innerText = loadingText;
    if (unrolledMinEl) unrolledMinEl.innerText = loadingText;
    if (unrolledMaxEl) unrolledMaxEl.innerText = loadingText;
    if (rerolledMedianEl) rerolledMedianEl.innerText = loadingText;
    if (rerolledMinEl) rerolledMinEl.innerText = loadingText;
    if (rerolledMaxEl) rerolledMaxEl.innerText = loadingText;
    if (webAvgEl) webAvgEl.innerText = loadingText;
    if (webMinEl) webMinEl.innerText = loadingText;
    if (webOrdersEl) webOrdersEl.innerText = loadingText;
    if (valSpan) valSpan.innerText = "...";

    try {
        const { getMetaStats } = await import("./riven_market.service.js");
        const meta = getMetaStats(weaponName);

        if (meta) {
            const popularity = meta.popularity_pct || 0;
            const realVolume = (meta.de_unrolled?.pop || 0) + (meta.de_rerolled?.pop || 0);
            const isUnpopular = popularity < 8.0 || realVolume < 3;

            const smoothPrice = (price, threshold, dampFactor) => {
                if (price && price > threshold) {
                    return Math.round(threshold + (price - threshold) * dampFactor);
                }
                return price;
            };

            // Get unrolled stats (pure raw data)
            const unrolledMedian = (meta.de_unrolled && meta.de_unrolled.median > 0)
                ? meta.de_unrolled.median
                : (meta.official_median > 0 ? meta.official_median : null);
            const unrolledMin = (meta.de_unrolled && meta.de_unrolled.min_price > 0) ? meta.de_unrolled.min_price : null;
            const unrolledMax = (meta.de_unrolled && meta.de_unrolled.max_price > 0) ? meta.de_unrolled.max_price : null;

            // Get rerolled stats (pure raw data)
            const rerolledMedian = (meta.de_rerolled && meta.de_rerolled.median > 0) ? meta.de_rerolled.median : null;
            const rerolledMin = (meta.de_rerolled && meta.de_rerolled.min_price > 0) ? meta.de_rerolled.min_price : null;
            const rerolledMax = (meta.de_rerolled && meta.de_rerolled.max_price > 0) ? meta.de_rerolled.max_price : null;

            // Get WFM active listings stats (pure raw data)
            const wfmAvg = meta.wfm_avg_price > 0 ? meta.wfm_avg_price : null;
            const wfmMin = wfmAvg ? Math.round(wfmAvg * 0.25) : null;
            const wfmOrders = meta.wfm_market_sample > 0 ? meta.wfm_market_sample : 0;

            // Decouple and compute smoothed base ONLY for calculation logic (valSpan)
            // This prevents off-meta pricing spikes from throwing off the calculator slider
            let calculationBase = unrolledMedian;
            if (isUnpopular) {
                calculationBase = smoothPrice(calculationBase, 150, 0.15);
            }

            // Populate DOM using helper with pure, raw, accurate market numbers
            const updateField = (el, val) => {
                if (el) el.innerText = (val !== null && val !== undefined) ? (typeof val === "number" ? Math.round(val) : val) : "N/A";
            };

            updateField(unrolledMedianEl, unrolledMedian);
            updateField(unrolledMinEl, unrolledMin);
            updateField(unrolledMaxEl, unrolledMax);

            updateField(rerolledMedianEl, rerolledMedian);
            updateField(rerolledMinEl, rerolledMin);
            updateField(rerolledMaxEl, rerolledMax);

            updateField(webAvgEl, wfmAvg);
            updateField(webMinEl, wfmMin);
            updateField(webOrdersEl, wfmOrders);

            // Set hidden avg-value for backward compatibility using the smoothed base
            if (valSpan) valSpan.innerText = calculationBase ? Math.round(calculationBase) : "50";
        } else {
            const isLoading = !globalThis.dynamicMetaStats || Object.keys(globalThis.dynamicMetaStats).length <= 10;
            const fallbackText = isLoading ? (isEs ? "Cargando..." : "Loading...") : "N/A";
            [unrolledMedianEl, unrolledMinEl, unrolledMaxEl, rerolledMedianEl, rerolledMinEl, rerolledMaxEl, webAvgEl, webMinEl, webOrdersEl].forEach(el => {
                if (el) el.innerText = fallbackText;
            });
            if (valSpan) valSpan.innerText = isLoading ? "..." : "50";
        }
    } catch (e) {
        console.error("Error setting official DE prices in fast view:", e);
        const isLoading = !globalThis.dynamicMetaStats || Object.keys(globalThis.dynamicMetaStats).length <= 10;
        const fallbackText = isLoading ? (isEs ? "Cargando..." : "Loading...") : "N/A";
        [unrolledMedianEl, unrolledMinEl, unrolledMaxEl, rerolledMedianEl, rerolledMinEl, rerolledMaxEl, webAvgEl, webMinEl, webOrdersEl].forEach(el => {
            if (el) el.innerText = fallbackText;
        });
        if (valSpan) valSpan.innerText = isLoading ? "..." : "50";
    }
}
