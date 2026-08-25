/**
 * La pestaña activa, en la URL.
 *
 * No había ninguna: vivía solo en localStorage. Eso dejaba tres cosas sin resolver — no se
 * podía enlazar una pestaña (ni recomendar la app apuntando a lo que hace bien), el botón
 * Atrás sacaba del sitio en vez de volver a la pestaña anterior (en móvil ES el gesto de
 * volver), y dos ventanas abiertas se pisaban el "dónde estaba".
 *
 * La parte que decide vive en tabFromHash(), sin tocar el navegador, para poder probarla.
 */

/**
 * @param hash  `location.hash` tal cual, con o sin "#".
 * @param tabs  pestañas que existen; cualquier otra cosa devuelve null en vez de dejar la
 *   app sin ningún #mode-* visible, que es lo que pasaba con un save de una pestaña borrada.
 */
export function tabFromHash(hash, tabs) {
    // trim ANTES de quitar la almohadilla: con " #vosfor " el ^# no casaba y se descartaba
    // una pestaña válida escrita a mano en la barra de direcciones.
    const raw = String(hash || "").trim().replace(/^#/, "").trim().toLowerCase();
    return Array.isArray(tabs) && tabs.includes(raw) ? raw : null;
}

/** Lee la pestaña de la URL actual. Devuelve null fuera del navegador (tests). */
export function readTabHash(tabs) {
    return tabFromHash(globalThis.location?.hash, tabs);
}

/**
 * Escribe la pestaña en la URL.
 *
 * La primera vez usa replaceState y no pushState: al entrar sin hash, empujar una entrada
 * dejaría un Atrás que aparentemente no hace nada (misma pantalla, solo sin "#relic").
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
 * Avisa cuando el usuario navega a otra pestaña con el historial o editando la URL.
 *
 * Se escuchan los dos eventos a propósito: pushState no emite `hashchange`, así que el Atrás
 * sobre una entrada nuestra solo llega por `popstate`; y escribir el hash a mano en la barra
 * de direcciones solo llega por `hashchange` en algunos navegadores.
 */
export function onTabHashChange(tabs, fn) {
    const aviso = () => {
        const mode = readTabHash(tabs);
        if (mode) fn(mode);
    };
    globalThis.addEventListener?.("popstate", aviso);
    globalThis.addEventListener?.("hashchange", aviso);
}
