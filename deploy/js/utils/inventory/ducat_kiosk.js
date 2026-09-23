// tracks ducat kiosk sales and deducts sold parts from inventory on confirmation

export const esKioscoDucados = (texto) => /DUCAT|DUCAD|K[I1]\s?[O0]SK|QUIOSC/i.test(texto || "");

export const esDialogoVenta = (texto) => /SELL|VENDER|VENTA/i.test(texto || "") && /ITEM|OBJET|ART[IÍ]C|PIEZA|FOR|POR/i.test(texto || "");

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

export function vuelcaSesion(primeInventory, sessionInventory) {
    const inventario = { ...primeInventory };
    for (const [name, count] of sessionInventory) {
        if (count !== null) inventario[name] = count;
        else inventario[name] ??= 1;
    }
    return inventario;
}

export function parseDucados(texto) {
    const grupos = String(texto || "").match(/\d[\d,.]*/g);
    if (!grupos) return null;
    const n = Number(grupos[grupos.length - 1].replace(/[,.]/g, ""));
    return Number.isFinite(n) ? n : null;
}

export const KIOSCO_INICIAL = Object.freeze({ lista: [], enDialogo: false, vacias: 0, ducadosConLista: null });

// one empty reading is not enough: a line can be lost for a frame, so it takes two in a row
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
