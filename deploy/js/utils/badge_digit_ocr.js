/**
 * Lectura del BADGE de cantidad (esquina sup-izq de cada celda del inventario)
 * por TEMPLATE-MATCHING de dígitos, en vez de Tesseract.
 *
 * Motivo: Tesseract falla sistemáticamente en dígitos AISLADOS sin línea base
 * (4, 8, 9 sueltos) porque el glifo es minúsculo (~15px) y el PSM no ayuda —
 * un prototipo offline validado sobre capturas reales dio 33/35 aciertos vs
 * 30/35 de Tesseract, acertando justo esos casos.
 *
 * Lógica 100% pura sobre un objeto tipo ImageData ({ data, width, height },
 * RGBA, dígitos en NEGRO puro sobre blanco — la salida de
 * VisionService.extractBadgeByColor ya viene así): sin DOM ni canvas, para
 * poder testearla offline en Node (igual que grid_detect.js).
 *
 * Formato de plantilla: cada dígito 0-9 es un bitmap binario NW×NH (24×32),
 * 1 = píxel de dígito. Se guarda empaquetado a 1 bit/píxel (768 bits = 96
 * bytes) como string hex de 192 chars, MSB-first, orden row-major — así el
 * archivo queda compacto y legible (10 líneas cortas) en vez de 10 strings
 * de 768 caracteres.
 */

export const NW = 24; // ancho normalizado del glifo
export const NH = 32; // alto normalizado del glifo

// Plantillas cosechadas de capturas reales (ver scripts-actu/harvest_badge_templates.mjs):
// dígitos 0,2,3,4,5,6,8,9 de "Captura de pantalla_20260714_214630.png" y
// "...215138.png" (celdas donde el nº de componentes segmentados == longitud
// de la verdad de terreno); dígito 1 viene del "10"/"19" de 215138; dígito 7
// de "...215114.png" r1c4 (Chroma Prime Blueprint = 7, verificado visualmente).
const PACKED_TEMPLATES = {
    "0": "001c00003e0003ffe007fff00ffff83ffffe3ffffe3f007eff007ffe003ffc001ffc001ffc001ffc001ffc001ffc001ffc001ffc001ffc001ffc001ffc001ffc001ffc001ffc001ffc001f3f007e3f80fe3fc1fe0ffffe0ffffc0ffff801ffc0",
    "1": "07fffe1fffff7fffffffffffffffff3fffff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff0001ff",
    "2": "000400000e0003ffe007fffc0ffffe3ffbfe3ff3ff3f007fff001ffe001f7c001f3c001f18001f00003e00007e0001f80003f00003f0000ff0000fe0001f80003f00007e0000fc0001f80007e0000fc0000fc0003fffff7fffffffffffffffff",
    "3": "001c00003e0003ffe007fffc0ffffe3ffffe7fffffff007ffc001ffc001f7c001f00001f00007f003ffe007ffe007ff0007ff8007ff80003fe0001fe00007f00001f10001f78001ffc001fff007f7f80ff3fc1fe3ffffe1ffffc0ffff801fff0",
    "4": "0001c00003c00007e00007f00007f0001ff0001ff0003ff0003ff0007ff000fff000fff001fbf003f3f007e3f007e3f00fc3f00f83f00f83f03f03f07e03f0fc03f0ffffffffffffffffffffffff7fffff0003f00003f00003f00003f00003f0",
    "5": "07fff00ffff81ffffc3ffffe3ffffe3f00003f00003f00003f00003f00003e00003e00007fffe0fffff0fffff8fffffefffffefe01fe3800fe1000fe00007f00003f00003f7c007ffe00fefe00feff01feff01fe3ffff83ffff81ffff003ff80",
    "6": "000e00001f0003fff007fffc0ffffe3ffff83ffff03f0000ff0000ff0000fe0000fe0000fe0600fffff0fffff8fffffeffffffff00fffe003ffe003ffe003ffe003ffe003ffe003ffe003fff003f7fc07f3fc0ff3ffffe1ffffc0ffff003ffe0",
    "7": "7ffffcfffffeffffffffffffffffff00007f00007f00007e0001f80003f00003f00003f0000fe0000f80000f00003f00003e00003e00007e00007e00007e00007e0000fc0001f80001f80001f80001f80001f80001f80001f80001f80001f800",
    "8": "00100000380003ff8007ffe00ffff03feff83feff83f01f83f007e3f007e3f00fc3f01f83f81f81ffff80ffff807fff00ffff00ffff03fe3f87fc1fcff007efc007efc003ffc003ffc007ffc007eff00feff01fe3ffffe1ffffc0ffff807ffc0",
    "9": "00100000380003ff8007fff00ffff83ffff87ffffcff01fefc007efc007efc007ffc001ffc001ffc001ffc001fff007f7f80ff3fc1ff3fffff1fffff0fffff01ff1f00fe7f00007f00007e00007e0000fe0001fe0ffff81ffff01fffe00fffc0",
};

function unpackTemplate(hex) {
    const bmp = new Uint8Array(NW * NH);
    for (let i = 0; i < NW * NH; i++) {
        const byte = Number.parseInt(hex.substr((i >> 3) * 2, 2), 16);
        bmp[i] = (byte >> (7 - (i & 7))) & 1;
    }
    return bmp;
}

export const DIGIT_TEMPLATES = Object.fromEntries(
    Object.entries(PACKED_TEMPLATES).map(([digit, hex]) => [digit, unpackTemplate(hex)]),
);

// IoU entre dos bitmaps NW×NH (Uint8Array de 0/1, mismo tamaño).
export function iou(a, b) {
    let inter = 0, union = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] && b[i]) inter++;
        if (a[i] || b[i]) union++;
    }
    return union ? inter / union : 0;
}

/**
 * Segmenta un canvasLike ({ width, height, data } RGBA, dígitos negros sobre
 * blanco) en componentes-dígito normalizados a NW×NH, de izquierda a derecha.
 * Componentes conexos 8-conn sobre píxeles negros puros (canal R === 0).
 * Filtra ruido: un dígito real ocupa >= 40% del alto del canvas y tiene área
 * >= 15px (descarta motas de antialiasing/arte residual).
 */
export function segmentDigits(canvasLike) {
    if (!canvasLike) return [];
    const W = canvasLike.width, H = canvasLike.height, px = canvasLike.data;
    if (!W || !H) return [];
    const isBlack = (i) => px[i * 4] === 0;
    const lab = new Int32Array(W * H).fill(-1);
    const comps = [];
    for (let s = 0; s < W * H; s++) {
        if (!isBlack(s) || lab[s] !== -1) continue;
        const id = comps.length;
        const queue = [s];
        lab[s] = id;
        let qi = 0, minX = W, maxX = 0, minY = H, maxY = 0, area = 0;
        while (qi < queue.length) {
            const cur = queue[qi++];
            const cx = cur % W, cy = (cur - cx) / W;
            minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
            minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
            area++;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    const nx = cx + dx, ny = cy + dy;
                    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
                    const n = ny * W + nx;
                    if (isBlack(n) && lab[n] === -1) { lab[n] = id; queue.push(n); }
                }
            }
        }
        comps.push({ minX, maxX, minY, maxY, area });
    }
    const digitComps = comps
        .filter((c) => (c.maxY - c.minY + 1) >= H * 0.4 && c.area >= 15)
        .sort((a, b) => a.minX - b.minX);
    return digitComps.map((c) => {
        const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
        const bmp = new Uint8Array(NW * NH);
        for (let y = 0; y < NH; y++) {
            for (let x = 0; x < NW; x++) {
                const sx = c.minX + Math.floor((x * bw) / NW);
                const sy = c.minY + Math.floor((y * bh) / NH);
                bmp[y * NW + x] = isBlack(sy * W + sx) ? 1 : 0;
            }
        }
        return { bmp, minX: c.minX, maxX: c.maxX };
    });
}

// Umbral mínimo de IoU contra la mejor plantilla para aceptar un componente como
// dígito. Medido sobre capturas reales: el checkmark ✓ (círculo con check, junto al
// dígito) puntúa ~0.48-0.49 contra "9", el icono de fundición y el arte también bajo;
// los dígitos REALES puntúan ≥0.77. 0.6 cae en ese hueco con margen a ambos lados.
const MIN_IOU = 0.6;

/**
 * Lee la cadena de dígitos de un badge por template-matching. Los componentes que no
 * se parecen a NINGÚN dígito (checkmark, icono de fundición, arte del ítem que se cuela
 * en el crop) se DESCARTAN individualmente —no invalidan el resto—: p.ej. "✓ 3" leería
 * el círculo como 9 a 0.48 → se descarta y queda "3", no "93". Devuelve "" si tras
 * descartar no queda ningún dígito.
 */
export function readBadgeDigits(canvasLike) {
    // 1) Acepta como dígito los componentes con IoU suficiente, guardando su X.
    const digits = [];
    for (const comp of segmentDigits(canvasLike)) {
        let best = "", bestScore = -1;
        for (const [digit, tmpl] of Object.entries(DIGIT_TEMPLATES)) {
            const score = iou(comp.bmp, tmpl);
            if (score > bestScore) { bestScore = score; best = digit; }
        }
        if (bestScore < MIN_IOU) continue; // no es un dígito: checkmark/fundición/arte
        digits.push({ d: best, minX: comp.minX, maxX: comp.maxX });
    }
    if (!digits.length) return "";
    // 2) El badge es el RACIMO IZQUIERDO de dígitos (pegado al checkmark). Con el crop
    // ancho (para capturar el 2º dígito de "27") entra también el fondo de ESQUEMA de los
    // PLANOS: trazos verticales que matchean "1". Van separados del número por un hueco, así
    // que nos quedamos con los dígitos contiguos desde el primero y cortamos en el 1er hueco
    // grande (> 1.4× ancho medio de dígito). Un número real ("27") tiene huecos pequeños.
    const widths = digits.map(g => g.maxX - g.minX + 1);
    const avgW = widths.reduce((a, b) => a + b, 0) / widths.length;
    let out = digits[0].d;
    for (let k = 1; k < digits.length; k++) {
        if (digits[k].minX - digits[k - 1].maxX > avgW * 1.4) break;
        out += digits[k].d;
    }
    return out;
}
