import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

// ===========================================================================
// El escáner de inventario contra un frame REESCALADO.
//
// El stream de captura en vivo no llega a resolución nativa, así que lo que ve el
// escáner en producción es esta misma captura reducida. Reduciéndola y leyendo los 18
// nombres con Tesseract salían 17/18 en nativa y 9/18 a 1280x720, y aquí quedan fijadas
// las dos causas medidas, que son las dos de la misma familia: un umbral en píxeles
// absolutos deja de significar lo mismo cuando el frame encoge.
//
//  1) La captura tiene una 4ª fila CORTADA (se le ven badges y arte; sus nombres quedan
//     fuera del frame). A 1280x720 y 960x540 el auto-grid la contaba como fila de
//     nombres —rows=4 con 3 filas en pantalla— porque mergeGapY eran 12 px fijos: a
//     720p esos 12 px valen el doble de celda que a 1440p, fundían los badges con el
//     arte y la banda resultante bajaba lo justo para caer dentro de la tolerancia del
//     slot de la 4ª fila. Consecuencia en vivo: 6 celdas de arte escaneadas por página.
//     Lo que NO pasaba (medido antes de tocar nada): esa 4ª fila no desplazaba la
//     geometría de las tres primeras, que en todas las resoluciones cae en el mismo
//     sitio a menos de 1,3 px nativos.
//  2) El color con el que se binariza el nombre se elegía por la MODA del histograma.
//     Al reescalar, la masa del texto se reparte entre decenas de tonos de antialias
//     mientras el gris plano del interior de la card sigue en uno solo: la moda se iba
//     al gris, el recorte salía con el ARTE en negro y el nombre en hueco. Se ve en la
//     fracción de tinta, que es lo que se comprueba abajo.
// ===========================================================================

installFakeDocument();
const { detectInventoryGrid } = await import("../deploy/js/utils/vision/grid_detect.js");
const { rampCoreColor } = await import("../deploy/js/utils/vision/name_color.js");
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { leeCantidadBadge } = await import("../deploy/js/services/scanner/badge_read.service.js");

const FIXTURE = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "_fixtures/inventory_ballistica_banshee_2531x1412.png",
);
const NATIVA = decodePng(fs.readFileSync(FIXTURE));
// Filas REALES de nombres en la captura: 3. La cuarta entra recortada por abajo.
const FILAS = 3;
const CELDAS = 18;

function reescala(w, h) {
    if (w === NATIVA.width && h === NATIVA.height) return NATIVA;
    const cvs = new FakeCanvas(w, h);
    const ctx = cvs.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(NATIVA, 0, 0, NATIVA.width, NATIVA.height, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
}

const RESOLUCIONES = [[2531, 1412], [2560, 1440], [1920, 1080], [1600, 900], [1280, 720], [960, 540]];

test("la 4ª fila cortada no se cuenta como fila de nombres a ninguna resolución", () => {
    for (const [w, h] of RESOLUCIONES) {
        const res = detectInventoryGrid(reescala(w, h));
        assert.ok(res, `${w}x${h}: sin detección`);
        assert.equal(res.rows, FILAS, `${w}x${h}: ${res.rows} filas; la 4ª solo enseña badges y arte`);
        assert.equal(res.cols, 6, `${w}x${h}: ${res.cols} columnas`);
    }
});

test("la rejilla detectada cae en el mismo sitio aunque cambie la resolución", () => {
    // Normalizado al tamaño nativo, el origen y la celda tienen que coincidir: si el
    // recorte de nombre se desplazase dentro de la celda al reescalar, el OCR leería
    // arte aunque la rejilla "existiera".
    let ref = null;
    for (const [w, h] of RESOLUCIONES) {
        const res = detectInventoryGrid(reescala(w, h));
        const k = w / NATIVA.width;
        const norm = { x: res.gridZone.x / k, y: res.gridZone.y / k, cw: res.cellW / k, ch: res.cellH / k };
        if (!ref) { ref = norm; continue; }
        // 2% de la celda nativa: por debajo de eso la banda de nombre no se mueve de sitio.
        const tol = 0.02 * ref.ch;
        for (const campo of ["x", "y", "cw", "ch"]) {
            assert.ok(
                Math.abs(norm[campo] - ref[campo]) <= tol,
                `${w}x${h}: ${campo} normalizado ${norm[campo].toFixed(1)} vs ${ref[campo].toFixed(1)} (tol ${tol.toFixed(1)})`,
            );
        }
    }
});

test("la banda de nombre binarizada no se llena del arte de la card al reescalar", () => {
    // La tinta de un nombre ocupa una fracción pequeña de su banda. Cuando el color de
    // texto se elige mal, lo que se pinta de negro es el ARTE y la fracción se dispara:
    // medido celda a celda, como mucho 8,0% eligiéndolo bien contra 11,6–15,6% con la
    // moda (y ahí es donde el OCR pasaba de 18/18 a 9/18).
    const TOPE = 0.10;
    for (const [w, h] of RESOLUCIONES) {
        const img = reescala(w, h);
        const calib = detectInventoryGrid(img);
        const z = calib.gridZone;
        const tema = VisionService.detectThemeFromSnapshot(img, z.x, z.y, z.w, z.h);
        const grid = VisionService.buildAutoGrid(img, z, tema, calib);
        const { cellW, cellH, cols } = grid;
        const bandaY = Math.round(cellH * 0.50), bandaH = Math.round(cellH * 0.48);
        for (const celda of grid.cellRects) {
            if (celda.r * cols + celda.c >= CELDAS) continue;
            const cvs = VisionService.cropThemeBinarized(img, celda.sx, celda.sy + bandaY, cellW, bandaH, tema, null);
            const px = cvs.getContext("2d").getImageData(0, 0, cvs.width, cvs.height).data;
            let tinta = 0;
            for (let i = 0; i < px.length; i += 4) if (px[i] === 0) tinta++;
            const frac = tinta / (cvs.width * cvs.height);
            assert.ok(
                frac < TOPE,
                `${w}x${h} r${celda.r}c${celda.c}: ${(frac * 100).toFixed(1)}% de tinta — el recorte es arte, no un nombre`,
            );
        }
    }
});

test("el color de texto sale de la rampa de antialias, no del tono más frecuente", () => {
    // Histograma tomado de una celda real a 1920x1080 (r0c0, "Astilla Prime Receiver").
    // El naranja del nombre (248,128,0) llega repartido por su rampa desde el fondo
    // (16,24,32); el gris del interior de la card viene en un tono con más píxeles que
    // cualquiera de ellos, y por eso ganaba.
    const fondo = [16, 24, 32];
    const bins = [
        { col: [56, 56, 64], count: 1619 },   // interior de la card: una mancha, un tono
        { col: [56, 64, 64], count: 1232 },
        { col: [48, 56, 56], count: 1059 },
        { col: [232, 120, 0], count: 1118 },  // rampa del nombre, repartida
        { col: [248, 128, 0], count: 974 },
        { col: [216, 112, 0], count: 755 },
        { col: [192, 104, 8], count: 620 },
        { col: [176, 96, 8], count: 540 },
    ];
    const moda = bins.reduce((a, b) => (b.count > a.count ? b : a)).col;
    assert.deepEqual(moda, [56, 56, 64], "la moda de este histograma es el gris de la card");

    const elegido = rampCoreColor(bins, fondo);
    // Tiene que caer sobre la rampa del naranja, no sobre el gris.
    const dist = Math.hypot(elegido[0] - 248, elegido[1] - 128, elegido[2] - 0);
    assert.ok(dist <= 66, `elegido rgb(${elegido}) fuera de la bola del color del nombre (d=${dist.toFixed(0)})`);
});

// ===========================================================================
// Los BADGES de cantidad al reescalar.
//
// Mismo mecanismo que los dos de arriba, en otro sitio: el listón de parecido con la
// plantilla (MIN_IOU en utils/vision/badge_digit_ocr.js) se calibró con glifos de ~21px,
// pero el glifo encoge con el frame y su IoU con él. A 1280x720 el dígito mide ~10px y
// el MISMO "2", correctamente reconocido como "2", puntuaba 0.59-0.60 contra un listón
// de 0.60 — se descartaba un acierto. Comprobado que la binarización no era la culpable:
// volcada a 720p sale limpia y legible.
// ===========================================================================

// Cantidades contadas a mano en la captura; `null` = celda sin badge (pieza no repetida).
const CANTIDADES = [
    5, null, 3, 2, null, 4,
    4, 6, 11, 2, 2, 3,
    2, 3, 3, 5, 2, 9,
];

async function leeBadges(w, h) {
    const img = reescala(w, h);
    const calib = VisionService.detectGridAutoCalib(img, w, h);
    const zona = calib.gridZone;
    const tema = VisionService.detectThemeFromSnapshot(img, zona.x, zona.y, zona.w, zona.h);
    const auto = VisionService.buildAutoGrid(img, zona, tema, calib);
    const leidos = [];
    for (const cell of auto.cellRects) {
        const i = cell.r * auto.cols + cell.c;
        if (i >= CELDAS || CANTIDADES[i] === null) continue;
        const q = await leeCantidadBadge(img, cell, auto.cellW, auto.cellH, tema);
        leidos.push({ celda: `r${cell.r}c${cell.c}`, leido: q.raw || null, real: String(CANTIDADES[i]) });
    }
    return leidos;
}

// Acierto pleno en todas menos 1280x720. El hueco que queda es UNO de los 96 badges: un "6"
// que puntúa 5@0.760 contra 6@0.695 —no es un empate, ese glifo se parece de verdad más a un 5
// a esa resolución—. El resto de confusiones 5<->6, que eran empates de milésimas, las resuelve
// ahora decidePorDiferencia mirando solo la zona donde las dos plantillas difieren.
for (const [w, h] of [[2531, 1412], [2560, 1440], [1920, 1080], [1600, 900], [960, 540]]) {
    test(`los badges se leen todos a ${w}x${h}`, async () => {
        const fallos = (await leeBadges(w, h)).filter((r) => r.leido !== r.real);
        assert.deepEqual(fallos, []);
    });
}

test("a 1280x720 se leen al menos 15 de los 16 badges", async () => {
    const leidos = await leeBadges(1280, 720);
    const ok = leidos.filter((r) => r.leido === r.real).length;
    assert.ok(ok >= 15, `${ok}/16 — ${leidos.filter((r) => r.leido !== r.real).map((r) => `${r.celda}:"${r.leido}"≠${r.real}`).join(" ")}`);
});

test("un dígito bien reconocido no se descarta por medir menos píxeles", async () => {
    // Las tres celdas cuyo "2" puntuaba 0.60, 0.59 y 0.59 a 1280x720: reconocido como "2"
    // por la plantilla y tirado por el listón. Es la regresión concreta del listón fijo.
    const leidos = await leeBadges(1280, 720);
    for (const celda of ["r1c3", "r2c0", "r2c4"]) {
        assert.equal(leidos.find((r) => r.celda === celda)?.leido, "2", `celda ${celda}`);
    }
});

