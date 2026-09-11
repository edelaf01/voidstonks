/**
 * Qué se le enseña al usuario la primera vez que el escáner entra en cada pantalla, y qué ya ha
 * visto. Aparte del componente porque esto decide y persiste, y `ui.components/` no puede tocar
 * localStorage (regla componentsDoingIO de tests/architecture.test.mjs).
 */

const CLAVE = "vs_scanner_coach";

/**
 * Un aviso por contexto, de UNA línea. La clave es el contexto que ya calcula el escáner, así
 * que no hay que detectar nada nuevo: `pista` es el texto y `paso` el trozo del tour guiado que
 * le corresponde, para poder saltar desde el aviso a la explicación larga.
 */
export const CONTEXTOS_CON_PISTA = ["INVENTORY", "RELICS", "MISSION_COMPLETE", "INVENTORY_MODS", "SQUAD"];

/**
 * REWARD queda fuera a propósito: esa pantalla tiene 15 segundos de reloj para elegir premio y
 * es justo el momento en que un aviso estorba. Se explica en el tour, que el usuario abre cuando
 * quiere.
 */
export function tienePista(contexto) { return CONTEXTOS_CON_PISTA.includes(contexto); }

const leidos = () => {
    try { return JSON.parse(localStorage.getItem(CLAVE) || "{}") || {}; } catch { return {}; }
};

/** ¿Ya se le enseñó el aviso de este contexto? */
export function yaVisto(contexto) { return leidos()[contexto] === true; }

/** Lo marca como visto. Devuelve false si no había nada que marcar (ya lo estaba). */
export function marcaVisto(contexto) {
    if (!contexto || yaVisto(contexto)) return false;
    const vistos = leidos();
    vistos[contexto] = true;
    try { localStorage.setItem(CLAVE, JSON.stringify(vistos)); } catch { /* modo privado */ }
    return true;
}

/** Vuelve a enseñarlo todo: lo llama el botón de "ver tutorial otra vez". */
export function olvidaVistos() {
    try { localStorage.removeItem(CLAVE); } catch { /* modo privado */ }
}

/**
 * ¿Toca enseñar el aviso de este contexto ahora? Une las tres condiciones para que el
 * componente no tenga que conocerlas: que el contexto tenga pista, que no se haya visto y que
 * el usuario no lo haya desactivado.
 */
export function tocaAvisar(contexto, activado = true) {
    return activado === true && tienePista(contexto) && !yaVisto(contexto);
}

/**
 * Los pasos del tour guiado, en orden. Cada uno resalta un elemento del HUD por su id; el texto
 * lo pone el componente desde TEXTS, aquí solo va la estructura para poder probarla sin DOM.
 *
 * `id: null` = paso sin elemento que resaltar (la bienvenida): se pinta centrado y sin recorte.
 */
export const PASOS_TOUR = Object.freeze([
    { clave: "intro", id: null },
    { clave: "contexto", id: "hud-context-badge" },
    { clave: "scan", id: "btn-manual-scan" },
    { clave: "auto", id: "btn-auto-scan" },
    { clave: "guardar", id: "btn-save-inv" },
    { clave: "detectados", id: "live-inventory-items-list" },
    { clave: "motor", id: "lbl-ocr-engine" },
    { clave: "diag", id: "btn-debug-toggle" },
]);

/** Índice siguiente del tour, o -1 cuando se acaba. */
export function siguientePaso(indice) {
    return indice + 1 < PASOS_TOUR.length ? indice + 1 : -1;
}
