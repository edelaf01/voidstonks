import { getItemIcon } from "./ui_utils.js";

/**
 * Icono de un ítem de Warframe.market usando los assets propios de la app.
 *
 * La resolución de partes (chassis, neuroptics, barrel...) ya la hace getItemIcon:
 * conoce los casos raros —"limb" va a blade.webp, "string" a stock.webp— y cachea
 * el resultado. Aquí solo se traduce del vocabulario de WFM (slug) al suyo (nombre
 * legible).
 *
 * El problema que resuelve la precarga: assets/relic_contents/ solo tiene contenido
 * de reliquias (armas, partes prime, arcanos), y getItemIcon SIEMPRE devuelve una
 * ruta, exista o no. Con un mod ("Hunter Munitions") inventaba una ruta que daba 404
 * y el <img> parpadeaba de roto al respaldo. Probando la carga fuera del DOM,
 * el <img> real solo recibe una URL que ya se sabe buena.
 */

const GENERICO = "assets/mod.svg";
const CLAVE_SIN_ASSET = "vs_iconos_sin_asset";

/**
 * Rutas locales ya comprobadas: ruta -> Promise<boolean>.
 * Se cachea la promesa, no el resultado, para que N tarjetas del mismo ítem
 * compartan una única comprobación en vuelo. Los 404 se recuerdan entre sesiones:
 * cada sonda fallida deja un error en la consola.
 */
const localExists = new Map();
let sinAsset = null;

function faltan() {
    if (!sinAsset) {
        try { sinAsset = new Set(JSON.parse(localStorage.getItem(CLAVE_SIN_ASSET) || "[]")); } catch { sinAsset = new Set(); }
    }
    return sinAsset;
}

/** @returns {Promise<boolean>} true si el asset local se puede cargar. */
function checkLocal(path) {
    let hit = localExists.get(path);
    if (hit) return hit;
    if (faltan().has(path)) hit = Promise.resolve(false);
    else hit = new Promise((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve(true);
        probe.onerror = () => {
            faltan().add(path);
            try { localStorage.setItem(CLAVE_SIN_ASSET, JSON.stringify([...sinAsset])); } catch {}
            resolve(false);
        };
        probe.src = path;
    });
    localExists.set(path, hit);
    return hit;
}

/**
 * Pinta el icono en un <img>; si el asset propio no existe (los mods no tienen), uno genérico.
 * El CDN de warframe.market no sirve: bloquea las imágenes a otros orígenes.
 * @param {HTMLImageElement} img
 * @param {string} itemName nombre legible ("Ash Prime Neuroptics Blueprint")
 */
export function applyIcon(img, itemName) {
    if (!itemName) return;
    if (/\brelic$/i.test(itemName)) {
        img.src = "assets/relic.webp";
        return;
    }
    const local = getItemIcon(itemName);
    // Sin guard de isConnected a propósito: orderCard monta la tarjeta entera antes de
    // insertarla, así que aquí el <img> todavía no está en el DOM y un guard lo dejaría
    // siempre en blanco. Escribir src en un <img> ya descartado no cuesta nada.
    checkLocal(local).then((ok) => {
        img.src = ok ? local : GENERICO;
    });
}
