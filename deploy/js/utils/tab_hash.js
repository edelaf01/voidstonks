// keeps the active tab in the URL hash for history navigation and direct links

export function tabFromHash(hash, tabs) {
    const raw = String(hash || "").trim().replace(/^#/, "").trim().toLowerCase();
    return Array.isArray(tabs) && tabs.includes(raw) ? raw : null;
}

export function readTabHash(tabs) {
    return tabFromHash(globalThis.location?.hash, tabs);
}

export function writeTabHash(mode) {
    const loc = globalThis.location;
    const hist = globalThis.history;
    if (!loc || !hist?.replaceState) return;

    const destino = `#${mode}`;
    if (loc.hash === destino) return;

    if (loc.hash) hist.pushState(null, "", destino);
    else hist.replaceState(null, "", destino);
}

// pushState emits no hashchange, so Back over our entries only arrives through popstate
export function onTabHashChange(tabs, fn) {
    const aviso = () => {
        const mode = readTabHash(tabs);
        if (mode) fn(mode);
    };
    globalThis.addEventListener?.("popstate", aviso);
    globalThis.addEventListener?.("hashchange", aviso);
}
