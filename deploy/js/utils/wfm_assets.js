import { getItemIcon } from "./ui_utils.js";

const WFM_BASE = "https://warframe.market/static/assets/";

const localExists = new Map();

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

    // no isConnected guard because cards are built before being inserted into the DOM
    checkLocal(local).then((ok) => {
        img.src = ok ? local : remote;
    });
}
