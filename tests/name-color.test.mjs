import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

// choosing the text colour of names (services/name_color.service.js)
// the fixture is 3 real cells from the RELICS tab, where the brown art and the orange name share almost
// the same pixels of the name band: on the raw frame the name wins, but the stream rescale is enough for
// the art to win in some cells, which made the scanner read the same inventory differently on each pass
// pinned here: the name colour stays among the candidates, and using it for the whole page keeps every
// cell readable

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
// name colour in this capture (orange theme): observed data, not a tunable
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

/** ink rows of the binarised crop, as % of height */
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

// the stream rescale: the capture arrives at a slightly different resolution than the game, enough to flip
// the art/name tie
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
            // a one-line name fills ~1/6 of the crop; if the art comes out, ink fills almost every row and tesseract
            // returns garbage
            assert.ok(frac > 0 && frac < 0.35, `celda ${c}: ${(frac * 100).toFixed(0)}% de filas con tinta`);
        }
    });
}

// the binarised crop comes from a ring of recycled canvases (vision.service), which is only safe if nobody
// keeps a crop beyond its iteration; these two tests pin that invariant, since breaking it fails silently
// (a cell with another's image)
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
    // this documents the failure that motivates the module: measured per cell, some cell binarises the art; if
    // it ever stops failing it was fixed elsewhere, and this test should be deleted, not relaxed
    assert.ok(
        fracs.some(f => f > 0.8),
        `midiendo por celda ninguna falló (${fracs.map(f => (f * 100).toFixed(0) + "%").join(", ")})`,
    );
});

// colour vote across cells (utils/vision/name_color.js)

test("voto de página: gana el color que sale en TODAS las celdas, no el que más píxeles tiene", () => {
    // an item's art can have more pixels than its name, but only within its own cell
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
    // binarising on the smoothed edge leaves the core out of tolerance and letters come out hollow, so the
    // bright colour is returned even if the edge has more pixels
    const borde = [200, 104, 8], nucleo = [248, 128, 0];
    const ranking = rankPageNameColors([
        [{ col: borde, count: 900 }, { col: nucleo, count: 600 }],
        [{ col: borde, count: 900 }, { col: nucleo, count: 600 }],
    ]);
    assert.deepEqual(ranking[0], nucleo);
});

// letter isolation by SHAPE (cropThemeBinarized): the filter drops non-text components; the "is text" bar
// sat above a letter's height, so only a stroke bridging two lines passed and then the whole name was
// erased

/** synthetic name band: two lines of "letters" and, optionally, a stroke joining them */
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
    const LINEAS = [[46, 68], [78, 100]]; // spaced like the two lines of a real name
    for (const [y0, y1] of LINEAS) for (const x of LETRAS_X) pinta(x, x + 5, y0, y1);
    // the bridge sits far in X from the letters: if the filter takes it as the only "text", the "touching in
    // X" rule does not save the letters and they vanish
    if (puente) pinta(150, 155, LINEAS[0][0], LINEAS[1][1]);
    return { data, width: W, height: H, LETRAS_X, LINEAS };
}

/** is there ink in the rectangle (band coordinates; the crop is enlarged)? */
function hayTinta(mask, x0, x1, y0, y1) {
    const S = mask.width / 277;
    const d = mask.getContext("2d").getImageData(0, 0, mask.width, mask.height).data;
    for (let y = Math.ceil(y0 * S); y <= Math.floor(y1 * S); y++) {
        for (let x = Math.ceil(x0 * S); x <= Math.floor(x1 * S); x++) {
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

// page colour confirmation (services/scanner/name_color.service.js): the colour is cached for the whole
// session, so trusting one lucky read poisoned every later page

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
        // FLOJO hits the first cell and misses the rest: the pattern of a colour that only catches the letter
        // edges
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
