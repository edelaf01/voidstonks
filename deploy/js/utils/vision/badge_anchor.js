/**
 * Selección de los dígitos del badge de cantidad ANCLANDO en el checkmark.
 *
 * Sustituye a la cascada de filtros por brillo, forma y banda, que decidía qué componente del
 * recorte binarizado era un dígito por sus propiedades AISLADAS. Esa cascada era inestable:
 * medido, la misma captura a 2531x1412 y reescalada a 2560x1440 —un 1,1% de diferencia,
 * binarizaciones idénticas a simple vista— se quedaba con los dos "1" del badge en un caso y
 * con un borrón de arte en el otro.
 *
 * El checkmark es un ancla mucho más firme que cualquier umbral: está en las 96 celdas medidas
 * de seis resoluciones distintas, mide siempre ~0,34 de la ventana de búsqueda, y los dígitos
 * son exactamente lo que hay a su derecha en su misma banda. Anclando así, 86/96 -> 92/96,
 * con las cuatro resoluciones de 1600x900 para arriba a pleno.
 */

// El checkmark es CUADRADO (círculo con el check dentro) y vive en el tercio izquierdo.
const ANCLA = { xMax: 0.35, altoMin: 0.25, altoMax: 0.50, arMin: 0.80, arMax: 1.25, areaMin: 8 };

// Un dígito comparte centro vertical con el checkmark y mide entre el 40% y el 125% de su alto.
// La banda de 0,45 no es cosmética: a 0,55 se cuela un bloque de arte del plano y "5" se lee
// "58" a 1920x1080 y a 1280x720.
const DIGITO = { banda: 0.45, altoMin: 0.40, altoMax: 1.25, hueco: 0.60 };

/**
 * @param comps [{ minX, maxX, minY, maxY, width, height, area }] del recorte binarizado.
 * @returns índices de los componentes que son el NÚMERO, en orden de izquierda a derecha,
 *          o [] si no hay checkmark o no hay nada a su derecha.
 */
export function digitosPorAncla(comps, ventanaW, ventanaH) {
    const centroY = (c) => (c.minY + c.maxY) / 2;

    // De MAYOR área, no el más a la izquierda: a baja resolución el arte deja motas cuadradas
    // antes que el checkmark y quedarse con la primera perdía el ancla.
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

    // El número es el racimo CONTIGUO desde el primero: el arte que quede en la banda va
    // separado, y así no hace falta saber de cuántas cifras es el número.
    const salida = [candidatos[0].i];
    let ultimo = candidatos[0].c;
    for (let k = 1; k < candidatos.length; k++) {
        if (candidatos[k].c.minX - ultimo.maxX > ancla.height * DIGITO.hueco) break;
        salida.push(candidatos[k].i);
        ultimo = candidatos[k].c;
    }
    return salida;
}
