import { getItemIcon } from "./ui_utils.js";

const WFM_BASE = "https://warframe.market/static/assets/";

const localExists = new Map();

/** @returns {Promise<boolean>} true when the local asset can be loaded. */
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
 * @param {HTMLImageElement} img
 * @param {string} itemName
 * @param {string} [wfmThumb]
 */
export function applyIcon(img, itemName, wfmThumb) {
    const remote = wfmThumb ? WFM_BASE + wfmThumb : null;
    const local = itemName ? getItemIcon(itemName) : null;

    if (!local) {
        if (remote) img.src = remote;
        return;
    }

    if (!remote) {
        img.src = local;
        return;
    }

    // no isConnected guard on purpose: orderCard builds the whole card before inserting it, so the <img> is not
    // in the DOM yet and a guard would always leave it blank
    checkLocal(local).then((ok) => {
        img.src = ok ? local : remote;
    });
}
