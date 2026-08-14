// fast FNV-1a hash of inventory names and counts to skip unnecessary repaints
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
