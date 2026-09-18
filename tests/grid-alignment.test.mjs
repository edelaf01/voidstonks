// El corte de fase que decide si una página se lee o se salta. Las cifras salen de medir las 40
// capturas del corpus con el detector real: la baseline cae en 0,919 del alto de celda (mediana).
import { test } from "node:test";
import assert from "node:assert/strict";
import { filasEnFase, filasConNombre } from "../deploy/js/utils/vision/grid_alignment.js";

const CELL = 296;
const REJILLA = { gridY: 236, cellH: CELL, rows: 3 };
// Baselines reales de una página bien alineada: 236 + k·296 + 0,919·296
const BANDAS = [{ y1: 508 }, { y1: 804 }, { y1: 1100 }];

test("una rejilla sobre los nombres está en fase", () => {
  assert.equal(filasEnFase(BANDAS, REJILLA), true);
});

test("media celda de desfase no pasa", () => {
  assert.equal(filasEnFase(BANDAS, { ...REJILLA, gridY: 236 + CELL / 2 }), false);
});

test("un cuarto de celda tampoco: ahí el recorte ya parte el nombre", () => {
  assert.equal(filasEnFase(BANDAS, { ...REJILLA, gridY: 236 + CELL / 4 }), false);
});

test("±3% de tolerancia sí pasa: es el margen entre capturas del corpus", () => {
  assert.equal(filasEnFase(BANDAS, { ...REJILLA, gridY: 236 + 9 }), true);
  assert.equal(filasEnFase(BANDAS, { ...REJILLA, gridY: 236 - 9 }), true);
});

test("una fila cortada por el borde inferior no tumba la página", () => {
  const cuatro = { ...REJILLA, rows: 4 };
  const bandas = [...BANDAS, { y1: 236 + 3 * CELL + Math.round(CELL * 0.625) }];
  assert.equal(filasEnFase(bandas, cuatro), true);
});

test("la rejilla de otra página, sobre este frame, se rechaza", () => {
  assert.equal(filasEnFase(BANDAS, { gridY: 427, cellH: 296, rows: 3 }), false);
  assert.equal(filasEnFase(BANDAS, { gridY: 117, cellH: 311, rows: 4 }), false);
});

test("sin bandas no se bloquea la lectura: no hay con qué juzgar", () => {
  assert.equal(filasEnFase([], REJILLA), true);
  assert.equal(filasEnFase(null, REJILLA), true);
  assert.equal(filasEnFase(BANDAS, { gridY: 236, cellH: 0, rows: 3 }), true);
});

test("basta con la mitad de las filas sobre un nombre", () => {
  assert.equal(filasEnFase([{ y1: 508 }, { y1: 804 }], REJILLA), true, "2 de 3 alcanza");
  assert.equal(filasEnFase([{ y1: 508 }], REJILLA), false, "1 de 3 no");
});

// --- La fila que asoma al final de la lista ---------------------------------------------------
// Cifras de la página donde se quedaba sin leer el último ítem: rejilla y=143 cellH=292 cellW=277
// con 3 filas, y en el hueco de la 4ª una banda 1248-1292 de masa 603 con un bloque en 22-259.

const REJILLA4 = { gridX: 0, gridY: 143, cellW: 277, cellH: 292, cols: 6, rows: 3, height: 1440 };
const LLENAS = { y0: 459, y1: 708, mass: 14935 }; // banda de una fila llena: fija la masa de referencia
const NOMBRE_SUELTO = { y0: 1248, y1: 1292, mass: 603 };
const unBloque = (x0, x1) => () => [{ x0, x1 }];

test("una fila con un solo ítem al final de la lista cuenta como fila", () => {
  assert.equal(filasConNombre([LLENAS, NOMBRE_SUELTO], { ...REJILLA4, bloques: unBloque(22, 259) }), 4);
});

test("el overlay de fps del juego no cuenta: su bloque cruza varias celdas", () => {
  assert.equal(filasConNombre([LLENAS, { y0: 1248, y1: 1292, mass: 603 }],
    { ...REJILLA4, bloques: unBloque(1, 549) }), 3);
});

// La raya del HUD del juego (contador de fps) mide 15 px y pesa el 2% de la banda más fuerte;
// el nombre de una fila real, 45 px y el 4%. Medido sobre 101 frames.
test("una raya del HUD no cuenta, aunque su bloque esté centrado en la columna", () => {
  assert.equal(filasConNombre([LLENAS, { y0: 1394, y1: 1408, mass: 275 }],
    { ...REJILLA4, bloques: unBloque(3, 217) }), 3, "15 px de alto no son un nombre");
  assert.equal(filasConNombre([LLENAS, { y0: 1248, y1: 1292, mass: 102 }],
    { ...REJILLA4, bloques: unBloque(22, 259) }), 3, "ni una banda de masa ridícula");
});

test("un bloque descentrado respecto a su columna no es un nombre", () => {
  // centrado en 40 cuando la columna 0 centra en 138: más de un cuarto de celda de desvío
  assert.equal(filasConNombre([LLENAS, NOMBRE_SUELTO], { ...REJILLA4, bloques: unBloque(2, 78) }), 3);
});

test("no se inventan filas por debajo del borde del frame", () => {
  const bandas = [LLENAS, NOMBRE_SUELTO, { y0: 1540, y1: 1584, mass: 603 }];
  assert.equal(filasConNombre(bandas, { ...REJILLA4, bloques: unBloque(22, 259) }), 4, "la 5ª no entra entera");
});

test("sin bandas ni rejilla se devuelven las filas que ya había", () => {
  assert.equal(filasConNombre([], { ...REJILLA4, bloques: unBloque(22, 259) }), 3);
  assert.equal(filasConNombre([LLENAS, NOMBRE_SUELTO], { ...REJILLA4, cellW: 0, bloques: unBloque(22, 259) }), 3);
});
