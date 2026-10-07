// picks the digits of the quantity badge anchored on the checkmark

const ANCLA = { xMax: 0.35, altoMin: 0.25, altoMax: 0.50, arMin: 0.80, arMax: 1.25, areaMin: 8 };

// the 0.45 band is not cosmetic: at 0.55 background art gets in and "5" reads "58"
const DIGITO = { banda: 0.45, altoMin: 0.40, altoMax: 1.25, hueco: 0.60, desfase: 0.25 };

export function digitosPorAncla(comps, ventanaW, ventanaH) {
    const centroY = (c) => (c.minY + c.maxY) / 2;

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
