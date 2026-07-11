import { WORKER_URL } from "../config.js";
import { state } from "../state.js";
import { dbHelper } from "../repositories/storage.repository.js";
import { getRivenSlug } from "../utils/slugs.utils.js";

const EXCLUDED_COMPONENTS = new Set([
    // Zaw Grips
    "JAYAP", "KORB", "KROOSTRA", "KWATH", "LAKA", "PEYE", "SEEKALLA", "SHTUNG", "PLAGUE AKWIN", "PLAGUE BOKWIN",
    // Zaw Links
    "JAI", "RUHANG", "JAI II", "RUHANG II", "VARGEET JAI", "VARGEET RUHANG", "EKWANA JAI", "EKWANA RUHANG", 
    "VARGEET II JAI", "VARGEET II RUHANG", "EKWANA II JAI", "EKWANA II RUHANG", "VARGEET JAI II", "VARGEET RUHANG II",
    "EKWANA JAI II", "EKWANA RUHANG II"
]);

// Hound companion weapons attack in melee, so their rivens use MELEE stats (unlike Sentinel
// companion weapons, which are ranged). Both share the raw type "Companion Weapon".
const HOUND_WEAPONS = new Set(["AKATEN", "BATOTEN", "LACERTEN"]);

// Kitgun chambers aren't present in cleaned_weapons.json, so they fall through to the metastats
// fallback with no type. They use Pistol (secondary) riven stats.
const KITGUN_WEAPONS = new Set(["CATCHMOON", "GAZE", "RATTLEGUTS", "TOMBFINGER", "VERMISPLICER", "SPORELACER"]);

// Armas con escalado de Condition Overload MULTIPLICATIVO en su comportamiento base
// (curado de wiki Condition_Overload_(Mechanic)). Excluidas a propósito las que solo
// multiplican en un modo puntual (Incarnon/carga/alt-fire) — ver comentario en la derivación.
// Match por nombre exacto tal cual llega de WFCD (case-sensitive).
const MULTIPLICATIVE_CO = new Set([
    "Acceltra", "Aeolak", "Alternox", "Alternox Prime", "Arca Plasmor", "Tenet Arca Plasmor",
    "Basmu", "Battacor", "Bubonico", "Buzlok", "Catchmoon", "Cedo", "Cedo Prime",
    "Coda Bassocyst", "Coda Hema", "Mutalist Cernos", "Cinta", "Cyanex", "Epitaph", "Exergis",
    "Felarx", "Fulmin", "Harpak", "Hema", "Javlok", "Nataruk", "Quellor", "Scourge",
    "Scourge Prime", "Sepulcrum", "Shedu", "Sporelacer", "Stahlta", "Steflos", "Seer",
    "Kuva Seer", "Tenet Envoy", "Tenet Diplos", "Tenet Spirex", "Tombfinger", "Torid",
    "Zakti", "Zakti Prime", "Zenith", "Zymos"
]);

// Maps a cleaned_weapons type to the riven stat category the rest of the app understands.
// "Zaw Component" → Melee, and Hound companion weapons → Melee; everything else passes through.
function normalizeRivenWeaponType(item) {
    const t = item.type || "Rifle";
    if (t === "Zaw Component") return "Melee";
    if (t === "Companion Weapon") return HOUND_WEAPONS.has(item.name.toUpperCase()) ? "Melee" : "Rifle";
    return t;
}

/**
 * Loads weapon database, updates state.weaponMap and state.allRivenNames.
 */
export async function fetchRivenWeapons() {
    // v9 (jul 2026): +Haalvu, dedup de strikes de Zaw/Grimoire y 38 disposiciones del último
    // update. Bumpear la versión invalida la caché de IndexedDB de todos los clientes para que
    // reconstruyan weaponMap desde el cleaned_weapons.json nuevo en la siguiente carga (sin
    // esperar el TTL de 24h). Súbela cada vez que cambien los datos de armas.
    const CACHE_KEY = "voidstonkscache_weapons_v9";
    const ONE_DAY = 24 * 60 * 60 * 1000;
    try {
        const cached = await dbHelper.get(CACHE_KEY);
        if (cached?.data && cached?.timestamp && (Date.now() - cached.timestamp < ONE_DAY) && cached.data["Athodai Prime"]) {
            state.weaponMap = cached.data;
            state.allRivenNames = Object.keys(state.weaponMap).sort((a, b) => a.localeCompare(b));

            // The cache only holds the slim weaponMap, not full weapon details. Without this the
            // recipe tab (components/quantities) is empty on every cache hit, so load it here too.
            if (!state.weaponDetailsDB) {
                try {
                    const detailsRes = await fetch("assets/json/cleaned_weapons.json");
                    if (detailsRes.ok) state.weaponDetailsDB = await detailsRes.json();
                } catch (detErr) {
                    console.error("Error loading weapon details on cache hit:", detErr);
                }
            }

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
                t: normalizeRivenWeaponType(item),
            };
        });

        // Fetch metastats.json to add any missing Riven weapons (like Sydon)
        try {
            const metaRes = await fetch("metastats.json");
            if (metaRes.ok) {
                const metaData = await metaRes.json();
                const statsObj = metaData.data ? metaData.data : metaData;
                Object.keys(statsObj).forEach((rawName) => {
                    // DE weeklyRivens uses "Sigma And Octantis" while cleaned_weapons uses "Sigma & Octantis".
                    // Normalize to canonical & form so duplicates don't appear in allRivenNames.
                    const wName = rawName.replace(/ And /g, " & ");
                    if (EXCLUDED_COMPONENTS.has(wName.toUpperCase())) return;
                    if (!state.weaponMap[wName]) {
                        const metaItem = statsObj[wName];
                        let type = "Rifle";
                        if (/\(melee\)\s*$/i.test(wName)) {
                            // Variante melee de un arma con bayoneta/modo cuerpo a cuerpo
                            // ("Vinquibus (Melee)"): usa stats de riven de melee, no de rifle.
                            type = "Melee";
                        } else if (KITGUN_WEAPONS.has(wName.toUpperCase())) {
                            // Kitguns aren't in cleaned_weapons.json; they use Pistol riven stats.
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
    // v9 (jul 2026): fuerza refetch para poblar los nuevos campos fireModes/coScaling en TODAS
    // las armas (la caché v8 se generó antes de existir esos campos → salían solo en las del
    // override, p.ej. Haalvu). Súbela cuando salga un arma nueva o cambie la forma de statsDB.
    const CACHE_KEY = "voidstonkscache_combat_stats_v9";
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    try {
        const cached = await dbHelper.get(CACHE_KEY);
        if (cached?.data && cached?.timestamp && (Date.now() - cached.timestamp < ONE_WEEK)) {
            // El override se aplica en el ASSIGN (no se cachea fusionado), así editar el override
            // surte efecto sin bump de caché — solo hay que recargar.
            state.combatStatsDB = await applyCombatOverrides(cached.data);
            return;
        }

        const statsDB = {};
        // SentinelWeapons holds companion/Hound weapons (Batoten, etc.); without it they have no
        // combat-stat breakdown in the riven view.
        const categories = ["Primary", "Secondary", "Melee", "Arch-Gun", "SentinelWeapons"];
        
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

                        // Modos de disparo (Normal, Alt-Fire, Carga…): muchas armas tienen
                        // >1 y con stats distintos. WFCD los trae en attacks[] con crit_chance/
                        // crit_mult/status_chance/speed ya en su escala final. Excluimos radial/
                        // slam/heavy (se muestran aparte). Solo se puebla si hay ≥2 modos reales;
                        // el daño puede venir vacío ({}) en armas nuevas → lo cubre el override.
                        // Escalado con Condition Overload (wiki Condition_Overload_(Mechanic)):
                        //  1º) lista curada de armas MULTIPLICATIVAS SIEMPRE (base) — cubre las
                        //      excepciones hitscan que la regla no pilla (Fulmin, Cedo, Shedu…).
                        //  2º) fallback por shot_type: proyectil → multiplicativo, hitscan → aditivo.
                        //  El override JSON (Haalvu) gana sobre todo. EXCLUIDAS a propósito las que
                        //  solo multiplican en UN modo (Incarnon: Dread/Paris/Latron/Kunai/Miter;
                        //  alt-fire: Phantasma/Trumna) — marcar el arma entera engañaría.
                        // Default ADITIVO (el comportamiento "intended" de la wiki); así TODA
                        // arma muestra la insignia aunque no haya shot_type. Melee: su mod CO es
                        // multiplicativo siempre. Guns: set curado o proyectil → multiplicativo.
                        let coScaling = "additive";
                        if (cat === "Melee" || item.type === "Melee") {
                            coScaling = "multiplicative";
                        } else if (MULTIPLICATIVE_CO.has(item.name)) {
                            coScaling = "multiplicative";
                        } else if (Array.isArray(item.attacks) && item.attacks.length > 0) {
                            const shotType = (item.attacks.find(a => a.shot_type) || {}).shot_type || "";
                            if (/projectile/i.test(shotType)) coScaling = "multiplicative";
                        }

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

        // Se cachean los datos WFCD CRUDOS; el override se fusiona al asignar (ver arriba).
        dbHelper.set(CACHE_KEY, { timestamp: Date.now(), data: statsDB });
        state.combatStatsDB = await applyCombatOverrides(statsDB);
    } catch (e) {
        console.error("Error fetching combat stats:", e);
    }
}

// Fusiona combat_stats_overrides.json ENCIMA de los datos de WFCD para armas donde el
// upstream sirve datos malos/incompletos (típico en armas nuevas; p.ej. jsdelivr cacheaba
// una build corrupta de Haalvu con recarga de 13.8s). El override gana por completo por
// nombre de arma. Memoizado en módulo; si falla el fetch, devuelve los datos sin tocar.
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

    // Set loading placeholders
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
            const wfmAvg = (meta.wfm_avg_price > 0 ? meta.wfm_avg_price : null) || (meta.wfm_avg > 0 ? meta.wfm_avg : null);
            const wfmMin = (meta.web_min !== undefined && meta.web_min !== null) ? meta.web_min : (wfmAvg ? Math.round(wfmAvg * 0.25) : null);
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

/**
 * Calculates dynamic market tiers (Trash, Good Reroll, Godroll) combining
 * official DE medians and active WFM averages.
 * @param {Object} weapon
 * @returns {Object} { trash, goodReroll, godroll }
 */
export function calculateHybridTiers(weapon) {
  const popularity = weapon.popularity_pct || 0;
  const realVolume = (weapon.de_unrolled?.pop || 0) + (weapon.de_rerolled?.pop || 0) + (weapon.wfm_market_sample || 0);

  let wfmAvg = weapon.wfm_avg_price || weapon.wfm_avg || 0;
  let offMedian = weapon.official_median || 0;
  let offStdDev = weapon.official_stddev || 0;
  let reMedian = (weapon.de_rerolled?.median !== undefined) ? weapon.de_rerolled.median : 0;

  let clampMultiplier = 8;
  if (popularity > 0 || realVolume > 0) {
    if (popularity < 25 || realVolume < 25) {
      clampMultiplier = 5.5;
    } else if (popularity > 75 || realVolume > 100) {
      clampMultiplier = 12;
    }
  }

  const baseRefMedian = offMedian > 0 ? offMedian : (reMedian > 0 ? reMedian : 50);
  if (wfmAvg > baseRefMedian * clampMultiplier) {
    wfmAvg = baseRefMedian * clampMultiplier + (wfmAvg - baseRefMedian * clampMultiplier) * 0.15;
  }

  const maxUnrolled = (weapon.de_unrolled?.max_price) || 0;
  const maxRerolled = (weapon.de_rerolled?.max_price) || 0;
  const absoluteMax = Math.max(maxUnrolled, maxRerolled, weapon.max_price || 0);

  // Market-derived signals replace the hardcoded meta list: "meta" status follows real
  // liquidity/value so the model self-adjusts as the in-game meta shifts.
  const isHighValue = wfmAvg > 800 || (absoluteMax > 2500 && wfmAvg > 500);
  const hasBasicVolume = popularity >= 5.0 || realVolume >= 5;
  const isMetaWeapon = ((isHighValue || wfmAvg > 1200) && hasBasicVolume) || popularity >= 60;
  const isUnpopular = (popularity < 25 || realVolume < 25) && !(isHighValue && hasBasicVolume) && !isMetaWeapon;

  if (isUnpopular) {
    if (offMedian > 150) {
      offMedian = 150 + (offMedian - 150) * 0.15;
    }
    if (reMedian > 300) {
      reMedian = 300 + (reMedian - 300) * 0.15;
    }
    if (wfmAvg > 400) {
      wfmAvg = 400 + (wfmAvg - 400) * 0.2;
    }
    if (offStdDev > 200) {
      offStdDev = 200 + (offStdDev - 200) * 0.1;
    }
  }

  let trash = offMedian > 0 ? offMedian : ((weapon.de_unrolled?.median > 0) ? weapon.de_unrolled.median : ((weapon.de_unrolled?.min_price > 0) ? weapon.de_unrolled.min_price : (isMetaWeapon ? 50 : 15)));
  const maxTrashFloor = isMetaWeapon ? 250 : 100;
  if (trash > maxTrashFloor) {
    trash = maxTrashFloor;
  }

  let goodReroll = 0;
  if (reMedian > 0) {
    goodReroll = Math.round(reMedian * 1.6 + Math.min(wfmAvg * 0.15, reMedian * 2));
  } else {
    goodReroll = wfmAvg > 0
      ? Math.round(wfmAvg * 0.3)
      : Math.round(trash * 2.5);
  }

  let godroll = 0;
  if (offMedian > 0) {
    const stdDevScale = offStdDev > 0 ? (offStdDev / offMedian) : 1;
    const baseRef = reMedian > 0 ? reMedian : offMedian;

    let stdDevMultiplier = 5;
    if (isUnpopular) {
      stdDevMultiplier = 1.5;
    }

    const deGodroll = Math.round(baseRef * (2.5 + Math.min(stdDevScale * stdDevMultiplier, 10)));

    if (wfmAvg > 0) {
      if (wfmAvg > baseRef * 2) {
        const baseWfmScale = wfmAvg * (1.2 + Math.min(stdDevScale * 0.5, 1.5));
        godroll = Math.round(deGodroll * 0.3 + baseWfmScale * 0.7);
      } else {
        godroll = Math.round(deGodroll * 0.6 + Math.min(wfmAvg * 0.8, baseRef * 20) * 0.4);
      }
    } else {
      godroll = deGodroll;
    }
  } else {
    godroll = wfmAvg > 0
      ? Math.round(wfmAvg * 1.2)
      : Math.round(trash * 6);
  }

  if (goodReroll <= trash) {
    goodReroll = Math.round(trash * 1.8);
  }
  if (godroll <= goodReroll) {
    godroll = Math.round(goodReroll * 2.5);
  }

  return { trash, goodReroll, godroll };
}

/**
 * Predicts estimated pricing bounds based on selected attributes.
 * @param {Object} weapon
 * @param {Array} itemAttributes
 * @param {Object} tiers
 * @returns {Object} { estimatedValue, suggestedMin, suggestedMax, adjustedScore }
 */
export function calculateAdvancedPredictivePrice(weapon, itemAttributes, tiers) {
  const bestPositives = Array.isArray(weapon.pos) ? weapon.pos : (weapon.pos?.best || weapon.pos_tier?.top || []);

  let positiveCount = 0;
  let totalMetaScore = 0;
  let totalRollQuality = 0;

  const isMeleeWeapon = itemAttributes.some(attr => {
    const name = attr.name.toLowerCase();
    return name.includes("melee") || name.includes("range") || name.includes("combo") || name.includes("efficiency");
  });

  const midPositives = Array.isArray(weapon.pos_tier?.mid) ? weapon.pos_tier.mid : 
    isMeleeWeapon ? ["initial combo", "toxin", "heat", "combo duration"] : ["fire rate", "toxin", "heat", "elemental"];
  const trashPositives = Array.isArray(weapon.pos_tier?.trash) ? weapon.pos_tier.trash : [];

  const positiveWeights = [];
  itemAttributes.forEach(attr => {
    if (attr.isPositive) {
      positiveCount++;
      const nameLower = attr.name.toLowerCase();

      let attributeWeight = 0.15; // Default utility weight

      const wDynamicWeights = weapon.dynamic_weights;
      let foundWeightVal = null;
      if (wDynamicWeights && typeof wDynamicWeights === "object") {
        const foundKey = Object.keys(wDynamicWeights).find(
          k => k.toLowerCase() === nameLower || nameLower.includes(k.toLowerCase()) || k.toLowerCase().includes(nameLower)
        );
        if (foundKey !== undefined && wDynamicWeights[foundKey] !== undefined && wDynamicWeights[foundKey] !== null) {
          foundWeightVal = parseFloat(wDynamicWeights[foundKey]);
        }
      }

      if (foundWeightVal !== null) {
        attributeWeight = foundWeightVal;
      } else {
        const isDynamicMeta = bestPositives.some(p => p.toLowerCase().includes(nameLower) || nameLower.includes(p.toLowerCase()));
        const isMidMeta = midPositives.some(p => p.toLowerCase().includes(nameLower) || nameLower.includes(p.toLowerCase()));
        const isTrashMeta = trashPositives.some(p => p.toLowerCase().includes(nameLower) || nameLower.includes(p.toLowerCase()));

        if (isTrashMeta) {
          attributeWeight = 0.0;
        } else if (isDynamicMeta) {
          attributeWeight = 1.0;
        } else if (isMidMeta) {
          attributeWeight = 0.60;
        }
      }

      totalMetaScore += attributeWeight;
      positiveWeights.push(attributeWeight);

      const range = (attr.maxIdeal || 0) - (attr.minIdeal || 0);
      const quality = range > 0 ? (attr.value - attr.minIdeal) / range : 0.5;
      totalRollQuality += Math.max(0, Math.min(1, quality));
    }
  });

  const avgRollQuality = positiveCount > 0 ? totalRollQuality / positiveCount : 0.5;
  let finalMetaRatio = 0;
  if (positiveCount === 1) {
    finalMetaRatio = positiveWeights[0] || 0;
  } else if (positiveCount === 2) {
    finalMetaRatio = (((positiveWeights[0] || 0) + (positiveWeights[1] || 0)) / 2) * 1.10;
  } else if (positiveCount >= 3) {
    const sortedWeights = positiveWeights.toSorted((a, b) => b - a);
    finalMetaRatio = ((sortedWeights[0] + sortedWeights[1]) / 2) * 0.80 + sortedWeights[2] * 0.20;
  }

  let hasNegAttr = false;
  itemAttributes.forEach(attr => {
    if (!attr.isPositive) hasNegAttr = true;
  });

  let effectiveMetaRatio = finalMetaRatio;
  if (!hasNegAttr) {
    if (positiveCount >= 3) {
      effectiveMetaRatio = finalMetaRatio * 0.82; 
    } else {
      effectiveMetaRatio = finalMetaRatio * 0.80;
    }
  }

  let finalPrice = 0;

  if (effectiveMetaRatio >= 0.85) {
    const floorGodroll = tiers.godroll * 0.60;
    finalPrice = floorGodroll + (Math.pow(avgRollQuality, 1.2) * (tiers.godroll - floorGodroll));
  } else if (effectiveMetaRatio >= 0.50) {
    if (avgRollQuality <= 0.5) {
      const floorGood = tiers.goodReroll * 0.65;
      finalPrice = floorGood + (avgRollQuality * 2) * (tiers.goodReroll - floorGood);
    } else {
      const upperBound = tiers.goodReroll * 1.4;
      finalPrice = tiers.goodReroll + ((avgRollQuality - 0.5) * 2) * (upperBound - tiers.goodReroll);
    }
  } else {
    finalPrice = tiers.trash * (0.8 + avgRollQuality * 0.4);
  }

  const curseNegs = Array.isArray(weapon.neg_tier?.curse) ? weapon.neg_tier.curse : 
    ["critical chance", "critical damage", "damage", "multishot", "fire rate", "attack speed", "melee damage", "range"];
  const buffNegs = Array.isArray(weapon.neg_tier?.buff) ? weapon.neg_tier.buff : 
    ["zoom", "recoil", "impact", "puncture"];

  let isBricked = false;

  itemAttributes.forEach(attr => {
    if (!attr.isPositive) {
      const negName = attr.name.toLowerCase();
      
      const isElementalNeg = ["toxin", "heat", "cold", "electric"].some(e => negName.includes(e));
      
      const isCurse = isElementalNeg || curseNegs.some(n => n.toLowerCase().includes(negName) || negName.includes(n.toLowerCase()));
      const isBuff = !isElementalNeg && buffNegs.some(n => n.toLowerCase().includes(negName) || negName.includes(n.toLowerCase()));

      const isBrick = isElementalNeg || (isCurse && ["multishot", "critical chance", "critical damage", "damage", "melee damage"].some(b => negName.includes(b)));
      if (isBrick) {
        isBricked = true;
      }

      if (isCurse) {
        finalPrice *= (effectiveMetaRatio >= 0.85) ? 0.35 : 0.15;
      } else if (isBuff) {
        finalPrice *= 1.15;
      } else {
        finalPrice *= 0.90;
      }
    }
  });

  if (isBricked) {
    finalPrice = tiers.trash;
  }

  finalPrice = Math.max(Math.round(finalPrice), tiers.trash);

  return {
    estimatedValue: finalPrice,
    suggestedMin: Math.round(finalPrice * 0.85),
    suggestedMax: Math.round(finalPrice * 1.15),
    adjustedScore: Math.round(((finalMetaRatio * 0.85) + (avgRollQuality * 0.15)) * 100)
  };
}

/**
 * Calculates potential score index.
 * @param {Object} weapon
 * @returns {number}
 */
export function calculatePotentialScore(weapon) {
  if (!weapon || (!weapon.wfm_avg_price && !weapon.wfm_avg && !weapon.official_median)) {
    return 0;
  }

  const basePrice = weapon.wfm_avg_price || weapon.wfm_avg || weapon.official_median;
  const offStdDev = weapon.official_stddev || 0;

  const volatilityFactor = basePrice > 0 ? (offStdDev / basePrice) : 0;
  let scoreV = Math.min(volatilityFactor * 50, 40);

  const wfmSamples = weapon.wfm_market_sample || 0;
  const dePop = weapon.de_unrolled?.pop || weapon.de_rerolled?.pop || 0;
  const popFactor = Math.max(wfmSamples, dePop * 2);
  let scoreP = Math.min(popFactor, 30);

  let scoreB = Math.min((basePrice / 500) * 30, 30);

  const finalScore = Math.round(scoreV + scoreP + scoreB);

  return Math.min(Math.max(finalScore, 0), 100);
}
