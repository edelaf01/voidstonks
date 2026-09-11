// detects when a dropped middle component word leaves an existing catalog blueprint

const COMPONENTES = ["NEUROPTICS", "SYSTEMS", "CHASSIS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM"];

const esComponente = (item) => item.searchWords.some((w) => COMPONENTES.includes(w));

export function hasComponentSiblings(items, originalName) {
    const item = items.find((i) => i.originalName === originalName);
    if (!item || item.searchWords.at(-1) !== "BLUEPRINT") return false;
    if (esComponente(item)) return false;
    return items.some((otro) => otro.firstWord === item.firstWord && esComponente(otro));
}
