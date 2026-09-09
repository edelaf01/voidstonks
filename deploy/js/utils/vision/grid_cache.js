/**
 * Is the cached grid still valid, or must it be detected again? Detecting costs a getImageData of the whole
 * frame plus the profiles, so it is done once and reused. Requiring the page to match NOTHING missed the END
 * of the list, where scrolling stops mid row, the grid falls between cells and still hits the ones that line
 * up by chance.
 */

/** Under a third of cells matched = the grid is not where we think. */
const FRACCION_MALA = 3;
/** Half or more matched = the grid is good; retrying is allowed again later. */
const FRACCION_BUENA = 2;
/** With very few active cells the percentage says nothing. */
const CELDAS_MINIMAS = 4;

/**
 * @param aciertos       cells that matched something (item or relic).
 * @param celdas         active cells of the page.
 * @param yaReintentado  whether it was already re-detected for this reason and no good page was seen since.
 * @returns {{reDetectar: boolean, yaReintentado: boolean}}
 */
export function revisaRejillaCacheada(aciertos, celdas, yaReintentado) {
    // a good page re-arms the retry: otherwise the scanner gets no second chance for the rest of the session once
    // the grid misaligns once
    if (celdas > 0 && aciertos * FRACCION_BUENA >= celdas) {
        return { reDetectar: false, yaReintentado: false };
    }
    if (!celdas || yaReintentado) return { reDetectar: false, yaReintentado };
    // without this cap it would re-detect page after page when the problem is not the grid but a page with little
    // to match (mods, resources), and detecting costs a whole frame
    const mala = celdas >= CELDAS_MINIMAS && aciertos * FRACCION_MALA < celdas;
    const vacia = aciertos === 0;
    return mala || vacia ? { reDetectar: true, yaReintentado: true } : { reDetectar: false, yaReintentado };
}
