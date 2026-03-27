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

    const refR = 215, refG = 165, refB = 95;

    const imgData = ocrCtx.getImageData(0, 0, width, height);
    const px = imgData.data;
    for (let i = 0; i < px.length; i += 4) {
        let r = px[i], g = px[i + 1], b = px[i + 2];
        const dist = Math.sqrt(Math.pow(r - refR, 2) + Math.pow(g - refG, 2) + Math.pow(b - refB, 2));

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
    const textSrcY = Math.floor(grid.cellH * 0.5);
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
    const badgeW = Math.floor(grid.cellW * 0.35);
    const badgeH = Math.floor(grid.cellH * 0.2);
    const BADGE_SCALE = 3;

    const tempCvs = document.createElement('canvas');
    tempCvs.width = badgeW; tempCvs.height = badgeH;
    const tCtx = tempCvs.getContext('2d');
    tCtx.drawImage(snapshot, cell.sx, cell.sy, badgeW, badgeH, 0, 0, badgeW, badgeH);

    const imgData = tCtx.getImageData(0, 0, badgeW, badgeH);
    const px = imgData.data;
    const samples = [];
    for (let i = 0; i < px.length; i += 8) {
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
            px[i] = px[i + 1] = px[i + 2] = 0;
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

/**
 * Aplica un umbral basado en clustering (K-means k=2) para separar texto de fondo.
 * Útil cuando no conocemos el color exacto del texto (temas personalizados).
 */
export function applyClusteringThreshold(ctx, w, h) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const px = imgData.data;
    
    // Sampler (1 de cada 8 px para velocidad en áreas grandes como el header)
    const samples = [];
    for (let i = 0; i < px.length; i += 32) {
        samples.push([px[i], px[i+1], px[i+2]]);
    }

    // Inicialización por luminancia
    let c1 = [0, 0, 0], c2 = [255, 255, 255];
    let minL = 255, maxL = 0;
    for (const s of samples) {
        let l = 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2];
        if (l < minL) { minL = l; c1 = [...s]; }
        if (l > maxL) { maxL = l; c2 = [...s]; }
    }

    // K-means (reduit iterations)
    for (let iter = 0; iter < 4; iter++) {
        let s1 = [0,0,0], s2 = [0,0,0], n1 = 0, n2 = 0;
        for (const s of samples) {
            let d1 = Math.abs(s[0]-c1[0]) + Math.abs(s[1]-c1[1]) + Math.abs(s[2]-c1[2]);
            let d2 = Math.abs(s[0]-c2[0]) + Math.abs(s[1]-c2[1]) + Math.abs(s[2]-c2[2]);
            if (d1 < d2) { s1[0]+=s[0]; s1[1]+=s[1]; s1[2]+=s[2]; n1++; }
            else { s2[0]+=s[0]; s2[1]+=s[1]; s2[2]+=s[2]; n2++; }
        }
        if (n1 > 0) { c1[0]=s1[0]/n1; c1[1]=s1[1]/n1; c1[2]=s1[2]/n1; }
        if (n2 > 0) { c2[0]=s2[0]/n2; c2[1]=s2[1]/n2; c2[2]=s2[2]/n2; }
    }

    let l1 = 0.299*c1[0] + 0.587*c1[1] + 0.114*c1[2];
    let l2 = 0.299*c2[0] + 0.587*c2[1] + 0.114*c2[2];
    
    // Heurística: El texto suele ser el más estable/puro o el de mayor luminancia.
    // En Warframe el texto suele brillar más que el fondo.
    let textC = l2 > l1 ? c2 : c1;
    let bgC = l2 > l1 ? c1 : c2;

    // Log centroids if needed
    if (globalThis.logDebug) {
        globalThis.logDebug("Cluster centroids:", JSON.stringify({text: textC, bg: bgC}));
    }

    for (let i = 0; i < px.length; i += 4) {
        let r = px[i], g = px[i+1], b = px[i+2];
        let dText = Math.abs(r - textC[0]) + Math.abs(g - textC[1]) + Math.abs(b - textC[2]);
        let dBg = Math.abs(r - bgC[0]) + Math.abs(g - bgC[1]) + Math.abs(b - bgC[2]);
        
        // El factor 1.2 ayuda a ser más selectivo con el texto
        if (dText < dBg * 1.2) {
            px[i] = px[i+1] = px[i+2] = 0;
        } else {
            px[i] = px[i+1] = px[i+2] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

/**
 * Preprocesa una celda de recompensa de forma dinámica.
 */
export function preprocessRewardCell(snapshot, x, y, w, h, scale = 2) {
    const cvs = document.createElement('canvas');
    cvs.width = w * scale;
    cvs.height = h * scale;
    const ctx = cvs.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(snapshot, x, y, w, h, 0, 0, cvs.width, cvs.height);
    
    // Aplicar clustering dinámico
    applyClusteringThreshold(ctx, cvs.width, cvs.height);
    
    return cvs;
}

/**
 * Detecta si existe un 'tick' de selección en una región.
 * En Warframe el tick suele ser una forma con alto contraste en la esquina.
 */
export function detectCheckmark(snapshot, x, y, w, h) {
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(snapshot, x, y, w, h, 0, 0, w, h);
    
    const data = ctx.getImageData(0, 0, w, h).data;
    let brightnessSum = 0;
    for (let i = 0; i < data.length; i += 4) {
        brightnessSum += (data[i] + data[i+1] + data[i+2]) / 3;
    }
    const avgBrightness = brightnessSum / (data.length / 4);
    
    // Un tick activo suele ser muy brillante comparado con el fondo oscuro de la carta.
    // También podemos buscar píxeles que se acerquen al color del tema si lo supiéramos,
    // pero el brillo es un buen proxy inicial.
    let highPoints = 0;
    for (let i = 0; i < data.length; i += 4) {
        let l = (data[i] + data[i+1] + data[i+2]) / 3;
        if (l > avgBrightness * 1.8 && l > 100) highPoints++;
    }
    
    // Si hay suficientes puntos de alta luminosidad concentrados, asumimos tick.
    return highPoints > (w * h * 0.05); 
}
