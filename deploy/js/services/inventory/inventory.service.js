import { state } from "../../state.js";
import { dbHelper, MEMORY_CACHE, ensurePriceSnapshot, leeHistorialSets, guardaHistorialSets } from "../../repositories/storage.repository.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getPricesBatch, fetchTendencias } from "../../repositories/api.repository.js";
import { veredictoVenta } from "../../utils/inventory/vender_ya.js";
import { apuntaPrecios, diaDe, tendencias } from "../../utils/inventory/set_trend.js";

function collectInventorySlugs() {
    const itemsToCheck = new Set();
    const getSetName = (fullName) => {
        if (state.setDePieza?.[fullName]) return state.setDePieza[fullName];
        const match = fullName.match(/(.*?) (Prime|Vandal|Wraith)/);
        return match ? match[0].trim() : null;
    };

    Object.keys(state.primeInventory).forEach((name) => {
        if (state.primeInventory[name] <= 0 && !state.settings?.showEmptyPrime) return;
        itemsToCheck.add(getSlug(name));
        const setName = getSetName(name);
        if (setName) itemsToCheck.add(getSlug(`${setName} Set`));
    });

    state.inventory.forEach((item) => {
        state.relicsDatabase[item.name]?.forEach((d) => itemsToCheck.add(getSlug(d.name)));
    });

    if (state.setsDatabase) {
        Object.keys(state.setsDatabase).forEach((setName) => {
            const parts = state.setsDatabase[setName];
            // showEmptyPrime stays out on purpose: here it would fetch every part of every set
            if (parts.some((p) => (state.primeInventory[p] || 0) > 0)) {
                itemsToCheck.add(getSlug(`${setName} Set`));
                parts.forEach((p) => itemsToCheck.add(getSlug(p)));
            }
        });
    }

    return itemsToCheck;
}

export async function warmupPrices() {
    if (!state.primeInventory && state.inventory.length === 0) return;

    apuntaPreciosDeSets(await ensurePriceSnapshot());

    const slugsToFetch = Array.from(collectInventorySlugs()).filter((s) => !MEMORY_CACHE.has(s));
    if (slugsToFetch.length === 0) return;
    for (let i = 0; i < slugsToFetch.length; i += 25) {
        const chunk = slugsToFetch.slice(i, i + 25);
        try {
            const res = await getPricesBatch(chunk);
            if (!res.ok) continue;
            const data = await res.json();
            Object.entries(data).forEach(([slug, price]) => {
                if (price > 0) {
                    MEMORY_CACHE.set(slug, price);
                    dbHelper.set(`price_${slug}`, { val: price, time: Date.now() });
                }
            });
        } catch (e) {
            console.warn("Prefetch error", e);
        }
    }
}

export function apuntaPreciosDeSets(snapshot, ahora = Date.now()) {
    if (!snapshot || !state.setsDatabase) return;
    const precios = {};
    for (const [setName, parts] of Object.entries(state.setsDatabase)) {
        if (parts.some((p) => (state.primeInventory?.[p] || 0) > 0)) precios[setName] = snapshot[getSlug(`${setName} Set`)] || 0;
    }
    if (Object.keys(precios).length) guardaHistorialSets(apuntaPrecios(leeHistorialSets(), precios, diaDe(ahora)));
}

export function tendenciaDeSets(dias, ahora = Date.now()) {
    return tendencias(leeHistorialSets(), diaDe(ahora), dias);
}

export async function ventaUrgente() {
    const doc = await fetchTendencias();
    const mapa = doc?.t;
    if (!mapa) return [];
    const hoy = Date.now();
    const fuera = [];
    for (const [name, qty] of Object.entries(state.primeInventory || {})) {
        if (!(qty > 0)) continue;
        const slug = getSlug(name);
        const tendencia = mapa[slug];
        if (!tendencia) continue;
        const vivo = Number.parseInt(MEMORY_CACHE.get(slug), 10);
        const precio = vivo > 0 ? vivo : tendencia.p;
        const v = veredictoVenta({ precio, tendencia, hoy });
        if (v.urgente) fuera.push({ name, qty, precio, motivo: v.motivo, score: v.score, p7: tendencia.p7 });
    }
    return fuera.sort((a, b) => b.score - a.score);
}

export async function cicloVault(ahora = Date.now()) {
    const doc = await fetchTendencias();
    const mapa = doc?.t;
    if (!mapa) return [];
    const hoy = new Date(ahora).toISOString().slice(0, 10);
    const limiteVault = new Date(ahora - 21 * 86400000).toISOString().slice(0, 10);
    const propios = Object.entries(state.primeInventory || {}).filter(([, qty]) => qty > 0).map(([name]) => getSlug(name));
    const orden = { resurgence_proxima: 0, resurgence_actual: 1, vault: 2 };
    const filas = [];
    for (const [slug, tendencia] of Object.entries(mapa)) {
        const vc = tendencia?.vc;
        if (!vc?.t || !slug.endsWith("_set") || !(vc.t in orden)) continue;
        if (vc.t === "resurgence_actual" && vc.h && vc.h < hoy) continue;
        if (vc.t === "resurgence_proxima" && vc.d && vc.d < hoy) continue;
        if (vc.t === "vault" && !(vc.d >= limiteVault)) continue;
        const nombre = slug.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
        filas.push({ slug, nombre, tipo: vc.t, d: vc.d, h: vc.h, precio: tendencia.p, propio: propios.some((p) => p === slug || p.startsWith(slug.slice(0, -3))) });
    }
    return filas.sort((a, b) => orden[a.tipo] - orden[b.tipo] || b.propio - a.propio || a.nombre.localeCompare(b.nombre));
}
