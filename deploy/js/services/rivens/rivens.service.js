import { WORKER_URL } from "../../config.js";
import { state } from "../../state.js";
import { dbHelper } from "../../repositories/storage.repository.js";
import { getRivenSlug } from "../../utils/slugs.utils.js";

const EXCLUDED_COMPONENTS = new Set([
    "JAYAP", "KORB", "KROOSTRA", "KWATH", "LAKA", "PEYE", "SEEKALLA", "SHTUNG", "PLAGUE AKWIN", "PLAGUE BOKWIN",
    "JAI", "RUHANG", "JAI II", "RUHANG II", "VARGEET JAI", "VARGEET RUHANG", "EKWANA JAI", "EKWANA RUHANG", 
    "VARGEET II JAI", "VARGEET II RUHANG", "EKWANA II JAI", "EKWANA II RUHANG", "VARGEET JAI II", "VARGEET RUHANG II",
    "EKWANA JAI II", "EKWANA RUHANG II"
]);

const HOUND_WEAPONS = new Set(["AKATEN", "BATOTEN", "LACERTEN"]);

// kitgun chambers are missing from cleaned_weapons.json and use Pistol riven stats
const KITGUN_WEAPONS = new Set(["CATCHMOON", "GAZE", "RATTLEGUTS", "TOMBFINGER", "VERMISPLICER", "SPORELACER"]);

// weapons whose main fire mode multiplies Condition Overload damage instead of adding it
const MULTIPLICATIVE_CO = new Set([
    "Arbucep", "Corvas Prime", "Grattler", "Mandonel", "Velocitus",
    "Aeolak", "Alternox", "Alternox Prime", "Arca Plasmor", "Tenet Arca Plasmor",
    "Basmu", "Battacor", "Bubonico", "Buzlok", "Cinta", "Coda Bassocyst", "Coda Hema",
    "Exergis", "Felarx", "Fulmin", "Fulmin Prime", "Hema", "Javlok", "Mutalist Cernos",
    "Nataruk", "Scourge", "Scourge Prime", "Shedu", "Stahlta", "Steflos", "Tenet Envoy",
    "Torid",
    "Aegrit", "Akarius", "Akarius Prime", "Catchmoon", "Cyanex", "Epitaph",
    "Epitaph Prime", "Onos", "Seer", "Kuva Seer", "Sepulcrum", "Tenet Spirex",
    "Tombfinger", "Zakti", "Zakti Prime"
]);

function normalizeRivenWeaponType(item) {
    const t = item.type || "Rifle";
    if (t === "Zaw Component" || item.category === "Melee") return "Melee";
    if (t === "Companion Weapon") return HOUND_WEAPONS.has(item.name.toUpperCase()) ? "Melee" : "Rifle";
    return t;
}

export async function fetchRivenWeapons() {
    const CACHE_KEY = "voidstonkscache_weapons_v13";
    const ONE_DAY = 24 * 60 * 60 * 1000;
    try {
        const cached = await dbHelper.get(CACHE_KEY);
        if (cached?.data && cached?.timestamp && (Date.now() - cached.timestamp < ONE_DAY) && cached.data["Athodai Prime"]) {
            state.weaponMap = cached.data;
            state.allRivenNames = Object.keys(state.weaponMap).sort((a, b) => a.localeCompare(b));

            if (!state.weaponDetailsDB) {
                try {
                    const detailsRes = await fetch("assets/json/cleaned_weapons.json");
                    if (detailsRes.ok) state.weaponDetailsDB = await detailsRes.json();
                } catch (detErr) {
                    console.error("Error loading weapon details on cache hit:", detErr);
                }
            }

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
                t: normalizeRivenWeaponType(item),
            };
        });

        try {
            const metaRes = await fetch("metastats.json");
            if (metaRes.ok) {
                const metaData = await metaRes.json();
                const statsObj = metaData.data ? metaData.data : metaData;
                const slugOf = (n) => n.toLowerCase().replaceAll("&", "and").replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_+|_+$/g, "");
                const canonicalBySlug = {};
                Object.keys(state.weaponMap).forEach((n) => { canonicalBySlug[slugOf(n)] = n; });
                Object.keys(statsObj).forEach((rawName) => {
                    const wName = canonicalBySlug[slugOf(rawName)] || rawName.replace(/ And /g, " & ");
                    if (EXCLUDED_COMPONENTS.has(wName.toUpperCase())) return;
                    if (!state.weaponMap[wName]) {
                        const metaItem = statsObj[wName];
                        let type = "Rifle";
                        if (/\(melee\)\s*$/i.test(wName)) {
                            type = "Melee";
                        } else if (KITGUN_WEAPONS.has(wName.toUpperCase())) {
                            type = "Pistol";
                        } else if (metaItem.category) {
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
        
        if (typeof globalThis.refreshCurrentRivenMetaStats === "function") {
            globalThis.refreshCurrentRivenMetaStats();
        }
        
        const { updateDucatsDB } = await import("../inventory/relics.service.js");
        updateDucatsDB(data);
        
        fetchWeaponCombatStats();
    } catch (e) {
        console.error("Error weapons local:", e);
    }
}

async function fetchWeaponCombatStats() {
    const CACHE_KEY = "voidstonkscache_combat_stats_v12";
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    try {
        const cached = await dbHelper.get(CACHE_KEY);
        if (cached?.data && cached?.timestamp && (Date.now() - cached.timestamp < ONE_WEEK)) {
            state.combatStatsDB = await applyCombatOverrides(cached.data);
            return;
        }

        const statsDB = {};
        const categories = ["Primary", "Secondary", "Melee", "Arch-Gun", "SentinelWeapons"];
        
        await Promise.all(categories.map(async (cat) => {
            const res = await fetch(`https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/${cat}.json`);
            if (res.ok) {
                const data = await res.json();
                data.forEach(item => {
                    if (item && item.name) {
                        let damageTypes = null;
                        let radial = null;
                        
                        if (Array.isArray(item.attacks) && item.attacks.length > 0) {
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

                        const coScaling = MULTIPLICATIVE_CO.has(item.name) ? "multiplicative" : "additive";

                        let fireModes = [];
                        if (Array.isArray(item.attacks)) {
                            const modeAttacks = item.attacks.filter(a => a.name && !/radial|explosion|aoe|slam|heavy/i.test(a.name));
                            if (modeAttacks.length >= 2) {
                                fireModes = modeAttacks.map(a => {
                                    const dt = (a.damage && Object.keys(a.damage).length > 0) ? a.damage : null;
                                    let dmg = a.totalDamage || 0;
                                    if (!dmg && dt) dmg = Object.values(dt).reduce((x, y) => x + y, 0);
                                    return {
                                        name: a.name,
                                        damage: dmg,
                                        damageTypes: dt,
                                        critChance: a.crit_chance || 0,
                                        critMult: a.crit_mult || 0,
                                        statusChance: a.status_chance || 0,
                                        fireRate: a.speed || 0,
                                    };
                                });
                            }
                        }

                        statsDB[item.name] = {
                            damage: totalDmg,
                            fireModes,
                            coScaling,
                            critChance: (item.criticalChance * 100) || 0,
                            critMult: item.criticalMultiplier || 0,
                            statusChance: (item.procChance * 100) || 0,
                            fireRate: item.fireRate || 0,
                            magazine: item.magazineSize || 0,
                            reload: item.reloadTime || 0,
                            type: cat === "Melee" && item.type !== "Zaw Component" ? "Melee" : (item.type || cat),
                            damageTypes: damageTypes,
                            radial: radial,
                            multishot: item.multishot || 1,
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

        dbHelper.set(CACHE_KEY, { timestamp: Date.now(), data: statsDB });
        state.combatStatsDB = await applyCombatOverrides(statsDB);
    } catch (e) {
        console.error("Error fetching combat stats:", e);
    }
}

let _combatOverridesCache;
async function applyCombatOverrides(db) {
    if (_combatOverridesCache === undefined) {
        try {
            const res = await fetch("assets/json/combat_stats_overrides.json");
            const json = res.ok ? await res.json() : {};
            delete json._comment;
            _combatOverridesCache = json;
        } catch (e) {
            _combatOverridesCache = {};
        }
    }
    return { ...db, ..._combatOverridesCache };
}

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

    if (unrolledMedianEl) unrolledMedianEl.innerText = "...";
    if (unrolledMinEl) unrolledMinEl.innerText = "...";
    if (unrolledMaxEl) unrolledMaxEl.innerText = "...";
    if (rerolledMedianEl) rerolledMedianEl.innerText = "...";
    if (rerolledMinEl) rerolledMinEl.innerText = "...";
    if (rerolledMaxEl) rerolledMaxEl.innerText = "...";
    if (webAvgEl) webAvgEl.innerText = "...";
    if (webMinEl) webMinEl.innerText = "...";
    if (webOrdersEl) webOrdersEl.innerText = "...";
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

            const unrolledMedian = (meta.de_unrolled && meta.de_unrolled.median > 0)
                ? meta.de_unrolled.median
                : (meta.official_median > 0 ? meta.official_median : null);
            const unrolledMin = (meta.de_unrolled && meta.de_unrolled.min_price > 0) ? meta.de_unrolled.min_price : null;
            const unrolledMax = (meta.de_unrolled && meta.de_unrolled.max_price > 0) ? meta.de_unrolled.max_price : null;

            const rerolledMedian = (meta.de_rerolled && meta.de_rerolled.median > 0) ? meta.de_rerolled.median : null;
            const rerolledMin = (meta.de_rerolled && meta.de_rerolled.min_price > 0) ? meta.de_rerolled.min_price : null;
            const rerolledMax = (meta.de_rerolled && meta.de_rerolled.max_price > 0) ? meta.de_rerolled.max_price : null;

            const wfmAvg = (meta.wfm_avg_price > 0 ? meta.wfm_avg_price : null) || (meta.wfm_avg > 0 ? meta.wfm_avg : null);
            const wfmMin = (meta.web_min !== undefined && meta.web_min !== null) ? meta.web_min : (wfmAvg ? Math.round(wfmAvg * 0.25) : null);
            const wfmOrders = meta.wfm_market_sample > 0 ? meta.wfm_market_sample : 0;

            let calculationBase = unrolledMedian;
            if (isUnpopular) {
                calculationBase = smoothPrice(calculationBase, 150, 0.15);
            }

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

            if (valSpan) valSpan.innerText = calculationBase ? Math.round(calculationBase) : "50";
        } else {
            [unrolledMedianEl, unrolledMinEl, unrolledMaxEl, rerolledMedianEl, rerolledMinEl, rerolledMaxEl, webAvgEl, webMinEl, webOrdersEl].forEach(el => {
                if (el) el.innerText = "N/A";
            });
            if (valSpan) valSpan.innerText = "50";
        }
    } catch (e) {
        console.error("Error setting official DE prices in fast view:", e);
        [unrolledMedianEl, unrolledMinEl, unrolledMaxEl, rerolledMedianEl, rerolledMinEl, rerolledMaxEl, webAvgEl, webMinEl, webOrdersEl].forEach(el => {
            if (el) el.innerText = "N/A";
        });
        if (valSpan) valSpan.innerText = "50";
    }
}

