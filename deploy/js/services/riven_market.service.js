import { WORKER_URL } from "../config.js";
import { getRivenSlug } from "./slugs.service.js";
import { state } from "../state.js";
import { dbHelper } from "../repositories/storage.repository.js";
let dynamicMetaStats = null;
let baselineMetaStats = null;
export async function loadDynamicMetaStats() {
    const CACHE_KEY = "voidstonkscache_riven_metastats_v6";
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
    globalThis.dynamicMetaStats = dynamicMetaStats;
    try {
        // 0. Load the local metastats.json baseline first to ensure all weapons have fallback data
        try {
            const resLocalBaseline = await fetch("metastats.json");
            if (resLocalBaseline.ok) {
                let dataLocalBaseline = await resLocalBaseline.json();
                if (dataLocalBaseline && dataLocalBaseline.data && typeof dataLocalBaseline.data === "object" && !Array.isArray(dataLocalBaseline.data)) {
                    dataLocalBaseline = dataLocalBaseline.data;
                }
                if (dataLocalBaseline && !dataLocalBaseline.error && Object.keys(dataLocalBaseline).length > 0) {
                    loadedData = { ...loadedData, ...dataLocalBaseline };
                    baselineMetaStats = dataLocalBaseline;
                    globalThis.baselineMetaStats = baselineMetaStats;
                    dynamicMetaStats = loadedData;
                    globalThis.dynamicMetaStats = dynamicMetaStats;
                    console.log("Loaded baseline metastats from local metastats.json!");
                }
            }
        } catch (err) {
            // Quietly ignore
        }
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

                if (cachedObj && !cachedObj.error && Object.keys(cachedObj).length > 0) {
                    loadedData = { ...loadedData, ...cachedObj };
                    dynamicMetaStats = loadedData;
                    globalThis.dynamicMetaStats = dynamicMetaStats;
                    cacheValid = true;
                    console.log("Loaded dynamic Riven Meta Stats from local cache (Valid since last Monday 17:30 UTC)");
                }
            }
        }
        // 2. Fetch from Worker if cache is missing or expired
        let fetchedFromWorker = false;
        if (!cacheValid) {
            try {
                const cleanWorkerUrl = "https://soft-mountain-28fe.edelamf0.workers.dev/api/rivens";
                const res = await fetch(cleanWorkerUrl);
                if (res.ok) {
                    let data = await res.json();

                    // Unwrap if nested in {"data": ...}
                    if (data && data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
                        data = data.data;
                    }

                    if (data && !data.error && Object.keys(data).length > 0) {
                        loadedData = { ...loadedData, ...data };
                        dynamicMetaStats = loadedData;
                        globalThis.dynamicMetaStats = dynamicMetaStats;
                        await dbHelper.set(CACHE_KEY, { timestamp: Date.now(), data: loadedData });
                        fetchedFromWorker = true;
                        console.log("Loaded and cached fresh dynamic Riven Meta Stats from Worker!");
                    }
                }
            } catch (err) {
                console.warn("Could not fetch metastats from worker:", err);
            }
        }
        // 3. Try to fetch from local fallbacks ONLY if cache is invalid AND worker fetch failed
        if (!cacheValid && !fetchedFromWorker) {
            try {
                const resLocal = await fetch("metastats.json");
                if (resLocal.ok) {
                    let dataLocal = await resLocal.json();
                    if (dataLocal && dataLocal.data && typeof dataLocal.data === "object" && !Array.isArray(dataLocal.data)) {
                        dataLocal = dataLocal.data;
                    }
                    if (dataLocal && !dataLocal.error && Object.keys(dataLocal).length > 0) {
                        baselineMetaStats = dataLocal;
                        globalThis.baselineMetaStats = baselineMetaStats;
                        // Deep merge to avoid wiping out pricing data if some entries had parts of it
                        for (const [key, val] of Object.entries(dataLocal)) {
                            if (loadedData[key]) {
                                loadedData[key] = { ...loadedData[key], ...val };
                            } else {
                                loadedData[key] = val;
                            }
                        }
                        dynamicMetaStats = loadedData;
                        globalThis.dynamicMetaStats = dynamicMetaStats;
                        console.log("Loaded and merged local metastats.json fallback!");
                    }
                }
            } catch (err) {
                // Quietly ignore
            }
        }
        if (globalThis.refreshCurrentRivenMetaStats) {
            globalThis.refreshCurrentRivenMetaStats();
        }
        // Asynchronously refresh the Riven Analyzer average box once the dynamic stats are loaded!
        const weaponInput = document.getElementById("rivenWeaponInput");
        if (weaponInput && weaponInput.value) {
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
            const regex = new RegExp(`^${pre}\\s+`, "i");
            if (regex.test(baseCandidate)) {
                baseCandidate = baseCandidate.replace(regex, "");
                changed = true;
            }
        }

        for (const suf of suffixes) {
            const regex = new RegExp(`\\s+${suf}$`, "i");
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

    if (dynamicMetaStats) {
        const statsObj = dynamicMetaStats.data ? dynamicMetaStats.data : dynamicMetaStats;

        const lookupKey = (key) => {
            if (!key) return null;
            if (statsObj[key]) return statsObj[key];
            const matchedKey = Object.keys(statsObj).find(
                k => k.toLowerCase() === key.toLowerCase()
            );
            return matchedKey ? statsObj[matchedKey] : null;
        };
        const baseMeta = lookupKey(baseName);
        const variantMeta = lookupKey(weaponName);

        if (variantMeta) {
            rawMeta = { ...variantMeta };
        } else if (baseMeta) {
            rawMeta = { ...baseMeta };
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
        const hasValidRecommendations = (metaObj) => {
            if (!metaObj) return false;

            // Check pos
            const pos = metaObj.pos;
            if (Array.isArray(pos) && pos.length > 0) return true;
            if (pos && typeof pos === "object" && Array.isArray(pos.best) && pos.best.length > 0) return true;

            // Check top_positive
            const topPos = metaObj.top_positive;
            if (Array.isArray(topPos) && topPos.length > 0) return true;

            return false;
        };
        const hasValidPricing = (metaObj) => {
            if (!metaObj) return false;
            if (metaObj.official_median > 0) return true;
            if (metaObj.official_avg_price > 0) return true;
            if (metaObj.wfm_avg_price > 0) return true;
            if (metaObj.de_unrolled && metaObj.de_unrolled.median > 0) return true;
            return false;
        };
        // Perform robust inheritance if variant belongs to a base family
        if (rawMeta && baseMeta) {
            // 1. ALWAYS inherit recommendations from the base family if the base has them!
            if (hasValidRecommendations(baseMeta) && !hasValidRecommendations(rawMeta)) {
                if (baseMeta.pos) rawMeta.pos = baseMeta.pos;
                if (baseMeta.neg) rawMeta.neg = baseMeta.neg;
                if (baseMeta.top_positive) rawMeta.top_positive = baseMeta.top_positive;
                if (baseMeta.top_negative) rawMeta.top_negative = baseMeta.top_negative;
            }

            // 2. ALWAYS inherit pricing and statistical metrics from the base family if the base has them!
            if (hasValidPricing(baseMeta)) {
                const excludedKeys = new Set(["name", "pos", "neg", "top_positive", "top_negative"]);
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
    }

    if (!rawMeta) return null;

    const pos = Array.isArray(rawMeta.pos) ? rawMeta.pos : (rawMeta.pos?.best || []);
    const neg = Array.isArray(rawMeta.neg) ? rawMeta.neg : (rawMeta.neg?.best || []);

    console.log(`[getMetaStats] weaponName: ${weaponName}, baseName: ${baseName}, inherited pos:`, pos, "neg:", neg);

    return {
        ...rawMeta,
        pos,
        neg,
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
            console.log(`[Cache Hit] Retrieved live Riven auctions for ${weaponName} from memory (15 min cache)!`);
        } else {
            const res = await fetch(`${WORKER_URL}?type=riven&q=${slug}`);
            if (!res.ok) throw new Error("Worker Error");
            const data = await res.json();
            auctions = data.payload?.auctions || [];
            liveAuctionsCache[cacheKey] = {
                timestamp: Date.now(),
                auctions: auctions
            };
            console.log(`[Network Fetch] Fetched fresh live Riven auctions for ${weaponName} from Worker!`);
        }

        // Normalize search stats to clean lower case
        const searchPositives = positiveStats.map(s => s.toLowerCase().trim());
        const searchNegative = negativeStat ? negativeStat.toLowerCase().trim() : null;

        // Filter auctions
        const similar = auctions.filter(a => {
            if (!a.visible || a.owner.status === "offline") return false;
            if (!a.item || !a.item.attributes) return false;

            // Map positive and negative attributes from the live auction
            const itemPositives = a.item.attributes
                .filter(attr => attr.positive)
                .map(attr => attr.url_name.replace(/_/g, " ").toLowerCase());

            const itemNegatives = a.item.attributes
                .filter(attr => !attr.positive)
                .map(attr => attr.url_name.replace(/_/g, " ").toLowerCase());

            // Check how many positives match
            let matchCount = 0;
            for (const sp of searchPositives) {
                if (itemPositives.some(ip => ip.includes(sp) || sp.includes(ip))) {
                    matchCount++;
                }
            }

            // Check negative match if user has a negative
            let negativeMatch = true;
            if (searchNegative) {
                // If user selected a negative stat, we prefer auctions that also have that negative stat,
                // or at least have some negative stat (so the positive stats are boosted!).
                if (itemNegatives.length === 0) {
                    negativeMatch = false;
                }
            } else {
                // If user selected NO negative stat, we prefer auctions that also have NO negative stat.
                if (itemNegatives.length > 0) {
                    negativeMatch = false;
                }
            }

            // We want similar positive matches:
            // If user has 2 or 3 positive search stats: at least 2 must match.
            // If user has 1 positive: 1 must match.
            const requiredMatches = Math.max(1, searchPositives.length > 1 ? 2 : 1);

            if (matchCount < requiredMatches) return false;
            return negativeMatch;
        });
        // Fallback: If filtering strictly by negative/no-negative returned too few results (< 2),
        // relax the filter to return any positive matches!
        let finalResults = similar;
        if (similar.length < 2) {
            finalResults = auctions.filter(a => {
                if (!a.visible || a.owner.status === "offline") return false;
                if (!a.item || !a.item.attributes) return false;

                const itemPositives = a.item.attributes
                    .filter(attr => attr.positive)
                    .map(attr => attr.url_name.replace(/_/g, " ").toLowerCase());

                let matchCount = 0;
                for (const sp of searchPositives) {
                    if (itemPositives.some(ip => ip.includes(sp) || sp.includes(ip))) {
                        matchCount++;
                    }
                }
                const requiredMatches = Math.max(1, searchPositives.length > 1 ? 2 : 1);
                return matchCount >= requiredMatches;
            });
        }
        // Sort by price
        finalResults.sort((a, b) => (a.buyout_price || a.starting_price) - (b.buyout_price || b.starting_price));

        // Return top 4 cheapest
        return finalResults.slice(0, 4);
    } catch (e) {
        console.error("Failed to fetch similar rivens:", e);
        return [];
    }
}