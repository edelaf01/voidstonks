// keeps the active tab in the URL hash for history navigation and direct links

export function parseTabHash(hash, tabs) {
    const raw = String(hash || "").trim().replace(/^#/, "").trim();
    const corte = raw.indexOf("/");
    const tab = (corte < 0 ? raw : raw.slice(0, corte)).trim().toLowerCase();
    if (!Array.isArray(tabs) || !tabs.includes(tab)) return null;
    let ctx = "";
    if (corte >= 0) {
        try {
            ctx = decodeURIComponent(raw.slice(corte + 1));
        } catch {
            ctx = "";
        }
    }
    return { tab, ctx };
}

export function tabFromHash(hash, tabs) {
    return parseTabHash(hash, tabs)?.tab ?? null;
}

export function readTabHash(tabs) {
    return tabFromHash(globalThis.location?.hash, tabs);
}

export function readHashState(tabs) {
    return parseTabHash(globalThis.location?.hash, tabs);
}

export function writeTabHash(mode, ctx = "", { clear = false } = {}) {
    const loc = globalThis.location;
    const hist = globalThis.history;
    if (!loc || !hist?.replaceState) return;

    const actual = parseTabHash(loc.hash, [mode]);
    if (!ctx && actual && !clear) return;

    const destino = ctx ? `#${mode}/${encodeURIComponent(ctx)}` : `#${mode}`;
    if (loc.hash === destino) return;

    if (actual || !loc.hash) hist.replaceState(null, "", destino);
    else hist.pushState(null, "", destino);
}

// pushState emits no hashchange, so Back over our entries only arrives through popstate
export function onTabHashChange(tabs, fn) {
    const aviso = () => {
        const estado = parseTabHash(globalThis.location?.hash, tabs);
        if (estado) fn(estado.tab, estado.ctx);
    };
    globalThis.addEventListener?.("popstate", aviso);
    globalThis.addEventListener?.("hashchange", aviso);
}
