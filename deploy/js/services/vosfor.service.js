import { dbHelper } from "../repositories/storage.repository.js";
import { getArcaneBatch } from "../repositories/api.repository.js";
import { state } from "../state.js";

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
        const es = state?.currentLang === "es";
        const msg = es
            ? "Fallo al conectar con Warframe Market (posible bloqueo CORS/Red)."
            : "Failed to connect to Warframe Market (possible CORS/Network block).";
        return { ok: false, error: "network_error", message: msg };
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
// Precio R0 REALIZABLE (no el listing a pelo): los asks de arcanos con MERCADO MUERTO no
// reflejan lo que de verdad se vende — nadie compra a ese precio. Ponderamos el ask por la
// liquidez real (ventas cerradas/día, r0+rmax) y ponemos como suelo lo que ofrecen los
// compradores (best buy). Así un arcano casi sin ventas cuenta solo una fracción de su ask,
// y el EV del pack deja de inflarse con precios de listings que nadie paga.
function realizablePrice(ask, vol, bestBuy, thr) {
    if (!ask || ask <= 0) return 0;
    const liq = Math.max(0.15, Math.min(1, vol / thr));  // vol>=thr ventas/día = precio pleno; muerto ≈15%
    return Math.max(bestBuy || 0, ask * liq);            // al menos lo que pagan los compradores
}
// R0: umbral 5 ventas/día para crédito pleno (volumen r0 + rmax).
export function realizableR0(st) {
    return st ? realizablePrice(st.pe || 0, (st.v || 0) + (st.vm || 0), st.bb || 0, 5) : 0;
}
// Rango máximo: los R5 se venden menos a menudo, umbral más bajo (2/día) y su propio best-buy.
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

    // Liquidity Factor: penaliza packs con arcanos raros que no se venden (volumen cercano a 0)
    // y premia colecciones con alta rotación diaria (volumen >= 5/día)
    const liqMultiplier = Math.min(1.25, Math.max(0.4, 0.45 + 0.35 * Math.log10(1 + avgVolume)));
    const balancedRate = platPerVosfor * liqMultiplier;

    // EV REALIZABLE de verdad: el evPlat crudo asume que vendes los 3 arcanos de cada tirada a su
    // precio realizable, pero un pack de rotación lenta (Necralisk: 100% rares ilíquidos) no coloca
    // ese stock. Descuenta por el factor de realización = min(1, liqMult): un pack líquido muestra su
    // EV pleno (factor 1, no lo inflamos por encima de lo realizable), uno muerto se recorta.
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

    // R0 Math (1 copia). Precio REALIZABLE, no el listing: un arcano con mercado muerto no
    // vale su ask (nadie lo compra) → no debe recomendar "VENDER" con un precio fantasma.
    const sellR0 = realizableR0(st);
    const dissolvePlatR0 = meta.vosfor * rate;

    let verdictR0 = "pending";
    if (bestRate) {
        if (sellR0 <= 0) verdictR0 = "dissolve";
        else if (sellR0 > dissolvePlatR0 * 1.15) verdictR0 = "sell";
        else if (sellR0 < dissolvePlatR0 * 0.85) verdictR0 = "dissolve";
        else verdictR0 = "even";
    }

    // Rango máximo (copiesMax copias: 21 si fusionLimit 5, 10 si fusionLimit 3). Realizable.
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

    // Porcentaje de ganancia por subir a rango máximo frente a vender las copias R0
    const r5RankBonus = sell21R0 > 0 && sellR5 > sell21R0
        ? Math.round(((sellR5 - sell21R0) / sell21R0) * 100)
        : 0;

    const sellPerCopyMax = copiesMax > 0 ? sellR5 / copiesMax : 0;

    // ── VEREDICTO por CONJUNTO de `copiesMax` copias (foco en R5/R3, no en spamear R0) ──
    // Motivo: vender N copias R0 sueltas son N trades tediosos por poco cada uno; fusionar a
    // rango máximo y vender es 1 solo trade; disolver es una APUESTA (packs aleatorios).
    // Comparamos el valor NETO de cada salida para el MISMO lote, con:
    //   - fricción por trade (EFFORT_PL): penaliza vender muchas copias sueltas,
    //   - tasa ajustada por liquidez (no la cruda): el pack no siempre revende todo,
    //   - descuento de certeza (CERTAINTY): una apuesta vale menos que el mismo plat seguro.
    const CERTAINTY = 0.75;   // disolver→packs vale ~75% de su EV nominal (varianza + fricción de reventa)
    const EFFORT_PL = 2;      // coste de fricción en pl por cada trade de venta
    const liqRate = bestRate?.ev?.balancedRate ?? rate;   // tasa liquidez-ajustada del mejor pack

    // No puedes colocar 21 copias R0 de un común de mercado muerto: el mercado se satura y el
    // precio se hunde. Limita las copias R0 REALMENTE vendibles por la liquidez (ventas/día):
    // más allá de una ventana razonable, el stock sobrante solo vale como disolución, no como
    // "plat garantizado". Antes se multiplicaba por las copiesMax a secas -> inflaba el
    // garantizado a un número fantasma (Escapist mostraba "sacrificas 112 pl" con R5 real ~31).
    const volDay = (st.v || 0) + (st.vm || 0);
    const SELL_HORIZON_DAYS = 14;   // ventana razonable para colocar el stock sin hundir el precio
    const sellableR0 = Math.max(1, Math.min(copiesMax, Math.ceil(volDay * SELL_HORIZON_DAYS)));

    const canSellMax = st.pem > 0 && (st.rm || 0) > 0;                              // hay mercado real de Rmax
    const netSellMax = canSellMax ? sellR5 - EFFORT_PL : -Infinity;                 // fusionar + vender: 1 trade
    const netSellR0 = sellR0 > 0 ? sellableR0 * (sellR0 - EFFORT_PL) : -Infinity;   // vender solo lo colocable
    const netDissolve = meta.vosfor * copiesMax * liqRate * CERTAINTY;              // disolver: apuesta descontada
    const bestGuaranteed = Math.max(netSellMax, netSellR0);                         // mejor salida SIN apostar

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
            // Aviso: disolver "gana" en EV pero sacrificas un valor garantizado notable.
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

// ── The Hex: arcanos de Archimedea que se compran con PIX (no salen en packs de Loid) ──
// Coste R0 = 5 pix/arcano; alternativa: 200 vosfor = 6 pix. "Mejor plat por pix" compara comprar
// y revender cada arcano a R0 contra gastar esos pix en vosfor y meterlo en el mejor pack.
export const HEX_ARCANES = ["arcane_escapist", "arcane_universal_fallout", "arcane_hot_shot"];

/**
 * Ranking plat-por-pix de los 3 arcanos de The Hex frente a la ruta "pix → vosfor → pack".
 * bestRate: salida de bestBalancedPackRate (usa balancedRate, tasa plat/vosfor liquidez-ajustada).
 */
export function pixRank(data, bestRate) {
    const cfg = data?.hex_pix || { pixCostR0: 5, vosfor: 200, vosforPix: 6 };
    const rate = bestRate?.balancedRate ?? bestRate?.rate ?? 0;   // plat por vosfor realista
    const rows = [];
    for (const slug of HEX_ARCANES) {
        const meta = data?.arcanes?.[slug];
        if (!meta) continue;
        const st = ARC_STATS.get(slug);
        const pix = meta.pix || cfg.pixCostR0;
        const sellR0 = realizableR0(st);                          // plat realizable de 1 copia R0
        rows.push({
            slug, meta, pix,
            sellR0: Math.round(sellR0 * 10) / 10,
            platPerPix: pix > 0 ? Math.round((sellR0 / pix) * 100) / 100 : 0,
            ready: !!st,
        });
    }
    // Ruta vosfor: gastar los pix en vosfor y revender vía el mejor pack (misma unidad, plat/pix).
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
        // recomendación: ¿algún arcano bate la ruta vosfor?
        arcaneBeatsVosfor: !!bestArcane && bestArcane.platPerPix > vosforPlatPerPix,
        ready: rows.every((r) => r.ready),
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

        // Plat MOSTRADO = realizable neto (descontado por liquidez). El "mejor plat" se rankea por
        // ese neto: un pack ilíquido (Necralisk) deja de aparentar más plat del que colocarás.
        const estPlatNet = pulls * (ev.evPlatNet ?? ev.evPlat);
        const estPlatRaw = pulls * ev.evPlat;   // crudo: solo para el score de velocidad de venta
        const shown = Math.round(estPlatNet);
        if (estPlatNet > maxEvPlat) {
            maxEvPlat = estPlatNet;
            bestEvPack = { pack, pulls, estPlat: shown, ev };
        }

        // El score de liquidez pondera por rotación; usa el crudo para no aplicar el descuento dos veces.
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

