import { WORKER_URL } from "../config.js";
import { RIVEN_API_BASE } from "../repositories/riven.repository.js";
import { getRivenSlug } from "../utils/slugs.utils.js";
import { state } from "../state.js";
import { dbHelper } from "../repositories/storage.repository.js";

const ENABLE_DEBUG_LOGS = false; // Toggle this to see Riven market console logs

let dynamicMetaStats = null;
let baselineMetaStats = null;

function cleanMetadataKeys(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
    const metadataKeys = new Set(["note", "status", "version", "ttl", "error", "timestamp", "data", "created at", "completed at", "file path"]);
    for (const key of Object.keys(obj)) {
        if (metadataKeys.has(key.toLowerCase()) || metadataKeys.has(key)) {
            delete obj[key];
        }
    }
    return obj;
}

export async function loadDynamicMetaStats() {
    const CACHE_KEY = "voidstonkscache_riven_metastats_v8";
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

    // Default hardcoded initial fallback data provided by the user
    let loadedData = {
        "Arbucep": { "pos": ["Critical Damage", "Multishot", "Critical Chance", "Reload Speed"], "neg": ["Zoom", "Damage Vs Grineer"] },
        "Cortege": { "pos": ["Critical Damage", "Status Chance", "Toxin Damage", "Critical Chance"], "neg": ["Reload Speed"] },
        "Corvas": { "pos": ["Critical Chance", "Critical Damage", "Multishot", "Damage Vs Corpus"], "neg": ["Impact Damage", "Fire Rate / Attack Speed"] },
        "Cyngas": { "pos": ["Critical Damage", "Multishot", "Critical Chance", "Base Damage / Melee Damage"], "neg": ["Puncture Damage", "Zoom"] },
        "Dual Decurion": { "pos": ["Damage Vs Corpus", "Critical Chance", "Multishot", "Critical Damage"], "neg": ["Zoom", "Puncture Damage"] },
        "Fluctus": { "pos": ["Critical Damage", "Reload Speed", "Toxin Damage", "Critical Chance"], "neg": ["Zoom", "Ammo Maximum"] },
        "Kuva Ayanga": { "pos": ["Multishot", "Critical Damage", "Critical Chance", "Toxin Damage"], "neg": ["Recoil", "Reload Speed"] },
        "Larkspur": { "pos": ["Multishot", "Base Damage / Melee Damage", "Critical Chance", "Critical Damage"], "neg": ["Recoil", "Impact Damage"] },
        "Mandonel": { "pos": ["Multishot", "Base Damage / Melee Damage", "Critical Chance", "Punch Through"], "neg": ["Zoom", "Recoil"] }
    };

    dynamicMetaStats = { ...loadedData };
    baselineMetaStats = { ...loadedData };
    globalThis.dynamicMetaStats = dynamicMetaStats;
    globalThis.baselineMetaStats = baselineMetaStats;
    try {
        // Helper to calculate the most recent Monday at 17:30 UTC
        const getLastMonday1730UTC = (timestamp) => {
            const d = new Date(timestamp);
            const day = d.getUTCDay();
            const monday = new Date(d);
            monday.setUTCHours(17, 30, 0, 0);

            // Adjust day to Monday (0=Sun, 1=Mon, ..., 6=Sat)
            const diff = (day === 0 ? -6 : 1 - day);
            monday.setUTCDate(monday.getUTCDate() + diff);

            // If Monday 17:30 UTC is in the future relative to the given timestamp,
            // the last release was in the previous week.
            if (monday.getTime() > timestamp) {
                monday.setUTCDate(monday.getUTCDate() - 7);
            }
            return monday.getTime();
        };
        // 1. Try to load from IndexedDB cache
        const cached = await dbHelper.get(CACHE_KEY);
        let cacheValid = false;

        if (cached?.data && cached?.timestamp) {
            const lastMondayRelease = getLastMonday1730UTC(Date.now());
            // Cache is valid if it was saved AFTER the last Monday 17:30 UTC release
            if (cached.timestamp >= lastMondayRelease) {
                let cachedObj = cached.data;
                if (cachedObj && cachedObj.data && typeof cachedObj.data === "object" && !Array.isArray(cachedObj.data)) {
                    cachedObj = cachedObj.data;
                }
                cachedObj = cleanMetadataKeys(cachedObj);

                if (cachedObj && !cachedObj.error && Object.keys(cachedObj).length > 0) {
                    for (const [key, cachedVal] of Object.entries(cachedObj)) {
                        if (loadedData[key]) {
                            const cachedPop = cachedVal.popularity_pct;
                            const hasValidCachedPop = cachedPop !== undefined && cachedPop !== null && cachedPop > 0;
                            loadedData[key] = {
                                ...loadedData[key],
                                ...cachedVal,
                                popularity_pct: hasValidCachedPop ? cachedPop : (loadedData[key].popularity_pct || 0)
                            };
                        } else {
                            loadedData[key] = cachedVal;
                        }
                    }
                    dynamicMetaStats = loadedData;
                    globalThis.dynamicMetaStats = dynamicMetaStats;
                    cacheValid = true;
                    if (ENABLE_DEBUG_LOGS) console.log("Loaded dynamic Riven Meta Stats from local cache (Valid since last Monday 17:30 UTC)");
                }
            }
        }
        // 2. Fetch from Worker if cache is missing or expired
        let fetchedFromWorker = false;
        if (!cacheValid) {
            try {
                const cleanWorkerUrl = `${RIVEN_API_BASE}/rivens`;
                const res = await fetch(cleanWorkerUrl);
                if (res.ok) {
                    let data = await res.json();

                    // Unwrap if nested in {"data": ...}
                    if (data?.data && typeof data.data === "object" && !Array.isArray(data.data)) {
                        data = data.data;
                    }
                    data = cleanMetadataKeys(data);

                    if (data && !data.error && Object.keys(data).length > 0) {
                        for (const [key, workerVal] of Object.entries(data)) {
                            if (loadedData[key]) {
                                const workerPop = workerVal.popularity_pct;
                                const hasValidWorkerPop = workerPop !== undefined && workerPop !== null && workerPop > 0;
                                loadedData[key] = {
                                    ...loadedData[key],
                                    ...workerVal,
                                    popularity_pct: hasValidWorkerPop ? workerPop : (loadedData[key].popularity_pct || 0)
                                };
                            } else {
                                loadedData[key] = workerVal;
                            }
                        }
                        dynamicMetaStats = loadedData;
                        globalThis.dynamicMetaStats = dynamicMetaStats;
                        await dbHelper.set(CACHE_KEY, { timestamp: Date.now(), data: loadedData });
                        fetchedFromWorker = true;
                        if (ENABLE_DEBUG_LOGS) console.log("Loaded and cached fresh dynamic Riven Meta Stats from Worker!");
                    }
                }
            } catch (err) {
                console.warn("Could not fetch metastats from worker:", err);
            }
        }

        if (globalThis.refreshCurrentRivenMetaStats) {
            globalThis.refreshCurrentRivenMetaStats();
        }
        // Asynchronously refresh the Riven Analyzer average box once the dynamic stats are loaded!
        const weaponInput = document.getElementById("rivenWeaponInput");
        if (weaponInput?.value) {
            import("./rivens.service.js").then(({ fetchRivenAverage }) => {
                fetchRivenAverage(weaponInput.value);
            }).catch(err => console.error("Error refreshing Riven average after metadata load:", err));
        }
    } catch (e) {
        console.error("Could not load dynamic meta stats:", e);
    }
}
// Load immediately on startup
loadDynamicMetaStats();
export function getBaseWeaponName(weaponName) {
    if (!weaponName) return "";
    let clean = weaponName.trim();

    // Dex Furis is a dual weapon and uses the Afuris Riven Mod!
    if (clean.toLowerCase() === "dex furis" || clean.toLowerCase() === "dex afuris") {
        return "Afuris";
    }

    // Specific custom overrides for family mappings
    const overrides = {
        "pangolin prime": "Pangolin Sword",
        "prime laser rifle": "Laser Rifle",
        "prime burst laser": "Burst Laser",
        "prime robo-deth": "Robo-Deth",
        "prime deth machine rifle": "Deth Machine Rifle",
        "vaykor marelok": "Marelok",
        "vaykor hek": "Hek",
        "prisma dual decurions": "Dual Decurion",
        "dual decurions": "Dual Decurion",
        "prisma dual decurion": "Dual Decurion"
    };

    const lowerClean = clean.toLowerCase();
    if (overrides[lowerClean]) {
        return overrides[lowerClean];
    }

    // Strip hyphenated/spaced MK1/MK-1 prefix early
    let baseCandidate = clean.replace(/^(mk1|mk-1)[-\s]+/i, "");

    // Strip prefixes (case insensitive)
    const prefixes = [
        "coda", "kuva", "tenet", "prisma", "dex", "carmine",
        "telos", "synoid", "secura", "rakta", "sancti", "mara", "vandal",
        "vaykor", "dragon", "prime"
    ];
    // Strip suffixes (case insensitive)
    const suffixes = ["prime", "vandal", "wraith", "coda"];

    let changed = true;
    while (changed) {
        changed = false;

        for (const pre of prefixes) {
            const regex = new RegExp(String.raw`^${pre}\s+`, "i");
            if (regex.test(baseCandidate)) {
                baseCandidate = baseCandidate.replace(regex, "");
                changed = true;
            }
        }

        for (const suf of suffixes) {
            const regex = new RegExp(String.raw`\s+${suf}$`, "i");
            if (regex.test(baseCandidate)) {
                baseCandidate = baseCandidate.replace(regex, "");
                changed = true;
            }
        }
    }

    // Post-stripping overrides/mappings
    if (baseCandidate.toLowerCase() === "pangolin") {
        return "Pangolin Sword";
    }

    return baseCandidate;
}
export function getMetaStats(weaponName, weaponType) {
    if (!weaponName) return null;

    const baseName = getBaseWeaponName(weaponName);

    let rawMeta = null;
    let baseMeta = null;

    if (state.rivenIndexData && typeof state.rivenIndexData === "object") {
        if (state.rivenIndexData[weaponName]) {
            rawMeta = { ...state.rivenIndexData[weaponName] };
        } else {
            for (const family of Object.values(state.rivenIndexData)) {
                if (family && typeof family === "object") {
                    if (family.variants && family.variants[weaponName]) {
                        rawMeta = { ...family.variants[weaponName] };
                        break;
                    } else if (family.baseStats && family.familyName && family.familyName.toLowerCase() === baseName.toLowerCase()) {
                        rawMeta = { ...family.baseStats };
                        break;
                    }
                }
            }
        }
        if (state.rivenIndexData[baseName]) {
            baseMeta = { ...state.rivenIndexData[baseName] };
        } else {
            for (const family of Object.values(state.rivenIndexData)) {
                if (family && typeof family === "object" && family.familyName && family.familyName.toLowerCase() === baseName.toLowerCase()) {
                    baseMeta = family.baseStats ? { ...family.baseStats } : null;
                    break;
                }
            }
        }
    }

    if (!rawMeta && dynamicMetaStats) {
        const statsObj = dynamicMetaStats.data ? dynamicMetaStats.data : dynamicMetaStats;

        const lookupKey = (key) => {
            if (!key) return null;
            if (statsObj[key]) return statsObj[key];
            const matchedKey = Object.keys(statsObj).find(
                k => k.toLowerCase() === key.toLowerCase()
            );
            return matchedKey ? statsObj[matchedKey] : null;
        };
        const baseMetaFallback = lookupKey(baseName);
        const variantMeta = lookupKey(weaponName);

        if (variantMeta) {
            rawMeta = { ...variantMeta };
        } else if (baseMetaFallback) {
            rawMeta = { ...baseMetaFallback };
        }

        if (!rawMeta) {
            // Nested recursive fallback search
            const findNested = (obj, targetKey) => {
                if (!obj || typeof obj !== "object") return null;
                const matchedKey = Object.keys(obj).find(
                    k => k.toLowerCase() === targetKey.toLowerCase()
                );
                if (matchedKey && (obj[matchedKey].pos || obj[matchedKey].top_positive)) return obj[matchedKey];
                for (const key of Object.keys(obj)) {
                    const found = findNested(obj[key], targetKey);
                    if (found) return found;
                }
                return null;
            };
            rawMeta = findNested(statsObj, weaponName) || findNested(statsObj, baseName);
        }

        if (!baseMeta) {
            baseMeta = baseMetaFallback;
        }
    }

    const hasValidRecommendations = (metaObj) => {
        if (!metaObj) return false;

        // Check pos
        const pos = metaObj.pos;
        if (Array.isArray(pos) && pos.length > 0) return true;
        if (pos && typeof pos === "object" && Array.isArray(pos.best) && pos.best.length > 0) return true;

        // Check top_positive
        const topPos = metaObj.top_positive;
        if (Array.isArray(topPos) && topPos.length > 0) return true;

        // NEW FORMAT Check
        const posTier = metaObj.pos_tier;
        if (posTier && Array.isArray(posTier.top) && posTier.top.length > 0) return true;

        return false;
    };

    const hasValidPricing = (metaObj) => {
        if (!metaObj) return false;
        if (metaObj.official_median > 0) return true;
        if (metaObj.official_avg_price > 0) return true;
        if (metaObj.wfm_avg_price > 0 || metaObj.wfm_avg > 0) return true;
        if (metaObj.de_unrolled && metaObj.de_unrolled.median > 0) return true;
        return false;
    };

    // Perform robust inheritance if variant belongs to a base family
    if (rawMeta && baseMeta) {
        // 1. ALWAYS inherit recommendations from the base family if the base has them!
        if (hasValidRecommendations(baseMeta) && !hasValidRecommendations(rawMeta)) {
            if (baseMeta.pos) rawMeta.pos = baseMeta.pos;
            if (baseMeta.neg) rawMeta.neg = baseMeta.neg;
            if (baseMeta.pos_tier) rawMeta.pos_tier = baseMeta.pos_tier;
            if (baseMeta.neg_tier) rawMeta.neg_tier = baseMeta.neg_tier;
            if (baseMeta.top_positive) rawMeta.top_positive = baseMeta.top_positive;
            if (baseMeta.top_negative) rawMeta.top_negative = baseMeta.top_negative;
        }

        // 2. ALWAYS inherit pricing and statistical metrics from the base family if the base has them!
        if (hasValidPricing(baseMeta)) {
            const excludedKeys = new Set(["name", "pos", "neg", "pos_tier", "neg_tier", "top_positive", "top_negative"]);
            for (const key of Object.keys(baseMeta)) {
                if (!excludedKeys.has(key) && baseMeta[key] !== undefined) {
                    rawMeta[key] = baseMeta[key];
                }
            }
        }
    }

    // 3. Defensive fallback: If resolved rawMeta lacks valid recommendations (e.g. empty pos/neg from Worker or Cache),
    // retrieve them from the original baseline metadata.
    if (rawMeta && !hasValidRecommendations(rawMeta)) {
        const activeBaseline = baselineMetaStats || globalThis.baselineMetaStats;
        if (activeBaseline) {
            const lookupBaseline = (key) => {
                if (!key) return null;
                if (activeBaseline[key]) return activeBaseline[key];
                const matchedKey = Object.keys(activeBaseline).find(
                    k => k.toLowerCase() === key.toLowerCase()
                );
                return matchedKey ? activeBaseline[matchedKey] : null;
            };

            const baselineMeta = lookupBaseline(baseName) || lookupBaseline(weaponName);
            if (baselineMeta && hasValidRecommendations(baselineMeta)) {
                rawMeta.pos = baselineMeta.pos;
                rawMeta.neg = baselineMeta.neg;
                if (baselineMeta.pos_tier) rawMeta.pos_tier = baselineMeta.pos_tier;
                if (baselineMeta.neg_tier) rawMeta.neg_tier = baselineMeta.neg_tier;
                if (baselineMeta.top_positive) rawMeta.top_positive = baselineMeta.top_positive;
                if (baselineMeta.top_negative) rawMeta.top_negative = baselineMeta.top_negative;
            }
        }
    }

    // 4. Defensive fallback for other statistical/pricing metrics:
    // If the resolved rawMeta is missing key metrics, inherit them from the baseline entry.
    if (rawMeta) {
        const activeBaseline = baselineMetaStats || globalThis.baselineMetaStats;
        if (activeBaseline) {
            const lookupBaseline = (key) => {
                if (!key) return null;
                if (activeBaseline[key]) return activeBaseline[key];
                const matchedKey = Object.keys(activeBaseline).find(
                    k => k.toLowerCase() === key.toLowerCase()
                );
                return matchedKey ? activeBaseline[matchedKey] : null;
            };

            const baselineMeta = lookupBaseline(baseName) || lookupBaseline(weaponName);
            if (baselineMeta) {
                const fallbackMetrics = [
                    "popularity_pct",
                    "official_median",
                    "official_stddev",
                    "official_avg_price",
                    "wfm_market_sample",
                    "wfm_avg_price",
                    "wfm_avg",
                    "de_unrolled",
                    "de_rerolled"
                ];
                for (const metric of fallbackMetrics) {
                    if (rawMeta[metric] === undefined || rawMeta[metric] === null) {
                        rawMeta[metric] = baselineMeta[metric];
                    }
                }
            }
        }
    }

    if (!rawMeta) return null;

    const pos = Array.isArray(rawMeta.pos) ? rawMeta.pos : (rawMeta.pos?.best || rawMeta.pos_tier?.top || []);
    const neg = Array.isArray(rawMeta.neg) ? rawMeta.neg : (rawMeta.neg?.best || rawMeta.neg_tier?.buff || []);
    const midPos = rawMeta.pos_tier?.mid || rawMeta.pos?.mid || [];
    const midNeg = rawMeta.neg_tier?.mid || rawMeta.neg?.mid || [];

    if (ENABLE_DEBUG_LOGS) console.log(`[getMetaStats] weaponName: ${weaponName}, baseName: ${baseName}, inherited pos:`, pos, "neg:", neg);

    return {
        ...rawMeta,
        name: weaponName,
        popularity_pct: rawMeta.popularity_pct ?? rawMeta.liquidity_score ?? 0,
        pos,
        neg,
        midPos,
        midNeg,
        rawPos: rawMeta.pos,
        rawNeg: rawMeta.neg
    };
}
// Short-lived memory cache for live Riven auctions (15 minutes) to prevent spamming the worker on stat toggle
const liveAuctionsCache = {};

export async function fetchSimilarRivens(weaponName, positiveStats, negativeStat) {
    if (!weaponName || positiveStats.length === 0) return [];

    const slug = getRivenSlug(weaponName);
    const cacheKey = slug.toLowerCase();
    const FIFTEEN_MINUTES = 15 * 60 * 1000;

    let auctions = [];

    try {
        if (liveAuctionsCache[cacheKey] && (Date.now() - liveAuctionsCache[cacheKey].timestamp < FIFTEEN_MINUTES)) {
            auctions = liveAuctionsCache[cacheKey].auctions;
            if (ENABLE_DEBUG_LOGS) console.log(`[Cache Hit] Retrieved live Riven auctions for ${weaponName} from memory (15 min cache)!`);
        } else {
            const res = await fetch(`${WORKER_URL}?type=riven&q=${slug}`);
            if (!res.ok) throw new Error("Worker Error");
            const data = await res.json();
            auctions = data.payload?.auctions || [];
            liveAuctionsCache[cacheKey] = {
                timestamp: Date.now(),
                auctions: auctions
            };
            if (ENABLE_DEBUG_LOGS) console.log(`[Network Fetch] Fetched fresh live Riven auctions for ${weaponName} from Worker!`);
        }

        // Helper to canonicalize names for matching
        const getCanonicalStatKey = (name) => {
            if (!name) return "";
            const clean = name.toLowerCase().replaceAll('_', " ").replaceAll('-', " ").trim();
            if (clean.includes("critical chance")) return "critical_chance";
            if (clean.includes("critical damage")) return "critical_damage";
            if (clean.includes("multishot")) return "multishot";
            if (clean.includes("melee range") || clean.includes("range")) return "range";
            if (clean.includes("base damage") || clean.includes("melee damage") || clean === "damage") return "damage";
            if (clean.includes("fire rate") || clean.includes("attack speed") || clean === "speed") return "speed";
            if (clean.includes("status chance")) return "status_chance";
            if (clean.includes("status duration")) return "status_duration";
            if (clean.includes("toxin")) return "toxin";
            if (clean.includes("heat")) return "heat";
            if (clean.includes("electricity") || clean.includes("electric")) return "electricity";
            if (clean.includes("cold")) return "cold";
            if (clean.includes("impact")) return "impact";
            if (clean.includes("puncture")) return "puncture";
            if (clean.includes("slash")) return "slash";
            if (clean.includes("recoil")) return "recoil";
            if (clean.includes("magazine")) return "magazine_capacity";
            if (clean.includes("reload")) return "reload_speed";
            if (clean.includes("ammo")) return "ammo_maximum";
            if (clean.includes("flight") || clean.includes("projectile speed")) return "flight_speed";
            if (clean.includes("zoom")) return "zoom";
            if (clean.includes("punch")) return "punch_through";
            if (clean.includes("combo duration")) return "combo_duration";
            if (clean.includes("slide crit") || clean.includes("slide attack")) return "slide_crit";
            if (clean.includes("extra combo count") || clean.includes("combo count chance") || clean.includes("combo_count_chance")) return "combo_count_chance";
            if (clean.includes("channeling damage") || clean.includes("initial combo")) return "initial_combo";
            if (clean.includes("channeling efficiency") || clean.includes("heavy attack efficiency") || clean.includes("heavy efficiency")) return "heavy_efficiency";
            if (clean.includes("corpus")) return "vs_corpus";
            if (clean.includes("grineer")) return "vs_grineer";
            if (clean.includes("infested")) return "vs_infested";
            return clean;
        };

        const isBrickNegative = (negUrlName) => {
            const key = getCanonicalStatKey(negUrlName);
            return key === "critical_chance" ||
                   key === "critical_damage" ||
                   key === "multishot" ||
                   key === "damage";
        };

        // Canonicalize search criteria
        const searchPosKeys = positiveStats.map(s => getCanonicalStatKey(s));
        const searchNegKey = negativeStat ? getCanonicalStatKey(negativeStat) : null;

        // Map and score all active auctions
        const scoredAuctions = auctions
            .filter(a => a.visible && a.owner.status !== "offline" && a.item?.attributes)
            .map(a => {
                const itemPosKeys = a.item.attributes
                    .filter(attr => attr.positive)
                    .map(attr => getCanonicalStatKey(attr.url_name));

                const itemNegKeys = a.item.attributes
                    .filter(attr => !attr.positive)
                    .map(attr => getCanonicalStatKey(attr.url_name));

                // Calculate positive match count
                let matchCount = 0;
                for (const spKey of searchPosKeys) {
                    if (itemPosKeys.includes(spKey)) {
                        matchCount++;
                    }
                }

                // Similarity scoring
                let similarityScore = 0;

                // Positive match weighting
                if (searchPosKeys.length === 3) {
                    if (matchCount === 3) similarityScore += 150;
                    else if (matchCount === 2) similarityScore += 50;
                    else if (matchCount === 1) similarityScore += 10;
                } else if (searchPosKeys.length === 2) {
                    if (matchCount === 2) similarityScore += 150;
                    else if (matchCount === 1) similarityScore += 30;
                } else {
                    if (matchCount === 1) similarityScore += 150;
                }

                // Negative match weighting
                const hasSearchNeg = !!searchNegKey;
                const hasItemNeg = itemNegKeys.length > 0;

                if (hasSearchNeg && hasItemNeg) {
                    if (itemNegKeys.includes(searchNegKey)) {
                        similarityScore += 80; // Perfect negative match
                    } else {
                        similarityScore += 30; // Both have a negative, but different
                    }
                } else if (!hasSearchNeg && !hasItemNeg) {
                    similarityScore += 50; // Both have no negative
                } else {
                    similarityScore -= 20; // Mismatch in having negative
                }

                // Brick negative penalty
                if (hasItemNeg) {
                    const itemNegUrl = a.item.attributes.find(attr => !attr.positive)?.url_name || "";
                    const isItemNegBrick = isBrickNegative(itemNegUrl);
                    const isSearchNegBrick = searchNegKey ? isBrickNegative(searchNegKey) : false;

                    if (isItemNegBrick && !isSearchNegBrick) {
                        similarityScore -= 300; // Massive penalty for bricking
                    }
                }

                return {
                    auction: a,
                    matchCount: matchCount,
                    similarityScore: similarityScore
                };
            });

        // Filter: Must have at least required matches
        const requiredMatches = Math.max(1, searchPosKeys.length > 1 ? 2 : 1);
        const filtered = scoredAuctions.filter(item => item.matchCount >= requiredMatches);

        // Sort: First by similarity score (descending), then by price (ascending)
        filtered.sort((a, b) => {
            if (b.similarityScore !== a.similarityScore) {
                return b.similarityScore - a.similarityScore;
            }
            const priceA = a.auction.buyout_price || a.auction.starting_price || 99999;
            const priceB = b.auction.buyout_price || b.auction.starting_price || 99999;
            return priceA - priceB;
        });

        // Extract auctions
        const finalResults = filtered.map(item => item.auction);

        // Return top 4 most similar / cheapest
        return finalResults.slice(0, 4);

    } catch (e) {
        console.error("Failed to fetch similar rivens:", e);
        return [];
    }
}