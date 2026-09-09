// decides and persists scanner hints shown on first entry to each screen

const CLAVE = "vs_scanner_coach";

export const CONTEXTOS_CON_PISTA = ["INVENTORY", "RELICS", "MISSION_COMPLETE", "INVENTORY_MODS", "SQUAD"];

// skips REWARD on purpose: that screen has a 15 second clock to pick a reward
export function tienePista(contexto) { return CONTEXTOS_CON_PISTA.includes(contexto); }

const leidos = () => {
    try { return JSON.parse(localStorage.getItem(CLAVE) || "{}") || {}; } catch { return {}; }
};

export function yaVisto(contexto) { return leidos()[contexto] === true; }

export function marcaVisto(contexto) {
    if (!contexto || yaVisto(contexto)) return false;
    const vistos = leidos();
    vistos[contexto] = true;
    try { localStorage.setItem(CLAVE, JSON.stringify(vistos)); } catch {}
    return true;
}

export function olvidaVistos() {
    try { localStorage.removeItem(CLAVE); } catch {}
}

export function tocaAvisar(contexto, activado = true) {
    return activado === true && tienePista(contexto) && !yaVisto(contexto);
}

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
