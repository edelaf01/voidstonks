/** Grid rows against the name bands of grid_detect.js. */

// cell band where a name baseline falls (median 0.919, rows cut at the bottom drop to 0.625)
const MIN = 0.75, MAX = 1.05;

/**
 * Does each row fall on a name? Half a cell off crops art instead of text and the page comes out unreadable.
 * Half of them is enough: an empty row has no band.
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
 * Rows counting the one peeking at the end of the list with one or two items: its band weighs ~4% of a full
 * row's and the detector mass filter drops it. Art, the side panel and the game HUD fall in that strip too,
 * hence what is required below.
 *
 * @param bandas   bands NOT filtered by mass, [{ y0, y1, mass }].
 * @param bloques  (band) => [{ x0, x1 }].
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
        // HUD lines measure ≤0.054·cellH with ≤2.4% of the strongest band, and a real row ≥0.154·cellH with ≥4%
        const banda = bandas.find(b => b.y1 >= top + cellH * MIN && b.y1 <= top + cellH * MAX
            && b.y1 - b.y0 >= cellH * 0.06 && b.mass >= masaMax * 0.03 && bloques(b).some(enColumna));
        if (!banda) break;
        n++;
    }
    return n;
}
