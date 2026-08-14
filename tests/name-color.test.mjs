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
const { nameColorCandidates } = await import("../deploy/js/utils/vision/name_color.js");
const { electPageNameColor } = await import("../deploy/js/services/scanner/name_color.service.js");

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
        for (let c = 0; c < CELLS; c++) {
            const cands = VisionService.nameBandColorCandidates(cvs, c * cellW, ty, cellW, th);
            assert.ok(
                cands.some(isNameColor),
                `celda ${c}: ${JSON.stringify(cands)} no incluye el color del nombre`,
            );
        }
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

test("name color: nameColorCandidates no repite tono y respeta el máximo", () => {
    const cvs = loadCanvas();
    const px = cvs.getContext("2d").getImageData(0, TEXT_SRC_Y, CELL_W, TEXT_SRC_H);
    const cands = nameColorCandidates(px, 3);
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
