/**
 * Picks the digits of the quantity badge ANCHORED on the checkmark. Filters that judged each component of the
 * binarized crop by its ISOLATED properties were unstable: a 1% rescale of the same capture flipped them
 * between the badge digits and an art blob. The checkmark is a far firmer anchor than any threshold: it is
 * always ~0.34 of the search window, and the digits are exactly what sits right of it in its own band.
 */

// the checkmark is SQUARE (circle with the check inside) and lives in the left third
const ANCLA = { xMax: 0.35, altoMin: 0.25, altoMax: 0.50, arMin: 0.80, arMax: 1.25, areaMin: 8 };

// a digit shares the checkmark vertical center and measures 40% to 125% of its height. The 0.45 band is not
// cosmetic: at 0.55 a block of background art gets in and "5" reads "58"
const DIGITO = { banda: 0.45, altoMin: 0.40, altoMax: 1.25, hueco: 0.60, desfase: 0.25 };

/**
 * @param comps [{ minX, maxX, minY, maxY, width, height, area }] of the binarized crop.
 * @returns indices of the components that make the NUMBER, left to right, or [] when there is no checkmark
 *          or nothing right of it.
 */
export function digitosPorAncla(comps, ventanaW, ventanaH) {
    const centroY = (c) => (c.minY + c.maxY) / 2;

    // LARGEST area, not the leftmost: at low resolution the art leaves square specks before the checkmark and
    // taking the first lost the anchor
    let ancla = null;
    for (const c of comps) {
        if (c.minX >= ventanaW * ANCLA.xMax) continue;
        if (c.height < ventanaH * ANCLA.altoMin || c.height > ventanaH * ANCLA.altoMax) continue;
        const ar = c.width / c.height;
        if (ar < ANCLA.arMin || ar > ANCLA.arMax || c.area < ANCLA.areaMin) continue;
        if (!ancla || c.area > ancla.area) ancla = c;
    }
    if (!ancla) return [];

    const candidatos = comps
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.minX > ancla.maxX
            && Math.abs(centroY(c) - centroY(ancla)) <= ancla.height * DIGITO.banda
            && c.height >= ancla.height * DIGITO.altoMin
            && c.height <= ancla.height * DIGITO.altoMax)
        .sort((a, b) => a.c.minX - b.c.minX);
    if (!candidatos.length) return [];

    // the number is the CONTIGUOUS cluster from the first one: art left in the band comes apart, so there is no
    // need to know how many digits the number has
    const salida = [candidatos[0].i];
    const primero = candidatos[0].c;
    let ultimo = primero;
    for (let k = 1; k < candidatos.length; k++) {
        if (candidatos[k].c.minX - ultimo.maxX > ancla.height * DIGITO.hueco) break;
        if (Math.abs(centroY(candidatos[k].c) - centroY(primero)) > primero.height * DIGITO.desfase) break;
        salida.push(candidatos[k].i);
        ultimo = candidatos[k].c;
    }
    return salida;
}
