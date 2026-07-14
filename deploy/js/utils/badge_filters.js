/**
 * Filtros puros (sin canvas/DOM) para la lectura del badge de cantidad del
 * inventario. Extraídos de VisionService.extractBadgeByColor para poder testear
 * la DECISIÓN de forma aislada con datos de componentes reales (ver
 * tests/badge-band-filter.test.mjs), igual que grid_detect.js.
 */

/**
 * Filtro de BANDA: el badge (checkmark + dígitos) vive en UNA sola fila de texto.
 * El arte del ítem que entra por la derecha del crop puede pasar el filtro de forma:
 * un bloque alto de arte brillante cae dentro de los límites de altura y contamina
 * el crop final (Banshee Prime Blueprint 9→"Ø"), o un trazo vertical del arte se
 * lee como un "1" espurio (Ballistica Prime Blueprint 3→"31").
 *
 * Ancla = el superviviente más BRILLANTE (el filtro de luma previo ya garantizó que
 * el badge domina el brillo, así que el ancla es checkmark o dígito, nunca el arte
 * tenue). Se marca para borrar todo superviviente cuyo CENTRO vertical se aleje del
 * centro del ancla más de la mitad de la altura del menor de los dos: los dígitos y
 * el checkmark comparten centro aunque sus alturas difieran; el arte vive en otra
 * banda (se extiende hacia abajo, desplazando su centro).
 *
 * @param {Array<{minY:number,maxY:number,height:number,avgLuma:number,erased:boolean}>} components
 * @returns {number[]} índices (en `components`) de los componentes a borrar.
 */
export function offBandComponentIndices(components) {
    let anchor = null;
    for (const c of components) {
        if (c.erased) continue;
        if (!anchor || c.avgLuma > anchor.avgLuma) anchor = c;
    }
    if (!anchor) return [];

    const anchorCy = (anchor.minY + anchor.maxY) / 2;
    const anchorH = anchor.height;
    const toErase = [];
    for (let i = 0; i < components.length; i++) {
        const c = components[i];
        if (c.erased || c === anchor) continue;
        const cy = (c.minY + c.maxY) / 2;
        if (Math.abs(cy - anchorCy) > 0.5 * Math.min(c.height, anchorH)) {
            toErase.push(i);
        }
    }
    return toErase;
}
