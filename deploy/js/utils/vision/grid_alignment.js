// checks grid row alignment against detected text name bands

const MIN = 0.75, MAX = 1.05;

export function filasEnFase(bandas, { gridY, cellH, rows }) {
    if (!bandas?.length || !cellH || !rows) return true;
    let enFase = 0;
    for (let k = 0; k < rows; k++) {
        const top = gridY + k * cellH;
        if (bandas.some(b => b.y1 >= top + cellH * MIN && b.y1 <= top + cellH * MAX)) enFase++;
    }
    return enFase >= Math.ceil(rows / 2);
}

export function filasPorArriba(bandas, { gridY, cellH, rows }) {
    let y = gridY, n = rows;
    const nombreEncima = (b) => b.y1 >= y - cellH * (1 - MIN) && b.y1 <= y + cellH * (MAX - 1) && b.y0 >= y - cellH * 1.15;
    while (bandas?.length && cellH > 0 && rows > 0 && y - cellH >= -cellH * 0.15 && bandas.some(nombreEncima)) {
        y -= cellH;
        n++;
    }
    return { gridY: y, rows: n };
}

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
        // game HUD lines measure <=0.054 cellH with <=2.4% mass, real row >=0.154 cellH
        const banda = bandas.find(b => b.y1 >= top + cellH * MIN && b.y1 <= top + cellH * MAX
            && b.y1 - b.y0 >= cellH * 0.06 && b.mass >= masaMax * 0.03 && bloques(b).some(enColumna));
        if (!banda) break;
        n++;
    }
    return n;
}
