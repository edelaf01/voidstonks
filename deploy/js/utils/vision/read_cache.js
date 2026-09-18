import { compareHashes } from "./frame_hash.js";

// hash tolerance absorbs stream noise and animated UI glows while cell changes miss
export function createReadCache(tolerance = 8) {
    const entries = new Map();
    return {
        get(key, hash) {
            const e = entries.get(key);
            return e && compareHashes(hash, e.hash, tolerance) ? e.value : null;
        },
        set(key, hash, value) { entries.set(key, { hash, value }); },
        clear() { entries.clear(); },
        get size() { return entries.size; },
    };
}
