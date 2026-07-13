import { dbHelper } from "../repositories/storage.repository.js";
import { getArcaneBatch } from "../repositories/api.repository.js";
import { state } from "../state.js";

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

let lastLiveFetchGlobal = 0;
const LIVE_GLOBAL_COOLDOWN_MS = 60 * 1000;
const LIVE_ARCANE_COOLDOWN_MS = 60 * 60 * 1000;

export async function fetchLiveArcanePrice(slug) {
    const now = Date.now();
    const es = state.currentLang === "es";
    if (now - lastLiveFetchGlobal < LIVE_GLOBAL_COOLDOWN_MS) {
        const remaining = Math.ceil((LIVE_GLOBAL_COOLDOWN_MS - (now - lastLiveFetchGlobal)) / 1000);
        const msg = es
            ? `Para no saturar WFM, espera ${remaining}s antes de actualizar otro arcano.`
            : `To avoid spamming WFM, please wait ${remaining}s before updating another arcane.`;
        return { ok: false, error: "global_cooldown", message: msg };
    }

    const cached = await idbGetSafe(`arcstat_${slug}`);
    if (cached?.time && now - cached.time < LIVE_ARCANE_COOLDOWN_MS) {
        const remaining = Math.ceil((LIVE_ARCANE_COOLDOWN_MS - (now - cached.time)) / 60000);
        const msg = es
            ? `Actualizado recientemente. Podrás forzar otra comprobación en ${remaining} min.`
            : `Recently updated. You can force another check in ${remaining} min.`;
        return { ok: false, error: "arcane_cooldown", message: msg };
    }

    try {
        const res = await fetch(`https://api.warframe.market/v1/items/${slug}/orders`);
        if (!res.ok) throw new Error(`WFM API returned ${res.status}`);
        const data = await res.json();
        
        const activeOrders = data.payload.orders.filter((o) => 
            o.order_type === "sell" && (o.user.status === "ingame" || o.user.status === "online")
        );
        
        const r0Orders = activeOrders.filter((o) => o.mod_rank === 0).sort((a,b) => a.platinum - b.platinum);
        const maxRankOrders = activeOrders.filter((o) => o.mod_rank > 0).sort((a,b) => a.platinum - b.platinum);
        const buys = data.payload.orders.filter((o) =>
            o.order_type === "buy" && (o.user.status === "ingame" || o.user.status === "online"));
        const buysR0 = buys.filter((o) => o.mod_rank === 0).sort((a, b) => b.platinum - a.platinum);

        const med5 = (orders) => {
            const c = orders.slice(0, Math.min(5, orders.length)).map((o) => o.platinum);
            if (!c.length) return 0;
            const mid = Math.floor(c.length / 2);
            return c.length % 2 ? c[mid] : Math.round((c[mid - 1] + c[mid]) / 2);
        };

        const existing = ARC_STATS.get(slug) || {};
        const stats = {
            ...existing,
            p: med5(r0Orders) || existing.p || 0,
            pe: med5(r0Orders) || existing.pe || 0,
            s: r0Orders.length || existing.s || 0,
            d: buysR0.length || existing.d || 0,
            bb: buysR0[0]?.platinum ?? existing.bb ?? 0,
            pem: med5(maxRankOrders) || existing.pem || 0,
            rm: maxRankOrders[0]?.mod_rank || existing.rm || 0,
        };

        ARC_STATS.set(slug, stats);
        dbHelper.set(`arcstat_${slug}`, { val: stats, time: now });
        lastLiveFetchGlobal = now;
        
        notify();
        return { ok: true, stats };
    } catch (err) {
        console.error("fetchLiveArcanePrice error:", err);
        const es = state?.currentLang === "es";
        const msg = es
            ? "Fallo al conectar con Warframe Market (posible bloqueo CORS/Red)."
            : "Failed to connect to Warframe Market (possible CORS/Network block).";
        return { ok: false, error: "network_error", message: msg };
    }
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
function realizablePrice(ask, vol, bestBuy, thr) {
    if (!ask || ask <= 0) return 0;
    const liq = Math.max(0.15, Math.min(1, vol / thr));
    return Math.max(bestBuy || 0, ask * liq);
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

/**
 * Copies needed for an arcane's max rank (triangular numbers): fusionLimit 5 -> 21 copies, fusionLimit 3 -> 10
 * copies.
 */
export function copiesForMaxRank(meta) {
    const mr = Math.max(1, Math.min(meta?.maxRank ?? 5, 5));
    return ((mr + 1) * (mr + 2)) / 2;
}

export function arcaneVerdict(slug, arcanes, bestRate) {
    const meta = arcanes[slug];
    const st = ARC_STATS.get(slug);
    if (!meta || !st) return { verdict: "loading", verdictR5: "loading" };

    const rate = bestRate ? bestRate.rate : 0;
    const copiesMax = copiesForMaxRank(meta);

    const sellR0 = realizableR0(st);
    const dissolvePlatR0 = meta.vosfor * rate;

    let verdictR0 = "pending";
    if (bestRate) {
        if (sellR0 <= 0) verdictR0 = "dissolve";
        else if (sellR0 > dissolvePlatR0 * 1.15) verdictR0 = "sell";
        else if (sellR0 < dissolvePlatR0 * 0.85) verdictR0 = "dissolve";
        else verdictR0 = "even";
    }

    const sellR5 = realizableMax(st);
    const sell21R0 = sellR0 * copiesMax;
    const dissolvePlat21 = (meta.vosfor * copiesMax) * rate;

    let verdictR5 = "pending";
    let bestOptionR5Val = Math.max(sellR5, sell21R0, dissolvePlat21);

    if (bestRate) {
        if (sellR5 <= 0 && sell21R0 <= 0) verdictR5 = "dissolve";
        else if (bestOptionR5Val === sellR5 && sellR5 > dissolvePlat21 * 1.1) verdictR5 = "sell_r5";
        else if (bestOptionR5Val === sell21R0 && sell21R0 > dissolvePlat21 * 1.1) verdictR5 = "sell_r0";
        else if (dissolvePlat21 > Math.max(sellR5, sell21R0) * 1.05) verdictR5 = "dissolve";
        else verdictR5 = "even";
    }

    const r5RankBonus = sell21R0 > 0 && sellR5 > sell21R0
        ? Math.round(((sellR5 - sell21R0) / sell21R0) * 100)
        : 0;

    const sellPerCopyMax = copiesMax > 0 ? sellR5 / copiesMax : 0;

    // Verdict per lot of `copiesMax` copies: net value of each outcome, with friction per
    // trade, liquidity adjusted rate and the CERTAINTY discount for dissolving.
    const CERTAINTY = 0.75;
    const EFFORT_PL = 2;      // friction per sell trade, in plat
    const liqRate = bestRate?.ev?.balancedRate ?? rate;

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
    if (bestRate) {
        if (bestGuaranteed <= 0 && netDissolve <= 0) {
            bestAction = "dissolve";
        } else {
            const opts = [["sell_max", netSellMax], ["sell_r0", netSellR0], ["dissolve", netDissolve]];
            opts.sort((a, b) => b[1] - a[1]);
            const [topKey, topVal] = opts[0];
            bestAction = Math.abs(topVal - opts[1][1]) <= topVal * 0.08 ? "even" : topKey;
            if (bestAction === "dissolve" && bestGuaranteed >= 20) gambleWarning = true;
        }
    }

    return {
        gambleWarning,
        guaranteedBest: Math.round(Math.max(0, bestGuaranteed) * 10) / 10,
        netDissolveAdj: Math.round(netDissolve * 10) / 10,
        verdict: verdictR0,
        verdictR5: verdictR5,
        bestAction,
        sellPerCopyMax: Math.round(sellPerCopyMax * 10) / 10,
        sell: sellR0,
        sellR5: sellR5,
        sell21R0: sell21R0,
        dissolvePlat: dissolvePlatR0,
        dissolvePlat21: dissolvePlat21,
        r5RankBonus: r5RankBonus,
        copiesMax,
        maxRank: Math.min(meta.maxRank ?? 5, 5),
        hasR5Market: st.pem > 0 && (st.rm || 0) > 0,
        bestPackEs: bestRate?.pack?.es || "",
        bestPackEn: bestRate?.pack?.en || "",
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

