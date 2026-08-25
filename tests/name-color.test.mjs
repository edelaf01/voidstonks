import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

// ===========================================================================
// Elección del color de texto de los nombres (services/name_color.service.js).
//
// La fixture son 3 celdas reales de la pestaña RELIQUIAS, donde el arte marrón y
// el nombre naranja ocupan casi los mismos píxeles de la banda de nombre. Con el
// frame tal cual gana el nombre; basta el reescalado del stream de vídeo (que
// difumina los trazos finos y no toca la mancha de arte) para que gane el arte —
// y no en todas las celdas a la vez, que es lo que hacía que el escáner leyera
// distinto en cada pasada sobre el mismo inventario.
//
// Lo que se fija aquí: pase lo que pase con el orden, el color del nombre SIGUE
// estando entre los candidatos, y usarlo para toda la página deja las celdas
// legibles. El resto (cuál de los candidatos es) lo decide el OCR contra el
// catálogo, que no se puede ejercitar sin worker.
// ===========================================================================

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { bandInkHistogram, rankPageNameColors } = await import("../deploy/js/utils/vision/name_color.js");
const { electPageNameColor } = await import("../deploy/js/services/scanner/name_color.service.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");

const FIXTURE = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "_fixtures/relic_cells_3x277x296.png",
);
const CELL_W = 277, CELL_H = 296, CELLS = 3;
// Color del nombre en esta captura (tema naranja). Es el dato observado, no un
// parámetro que ajustar: si el aislado deja de encontrarlo, el escáner no lee.
const NAME_COLOR = [248, 128, 0];
const TEXT_SRC_Y = Math.round(CELL_H * 0.50);
const TEXT_SRC_H = Math.round(CELL_H * 0.48);
const THEME = { name: "Default", r: 227, g: 128, b: 20 };

function loadCanvas({ scale = 1 } = {}) {
    const img = decodePng(fs.readFileSync(FIXTURE));
    const cvs = new FakeCanvas();
    cvs.width = Math.round(img.width * scale);
    cvs.height = Math.round(img.height * scale);
    cvs.getContext("2d").drawImage(img, 0, 0, cvs.width, cvs.height);
    return cvs;
}

/** Filas del recorte binarizado que llevan tinta, en % del alto. */
function inkRowFraction(cvs) {
    const d = cvs.getContext("2d").getImageData(0, 0, cvs.width, cvs.height).data;
    let rows = 0;
    for (let y = 0; y < cvs.height; y++) {
        for (let x = 0; x < cvs.width; x++) {
            if (d[(y * cvs.width + x) * 4] === 0) { rows++; break; }
        }
    }
    return rows / cvs.height;
}

function isNameColor(col) {
    const dr = col[0] - NAME_COLOR[0], dg = col[1] - NAME_COLOR[1], db = col[2] - NAME_COLOR[2];
    return dr * dr + dg * dg + db * db < 66 * 66;
}

// El reescalado del stream: la captura llega a una resolución ligeramente distinta
// de la del juego. Es suficiente para invertir el empate arte/nombre.
for (const [label, opts] of [["frame nativo", {}], ["frame reescalado", { scale: 2560 / 2547 }]]) {
    const cellW = Math.round(CELL_W * (opts.scale || 1));
    const cellH = Math.round(CELL_H * (opts.scale || 1));
    const ty = Math.round(cellH * 0.50), th = Math.round(cellH * 0.48);

    test(`name color: el color del nombre está entre los candidatos (${label})`, () => {
        const cvs = loadCanvas(opts);
        const celdas = Array.from({ length: CELLS }, (_, c) => ({ sx: c * cellW, sy: 0 }));
        const cands = VisionService.pageNameColorCandidates(cvs, celdas, cellW, ty, th);
        assert.ok(
            cands.some(isNameColor),
            `${JSON.stringify(cands)} no incluye el color del nombre`,
        );
    });

    test(`name color: con el color de página todas las celdas quedan legibles (${label})`, () => {
        const cvs = loadCanvas(opts);
        for (let c = 0; c < CELLS; c++) {
            const crop = VisionService.cropThemeBinarized(cvs, c * cellW, ty, cellW, th, THEME, NAME_COLOR);
            const frac = inkRowFraction(crop);
            // Un nombre de una línea ocupa ~1/6 del recorte. Si sale el arte, la
            // tinta llena casi todas las filas y Tesseract devuelve basura.
            assert.ok(frac > 0 && frac < 0.35, `celda ${c}: ${(frac * 100).toFixed(0)}% de filas con tinta`);
        }
    });
}

// El recorte binarizado sale de un anillo de canvas reciclados (vision.service): sin él
// el escáner acumulaba ~1,4 MB por celda y llegaba a cientos de MB. El anillo solo es
// seguro si nadie retiene un recorte más allá de su iteración; estos dos tests fijan el
// invariante, porque si se rompe el fallo es mudo (una celda con la imagen de otra).
test("crop ring: recortes seguidos NO comparten canvas dentro del anillo", () => {
    const cvs = loadCanvas();
    const seen = new Set();
    for (let i = 0; i < 4; i++) {
        seen.add(VisionService.cropThemeBinarized(cvs, 0, TEXT_SRC_Y, CELL_W, TEXT_SRC_H, THEME, NAME_COLOR));
    }
    assert.equal(seen.size, 4, "4 recortes vivos a la vez deberían ser 4 canvas distintos");
});

test("crop ring: el anillo se recicla en vez de crecer sin fin", () => {
    const cvs = loadCanvas();
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
        seen.add(VisionService.cropThemeBinarized(cvs, 0, TEXT_SRC_Y, CELL_W, TEXT_SRC_H, THEME, NAME_COLOR));
    }
    assert.ok(seen.size <= 6, `30 recortes deberían reusar como mucho 6 canvas, usaron ${seen.size}`);
});

test("name color: sin worker de OCR no se inventa un color", async () => {
    assert.equal(await electPageNameColor(null, null, [], 0, 0, 0, null), null);
});

test("name color: los candidatos no repiten tono y respetan el máximo", () => {
    const cvs = loadCanvas();
    const px = cvs.getContext("2d").getImageData(0, TEXT_SRC_Y, CELL_W, TEXT_SRC_H);
    const cands = rankPageNameColors([bandInkHistogram(px)], 3);
    assert.ok(cands.length > 0 && cands.length <= 3);
    for (let i = 0; i < cands.length; i++) {
        for (let j = i + 1; j < cands.length; j++) {
            const dr = cands[i][0] - cands[j][0], dg = cands[i][1] - cands[j][1], db = cands[i][2] - cands[j][2];
            assert.ok(dr * dr + dg * dg + db * db >= 66 * 66, `candidatos repetidos: ${cands[i]} y ${cands[j]}`);
        }
    }
});

test("name color: sin color de página el reescalado rompe alguna celda", () => {
    const scale = 2560 / 2547;
    const cellW = Math.round(CELL_W * scale), cellH = Math.round(CELL_H * scale);
    const ty = Math.round(cellH * 0.50), th = Math.round(cellH * 0.48);
    const cvs = loadCanvas({ scale });
    const fracs = [];
    for (let c = 0; c < CELLS; c++) {
        fracs.push(inkRowFraction(
            VisionService.cropThemeBinarized(cvs, c * cellW, ty, cellW, th, THEME, null),
        ));
    }
    // Este test documenta el fallo que motiva el módulo: midiendo por celda, alguna
    // binariza el arte. Si algún día deja de pasar, el fallo se arregló en otro sitio
    // y este test sobra — no hay que relajarlo, hay que borrarlo.
    assert.ok(
        fracs.some(f => f > 0.8),
        `midiendo por celda ninguna falló (${fracs.map(f => (f * 100).toFixed(0) + "%").join(", ")})`,
    );
});

// ===========================================================================
// Voto de color entre celdas (utils/vision/name_color.js). Son los dos criterios
// que sustituyen al "el color más frecuente de la primera celda que mires".
// ===========================================================================

test("voto de página: gana el color que sale en TODAS las celdas, no el que más píxeles tiene", () => {
    // El arte de un ítem puede tener más píxeles que su nombre, pero solo está en su celda.
    const nombre = [248, 128, 0];
    const arte = [20, 200, 40];
    const ranking = rankPageNameColors([
        [{ col: arte, count: 9000 }, { col: nombre, count: 500 }],
        [{ col: nombre, count: 500 }],
        [{ col: nombre, count: 500 }],
    ]);
    assert.deepEqual(ranking[0], nombre);
});

test("voto de página: dentro del grupo se devuelve el núcleo del trazo, no el borde", () => {
    // Binarizar por el borde suavizado deja el núcleo fuera de la tolerancia y salen
    // letras huecas: el OCR las lee a medias. Aunque el borde tenga más píxeles, el
    // color que hay que devolver es el brillante.
    const borde = [200, 104, 8], nucleo = [248, 128, 0];
    const ranking = rankPageNameColors([
        [{ col: borde, count: 900 }, { col: nucleo, count: 600 }],
        [{ col: borde, count: 900 }, { col: nucleo, count: 600 }],
    ]);
    assert.deepEqual(ranking[0], nucleo);
});

// ===========================================================================
// Aislado de letras por FORMA (cropThemeBinarized). El filtro borra los
// componentes que no son texto; el bug era que el listón de "es texto" estaba
// por encima de la altura de una letra, así que solo lo pasaba un trazo que
// puenteara dos líneas — y entonces borraba el nombre entero.
// ===========================================================================

/** Banda de nombre sintética: dos líneas de "letras" y, opcional, un trazo que las une. */
function bandaSintetica({ puente }) {
    const W = 277, H = 142;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = 8; data[i + 1] = 16; data[i + 2] = 32; data[i + 3] = 255;
    }
    const pinta = (x0, x1, y0, y1) => {
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const i = (y * W + x) * 4;
                data[i] = 248; data[i + 1] = 128; data[i + 2] = 0;
            }
        }
    };
    const LETRAS_X = [30, 45, 60, 75, 90];
    const LINEAS = [[46, 68], [78, 100]]; // separadas como las dos líneas reales de un nombre
    for (const [y0, y1] of LINEAS) for (const x of LETRAS_X) pinta(x, x + 5, y0, y1);
    // El puente va lejos en X de las letras: si el filtro lo toma por el único "texto",
    // las letras no se salvan por la regla de "pegado en X" y desaparecen.
    if (puente) pinta(150, 155, LINEAS[0][0], LINEAS[1][1]);
    return { data, width: W, height: H, LETRAS_X, LINEAS };
}

/** ¿Queda tinta en el rectángulo (coordenadas de la banda, el recorte va a 3x)? */
function hayTinta(mask, x0, x1, y0, y1) {
    const S = 3;
    const d = mask.getContext("2d").getImageData(0, 0, mask.width, mask.height).data;
    for (let y = y0 * S; y <= y1 * S; y++) {
        for (let x = x0 * S; x <= x1 * S; x++) {
            if (d[(y * mask.width + x) * 4] === 0) return true;
        }
    }
    return false;
}

for (const puente of [false, true]) {
    test(`aislado por forma: las letras sobreviven ${puente ? "con" : "sin"} un trazo que une las dos líneas`, () => {
        const banda = bandaSintetica({ puente });
        const mask = VisionService.cropThemeBinarized(banda, 0, 0, banda.width, banda.height, THEME, NAME_COLOR);
        for (const [y0, y1] of banda.LINEAS) {
            for (const x of banda.LETRAS_X) {
                assert.ok(
                    hayTinta(mask, x + 1, x + 4, y0 + 2, y1 - 2),
                    `se borró la letra en x=${x}, línea ${y0}-${y1}`,
                );
            }
        }
    });
}

// ===========================================================================
// Confirmación del color de página (services/scanner/name_color.service.js).
// El color se cachea para toda la SESIÓN, así que darlo por bueno con UNA lectura
// afortunada envenenaba todas las páginas siguientes.
// ===========================================================================

test("elección de color: una sola lectura buena no basta para quedarse con un color", async () => {
    const FLOJO = [10, 20, 30], BUENO = [248, 128, 0];
    const original = {
        cands: VisionService.pageNameColorCandidates,
        crop: VisionService.cropThemeBinarized,
        text: OCRService.extractCellText,
        item: OCRService.getValidItemMatch,
        relic: OCRService.getRelicMatch,
    };
    try {
        VisionService.pageNameColorCandidates = () => [FLOJO, BUENO];
        VisionService.cropThemeBinarized = (...args) => ({ col: args[6] });
        // FLOJO acierta en la primera celda y falla en el resto: es el patrón del color
        // que solo pilla el borde de las letras.
        let vistas = 0;
        OCRService.extractCellText = async (_w, cvs) =>
            (cvs.col === FLOJO ? (vistas++ === 0 ? ["ALGO"] : null) : ["ALGO"]);
        OCRService.getValidItemMatch = () => "Item Prime Blueprint";
        OCRService.getRelicMatch = () => null;

        const celdas = [0, 1, 2, 3, 4, 5].map(i => ({ cell: { sx: i * 10, sy: 0 } }));
        assert.deepEqual(await electPageNameColor({}, null, celdas, 10, 0, 10, THEME), BUENO);
    } finally {
        VisionService.pageNameColorCandidates = original.cands;
        VisionService.cropThemeBinarized = original.crop;
        OCRService.extractCellText = original.text;
        OCRService.getValidItemMatch = original.item;
        OCRService.getRelicMatch = original.relic;
    }
});
