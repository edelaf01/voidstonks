/**
 * Losing the middle line of "Xaku Prime Neuroptics Blueprint" leaves "Xaku Prime Blueprint", which EXISTS
 * in the catalog and cannot be told apart by text. This only says when to look at the label's ink.
 */

/** Components only warframes (and archwings and sentinels) have, never weapons. */
const COMPONENTES = ["NEUROPTICS", "SYSTEMS", "CHASSIS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM"];

const esComponente = (item) => item.searchWords.some((w) => COMPONENTES.includes(w));

export function hasComponentSiblings(items, originalName) {
    const item = items.find((i) => i.originalName === originalName);
    if (!item || item.searchWords.at(-1) !== "BLUEPRINT") return false;
    // the component can be anywhere, not the last word: "Ash Prime Chassis Blueprint"
    if (esComponente(item)) return false;
    return items.some((otro) => otro.firstWord === item.firstWord && esComponente(otro));
}
