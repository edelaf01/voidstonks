import { WORKER_URL } from "../../config.js";
import { state } from "../../state.js";
import { dbHelper } from "../../repositories/storage.repository.js";
import { getRivenSlug } from "../../utils/slugs.utils.js";

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

// Armas cuyo modo de disparo PRINCIPAL multiplica el daño de CO en vez de sumarlo.
// Fuente: hoja de tests de rainy/Prof_Blocks_007 "Galvanized GunCO on Projectiles"
// (docs.google.com/spreadsheets/d/1ryemX4Y2vWy9LjuJ355bWVNuBhzLaHTTFqPeTNto9RA),
// columna "+Damage Math". Su regla de oro: lo que NO sale en la hoja suma plano, así
// que esta lista es cerrada — no se deduce del tipo de arma ni del shot_type.
// Excluidas a propósito las que solo multiplican en un modo secundario, porque marcar
// el arma entera engañaría: Incarnon (Dread/Paris/Latron/Kunai/Miter/Angstrum), alt-fire
// (Cedo, Zenith Disc, Tenet Plinx, Larkspur Prime, Phantasma/Trumna), carga (Quellor),
// arpón (Harpak, Paracyst), contacto (Zymos, Catabolyst), ADS (Tenet Diplos) y los
// melee que solo multiplican en su ataque pesado o de proyectil (Corufell, Syam,
// Nepheri, Verdilac, Tatsu Prime, Exodia Contagion).
// Match por nombre exacto tal cual llega de WFCD (case-sensitive).
const MULTIPLICATIVE_CO = new Set([
    // Archgun
    "Arbucep", "Corvas Prime", "Grattler", "Mandonel", "Velocitus",
    // Primary
    "Aeolak", "Alternox", "Alternox Prime", "Arca Plasmor", "Tenet Arca Plasmor",
    "Basmu", "Battacor", "Bubonico", "Buzlok", "Cinta", "Coda Bassocyst", "Coda Hema",
    "Exergis", "Felarx", "Fulmin", "Fulmin Prime", "Hema", "Javlok", "Mutalist Cernos",
    "Nataruk", "Scourge", "Scourge Prime", "Shedu", "Stahlta", "Steflos", "Tenet Envoy",
    "Torid",
    // Secondary
    "Aegrit", "Akarius", "Akarius Prime", "Catchmoon", "Cyanex", "Epitaph",
    "Epitaph Prime", "Onos", "Seer", "Kuva Seer", "Sepulcrum", "Tenet Spirex",
    "Tombfinger", "Zakti", "Zakti Prime"
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
    // v10 (jul 2026): dedup por slug de las claves de metastats ("Ax 52" duplicaba a "Ax-52",
    // ídem EFV-5/EFV-8/Riot-848/Dark Split-Sword). Bumpear la versión invalida la caché de
    // IndexedDB de todos los clientes para que reconstruyan weaponMap desde el
    // cleaned_weapons.json nuevo en la siguiente carga (sin esperar el TTL de 24h).
    // Súbela cada vez que cambien los datos de armas.
    const CACHE_KEY = "voidstonkscache_weapons_v10";
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
                // Las fuentes de metastats publican el mismo arma con separadores distintos que
                // cleaned_weapons ("Ax 52" vs "Ax-52", "Sigma And Octantis" vs "Sigma & Octantis"),
                // lo que duplicaba la entrada en allRivenNames y la copia extra salía sin datos.
                // Canonicalizamos por slug contra los nombres ya cargados en weaponMap.
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
        
        const { updateDucatsDB } = await import("../inventory/relics.service.js");
        updateDucatsDB(data);
        
        // Fetch combat stats in background
        fetchWeaponCombatStats();
    } catch (e) {
        console.error("Error weapons local:", e);
    }
}

async function fetchWeaponCombatStats() {
    // v10 (ago 2026): la v9 se generó con la regla vieja "proyectil ⇒ CO multiplicativo" y
    // con melee siempre multiplicativo; sin bump, esos coScaling erróneos vivirían en la caché
    // del cliente hasta una semana. Súbela cuando salga un arma nueva o cambie la forma de statsDB.
    const CACHE_KEY = "voidstonkscache_combat_stats_v10";
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
                        // Escalado con Condition Overload: multiplicativo SOLO si el arma está en
                        // la lista cerrada de arriba. Sumar plano es el caso general — incluido el
                        // melee ("Normal Melee Hits: Adds", CO va al mismo saco que Pressure Point)
                        // y los proyectiles, que la hoja lista uno a uno como aditivos (Boltor,
                        // Penta, Tonkor, Zarr, Kuva Bramma, Lenz, arcos, Acceltra, Kompressa…).
                        // Por eso no hay fallback por shot_type ni por categoría: "proyectil ⇒
                        // multiplicativo" es falso y marcaba en verde a docenas de armas planas.
                        // El override JSON (Haalvu) gana sobre esto.
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

