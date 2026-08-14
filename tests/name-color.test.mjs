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
const { nameColorCandidates } = await import("../deploy/js/utils/vision/name_color.js");
const { electPageNameColor } = await import("../deploy/js/services/scanner/name_color.service.js");

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
    // this documents the failure that motivates the module: measured per cell, some cell binarises the art; if
    // it ever stops failing it was fixed elsewhere, and this test should be deleted, not relaxed
    assert.ok(
        fracs.some(f => f > 0.8),
        `midiendo por celda ninguna falló (${fracs.map(f => (f * 100).toFixed(0) + "%").join(", ")})`,
    );
});
