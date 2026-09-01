/**
 * Si el OCR pierde la línea del medio de "Xaku Prime Neuroptics Blueprint" queda "Xaku Prime
 * Blueprint", que EXISTE en el catálogo: 168 de los 224 nombres multilínea tienen ese gemelo y
 * por texto no hay forma de separarlos. Esto solo dice cuándo hay que mirar la tinta del rótulo.
 */

/** Componentes que solo tienen los warframes (y arcoalas y centinelas), nunca las armas. */
const COMPONENTES = ["NEUROPTICS", "SYSTEMS", "CHASSIS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM"];

const esComponente = (item) => item.searchWords.some((w) => COMPONENTES.includes(w));

export function hasComponentSiblings(items, originalName) {
    const item = items.find((i) => i.originalName === originalName);
    if (!item || item.searchWords.at(-1) !== "BLUEPRINT") return false;
    // El componente va en cualquier posición, no en la última palabra: la BD los llama
    // "Ash Prime Chassis Blueprint", así que mirar at(-1) veía "BLUEPRINT" en todos.
    if (esComponente(item)) return false;
    return items.some((otro) => otro.firstWord === item.firstWord && esComponente(otro));
}
