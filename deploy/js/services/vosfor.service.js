import { dbHelper } from "../repositories/storage.repository.js";
import { getArcaneBatch } from "../repositories/api.repository.js";
import { copiesForMaxRank } from "../utils/vosfor_math.js";

// Vosfor calculator: static data (Loid collections, dissolve values) and lazy arcane
// price and liquidity loading from the worker (type=arcane_batch). Chunks are always the
// same slices of 10 of each sorted collection, so the Cloudflare edge serves one batch to
// everyone.

const CACHE_TTL = 1 * 60 * 60 * 1000;
const CHUNK_SIZE = 10;
const PUMP_DELAY_MS = 800;
const MAX_CHUNK_RETRIES = 3;

let vosforData = null;
let vosforDataPromise = null;

export const ARC_STATS = new Map();

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

// IndexedDB can hang (blocked open during a version change): the cache is optional,
// so give up after 1.5 s.
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

/**
 * Queues a collection's prices; priority puts it first. Resolves once the local cache
 * is hydrated.
 */
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

/** Pseudo-collection of tradeable arcanes outside every Loid pack. */
export function othersPack(data) {
    return { id: "others", items: data.others || [] };
}

export async function requestAllPacks(force = false) {
    const data = await loadVosforData();
    for (const pack of data.packs) await requestPackStats(pack, false, force);
    if (data.others?.length) await requestPackStats(othersPack(data), false, force);
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

const RARITIES = ["COMMON", "UNCOMMON", "RARE", "LEGENDARY"];

function meanBy(items, fn) {
    const vals = items.map(fn).filter((v) => v > 0);
    if (!vals.length) return 0;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/**
 * Expected value of a Loid pack: per pull, rarity weight x mean realizable R0 price of
 * that rarity, plus the pack's average liquidity.
 */
// Realizable price, not the raw ask: the ask is weighted by real liquidity (closed sales
// per day) with the best buy as floor.
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

    for (const roll of pack.rolls || []) {
        for (const r of RARITIES) {
            const w = roll[r] || 0;
            if (!w || !byRarity[r].length) continue;
            evPlat += w * meanBy(byRarity[r], (s) => realizableR0(ARC_STATS.get(s)));
            evVosfor += w * meanBy(byRarity[r], (s) => arcanes[s]?.vosfor || 0);
        }
    }

    for (const slug of pack.items) {
        const st = ARC_STATS.get(slug);
        if (st) {
            totalVolume += (st.v || 0) + (st.vm || 0);
            validVolCount++;
        }
    }

    const avgVolume = validVolCount > 0 ? totalVolume / validVolCount : 0;
    const platPerVosfor = pack.cost?.vosfor > 0 ? evPlat / pack.cost.vosfor : 0;

    const liqMultiplier = Math.min(1.25, Math.max(0.4, 0.45 + 0.35 * Math.log10(1 + avgVolume)));
    const balancedRate = platPerVosfor * liqMultiplier;

    // a slow pack cannot place its stock: discount by min(1, liqMultiplier)
    const realizationFactor = Math.min(1, liqMultiplier);
    const evPlatNet = evPlat * realizationFactor;

    return {
        ready,
        loaded: loaded.length,
        total: pack.items.length,
        evPlat: Math.round(evPlat * 10) / 10,
        evPlatNet: Math.round(evPlatNet * 10) / 10,
        evVosfor: Math.round(evVosfor),
        platPerVosfor,
        avgVolume: Math.round(avgVolume),
        balancedRate,
        liqMultiplier,
    };
}

export function bestPackRate(data) {
    let best = null;
    for (const pack of data.packs) {
        const ev = computePackEV(pack, data.arcanes);
        if (!ev.ready) continue;
        if (!best || ev.platPerVosfor > best.rate) {
            best = { rate: ev.platPerVosfor, packId: pack.id, pack, ev };
        }
    }
    return best;
}

export function bestBalancedPackRate(data) {
    let best = null;
    for (const pack of data.packs) {
        const ev = computePackEV(pack, data.arcanes);
        if (!ev.ready) continue;
        if (!best || ev.balancedRate > best.balancedRate) {
            best = { balancedRate: ev.balancedRate, rate: ev.platPerVosfor, packId: pack.id, pack, ev };
        }
    }
    return best;
}

// Dissolving goes into random packs, so its EV is worth less than sure platinum.
// Shared so the per-arcane verdict and the dissolve ranking discount the same.
const CERTAINTY = 0.75;

// Two outcomes within this margin are "even".
const EVEN_BAND = 0.08;

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * "Sell or dissolve?" simulator verdict for `qty` units at R0 or max rank, on the same
 * basis as arcaneVerdict.
 */
export function sellSimVerdict(meta, st, { isMax, qty, liqRate }) {
    if (!meta || !st) return null;
    const copiesMax = copiesForMaxRank(meta);
    const copiesPerUnit = isMax ? copiesMax : 1;
    const unitRealizable = isMax ? realizableMax(st) : realizableR0(st);
    const sellValue = qty * unitRealizable;
    const totalVosfor = qty * copiesPerUnit * (meta.vosfor || 0);
    const dissolveValue = liqRate > 0 ? totalVosfor * liqRate * CERTAINTY : null;

    let verdict = "pending";
    if (dissolveValue !== null) {
        const top = Math.max(sellValue, dissolveValue);
        if (sellValue <= 0) verdict = "dissolve";
        else if (Math.abs(sellValue - dissolveValue) <= top * EVEN_BAND) verdict = "even";
        else verdict = sellValue > dissolveValue ? "sell" : "dissolve";
    }
    return { copiesMax, copiesPerUnit, unitRealizable, sellValue, totalVosfor, dissolveValue, verdict };
}

/**
 * How much better dissolving one copy is than keeping it, as a multiple. Keeping is worth
 * the best of selling it at R0 or its share of a fused max rank, both liquidity weighted.
 */
export function dissolveEdge(meta, st, liqRate) {
    if (!meta || !st || !(liqRate > 0)) return null;
    const dissolveValue = (meta.vosfor || 0) * liqRate * CERTAINTY;
    if (!(dissolveValue > 0)) return null;

    const copiesMax = copiesForMaxRank(meta);
    const keepValue = Math.max(realizableR0(st), realizableMax(st) / copiesMax);

    return {
        copiesMax,
        keepValue,
        dissolveValue,
        edge: keepValue > 0 ? dissolveValue / keepValue : Infinity,
    };
}

/**
 * Vosfor per platinum when you buy the arcane to dissolve it. Uses the raw ask: buying
 * pays what sellers ask.
 */
export function vosforPerPlat(meta, st) {
    const ask = st?.pe || 0;
    const vosfor = meta?.vosfor || 0;
    if (!(ask > 0) || !(vosfor > 0)) return null;
    return {
        ratio: vosfor / ask,
        buyPrice: ask,
        sellers: st.s ?? null,
        platPerPack: (200 / vosfor) * ask,
    };
}

/**
 * Full verdict for R0 (1 copy) and max rank (21 or 10 copies by fusionLimit).
 * `spend` is the bestBalancedPackRate output.
 */
export function arcaneVerdict(slug, arcanes, spend) {
    const meta = arcanes[slug];
    const st = ARC_STATS.get(slug);
    if (!meta || !st) return {};

    const rate = spend ? spend.rate : 0;
    const copiesMax = copiesForMaxRank(meta);

    const sellR0 = realizableR0(st);
    const dissolvePlatR0 = meta.vosfor * rate;

    const sellR5 = realizableMax(st);
    const sell21R0 = sellR0 * copiesMax;
    const dissolvePlat21 = (meta.vosfor * copiesMax) * rate;

    const r5RankBonus = sell21R0 > 0 && sellR5 > sell21R0
        ? Math.round(((sellR5 - sell21R0) / sell21R0) * 100)
        : 0;

    // Verdict per lot of `copiesMax` copies: net value of each outcome, with friction per
    // trade, liquidity adjusted rate and the CERTAINTY discount for dissolving.
    const EFFORT_PL = 2;      // friction per sell trade, in plat
    const liqRate = spend?.balancedRate ?? rate;

    // R0 copies you can actually sell are capped by liquidity; the rest only counts as dissolve.
    const volDay = (st.v || 0) + (st.vm || 0);
    const SELL_HORIZON_DAYS = 14;
    const sellableR0 = Math.max(1, Math.min(copiesMax, Math.ceil(volDay * SELL_HORIZON_DAYS)));

    const canSellMax = st.pem > 0 && (st.rm || 0) > 0;
    const netSellMax = canSellMax ? sellR5 - EFFORT_PL : -Infinity;
    const netSellR0 = sellR0 > 0 ? sellableR0 * (sellR0 - EFFORT_PL) : -Infinity;
    const netDissolve = meta.vosfor * copiesMax * liqRate * CERTAINTY;
    const bestGuaranteed = Math.max(netSellMax, netSellR0);

    let bestAction = "pending";
    let gambleWarning = false;
    if (spend) {
        if (bestGuaranteed <= 0 && netDissolve <= 0) {
            bestAction = "dissolve";
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
        hasR5Market: st.pem > 0 && (st.rm || 0) > 0,
        bestPackEs: spend?.pack?.es || "",
        bestPackEn: spend?.pack?.en || "",
    };
}

// The Hex: Archimedea arcanes bought with pix, not in Loid packs.
// R0 costs 5 pix each; 200 vosfor = 6 pix.
export const HEX_ARCANES = ["arcane_escapist", "arcane_universal_fallout", "arcane_hot_shot"];

/**
 * Plat-per-pix ranking of the 3 Hex arcanes against pix -> vosfor -> pack.
 * bestRate: bestBalancedPackRate output.
 */
export function pixRank(data, bestRate) {
    const cfg = data?.hex_pix || { pixCostR0: 5, vosfor: 200, vosforPix: 6 };
    const rate = bestRate?.balancedRate ?? bestRate?.rate ?? 0;
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

/**
 * Liquidity index from closed sales per day (r0 + max rank), with online buy orders as
 * a demand boost.
 */
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

/**
 * Pulls and best packs for a Vosfor amount, by estimated total gain and selling speed.
 */
export function calculateVosforInvestment(vosforAmount, data, selectedPackId = "auto") {
    if (!vosforAmount || vosforAmount < 200 || !data?.packs) return null;

    let bestEvPack = null;
    let maxEvPlat = -1;

    let bestLiquidPack = null;
    let maxLiquidScore = -1;

    let customPack = null;

    for (const pack of data.packs) {
        const ev = computePackEV(pack, data.arcanes);
        if (!ev.ready) continue;

        const pulls = Math.floor(vosforAmount / (pack.cost?.vosfor || 200));
        if (pulls <= 0) continue;

        // shown plat is the liquidity-discounted net, and the ranking uses it
        const estPlatNet = pulls * (ev.evPlatNet ?? ev.evPlat);
        const estPlatRaw = pulls * ev.evPlat;
        const shown = Math.round(estPlatNet);
        if (estPlatNet > maxEvPlat) {
            maxEvPlat = estPlatNet;
            bestEvPack = { pack, pulls, estPlat: shown, ev };
        }

        // raw, so the discount is not applied twice
        const liquidScore = estPlatRaw * Math.min(1.3, 0.4 + 0.6 * Math.log10(1 + ev.avgVolume));
        if (liquidScore > maxLiquidScore) {
            maxLiquidScore = liquidScore;
            bestLiquidPack = { pack, pulls, estPlat: shown, ev };
        }

        if (selectedPackId && selectedPackId !== "auto" && pack.id === selectedPackId) {
            customPack = { pack, pulls, estPlat: shown, ev };
        }
    }

    return {
        bestEvPack,
        bestLiquidPack,
        customPack,
        vosforAmount,
        selectedPackId,
    };
}

