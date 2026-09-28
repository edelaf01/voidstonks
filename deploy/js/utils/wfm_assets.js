import { getItemIcon } from "./ui_utils.js";

const GENERICO = "assets/mod.svg";
const CLAVE_SIN_ASSET = "vs_iconos_sin_asset";

const localExists = new Map();
let sinAsset = null;

function faltan() {
    if (!sinAsset) {
        try { sinAsset = new Set(JSON.parse(localStorage.getItem(CLAVE_SIN_ASSET) || "[]")); } catch { sinAsset = new Set(); }
    }
    return sinAsset;
}

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

export function applyIcon(img, itemName) {
    if (!itemName) return;
    if (/\brelic$/i.test(itemName)) {
        img.src = "assets/relic.webp";
        return;
    }
    const local = getItemIcon(itemName);
    // no isConnected guard because cards are built before being inserted into the DOM
    checkLocal(local).then((ok) => {
        img.src = ok ? local : GENERICO;
    });
}
