/** Filas de la rejilla contra las bandas de nombre de grid_detect.js. */

// Franja de la celda donde cae la baseline de un nombre. Corpus de 40 capturas: mediana 0,919,
// todas entre 0,907 y 0,98; las filas cortadas por abajo caen a 0,625.
const MIN = 0.75, MAX = 1.05;

/**
 * ¿Cae cada fila sobre un nombre? Media celda de desfase recorta arte en vez de texto y la página
 * sale ilegible, y eso solo se veía tras el OCR. Basta la mitad: una fila vacía no tiene banda.
 */
export function filasEnFase(bandas, { gridY, cellH, rows }) {
    if (!bandas?.length || !cellH || !rows) return true;
    let enFase = 0;
    for (let k = 0; k < rows; k++) {
        const top = gridY + k * cellH;
        if (bandas.some(b => b.y1 >= top + cellH * MIN && b.y1 <= top + cellH * MAX)) enFase++;
    }
    return enFase >= Math.ceil(rows / 2);
}

/**
 * Filas contando la que asoma al final de la lista con uno o dos ítems: su banda pesa un 4% de la
 * de una fila llena y el filtro de masa del detector la tira. En esa franja caen también el arte,
 * el panel lateral y el HUD del juego, de ahí lo que se exige abajo.
 *
 * @param bandas   bandas SIN filtrar por masa, [{ y0, y1, mass }].
 * @param bloques  (banda) => [{ x0, x1 }].
 */
export function filasConNombre(bandas, { gridX, gridY, cellW, cellH, cols, rows, height, bloques }) {
    if (!bandas?.length || !cellW || !cellH) return rows;
    const masaMax = Math.max(...bandas.map(b => b.mass || 0));
    const enColumna = (bl) => {
        const ancho = bl.x1 - bl.x0, cx = (bl.x0 + bl.x1) / 2;
        if (ancho > cellW * 0.95 || bl.x0 < gridX) return false;
        const col = Math.round((cx - gridX - cellW / 2) / cellW);
        return col >= 0 && col < cols && Math.abs(cx - (gridX + (col + 0.5) * cellW)) <= cellW * 0.25;
    };
    let n = rows;
    while (gridY + n * cellH + cellH * MAX <= height) {
        const top = gridY + n * cellH;
        // Medido sobre 101 frames: las rayas del HUD miden ≤0,054·cellH con ≤2,4% de la banda más
        // fuerte, y una fila de verdad ≥0,154·cellH con ≥4%.
        const banda = bandas.find(b => b.y1 >= top + cellH * MIN && b.y1 <= top + cellH * MAX
            && b.y1 - b.y0 >= cellH * 0.06 && b.mass >= masaMax * 0.03 && bloques(b).some(enColumna));
        if (!banda) break;
        n++;
    }
    return n;
}
