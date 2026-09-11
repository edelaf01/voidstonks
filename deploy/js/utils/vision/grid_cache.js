// re-detects the cached grid when a page matches too few cells, at most once until a good page shows up

const FRACCION_MALA = 3;
const FRACCION_BUENA = 2;
const CELDAS_MINIMAS = 4;

export function revisaRejillaCacheada(aciertos, celdas, yaReintentado) {
    if (celdas > 0 && aciertos * FRACCION_BUENA >= celdas) {
        return { reDetectar: false, yaReintentado: false };
    }
    if (!celdas || yaReintentado) return { reDetectar: false, yaReintentado };
    // pages with little to match (mods, resources) would re-detect a whole frame every time
    const mala = celdas >= CELDAS_MINIMAS && aciertos * FRACCION_MALA < celdas;
    const vacia = aciertos === 0;
    return mala || vacia ? { reDetectar: true, yaReintentado: true } : { reDetectar: false, yaReintentado };
}
