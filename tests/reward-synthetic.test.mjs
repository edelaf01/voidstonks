import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pantallaRecompensas, TEMAS } from "./_helpers/reward-synth.mjs";
import { detectRewardCells, estimateAccentColor } from "../deploy/js/utils/vision/mission_complete_grid.js";

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
            for (let c = 0; c < 3; c++) {
                assert.ok(Math.abs(acento[c] - tema[c]) < 40,
                    `${nombre}: canal ${c} medido ${Math.round(acento[c])}, esperado ~${tema[c]}`);
            }
        }
    });

    test("el arte de fondo no desvía el acento medido", () => {
        // with the mean, orange (241,127,4) drifted to (211,120,47)
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
            assert.ok(Math.abs(centros[i] - esperados[i]) < res.pitch,
                `casilla ${i}: centro ${Math.round(centros[i])} vs ✓ en ${Math.round(esperados[i])}`);
        }
    });
});
