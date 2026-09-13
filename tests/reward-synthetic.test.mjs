import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pantallaRecompensas, TEMAS } from "./_helpers/reward-synth.mjs";
import { detectRewardCells, estimateAccentColor } from "../deploy/js/utils/vision/mission_complete_grid.js";

// synthetic reward screen sweep varying theme colour, background art and contrast
// pins two silent failures: a WHITE theme returning null for lack of saturation, and background art
// skewing the accent when using the mean instead of the median
// glyph ocr does NOT run here: this validates colour, geometry, checkmarks and grid

const NIVELES_RUIDO = [0, 0.5, 1];

describe("pantalla de recompensas sintética", () => {
    for (const [nombre, tema] of Object.entries(TEMAS)) {
        for (const ruido of NIVELES_RUIDO) {
            test(`tema ${nombre} con ruido ${ruido}: encuentra las 4 casillas`, () => {
                const trace = {};
                const { img } = pantallaRecompensas({ tema, ruido });
                const res = detectRewardCells(img, { trace });
                assert.ok(res, `no detectó la retícula: ${trace.fail || "sin motivo"}`);
                assert.equal(res.cells.length, 4);
                assert.equal(trace.rows, 1);
                assert.equal(trace.cols, 4);
            });
        }
    }

    test("el acento se mide del título, sea del color que sea", () => {
        for (const [nombre, tema] of Object.entries(TEMAS)) {
            const { img } = pantallaRecompensas({ tema, ruido: 0 });
            const acento = estimateAccentColor(img);
            assert.ok(acento, `${nombre}: sin acento`);
            // wide tolerance: what matters is that it does NOT drift to the background tint
            for (let c = 0; c < 3; c++) {
                assert.ok(Math.abs(acento[c] - tema[c]) < 40,
                    `${nombre}: canal ${c} medido ${Math.round(acento[c])}, esperado ~${tema[c]}`);
            }
        }
    });

    test("el arte de fondo no desvía el acento medido", () => {
        // the breaking case: with the mean, orange (241,127,4) drifted to (211,120,47)
        const limpio = estimateAccentColor(pantallaRecompensas({ tema: TEMAS.naranja, ruido: 0 }).img);
        const sucio = estimateAccentColor(pantallaRecompensas({ tema: TEMAS.naranja, ruido: 1 }).img);
        for (let c = 0; c < 3; c++) {
            assert.ok(Math.abs(sucio[c] - limpio[c]) < 25,
                `el canal ${c} se movió de ${Math.round(limpio[c])} a ${Math.round(sucio[c])} solo por el fondo`);
        }
    });

    test("un tema apagado sigue valiendo hasta la mitad de brillo", () => {
        for (const contraste of [1, 0.7, 0.5]) {
            const { img } = pantallaRecompensas({ tema: TEMAS.rojo, ruido: 0.5, contraste });
            const res = detectRewardCells(img, { trace: {} });
            assert.ok(res && res.cells.length === 4, `contraste ${contraste}: ${res ? res.cells.length : "null"}`);
        }
    });

    // the hard case: separating text from background when they share colour
    // mission art tints the entire screen and the title is four thin strokes against it; in a real capture
    // (lastmission-rojo.png) the accent came out (99,39,30), the tint, instead of the title white: the mask
    // marked half the screen (6114 components) and not a single checkmark survived
    for (const nombre of ["stalker", "default", "tenno", "lotus", "corpus", "high-contrast"]) {
        test(`tema ${nombre} sobre un fondo teñido de su mismo tono`, () => {
            const trace = {};
            const { img } = pantallaRecompensas({ tema: TEMAS[nombre], ruido: 0.5, tinte: 1 });
            const res = detectRewardCells(img, { trace });
            assert.ok(res, `no detectó la retícula: ${trace.fail || "sin motivo"}`);
            assert.equal(res.cells.length, 4);
            const acento = estimateAccentColor(img);
            for (let c = 0; c < 3; c++) {
                assert.ok(Math.abs(acento[c] - TEMAS[nombre][c]) < 40,
                    `el acento se fue al tinte: ${acento.map(Math.round)} en vez de ${TEMAS[nombre]}`);
            }
        });
    }

    for (const nombre of ["blanco", "lotus", "corpus"]) {
        test(`texto ${nombre} sobre fondo teñido de OTRO tono (rojo)`, () => {
            // the capture case: light title and red art behind it
            const trace = {};
            const { img } = pantallaRecompensas({
                tema: TEMAS[nombre], tinteColor: TEMAS.stalker, tinte: 1, ruido: 0.5,
            });
            const res = detectRewardCells(img, { trace });
            assert.ok(res, `no detectó la retícula: ${trace.fail || "sin motivo"}`);
            assert.equal(res.cells.length, 4);
            const acento = estimateAccentColor(img);
            assert.ok(Math.abs(acento[0] - TEMAS[nombre][0]) < 40 && Math.abs(acento[2] - TEMAS[nombre][2]) < 40,
                `el acento se fue al tinte rojo: ${acento.map(Math.round)}`);
        });
    }

    // the 12 failing combinations from sweeping 15 text colours × 15 tint colours
    // out of scope on purpose: a colour not in WF_THEMES on a dark background
    for (const [texto, fondo] of [
        ["stalker", "corpus"], ["baruuk", "legacy"], ["baruuk", "baruuk"],
        ["grineer", "vitruvian"], ["lotus", "blanco"], ["blanco", "vitruvian"],
        ["tenno", "stalker"], ["tenno", "nidus"], ["tenno", "orokin"],
        ["corpus", "stalker"], ["legacy", "tenno"], ["nidus", "lotus"],
    ]) {
        test(`texto ${texto} sobre arte teñido de ${fondo}`, () => {
            const trace = {};
            const { img } = pantallaRecompensas({
                tema: TEMAS[texto], tinteColor: TEMAS[fondo], tinte: 1, ruido: 0.5,
            });
            const res = detectRewardCells(img, { trace });
            assert.ok(res, `no detectó la retícula: ${trace.fail || "sin motivo"}`);
            assert.equal(res.cells.length, 4, `casillas: ${res.cells.length} (${trace.rows}×${trace.cols})`);
            assert.equal(trace.rows, 1);
        });
    }

    test("con menos de 4 ✓ no inventa una retícula: devuelve null y dice por qué", () => {
        const trace = {};
        const res = detectRewardCells(pantallaRecompensas({ recompensas: 3 }).img, { trace });
        assert.equal(res, null);
        assert.match(trace.fail, /3 ✓/);
    });

    test("el panel scrolleado se lee igual: se marca como desplazado, no como tapado", () => {
        // the first row of checkmarks always falls in the same place; seeing it lower means the panel is scrolled
        // with rewards above; leaving it unread meant with more than four rows (Plague Star) the bottom ones never
        // made it in; the screen registry prevents duplicates when scrolling, not skipping reads
        const entero = detectRewardCells(pantallaRecompensas({ tema: TEMAS.rojo, ruido: 0.5 }).img, { trace: {} });
        assert.equal(entero.occluded, false);
        assert.equal(entero.cut, false);
        const trace = {};
        const movido = detectRewardCells(
            pantallaRecompensas({ tema: TEMAS.rojo, ruido: 0.5, desplazaY: 0.06 }).img, { trace });
        assert.equal(movido.cells.length, 4);
        assert.equal(movido.occluded, false);
        assert.equal(movido.cut, true);
        assert.equal(trace.cut, true);
    });

    test("las casillas caen donde se dibujaron", () => {
        const { img, casillas } = pantallaRecompensas({ tema: TEMAS.rojo, ruido: 0.5 });
        const res = detectRewardCells(img, { trace: {} });
        const centros = res.cells.map((c) => c.x + c.w / 2).sort((a, b) => a - b);
        const esperados = casillas.map((c) => c.x + c.s / 2).sort((a, b) => a - b);
        for (let i = 0; i < 4; i++) {
            // half a cell margin: the grid anchors on the checkmark, which sits in its corner
            assert.ok(Math.abs(centros[i] - esperados[i]) < res.pitch,
                `casilla ${i}: centro ${Math.round(centros[i])} vs ✓ en ${Math.round(esperados[i])}`);
        }
    });
});
