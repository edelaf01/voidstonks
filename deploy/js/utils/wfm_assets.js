import { getItemIcon } from "./ui_utils.js";

/**
 * Icono de un ítem de Warframe.market usando los assets propios de la app.
 *
 * La resolución de partes (chassis, neuroptics, barrel...) ya la hace getItemIcon:
 * conoce los casos raros —"limb" va a blade.webp, "string" a stock.webp— y cachea
 * el resultado. Aquí solo se traduce del vocabulario de WFM (slug) al suyo (nombre
 * legible) y se deja el icono de WFM como respaldo.
 *
 * Servir desde el propio dominio evita depender de su CDN y respeta su regla de no
 * cargar innecesariamente su infraestructura.
 *
 * El problema que resuelve la precarga: assets/relic_contents/ solo tiene contenido
 * de reliquias (armas, partes prime, arcanos), y getItemIcon SIEMPRE devuelve una
 * ruta, exista o no. Con un mod ("Hunter Munitions") inventaba una ruta que daba 404
 * y el <img> parpadeaba de roto al icono de WFM. Probando la carga fuera del DOM,
 * el <img> real solo recibe una URL que ya se sabe buena.
 */

const WFM_BASE = "https://warframe.market/static/assets/";

/**
 * Rutas locales ya comprobadas: ruta -> Promise<boolean>.
 * Se cachea la promesa, no el resultado, para que N tarjetas del mismo ítem
 * compartan una única comprobación en vuelo.
 */
const localExists = new Map();

/** @returns {Promise<boolean>} true si el asset local se puede cargar. */
function checkLocal(path) {
    let hit = localExists.get(path);
    if (hit) return hit;

    hit = new Promise((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve(true);
        probe.onerror = () => resolve(false);
        probe.src = path;
    });
    localExists.set(path, hit);
    return hit;
}

/**
 * Pinta el icono en un <img>, con el de warframe.market como red de seguridad.
 * @param {HTMLImageElement} img
 * @param {string} itemName nombre legible ("Ash Prime Neuroptics Blueprint")
 * @param {string} [wfmThumb] ruta relativa que devuelve la API de WFM
 */
export function applyIcon(img, itemName, wfmThumb) {
    const remote = wfmThumb ? WFM_BASE + wfmThumb : null;
    const local = itemName ? getItemIcon(itemName) : null;

    if (!local) {
        if (remote) img.src = remote;
        return;
    }

    // Sin respaldo remoto no hay nada que decidir: se intenta el local y punto.
    if (!remote) {
        img.src = local;
        return;
    }

    // Sin guard de isConnected a propósito: orderCard monta la tarjeta entera antes de
    // insertarla, así que aquí el <img> todavía no está en el DOM y un guard lo dejaría
    // siempre en blanco. Escribir src en un <img> ya descartado no cuesta nada.
    checkLocal(local).then((ok) => {
        img.src = ok ? local : remote;
    });
}
