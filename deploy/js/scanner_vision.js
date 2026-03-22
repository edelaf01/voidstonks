export function getFrameHash(ctx, w, h) {
    const data = ctx.getImageData(0, 0, w, h).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += Math.floor(data.length / 64)) {
        hash += data[i];
    }
    return hash;
}

export function createFilteredOcrCanvas(snapshot, width, height, grid, cellRects) {
    const ocrCanvas = document.createElement("canvas");
    ocrCanvas.width = width; ocrCanvas.height = height;
    const ocrCtx = ocrCanvas.getContext("2d");
    ocrCtx.drawImage(snapshot, 0, 0);

    // Se elimina el muestreo dinámico ya que capturaba los píxeles grises/blancos de los modelos 3D 
    // de las armas, lo que destrozaba el color de referencia 'refR' promediándolo a un gris oscuro, 
    // haciendo que el filtro de distancia borrara el texto dorado real dejándole la pantalla en blanco
    // al OCR para leer la chatarra 3D restante. Volvemos al dorado universal estático.
    const refR = 215, refG = 165, refB = 95;

    const imgData = ocrCtx.getImageData(0, 0, width, height);
    const px = imgData.data;
    for (let i = 0; i < px.length; i += 4) {
        let r = px[i], g = px[i + 1], b = px[i + 2];
        const dist = Math.sqrt(Math.pow(r - refR, 2) + Math.pow(g - refG, 2) + Math.pow(b - refB, 2));

        // ONLY Euclidean distance to Gold. Eliminamos el fallback de luminancia (lum > 175)
        // porque si el modelo 3D del fondo es blanco o plateado brillante, se convertía en
        // un manchón negro gigante que se fusionaba con el texto destrozando la lectura.
        if (dist < 90) {
            px[i] = px[i + 1] = px[i + 2] = 0; // Texto -> Negro
        } else {
            px[i] = px[i + 1] = px[i + 2] = 255; // Fondo -> Blanco
        }
    }
    ocrCtx.putImageData(imgData, 0, 0);
    return ocrCanvas;
}

export function createTextCanvas(ocrCanvas, cell, grid) {
    const TEXT_SCALE = 3;
    const textSrcY = Math.floor(grid.cellH * 0.50);
    const textSrcH = grid.cellH - textSrcY;
    const textCvs = document.createElement('canvas');
    textCvs.width = grid.cellW * TEXT_SCALE;
    textCvs.height = textSrcH * TEXT_SCALE;
    const tCtx = textCvs.getContext('2d');
    tCtx.imageSmoothingEnabled = false;
    tCtx.drawImage(ocrCanvas, cell.sx, cell.sy + textSrcY, grid.cellW, textSrcH, 0, 0, textCvs.width, textCvs.height);
    return textCvs;
}

export function createBadgeCanvas(snapshot, cell, grid) {
    const badgeW = Math.floor(grid.cellW * 0.40);
    const badgeH = Math.floor(grid.cellH * 0.22);
    const BADGE_SCALE = 3;

    const tempCvs = document.createElement('canvas');
    tempCvs.width = badgeW; tempCvs.height = badgeH;
    const tCtx = tempCvs.getContext('2d');
    tCtx.drawImage(snapshot, cell.sx, cell.sy, badgeW, badgeH, 0, 0, badgeW, badgeH);

    // Extracción K-Means local exclusiva para la cantidad.
    // Descubre matemáticamente el color del texto (número) y el fondo (interfaz)
    // sin asumir que es blanco puro, adaptándose a filtros o brillos del juego.
    const imgData = tCtx.getImageData(0, 0, badgeW, badgeH);
    const px = imgData.data;
    const samples = [];
    for (let i = 0; i < px.length; i += 8) { // Muestrear la mitad para 100% precisión
        samples.push([px[i], px[i + 1], px[i + 2]]);
    }

    let minLum = 255, maxLum = 0;
    let c1 = [0, 0, 0], c2 = [255, 255, 255];
    for (let s of samples) {
        let lum = 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2];
        if (lum < minLum) { minLum = lum; c1 = [...s]; }
        if (lum > maxLum) { maxLum = lum; c2 = [...s]; }
    }

    for (let iter = 0; iter < 5; iter++) {
        let sum1 = [0, 0, 0], sum2 = [0, 0, 0], count1 = 0, count2 = 0;
        for (let s of samples) {
            let d1 = Math.abs(s[0] - c1[0]) + Math.abs(s[1] - c1[1]) + Math.abs(s[2] - c1[2]);
            let d2 = Math.abs(s[0] - c2[0]) + Math.abs(s[1] - c2[1]) + Math.abs(s[2] - c2[2]);
            if (d1 < d2) { sum1[0] += s[0]; sum1[1] += s[1]; sum1[2] += s[2]; count1++; }
            else { sum2[0] += s[0]; sum2[1] += s[1]; sum2[2] += s[2]; count2++; }
        }
        if (count1 > 0) { c1[0] = sum1[0] / count1; c1[1] = sum1[1] / count1; c1[2] = sum1[2] / count1; }
        if (count2 > 0) { c2[0] = sum2[0] / count2; c2[1] = sum2[1] / count2; c2[2] = sum2[2] / count2; }
    }

    let lum1 = 0.299 * c1[0] + 0.587 * c1[1] + 0.114 * c1[2];
    let lum2 = 0.299 * c2[0] + 0.587 * c2[1] + 0.114 * c2[2];
    let textCentroid = lum2 > lum1 ? c2 : c1;
    let bgCentroid = lum2 > lum1 ? c1 : c2;

    for (let i = 0; i < px.length; i += 4) {
        let r = px[i], g = px[i + 1], b = px[i + 2];
        let dText = Math.abs(r - textCentroid[0]) + Math.abs(g - textCentroid[1]) + Math.abs(b - textCentroid[2]);
        let dBg = Math.abs(r - bgCentroid[0]) + Math.abs(g - bgCentroid[1]) + Math.abs(b - bgCentroid[2]);

        if (dText < dBg * 1.5) {
            px[i] = px[i + 1] = px[i + 2] = 0; // Se parece al texto encontrado -> Negro para OCR
        } else {
            px[i] = px[i + 1] = px[i + 2] = 255;
        }
    }
    tCtx.putImageData(imgData, 0, 0);

    const badgeCvs = document.createElement('canvas');
    badgeCvs.width = badgeW * BADGE_SCALE;
    badgeCvs.height = badgeH * BADGE_SCALE;
    const bCtx = badgeCvs.getContext('2d');
    bCtx.imageSmoothingEnabled = false;
    bCtx.drawImage(tempCvs, 0, 0, badgeW, badgeH, 0, 0, badgeCvs.width, badgeCvs.height);
    return badgeCvs;
}
