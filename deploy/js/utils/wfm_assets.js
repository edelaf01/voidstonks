import { getItemIcon } from "./ui_utils.js";

/**
 * Icon of a warframe.market item from the app's own assets. getItemIcon already resolves parts (chassis,
 * neuroptics, barrel...), knows the odd cases ("limb" goes to blade.webp, "string" to stock.webp) and caches
 * the result. Here the WFM vocabulary (slug) is only translated to its own (readable name).
 *
 * The preload exists because assets/relic_contents/ only has relic content (weapons, prime parts, arcanes) and
 * getItemIcon ALWAYS returns a path, whether it exists or not. Testing the load off the DOM, the real <img>
 * only gets a URL already known to be good.
 */

const GENERICO = "assets/mod.svg";
const CLAVE_SIN_ASSET = "vs_iconos_sin_asset";

/**
 * Local paths already checked: path -> Promise<boolean>. The promise is cached, not the result, so N cards of
 * the same item share one in flight check. 404s are remembered across sessions: each failed probe leaves a
 * console error.
 */
const localExists = new Map();
let sinAsset = null;

function faltan() {
    if (!sinAsset) {
        try { sinAsset = new Set(JSON.parse(localStorage.getItem(CLAVE_SIN_ASSET) || "[]")); } catch { sinAsset = new Set(); }
    }
    return sinAsset;
}

/** @returns {Promise<boolean>} true when the local asset can be loaded. */
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
 * Paints the icon in an <img>; when the own asset does not exist (mods have none), a generic one. The
 * warframe.market CDN does not work: it blocks images to other origins.
 * @param {HTMLImageElement} img
 * @param {string} itemName readable name ("Ash Prime Neuroptics Blueprint")
 */
export function applyIcon(img, itemName) {
    if (!itemName) return;
    if (/\brelic$/i.test(itemName)) {
        img.src = "assets/relic.webp";
        return;
    }
    const local = getItemIcon(itemName);
    // no isConnected guard on purpose: orderCard builds the whole card before inserting it, so the <img> is not
    // in the DOM yet and a guard would always leave it blank
    checkLocal(local).then((ok) => {
        img.src = ok ? local : GENERICO;
    });
}
