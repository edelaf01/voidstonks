/**
 * Cheap signature of a relic inventory to decide whether to repaint: renderInventory runs on EVERY
 * keystroke of the live search. FNV-1a over name and count, the only things the render shows.
 *
 * The length goes first so inventories of different sizes cannot collide.
 *
 * @param inv  array of {name, count} (or strings, old format)
 */
export function inventorySignature(inv) {
    if (!inv || inv.length === 0) return "0";
    let h = 0x811c9dc5;
    for (const item of inv) {
        const isStr = typeof item === "string";
        const name = isStr ? item : item.name;
        for (let i = 0; i < name.length; i++) {
            h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
        }
        h = Math.imul(h ^ (isStr ? 1 : item.count || 1), 0x01000193);
    }
    return `${inv.length}:${h >>> 0}`;
}
