/**
 * The active tab, in the URL: so a tab can be linked, Back returns to the previous tab instead of leaving the
 * site, and two open windows do not overwrite each other's "where was I".
 *
 * The deciding part lives in tabFromHash(), without touching the browser, so it can be tested.
 */

/**
 * @param hash  `location.hash` as is, with or without "#".
 * @param tabs  existing tabs; anything else returns null instead of leaving the app with no #mode-* visible.
 */
export function tabFromHash(hash, tabs) {
    // trim BEFORE dropping the hash sign: with " #vosfor " the ^# did not match and a valid tab typed by hand was
    // dropped
    const raw = String(hash || "").trim().replace(/^#/, "").trim().toLowerCase();
    return Array.isArray(tabs) && tabs.includes(raw) ? raw : null;
}

/** Reads the tab from the current URL. Returns null outside the browser (tests). */
export function readTabHash(tabs) {
    return tabFromHash(globalThis.location?.hash, tabs);
}

/**
 * Writes the tab to the URL. The first time it uses replaceState and not pushState: entering without hash,
 * pushing an entry would leave a Back that seemingly does nothing (same screen, only without "#relic").
 */
export function writeTabHash(mode) {
    const loc = globalThis.location;
    const hist = globalThis.history;
    if (!loc || !hist?.replaceState) return;

    const destino = `#${mode}`;
    if (loc.hash === destino) return;

    if (loc.hash) hist.pushState(null, "", destino);
    else hist.replaceState(null, "", destino);
}

/**
 * Notifies when the user moves to another tab through history or by editing the URL. Both events on purpose:
 * pushState emits no `hashchange`, so Back over one of our entries only arrives through `popstate`; and
 * typing the hash by hand only arrives through `hashchange` in some browsers.
 */
export function onTabHashChange(tabs, fn) {
    const aviso = () => {
        const mode = readTabHash(tabs);
        if (mode) fn(mode);
    };
    globalThis.addEventListener?.("popstate", aviso);
    globalThis.addEventListener?.("hashchange", aviso);
}
