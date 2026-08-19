import { state } from "../../state.js";

/**
 * Cuántas copias tienes de cada reliquia, indexado por el nombre SIN el sufijo " Relic".
 *
 * El inventario mezcla dos formas: el formato viejo era un array de strings y el nuevo es
 * `{name, count}` (state.js migra al primer +/- que se pulse, no antes), y los nombres se
 * guardan unas veces con " Relic" y otras sin él según por dónde entraran — el escáner, el
 * import de JSON o el botón de la ficha. Quien quiera contar reliquias tiene que resolver las
 * dos cosas, así que se resuelven una vez aquí en vez de en cada sitio que las necesita.
 *
 * @returns {Record<string, number>} p. ej. { "Lith K5": 3 }
 */
export function getRelicCounts() {
    const counts = {};
    for (const item of state.inventory || []) {
        const isString = typeof item === "string";
        const name = (isString ? item : item?.name || "").replace(/\s+Relic$/, "").trim();
        if (!name) continue;
        counts[name] = (counts[name] || 0) + (isString ? 1 : item.count || 1);
    }
    return counts;
}
