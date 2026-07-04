import { dbHelper } from "../repositories/storage.repository.js";
import { getArcaneBatch } from "../repositories/api.repository.js";

// Calculadora de Vosfor: datos estáticos (colecciones de Loid + valores de disolución)
// y carga perezosa de precios/liquidez de arcanos contra el worker (type=arcane_batch).
//
// Estrategia anti-cuota (100k req/día):
//  - Los chunks son SIEMPRE los mismos trozos de 10 del listado ordenado de cada colección,
//    así la caché edge de Cloudflare sirve el mismo lote a todos los clientes.
//  - Cliente: memoria + IndexedDB con TTL 6h (igual que las partes prime).
//  - Un solo bombeo secuencial con pausa entre chunks; expandir una colección la prioriza.

const CACHE_TTL = 1 * 60 * 60 * 1000; // 1 hora de caché local para arcanos
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

/** Se llama cada vez que llegan stats nuevas (para re-render progresivo). */
export function onArcaneStats(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function notify() {
    listeners.forEach((fn) => {
        try { fn(); } catch (e) { console.warn(e); }
    });
}

// IndexedDB puede colgarse indefinidamente (dbHelper.open no maneja el evento "blocked",
// p.ej. con otra pestaña abierta durante un cambio de versión). La caché local es solo una
// optimización: si no responde en 1.5s seguimos sin ella y pedimos al worker.
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

/** Trozos fijos de 10 sobre la lista ordenada: deterministas => cacheables en edge. */
function packChunks(pack) {
    const chunks = [];
    for (let i = 0; i < pack.items.length; i += CHUNK_SIZE) {
        chunks.push(pack.items.slice(i, i + CHUNK_SIZE));
    }
    return chunks;
}

/**
 * Encola la carga de precios de una colección. priority=true (colección expandida)
 * la pone al principio de la cola. Devuelve tras hidratar la caché local.
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

/** Pseudo-colección con los arcanos comerciables que no están en ningún pack de Loid. */
export function othersPack(data) {
    return { id: "others", items: data.others || [] };
}

/** Encola todas las colecciones (goteo de fondo mientras la pestaña está activa). */
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
                    // Con force los datos frescos PISAN los de memoria (si no, el
                    // "Actualizar precios" global no tendría ningún efecto visible)
                    if (!stats || (!force && ARC_STATS.has(slug))) continue;
                    ARC_STATS.set(slug, stats);
                    dbHelper.set(`arcstat_${slug}`, { val: stats, time: Date.now() });
                }
                notify();
            }
        } catch (e) {
            console.warn("arcane_batch chunk failed:", e);
        }

        // Reintento del chunk si el worker devolvió parcial (rate limit de WFM)
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

// --- Comprobación Manual en Vivo (Client-Side) ---

let lastLiveFetchGlobal = 0;
const LIVE_GLOBAL_COOLDOWN_MS = 60 * 1000; // 1 petición/minuto global
const LIVE_ARCANE_COOLDOWN_MS = 60 * 60 * 1000; // 1 petición/hora por arcano

export async function fetchLiveArcanePrice(slug) {
    const now = Date.now();
    if (now - lastLiveFetchGlobal < LIVE_GLOBAL_COOLDOWN_MS) {
        const remaining = Math.ceil((LIVE_GLOBAL_COOLDOWN_MS - (now - lastLiveFetchGlobal)) / 1000);
        return { ok: false, error: "global_cooldown", message: `Para no saturar WFM, espera ${remaining}s antes de actualizar otro arcano.` };
    }

    const cached = await idbGetSafe(`arcstat_${slug}`);
    if (cached?.time && now - cached.time < LIVE_ARCANE_COOLDOWN_MS) {
        const remaining = Math.ceil((LIVE_ARCANE_COOLDOWN_MS - (now - cached.time)) / 60000);
        return { ok: false, error: "arcane_cooldown", message: `Actualizado recientemente. Podrás forzar otra comprobación en ${remaining} min.` };
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

        // Media de las 3 más baratas (misma métrica que el worker): el ask mínimo a pelo
        // reintroduce el problema de los precios anómalos que el equilibrado evita
        const avg3 = (orders) => {
            const n = Math.min(3, orders.length);
            return n > 0 ? Math.round(orders.slice(0, n).reduce((s, o) => s + o.platinum, 0) / n) : 0;
        };

        // MERGE con lo existente: h/v/vm (histórico y volumen real) no cambian con un
        // live check y las badges de liquidez/demanda dependen de ellos
        const existing = ARC_STATS.get(slug) || {};
        const stats = {
            ...existing,
            p: r0Orders[0]?.platinum ?? existing.p ?? 0,
            pe: avg3(r0Orders) || existing.pe || 0,
            s: r0Orders.length || existing.s || 0,
            d: buysR0.length || existing.d || 0,
            bb: buysR0[0]?.platinum ?? existing.bb ?? 0,
            pem: avg3(maxRankOrders) || existing.pem || 0,
            rm: maxRankOrders[0]?.mod_rank || existing.rm || 0,
        };

        ARC_STATS.set(slug, stats);
        dbHelper.set(`arcstat_${slug}`, { val: stats, time: now });
        lastLiveFetchGlobal = now;
        
        // TODO (Future Feature - Crowdsourcing Cache): 
        // Si el coste del worker lo permite, podríamos enviar ('POST') este 'stats' fresquito al worker 
        // en una sola llamada (ej. /api/update_cache) si vemos que su caché local está muy anticuada. 
        // De esta forma, el cliente que hace el "Live Check" actualiza gratuitamente la caché global 
        // para el resto de usuarios de la herramienta sin consumir peticiones extra a WFM desde el servidor.

        notify();
        return { ok: true, stats };
    } catch (err) {
        console.error("fetchLiveArcanePrice error:", err);
        return { ok: false, error: "network_error", message: "Fallo al conectar con Warframe Market (posible bloqueo CORS/Red)." };
    }
}

// --- Matemática de rentabilidad y Liquidez ---

const RARITIES = ["COMMON", "UNCOMMON", "RARE", "LEGENDARY"];

function meanBy(items, fn) {
    const vals = items.map(fn).filter((v) => v > 0);
    if (!vals.length) return 0;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/**
 * Valor esperado de un pack de Loid: por cada tirada, peso de rareza x media del
 * precio equilibrado (rank 0) de los arcanos de esa rareza en la colección.
 * Incluye cálculo de liquidez promedio del pack para ponderar ventas reales.
 */
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
            evPlat += w * meanBy(byRarity[r], (s) => ARC_STATS.get(s)?.pe || 0);
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

    // Liquidity Factor: penaliza packs con arcanos raros que no se venden (volumen cercano a 0)
    // y premia colecciones con alta rotación diaria (volumen >= 5/día)
    const liqMultiplier = Math.min(1.25, Math.max(0.4, 0.45 + 0.35 * Math.log10(1 + avgVolume)));
    const balancedRate = platPerVosfor * liqMultiplier;

    return {
        ready,
        loaded: loaded.length,
        total: pack.items.length,
        evPlat: Math.round(evPlat * 10) / 10,
        evVosfor: Math.round(evVosfor),
        platPerVosfor,
        avgVolume: Math.round(avgVolume),
        balancedRate,
    };
}

/** Mejor plat/vosfor puro entre las colecciones ya cargadas. */
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

/** Mejor coleccion considerando equilibrio entre Plat y Liquidez (Venta rápida). */
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
 * Copias necesarias para el rango máximo de un arcano (números triangulares):
 * fusionLimit 5 -> 21 copias, fusionLimit 3 -> 10 copias.
 */
export function copiesForMaxRank(meta) {
    const mr = Math.max(1, Math.min(meta?.maxRank ?? 5, 5));
    return ((mr + 1) * (mr + 2)) / 2;
}

/**
 * Veredicto completo para R0 (1 copia) y rango máximo (21 o 10 copias según fusionLimit):
 * Compara vender R0 vs Disolver R0, y Vender Rmax vs Vender N R0s vs Disolver N copias.
 */
export function arcaneVerdict(slug, arcanes, bestRate) {
    const meta = arcanes[slug];
    const st = ARC_STATS.get(slug);
    if (!meta || !st) return { verdict: "loading", verdictR5: "loading" };

    const rate = bestRate ? bestRate.rate : 0;
    const copiesMax = copiesForMaxRank(meta);

    // R0 Math (1 copia)
    const sellR0 = st.pe || 0;
    const dissolvePlatR0 = meta.vosfor * rate;

    let verdictR0 = "pending";
    if (bestRate) {
        if (sellR0 <= 0) verdictR0 = "dissolve";
        else if (sellR0 > dissolvePlatR0 * 1.15) verdictR0 = "sell";
        else if (sellR0 < dissolvePlatR0 * 0.85) verdictR0 = "dissolve";
        else verdictR0 = "even";
    }

    // Rango máximo (copiesMax copias: 21 si fusionLimit 5, 10 si fusionLimit 3)
    const sellR5 = st.pem || 0;
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

    // Porcentaje de ganancia por subir a rango máximo frente a vender las copias R0
    const r5RankBonus = sell21R0 > 0 && sellR5 > sell21R0
        ? Math.round(((sellR5 - sell21R0) / sell21R0) * 100)
        : 0;

    // VEREDICTO ÚNICO por copia: qué hacer con cada copia de este arcano, sin importar
    // el rango. Compara las tres salidas por copia: vender suelta (R0), subir a rango
    // máximo y vender (pem/copias), o disolver (vosfor x tasa del mejor pack).
    const sellPerCopyMax = copiesMax > 0 ? sellR5 / copiesMax : 0;
    const bestSellPerCopy = Math.max(sellR0, sellPerCopyMax);
    let bestAction = "pending";
    if (bestRate) {
        if (bestSellPerCopy <= 0) bestAction = "dissolve";
        else if (bestSellPerCopy > dissolvePlatR0 * 1.15) {
            bestAction = sellPerCopyMax > sellR0 * 1.1 ? "sell_max" : "sell_r0";
        }
        else if (bestSellPerCopy < dissolvePlatR0 * 0.85) bestAction = "dissolve";
        else bestAction = "even";
    }

    return {
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

/**
 * Índice de liquidez basado en volumen real de ventas cerradas por día (r0 + rank max),
 * con nº de órdenes de compra online como refuerzo de demanda.
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
 * Calculadora interactiva: Dado una cantidad de Vosfor disponible, calcula tiradas y
 * los mejores packs según ganancia total estimada y velocidad de liquidez.
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

        const estPlat = pulls * ev.evPlat;
        if (estPlat > maxEvPlat) {
            maxEvPlat = estPlat;
            bestEvPack = { pack, pulls, estPlat: Math.round(estPlat), ev };
        }

        const liquidScore = estPlat * Math.min(1.3, 0.4 + 0.6 * Math.log10(1 + ev.avgVolume));
        if (liquidScore > maxLiquidScore) {
            maxLiquidScore = liquidScore;
            bestLiquidPack = { pack, pulls, estPlat: Math.round(estPlat), ev };
        }

        if (selectedPackId && selectedPackId !== "auto" && pack.id === selectedPackId) {
            customPack = { pack, pulls, estPlat: Math.round(estPlat), ev };
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

