/**
 * Kiosko de ducados (INVENTORY/DUCAT KIOSK): qué se ha vendido y cuánto restar del inventario.
 *
 * El panel de la derecha apila una línea por pieza ("2 X Vadarya Prime Receiver   90"); al pulsar
 * SELL ITEMS sale un diálogo de confirmación y, con YES, el panel se vacía. Con NO se queda como
 * estaba, y el jugador también puede quitar piezas a mano sin vender: por eso la venta es
 * "hubo diálogo y DESPUÉS el panel quedó vacío", nunca solo "el panel se vació".
 */

/** Cabecera del kiosko, con las lecturas típicas del OCR (K1OSK, KI0SK) y el rótulo en español. */
export const esKioscoDucados = (texto) => /DUCAT|DUCAD|K[I1]\s?[O0]SK|QUIOSC/i.test(texto || "");

/** Diálogo "Are you sure you want to sell N Items for M?" / "¿Seguro que quieres vender…?". */
export const esDialogoVenta = (texto) => /SELL|VENDER|VENTA/i.test(texto || "") && /ITEM|OBJET|ART[IÍ]C|PIEZA|FOR|POR/i.test(texto || "");

/**
 * Líneas del panel → [{ name, qty, ducats }]. `resolver(palabras)` devuelve el nombre canónico
 * o null; la línea sin pieza reconocida se tira. La cantidad va delante ("2 X", "3x") y sin
 * ella es una; los ducados son el número del final.
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

/** Vuelca la lectura de sesión al inventario. null = vista sin badge legible: no pisa lo que había. */
export function vuelcaSesion(primeInventory, sessionInventory) {
    const inventario = { ...primeInventory };
    for (const [name, count] of sessionInventory) {
        if (count !== null) inventario[name] = count;
        else inventario[name] ??= 1;
    }
    return inventario;
}

/** Ducados del jugador en la barra de arriba ("414,126,394  1,480  534"): el último número. */
export function parseDucados(texto) {
    const grupos = String(texto || "").match(/\d[\d,.]*/g);
    if (!grupos) return null;
    const n = Number(grupos[grupos.length - 1].replace(/[,.]/g, ""));
    return Number.isFinite(n) ? n : null;
}

export const KIOSCO_INICIAL = Object.freeze({ lista: [], enDialogo: false, vacias: 0, ducadosConLista: null });

/**
 * Avanza el estado con una lectura del panel. `dialogo` = el diálogo de confirmación está en
 * pantalla (el panel se ve atenuado y no se lee); `items` = lo leído si no lo está; `ducados` =
 * el contador del jugador en ese frame, si se leyó.
 *
 * Una lectura vacía sola no vale: entre el fundido del diálogo y el ruido del OCR una línea
 * puede perderse un frame, y ese frame vaciaría la lista justo antes de venderla. Hacen falta
 * dos vacías seguidas, y quien llama fuerza la relectura para que la segunda exista.
 *
 * La venta se confirma por el diálogo O porque los ducados subieron lo que valía la lista: el
 * diálogo dura un instante y el escáner puede estar leyendo una página justo entonces; el
 * contador, en cambio, se queda.
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
 * Resta la venta del inventario de piezas. Una pieza que no estaba no se inventa a negativo:
 * se devuelve en `ausentes` para avisar. El contador se queda a 0, no se borra: el inventario
 * real trae piezas a 0 y borrarlas cambia la lista que ve el usuario.
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
