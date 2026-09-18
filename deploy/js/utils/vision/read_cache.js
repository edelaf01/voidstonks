import { compareHashes } from "./frame_hash.js";

/**
 * Reads per object, valid while the crop does not change. Keyed by the crop hash, so a static screen is not
 * read again on every pass. The tolerance absorbs stream noise and animated UI glows; a real cell change
 * (another reward after scrolling the panel) misses and is read again.
 */
export function createReadCache(tolerance = 8) {
    const entries = new Map();
    return {
        /** The read stored for `key` if its crop is still the same; null otherwise. */
        get(key, hash) {
            const e = entries.get(key);
            return e && compareHashes(hash, e.hash, tolerance) ? e.value : null;
        },
        set(key, hash, value) { entries.set(key, { hash, value }); },
        clear() { entries.clear(); },
        get size() { return entries.size; },
    };
}
