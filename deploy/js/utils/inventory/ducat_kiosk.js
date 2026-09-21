/**
 * Ducat kiosk (INVENTORY/DUCAT KIOSK): what was sold and how much to take from the inventory.
 *
 * The right panel stacks one line per part ("2 X Vadarya Prime Receiver   90"); SELL ITEMS opens a
 * confirmation dialog and YES empties the panel. NO leaves it as it was, and the player can also remove
 * parts by hand without selling: a sale is "there was a dialog and AFTER that the panel emptied", never
 * just "the panel emptied".
 */

/** Kiosk header, with the usual OCR misreads (K1OSK, KI0SK) and the Spanish label. */
export const esKioscoDucados = (texto) => /DUCAT|DUCAD|K[I1]\s?[O0]SK|QUIOSC/i.test(texto || "");

/** Dialog "Are you sure you want to sell N Items for M?" / "¿Seguro que quieres vender…?". */
export const esDialogoVenta = (texto) => /SELL|VENDER|VENTA/i.test(texto || "") && /ITEM|OBJET|ART[IÍ]C|PIEZA|FOR|POR/i.test(texto || "");

/**
 * Panel lines → [{ name, qty, ducats }]. `resolver(palabras)` returns the canonical name or null; a line
 * with no known part is dropped. The quantity goes first ("2 X", "3x"), one without it; ducats are the
 * last number.
 */
export function parseVentaKiosco(lineas, resolver) {
    const items = [];
    for (const linea of lineas || []) {
        const limpia = String(linea).replace(/[|_]/g, " ").trim();
        if (!limpia || /^TOTAL/i.test(limpia)) continue;
        const m = /^(?:(\d{1,3})\s*[xX×]\s*)?(.+?)(?:\s+(\d{1,4}))?$/.exec(limpia);
        if (!m) continue;
        const palabras = m[2].split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
        if (!palabras.length) continue;
        const name = resolver(palabras);
        if (!name) continue;
        const qty = m[1] ? Number(m[1]) : 1;
        const ducats = m[3] ? Number(m[3]) : null;
        const previo = items.find((i) => i.name === name);
        if (previo) previo.qty += qty;
        else items.push({ name, qty, ducats });
    }
    return items;
}

/** Dumps the session reading into the inventory. null = view without a readable badge: keeps what was there. */
export function vuelcaSesion(primeInventory, sessionInventory) {
    const inventario = { ...primeInventory };
    for (const [name, count] of sessionInventory) {
        if (count !== null) inventario[name] = count;
        else inventario[name] ??= 1;
    }
    return inventario;
}

/** Player ducats in the top bar ("414,126,394  1,480  534"): the last number. */
export function parseDucados(texto) {
    const grupos = String(texto || "").match(/\d[\d,.]*/g);
    if (!grupos) return null;
    const n = Number(grupos[grupos.length - 1].replace(/[,.]/g, ""));
    return Number.isFinite(n) ? n : null;
}

export const KIOSCO_INICIAL = Object.freeze({ lista: [], enDialogo: false, vacias: 0, ducadosConLista: null });

/**
 * Advances the state with one panel reading. `dialogo` = the confirmation dialog is on screen (the panel
 * is dimmed and not read); `items` = what was read otherwise; `ducados` = the player counter, if read.
 *
 * One empty reading is not enough: a line can be lost for a frame. It takes two empty ones in a row.
 *
 * The sale is confirmed by the dialog OR by ducats rising by the list value: the dialog lasts an
 * instant, the counter stays.
 *
 * @returns {{ estado: object, venta: Array|null }}
 */
export function siguienteEstadoKiosco(prev, { items, dialogo, ducados = null }) {
    const s = { ...KIOSCO_INICIAL, ...prev };
    if (dialogo) return { estado: { ...s, enDialogo: true, vacias: 0 }, venta: null };
    if (items && items.length) {
        return { estado: { lista: items, enDialogo: false, vacias: 0, ducadosConLista: ducados ?? s.ducadosConLista }, venta: null };
    }
    const vacias = s.vacias + 1;
    if (vacias < 2) return { estado: { ...s, vacias }, venta: null };
    const valor = s.lista.reduce((t, i) => t + (i.ducats || 0), 0);
    const subida = ducados != null && s.ducadosConLista != null ? ducados - s.ducadosConLista : 0;
    const vendida = s.enDialogo || (subida > 0 && subida >= valor * 0.5);
    const venta = vendida && s.lista.length ? s.lista : null;
    return { estado: { ...KIOSCO_INICIAL, ducadosConLista: ducados }, venta };
}

/**
 * Takes the sale off the parts inventory. A part that was not there does not go negative: it is
 * returned in `ausentes`. The counter stays at 0 instead of being deleted.
 */
export function applyDucatSale(primeInventory, items) {
    const inventario = { ...primeInventory };
    const restadas = [], ausentes = [];
    for (const { name, qty } of items || []) {
        if (!name || !(qty > 0)) continue;
        if (!Object.hasOwn(inventario, name)) { ausentes.push(name); continue; }
        const antes = Number(inventario[name]) || 0;
        inventario[name] = Math.max(0, antes - qty);
        restadas.push({ name, qty: Math.min(qty, antes), quedan: inventario[name] });
    }
    return { inventario, restadas, ausentes };
}
