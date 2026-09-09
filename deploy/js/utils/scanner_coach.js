/**
 * What the user is shown the first time the scanner enters each screen, and what they already saw. Apart from
 * the component because this decides and persists, and `ui.components/` cannot touch localStorage
 * (componentsDoingIO rule in tests/architecture.test.mjs).
 */

const CLAVE = "vs_scanner_coach";

/**
 * A ONE line hint per context. The key is the context the scanner already computes: `pista` is the text and
 * `paso` the matching guided tour step, to jump from the hint to the long explanation.
 */
export const CONTEXTOS_CON_PISTA = ["INVENTORY", "RELICS", "MISSION_COMPLETE", "INVENTORY_MODS", "SQUAD"];

/**
 * REWARD is left out on purpose: that screen has a 15 second clock to pick a reward and a hint gets in the
 * way right then. The tour explains it.
 */
export function tienePista(contexto) { return CONTEXTOS_CON_PISTA.includes(contexto); }

const leidos = () => {
    try { return JSON.parse(localStorage.getItem(CLAVE) || "{}") || {}; } catch { return {}; }
};

export function yaVisto(contexto) { return leidos()[contexto] === true; }

/** Marks it as seen. Returns false when there was nothing to mark (it already was). */
export function marcaVisto(contexto) {
    if (!contexto || yaVisto(contexto)) return false;
    const vistos = leidos();
    vistos[contexto] = true;
    try { localStorage.setItem(CLAVE, JSON.stringify(vistos)); } catch { /* private mode */ }
    return true;
}

/** Shows everything again: called by the "see tutorial again" button. */
export function olvidaVistos() {
    try { localStorage.removeItem(CLAVE); } catch { /* private mode */ }
}

/**
 * Should this context's hint show now? Joins the three conditions so the component does not need to know them:
 * the context has a hint, it was not seen and the user did not turn it off.
 */
export function tocaAvisar(contexto, activado = true) {
    return activado === true && tienePista(contexto) && !yaVisto(contexto);
}

/**
 * Guided tour steps, in order. Each one highlights a HUD element by its id; the component puts the text from
 * TEXTS, only the structure lives here so it can be tested without DOM. `id: null` = step with nothing to
 * highlight (the welcome): painted centered with no cutout.
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

export function siguientePaso(indice) {
    return indice + 1 < PASOS_TOUR.length ? indice + 1 : -1;
}
