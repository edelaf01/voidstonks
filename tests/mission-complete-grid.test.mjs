/**
 * Acotado de la pantalla MISSION COMPLETE.
 *
 * Los casos con números concretos (paso 240, 13 casillas, 5×3) salen de medir las capturas
 * reales de `implementar/`; el frame sintético reproduce su geometría para que la suite corra
 * en cualquier clon. Las capturas, cuando están, se comprueban aparte al final.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  detectRewardCells, estimateAccentColor, lanes, bestLattice, hasGap,
  classifyRewardCell, readRewardBadge,
} from "../deploy/js/utils/vision/mission_complete_grid.js";
import { makeMissionCompleteFrame } from "./_helpers/mission-complete-frame.mjs";
import { decodePng } from "./_helpers/png.mjs";

/** Misma geometría que la captura de 1440p: panel a la derecha, casillas de 240. */
function frame1440(extra = {}) {
  return makeMissionCompleteFrame({
    width: 2559, height: 1439, gridX: 1222, gridY: 350, pitch: 240,
    cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
            [1, 0], [1, 1], [1, 2], [1, 3], [1, 4],
            [2, 0], [2, 1], [2, 2]],
    ...extra,
  });
}

test("lanes agrupa por cercanía y cuenta miembros", () => {
  const out = lanes([100, 102, 340, 341, 342, 580], 15);
  assert.deepEqual(out.map((l) => l.pos), [101, 341, 580]);
  assert.deepEqual(out.map((l) => l.members), [2, 3, 1]);
});

test("bestLattice ignora carriles fantasma", () => {
  // Caso real medido a 720 px de alto: dos fantasmas (151, 198) junto a las filas de verdad.
  const laneList = [
    { pos: 151, members: 1 }, { pos: 181, members: 5 }, { pos: 198, members: 1 },
    { pos: 301, members: 5 }, { pos: 421, members: 3 },
  ];
  const { pitch, positions } = bestLattice(laneList, 15, 720);
  assert.equal(pitch, 120);
  assert.deepEqual(positions, [181, 301, 421]);
});

test("bestLattice no se queda con el paso MITAD", () => {
  // Con paso 120 explica 3 carriles sin huecos; con 60 explicaría lo mismo dejando 2 vacíos.
  const laneList = [{ pos: 100, members: 4 }, { pos: 220, members: 4 }, { pos: 340, members: 4 }];
  assert.equal(bestLattice(laneList, 12, 800).pitch, 120);
});

test("hasGap distingue casillas vacías del final de una tapada en medio", () => {
  const cols = 5;
  const llenoHastaElFinal = [
    { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 },
  ];
  assert.equal(hasGap(llenoHastaElFinal, cols), false);

  // El tooltip de "N OWNED" tapó las dos primeras casillas de la fila 1.
  const tapada = [
    { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }, { row: 0, col: 4 },
    { row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 },
  ];
  assert.equal(hasGap(tapada, cols), true);
});

test("estimateAccentColor lee el color del tema del título", () => {
  const azul = [40, 140, 240];
  const img = frame1440({ accent: azul });
  const acc = estimateAccentColor(img).map(Math.round);
  assert.deepEqual(acc, azul);
});

test("detectRewardCells acota la rejilla de un frame sintético", () => {
  const trace = {};
  const res = detectRewardCells(frame1440(), { trace });
  assert.ok(res, `debería detectar; traza: ${JSON.stringify(trace)}`);
  assert.equal(res.pitch, 240);
  assert.equal(res.cells.length, 13);
  assert.equal(trace.cols, 5);
  assert.equal(trace.rows, 3);
  assert.equal(res.occluded, false);
  // El ✓ va metido dentro de la casilla, así que el origen queda por delante de él.
  assert.ok(Math.abs(res.cells[0].x - 1222) <= 2, `x=${res.cells[0].x}`);
  assert.ok(Math.abs(res.cells[0].y - 350) <= 2, `y=${res.cells[0].y}`);
});

test("detectRewardCells descarta los ✓ que no caen en la retícula", () => {
  // La lupa de SEARCH y un trazo de IMPORTANCE: mismo color y tamaño, fuera de la rejilla.
  const trace = {};
  const res = detectRewardCells(frame1440({ phantoms: [[2390, 301], [1724, 306]] }), { trace });
  assert.ok(res);
  assert.ok(trace.candidates >= 15, `candidatos=${trace.candidates}`);
  assert.equal(res.cells.length, 13, "los fantasmas no deben contar como casillas");
  assert.equal(trace.cols, 5);
});

test("detectRewardCells avisa cuando algo tapa el panel", () => {
  const img = makeMissionCompleteFrame({
    width: 2559, height: 1439, gridX: 1222, gridY: 350, pitch: 240,
    cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
            [1, 0], [1, 1], [1, 2], [1, 3], [1, 4],
            [2, 2], [2, 3], [2, 4]], // las dos primeras de la última fila, tapadas
  });
  const res = detectRewardCells(img);
  assert.ok(res);
  assert.equal(res.occluded, true);
});

test("detectRewardCells funciona con cualquier tema y resolución", () => {
  for (const height of [1439, 1080, 900, 720]) {
    const k = height / 1439;
    const img = makeMissionCompleteFrame({
      width: Math.round(2559 * k), height,
      gridX: Math.round(1222 * k), gridY: Math.round(350 * k), pitch: Math.round(240 * k),
      cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 0], [1, 1], [1, 2]],
      accent: [90, 220, 200], // tema teal, nada que ver con el naranja por defecto
    });
    const res = detectRewardCells(img);
    assert.ok(res, `sin detección a ${height}px`);
    assert.equal(res.cells.length, 8, `a ${height}px`);
    assert.ok(Math.abs(res.pitch - 240 * k) <= 3, `paso ${res.pitch} a ${height}px`);
  }
});

test("detectRewardCells devuelve null si no hay título del que sacar el color", () => {
  const img = { data: new Uint8ClampedArray(800 * 600 * 4), width: 800, height: 600 };
  const trace = {};
  assert.equal(detectRewardCells(img, { trace }), null);
  assert.match(trace.fail, /color de tema/);
});

// --- Capturas reales (solo en la máquina donde están) -----------------------------------

const CAPTURAS = [
  ["missioncomplete.png", { cells: 13, cols: 5, rows: 3, pitch: 240, occluded: false }],
  // Con el tooltip de NEURODES tapando dos casillas de la última fila.
  ["missioncomplete2.png", { cells: 13, cols: 5, rows: 3, pitch: 240, occluded: true }],
];
const DIR = `${process.env.HOME}/Imágenes/Capturas de pantalla/nofunciona/implementar`;

for (const [file, esperado] of CAPTURAS) {
  const path = `${DIR}/${file}`;
  test(`captura real ${file}`, { skip: existsSync(path) ? false : "captura no disponible en este clon" }, () => {
    const trace = {};
    const res = detectRewardCells(decodePng(readFileSync(path)), { trace });
    assert.ok(res, `sin detección; traza: ${JSON.stringify(trace)}`);
    assert.equal(res.cells.length, esperado.cells, JSON.stringify(trace));
    assert.equal(trace.cols, esperado.cols);
    assert.equal(trace.rows, esperado.rows);
    assert.equal(res.pitch, esperado.pitch);
    assert.equal(res.occluded, esperado.occluded);
  });
}

// --- Rótulo y badge de cada casilla -----------------------------------------------------

test("classifyRewardCell separa las casillas con nombre de las que no lo llevan", () => {
  // r1c1 se queda sin rótulo: es la carta de mod, que lleva su nombre dentro y en blanco.
  const img = frame1440({
    cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
    labels: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2]],
  });
  const res = detectRewardCells(img, {});
  const kind = Object.fromEntries(
    res.cells.map((c) => [`${c.row}:${c.col}`, classifyRewardCell(img, res.accent, c).kind]));
  assert.deepEqual(kind, {
    "0:0": "NAMED", "0:1": "NAMED", "0:2": "NAMED",
    "1:0": "NAMED", "1:1": "UNNAMED", "1:2": "NAMED",
  });
});

test("detectRewardCells describe cada casilla con named y qty", () => {
  // Es lo que consume processMissionComplete: si el detector no lo rellena, el escáner
  // trataría las cartas de mod como piezas y todas las cantidades caerían a 1.
  const img = frame1440({
    cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
    labels: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2]],
  });
  const res = detectRewardCells(img, {});
  const named = Object.fromEntries(res.cells.map((c) => [`${c.row}:${c.col}`, c.named]));
  assert.deepEqual(named, {
    "0:0": true, "0:1": true, "0:2": true, "1:0": true, "1:1": false, "1:2": true,
  });
  // Sin número en el badge, toda casilla vale 1 (nunca undefined ni NaN).
  for (const c of res.cells) assert.equal(c.qty, 1, `r${c.row}c${c.col}`);
});

test("readRewardBadge no confunde el ✓ con un dígito", () => {
  // Una recompensa de una sola unidad enseña el ✓ y ningún número: si el anillo colase como
  // dígito, cada pieza entraría en el inventario con una cantidad inventada.
  const img = frame1440({
    cells: [[0, 0], [0, 1], [0, 2], [0, 3]],
    labels: [[0, 0], [0, 1], [0, 2], [0, 3]],
  });
  const res = detectRewardCells(img, {});
  for (const cell of res.cells) {
    assert.equal(readRewardBadge(img, res.accent, cell), "");
  }
});

test("una casilla que se sale del frame se lee recortada, no envuelta", () => {
  // accentMask indexaba (y*width + x) sin comprobar límites, así que un rect que se pasaba
  // por la derecha continuaba leyendo en la FILA SIGUIENTE y devolvía tinta de píxeles
  // ajenos. La casilla queda fuera de la pantalla, así que lo correcto es no ver rótulo.
  const img = frame1440({ cells: [[0, 0], [0, 1], [0, 2], [0, 3]], labels: [[0, 0], [0, 1], [0, 2], [0, 3]] });
  const res = detectRewardCells(img, {});
  const cell = res.cells[0];
  const fuera = { ...cell, x: img.width - 10 };
  assert.equal(classifyRewardCell(img, res.accent, fuera).kind, "UNNAMED");
  assert.equal(readRewardBadge(img, res.accent, fuera), "");
  // Del todo fuera: ni NaN ni excepción.
  const lejos = { ...cell, x: img.width + 50 };
  assert.equal(classifyRewardCell(img, res.accent, lejos).ink, 0);
});

// Verdad de terreno leída a ojo sobre las capturas. `null` = casilla sin rótulo (no se le
// mira el badge porque no se llega a OCRear).
const CELDAS = [
  ["missioncomplete.png", {
    "0:0": "8010", "0:1": "", "0:2": "", "0:3": "80", "0:4": "16",
    "1:0": "68", "1:1": null, "1:2": "12", "1:3": "8", "1:4": "74",
    "2:0": "3744", "2:1": "54", "2:2": "6482",
  }],
  // Los cuatro mods de la fila 1 salen sin rótulo, que es lo esperado. r2c2 (Neurodes)
  // también, pero por otro motivo: está bajo el cursor y el juego le tiñe el nombre de rojo,
  // que ya no casa con el color del tema. No se corrige porque esa celda solo se ve así en
  // frames con tooltip, y processMissionComplete los descarta enteros por `occluded`.
  ["missioncomplete2.png", {
    "0:0": "8866", "0:1": "", "0:2": "", "0:3": "", "0:4": "14",
    "1:0": null, "1:1": "16", "1:2": null, "1:3": null, "1:4": null,
    "2:2": null, "2:3": "2", "2:4": "880",
  }],
];

for (const [file, esperado] of CELDAS) {
  const path = `${DIR}/${file}`;
  test(`rótulos y badges de ${file}`, { skip: existsSync(path) ? false : "captura no disponible en este clon" }, () => {
    const img = decodePng(readFileSync(path));
    const res = detectRewardCells(img, {});
    assert.ok(res);
    const leido = {};
    for (const cell of res.cells) {
      const key = `${cell.row}:${cell.col}`;
      leido[key] = classifyRewardCell(img, res.accent, cell).kind === "UNNAMED"
        ? null
        : readRewardBadge(img, res.accent, cell);
    }
    assert.deepEqual(leido, esperado);
  });
}
