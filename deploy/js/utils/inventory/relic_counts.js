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

/** El nombre sin el sufijo " Relic", que es la forma en la que dos entradas se comparan. */
export function relicKey(name) {
    return String(name || "").replace(/\s+Relic$/i, "").trim().toUpperCase();
}

/**
 * Mete las cantidades de un escaneo en el inventario, sin duplicar entradas.
 *
 * Semántica "set", igual que el inventario prime: lo escaneado REEMPLAZA la cantidad, no se
 * suma — si no, escanear la misma página dos veces duplicaría todo.
 *
 * Lo que hay que resolver aquí es que las dos partes hablan idiomas distintos: el escáner
 * devuelve el nombre canónico de `state.allRelicNames` (con " Relic" o sin él, según de dónde
 * venga la base de datos) y el inventario guarda strings sueltos del formato viejo o
 * `{name, count}` con cualquiera de las dos formas. Comparando `name` a secas —que es lo que
 * hacía saveLiveInventory— "Neo N12 Relic" no encontraba a "Neo N12" y se apuntaba aparte:
 * dos filas de la misma reliquia y el contador partido entre las dos.
 *
 * El nombre GUARDADO no se toca: quien ya estaba se queda como estaba y solo cambia su
 * cantidad. Normalizarlo aquí sería migrar el inventario entero de rebote.
 *
 * @param inventory  state.inventory (mezcla de strings y {name, count})
 * @param scanned    Map|Object de nombre canónico -> cantidad leída
 * @returns array nuevo de {name, count}; las entradas a 0 desaparecen
 */
export function mergeRelicCounts(inventory, scanned) {
    const out = [];
    const index = new Map();

    for (const item of inventory || []) {
        const isString = typeof item === "string";
        const name = (isString ? item : item?.name) || "";
        const key = relicKey(name);
        if (!key) continue;
        const count = isString ? 1 : Number(item?.count) || 1;
        const prev = index.get(key);
        // El formato viejo repite la reliquia una vez por copia: al convertirlo a {name, count}
        // hay que sumarlas, no quedarse con la última.
        if (prev) prev.count += count;
        else {
            const entry = { name: String(name).trim(), count };
            out.push(entry);
            index.set(key, entry);
        }
    }

    const pairs = scanned instanceof Map ? [...scanned] : Object.entries(scanned || {});
    for (const [name, raw] of pairs) {
        const key = relicKey(name);
        if (!key) continue;
        const count = Math.max(0, Math.round(Number(raw) || 0));
        const prev = index.get(key);
        if (prev) prev.count = count;
        else if (count > 0) {
            const entry = { name: String(name).trim(), count };
            out.push(entry);
            index.set(key, entry);
        }
    }

    return out.filter((e) => e.count > 0);
}
