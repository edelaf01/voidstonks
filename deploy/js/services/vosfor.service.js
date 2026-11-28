import { dbHelper } from "../repositories/storage.repository.js";
import { getArcaneBatch, getArcaneUpdated } from "../repositories/api.repository.js";
import { copiesForMaxRank } from "../utils/vosfor_math.js";

const CACHE_TTL = 1 * 60 * 60 * 1000;
const CHUNK_SIZE = 10;
const PUMP_DELAY_MS = 800;
const MAX_CHUNK_RETRIES = 3;

let vosforData = null;
let vosforDataPromise = null;

export const ARC_STATS = new Map();
export const FAILED_STATS = new Set();

const chunkQueue = [];
const queuedChunkKeys = new Set();
const retryCounts = new Map();
let pumping = false;
const listeners = new Set();

export async function loadVosforData() {
    if (vosforData) return vosforData;
    if (!vosforDataPromise) {
        vosforDataPromise = fetch("assets/json/arcanes_vosfor.json")
            .then((r) => {
                if (!r.ok) throw new Error("arcanes_vosfor.json load failed");
                return r.json();
            })
            .then((d) => (vosforData = d))
            .catch((e) => {
                vosforDataPromise = null;
                throw e;
            });
    }
    return vosforDataPromise;
}

export function onArcaneStats(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function notify() {
    listeners.forEach((fn) => {
        try { fn(); } catch (e) { console.warn(e); }
    });
}

// indexeddb can hang (blocked open during a version change): give up after 1.5 s
function idbGetSafe(key, ms = 1500) {
    return Promise.race([
        dbHelper.get(key),
        new Promise((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
}

async function hydrateFromIDB(slugs) {
    await Promise.all(slugs.map(async (slug) => {
        if (ARC_STATS.has(slug)) return;
        const cached = await idbGetSafe(`arcstat_${slug}`);
        if (cached?.val && Date.now() - cached.time < CACHE_TTL) {
            ARC_STATS.set(slug, cached.val);
        }
    }));
}

export async function clearArcaneCacheIDB() {
    const data = await loadVosforData();
    if (data && data.arcanes) {
        await Promise.all(
            Object.keys(data.arcanes).map((slug) => dbHelper.delete(`arcstat_${slug}`))
        );
    }
}

function packChunks(pack) {
    const chunks = [];
    for (let i = 0; i < pack.items.length; i += CHUNK_SIZE) {
        chunks.push(pack.items.slice(i, i + CHUNK_SIZE));
    }
    return chunks;
}

export async function requestPackStats(pack, priority = false, force = false) {
    if (!force) await hydrateFromIDB(pack.items);
    for (const chunk of packChunks(pack)) {
        if (!force && chunk.every((s) => ARC_STATS.has(s))) continue;
        const key = chunk.join(",");
        if (queuedChunkKeys.has(key)) continue;
        queuedChunkKeys.add(key);
        if (priority) chunkQueue.unshift({ chunk, force });
        else chunkQueue.push({ chunk, force });
    }
    pump();
}

export function othersPack(data) {
    return { id: "others", items: data.others || [] };
}

export async function requestAllPacks(force = false) {
    const data = await loadVosforData();
    for (const pack of data.packs) await requestPackStats(pack, false, force);
    if (data.others?.length) await requestPackStats(othersPack(data), false, force);
}

export async function fetchArcanePricesUpdated() {
    try {
        const res = await getArcaneUpdated();
        if (!res.ok) return null;
        const d = await res.json();
        return typeof d?.updated === "string" && d.updated ? d.updated : null;
    } catch {
        return null;
    }
}

async function pump() {
    if (pumping) return;
    pumping = true;
    while (chunkQueue.length > 0) {
        const item = chunkQueue.shift();
        const chunk = item.chunk;
        const force = item.force;
        
        const key = chunk.join(",");
        queuedChunkKeys.delete(key);

        const missing = chunk.filter((s) => !ARC_STATS.has(s));
        if (!force && missing.length === 0) continue;

        try {
            const res = await getArcaneBatch(chunk);
            if (res.ok) {
                const data = await res.json();
                for (const [slug, stats] of Object.entries(data)) {
                    if (!stats || (!force && ARC_STATS.has(slug))) continue;
                    ARC_STATS.set(slug, stats);
                    FAILED_STATS.delete(slug);
                    dbHelper.set(`arcstat_${slug}`, { val: stats, time: Date.now() });
                }
                notify();
            }
        } catch (e) {
            console.warn("arcane_batch chunk failed:", e);
        }

        // retry the chunk when the worker returned a partial batch (WFM rate limit)
        if (chunk.some((s) => !ARC_STATS.has(s))) {
            const tries = (retryCounts.get(key) || 0) + 1;
            if (tries < MAX_CHUNK_RETRIES) {
                retryCounts.set(key, tries);
                queuedChunkKeys.add(key);
                chunkQueue.push({ chunk, force });
            } else {
                retryCounts.delete(key);
                for (const s of chunk) {
                    if (!ARC_STATS.has(s)) FAILED_STATS.add(s);
                }
                notify();
            }
        } else {
            retryCounts.delete(key);
        }

        if (chunkQueue.length > 0) {
            await new Promise((r) => setTimeout(r, PUMP_DELAY_MS));
        }
    }
    pumping = false;
}

export function retryArcaneStats(slug) {
    if (!slug) return;
    FAILED_STATS.delete(slug);
    for (const k of retryCounts.keys()) {
        if (k.split(",").includes(slug)) retryCounts.delete(k);
    }
    if (!queuedChunkKeys.has(slug)) {
        queuedChunkKeys.add(slug);
        chunkQueue.unshift({ chunk: [slug], force: true });
    }
    notify();
    pump();
}

const RARITIES = ["COMMON", "UNCOMMON", "RARE", "LEGENDARY"];

export const PACK_COST = 200;
export const EFFORT_PL = 2;

function meanBy(items, fn) {
    const vals = items.map(fn).filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
    if (!vals.length) return 0;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function realizablePrice(ask, vol, bestBuy, thr) {
    if (!ask || ask <= 0) return 0;
    const liq = Math.max(0.15, Math.min(1, vol / thr));
    const floor = Math.min(bestBuy || 0, ask);
    return Math.max(floor, ask * liq);
}
export function realizableR0(st) {
    return st ? realizablePrice(st.pe || 0, (st.v || 0) + (st.vm || 0), st.bb || 0, 5) : 0;
}
export function realizableMax(st) {
    return st ? realizablePrice(st.pem || 0, st.vm || 0, st.bbm || 0, 2) : 0;
}

export function hasR5Market(st) {
    return !!st && st.pem > 0 && (st.vm || 0) > 0;
}

export function arcaneUnitValue(meta, st) {
    if (!st) return 0;
    const r0 = Math.max(0, realizableR0(st) - EFFORT_PL);
    if (hasR5Market(st)) {
        const r5 = Math.max(0, realizableMax(st) - EFFORT_PL) / copiesForMaxRank(meta);
        return Math.max(r0, r5);
    }
    return r0;
}

export function computePackEV(pack, arcanes) {
    const loaded = pack.items.filter((s) => ARC_STATS.has(s));
    const ready = loaded.length === pack.items.length;

    const byRarity = {};
    for (const r of RARITIES) byRarity[r] = [];
    for (const slug of pack.items) {
        const meta = arcanes[slug];
        if (meta) byRarity[meta.rarity]?.push(slug);
    }

    let evPlat = 0;
    let evVosfor = 0;
    let totalVolume = 0;
    let validVolCount = 0;

    const rolls = pack.rolls || [];
    for (const roll of rolls) {
        for (const r of RARITIES) {
            const w = roll[r] || 0;
            if (!w || !byRarity[r].length) continue;
            evPlat += w * meanBy(byRarity[r], (s) => arcaneUnitValue(arcanes[s], ARC_STATS.get(s)));
            evVosfor += w * meanBy(byRarity[r], (s) => arcanes[s]?.vosfor || 0);
        }
    }

    let topR5Slug = null;
    let topR5Val = -1;
    let topR0Slug = null;
    let topR0Val = -1;

    for (const slug of pack.items) {
        const st = ARC_STATS.get(slug);
        if (st) {
            totalVolume += (st.v || 0) + (st.vm || 0);
            validVolCount++;
            const hasR5 = hasR5Market(st);
            if (hasR5) {
                const rm = realizableMax(st);
                if (rm > topR5Val) {
                    topR5Val = rm;
                    topR5Slug = slug;
                }
            }
            const r0 = realizableR0(st);
            if (r0 > topR0Val) {
                topR0Val = r0;
                topR0Slug = slug;
            }
        }
    }

    const avgVolume = validVolCount > 0 ? totalVolume / validVolCount : 0;
    const cost = pack.cost?.vosfor || PACK_COST;
    const rate = cost > 0 ? evPlat / cost : 0;
    const evPlatRounded = Math.round(evPlat * 10) / 10;

    const topSlug = topR5Val > 0 ? topR5Slug : (topR0Val > 0 ? topR0Slug : null);
    let top = null;
    if (topSlug) {
        const topMeta = arcanes[topSlug];
        const topSt = ARC_STATS.get(topSlug);
        const topRarity = topMeta?.rarity;
        const rarityCount = byRarity[topRarity]?.length || 0;
        const probPerRoll = (rolls.length > 0 && rarityCount > 0)
            ? rolls.reduce((sum, roll) => sum + (roll[topRarity] || 0) / rarityCount, 0) / rolls.length
            : 0;
        const copies = copiesForMaxRank(topMeta);
        const rollsPerPack = rolls.length || 3;
        const packsForMax = probPerRoll > 0 ? copies / (rollsPerPack * probPerRoll) : null;
        const vosforForMax = packsForMax !== null ? packsForMax * cost : null;
        const hasR5 = hasR5Market(topSt);
        const netMax = hasR5
            ? Math.max(0, realizableMax(topSt) - EFFORT_PL)
            : copies * Math.max(0, realizableR0(topSt) - EFFORT_PL);
        top = { slug: topSlug, probPerRoll, copies, packsForMax, vosforForMax, netMax };
    }

    return {
        ready,
        loaded: loaded.length,
        total: pack.items.length,
        evPlat: evPlatRounded,
        evPlatNet: evPlatRounded,
        evVosfor: Math.round(evVosfor),
        rate,
        platPerVosfor: rate,
        balancedRate: rate,
        avgVolume: Math.round(avgVolume),
        top,
    };
}

export function bestPackRate(data) {
    let best = null;
    for (const pack of data.packs) {
        const ev = computePackEV(pack, data.arcanes);
        if (!ev.ready) continue;
        if (!best || ev.rate > best.rate) {
            best = { rate: ev.rate, balancedRate: ev.rate, packId: pack.id, pack, ev };
        }
    }
    return best;
}

export function bestBalancedPackRate(data) {
    return bestPackRate(data);
}

const EVEN_BAND = 0.08;

const round1 = (x) => Math.round(x * 10) / 10;

export function sellSimVerdict(meta, st, { isMax, qty, liqRate }) {
    if (!meta || !st) return null;
    const copiesMax = copiesForMaxRank(meta);
    const copiesPerUnit = isMax ? copiesMax : 1;
    const totalCopies = qty * copiesPerUnit;
    const unitRealizable = isMax ? realizableMax(st) : realizableR0(st);
    const sellValue = qty * Math.max(0, unitRealizable - EFFORT_PL);
    const totalVosfor = totalCopies * (meta.vosfor || 0);
    const dissolveValue = liqRate > 0 ? totalVosfor * liqRate : null;

    const unitNetR0 = Math.max(0, realizableR0(st) - EFFORT_PL);
    const sellR0Value = totalCopies * unitNetR0;
    const r5Market = hasR5Market(st);
    const fullSets = Math.floor(totalCopies / copiesMax);
    const remCopies = totalCopies % copiesMax;
    const unitNetMax = Math.max(0, realizableMax(st) - EFFORT_PL);
    const mergeValue = r5Market ? fullSets * unitNetMax + remCopies * unitNetR0 : null;

    let verdict = "pending";
    const maxSell = Math.max(sellR0Value, mergeValue ?? 0);
    if (maxSell <= 0 && (meta.vosfor || 0) <= 0) {
        verdict = "nodata";
    } else if (dissolveValue !== null) {
        const opts = [
            ["sell_r0", sellR0Value],
            ["dissolve", dissolveValue],
        ];
        if (mergeValue !== null && fullSets > 0) {
            opts.push(["sell_max", mergeValue]);
        }
        opts.sort((a, b) => b[1] - a[1]);
        const [topKey, topVal] = opts[0];
        if (topVal <= 0) {
            verdict = "nodata";
        } else if (opts.length > 1 && opts[1][1] > 0 && Math.abs(topVal - opts[1][1]) <= topVal * EVEN_BAND) {
            verdict = "even";
        } else {
            verdict = topKey;
        }
    }
    return {
        copiesMax,
        copiesPerUnit,
        totalCopies,
        unitRealizable,
        sellValue,
        sellR0Value,
        mergeValue,
        totalVosfor,
        dissolveValue,
        verdict,
    };
}

export function dissolveEdge(meta, st, liqRate) {
    if (!meta || !st || !(liqRate > 0)) return null;
    const dissolveValue = (meta.vosfor || 0) * liqRate;
    if (!(dissolveValue > 0)) return null;

    const copiesMax = copiesForMaxRank(meta);
    const keepValue = arcaneUnitValue(meta, st);

    return {
        copiesMax,
        keepValue,
        dissolveValue,
        edge: keepValue > 0 ? dissolveValue / keepValue : Infinity,
    };
}

export function vosforPerPlat(meta, st) {
    const ask = st?.pe || 0;
    const vosfor = meta?.vosfor || 0;
    if (!(ask > 0) || !(vosfor > 0)) return null;
    return {
        ratio: vosfor / ask,
        buyPrice: ask,
        sellers: st.s ?? null,
        platPerPack: (PACK_COST / vosfor) * ask,
    };
}

export function arcaneVerdict(slug, arcanes, spend) {
    const meta = arcanes[slug];
    const st = ARC_STATS.get(slug);
    if (!meta || !st) return {};

    const rate = spend?.rate ?? 0;
    const copiesMax = copiesForMaxRank(meta);

    const sellR0 = realizableR0(st);
    const dissolvePlatR0 = (meta.vosfor || 0) * rate;

    const sellR5 = realizableMax(st);
    const sell21R0 = sellR0 * copiesMax;
    const dissolvePlat21 = ((meta.vosfor || 0) * copiesMax) * rate;

    const r5RankBonus = sell21R0 > 0 && sellR5 > sell21R0
        ? Math.round(((sellR5 - sell21R0) / sell21R0) * 100)
        : 0;

    const volDay = (st.v || 0) + (st.vm || 0);
    const SELL_HORIZON_DAYS = 14;
    const sellableR0 = Math.max(1, Math.min(copiesMax, Math.ceil(volDay * SELL_HORIZON_DAYS)));

    const canSellMax = hasR5Market(st);
    const netSellMax = canSellMax ? sellR5 - EFFORT_PL : -Infinity;
    const netSellR0 = sellR0 > 0
        ? sellableR0 * (sellR0 - EFFORT_PL) + (copiesMax - sellableR0) * (meta.vosfor || 0) * rate
        : -Infinity;
    const netDissolve = (meta.vosfor || 0) * copiesMax * rate;
    const bestGuaranteed = Math.max(netSellMax, netSellR0);

    let bestAction = "pending";
    let gambleWarning = false;
    if (bestGuaranteed <= 0 && (meta.vosfor || 0) <= 0) {
        bestAction = "nodata";
    } else if (spend) {
        if (bestGuaranteed <= 0 && netDissolve <= 0) {
            bestAction = "nodata";
        } else {
            const opts = [["sell_max", netSellMax], ["sell_r0", netSellR0], ["dissolve", netDissolve]];
            opts.sort((a, b) => b[1] - a[1]);
            const [topKey, topVal] = opts[0];
            bestAction = Math.abs(topVal - opts[1][1]) <= topVal * EVEN_BAND ? "even" : topKey;
            if (bestAction === "dissolve" && bestGuaranteed >= 20) gambleWarning = true;
        }
    }

    return {
        gambleWarning,
        guaranteedBest: round1(Math.max(0, bestGuaranteed)),
        netDissolveAdj: round1(netDissolve),
        bestAction,
        sell: round1(sellR0),
        sellR5: round1(sellR5),
        sell21R0: round1(sell21R0),
        dissolvePlat: round1(dissolvePlatR0),
        dissolvePlat21: round1(dissolvePlat21),
        r5RankBonus: r5RankBonus,
        copiesMax,
        maxRank: Math.min(meta.maxRank ?? 5, 5),
        hasR5Market: canSellMax,
        bestPackEs: spend?.pack?.es || "",
        bestPackEn: spend?.pack?.en || "",
    };
}

export const HEX_ARCANES = ["arcane_escapist", "arcane_universal_fallout", "arcane_hot_shot"];

export function pixRank(data, bestRate) {
    const cfg = data?.hex_pix || { pixCostR0: 5, vosfor: PACK_COST, vosforPix: 6 };
    const rate = bestRate?.rate ?? 0;
    const rows = [];
    for (const slug of HEX_ARCANES) {
        const meta = data?.arcanes?.[slug];
        if (!meta) continue;
        const st = ARC_STATS.get(slug);
        const pix = meta.pix || cfg.pixCostR0;
        const sellR0 = realizableR0(st);
        rows.push({
            slug, meta, pix,
            sellR0: Math.round(sellR0 * 10) / 10,
            platPerPix: pix > 0 ? Math.round((sellR0 / pix) * 100) / 100 : 0,
            ready: !!st,
        });
    }
    const vosforPlatPerPix = (rate > 0 && cfg.vosforPix > 0)
        ? Math.round((cfg.vosfor * rate / cfg.vosforPix) * 100) / 100
        : 0;
    rows.sort((a, b) => b.platPerPix - a.platPerPix);
    const bestArcane = rows.find((r) => r.ready && r.platPerPix > 0) || null;
    return {
        rows,
        vosforPlatPerPix,
        rate,
        cfg,
        arcaneBeatsVosfor: !!bestArcane && bestArcane.platPerPix > vosforPlatPerPix,
        ready: rows.every((r) => r.ready),
    };
}

export function liquidityIndex(slug) {
    const st = ARC_STATS.get(slug);
    if (!st) return { level: "loading", demand: false, volume: 0, volumeR0: 0, volumeMax: 0, maxRank: 0 };
    const volume = (st.v || 0) + (st.vm || 0);
    const price = st.pe || st.p || 0;
    let level = "none";
    if (volume >= 15) level = "high";
    else if (volume >= 3) level = "med";
    else if (volume > 0 || st.s > 0) level = "low";
    const bestBuy = Math.max(st.bb || 0, st.bbm || 0);
    const demand = ((st.d || 0) + (st.dm || 0)) >= 3 && price > 0 && bestBuy >= price * 0.5;
    return {
        level,
        demand,
        volume: Math.round(volume),
        volumeR0: Math.round(st.v || 0),
        volumeMax: Math.round(st.vm || 0),
        maxRank: st.rm || 0,
    };
}

