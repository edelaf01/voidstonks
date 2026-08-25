import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseRelicGrid, RELIC_GRID_CROP } from "../deploy/js/utils/vision/relic_grid.js";

globalThis.document ??= { createElement: () => ({ getContext: () => null }) };
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");

// ===========================================================================
// Rejilla de VOID RELICS/REFINEMENT: nombre + cuántas tienes.
//
// Los dos fixtures son OCR REAL de la misma pantalla con DOS TEMAS distintos, que
// es lo que rompe cualquier atajo por color: el nombre se dibuja naranja puro
// (253,132,2) con el tema por defecto y blanco puro (255,255,255) con el otro, y
// el segundo NO coincide con el color de acento de su propio tema.
//
// El invariante que de verdad importa no es leerlas todas, es no INVENTARSE una
// cantidad: lo leído pisa el inventario del usuario y no queda copia.
// ===========================================================================

const fx = (n) => JSON.parse(readFileSync(new URL(`./_fixtures/${n}.json`, import.meta.url), "utf8"));
const DEFECTO = fx("relic-grid-words-default");
const CLARO = fx("relic-grid-words-tema-claro");

// Catálogo amplio a propósito: el matcher tiene que distinguir K3 de K4 y N10 de N17
// teniendo delante todas las combinaciones posibles, no solo las de la pantalla.
const nombres = [];
for (const T of ["Lith", "Meso", "Neo", "Axi"]) {
  for (const L of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") for (let n = 1; n <= 20; n++) nombres.push(`${T} ${L}${n}`);
}
state.allRelicNames = nombres;
const matchRelic = (w) => OCRService.getRelicMatch(w);

// La pantalla de la captura, leída a mano.
const REAL = {
  "Meso C6": 108, "Meso I1": 108, "Meso T1": 108, "Meso P5": 106,
  "Meso K4": 104, "Meso K3": 103, "Meso B9": 102, "Meso A3": 100, "Meso M4": 97,
  "Meso N17": 93, "Meso A7": 87, "Meso N10": 85, "Meso X1": 81, "Meso P10": 76,
  "Meso V13": 75, "Meso E6": 74, "Meso W3": 71, "Meso G4": 70, "Meso G8": 70,
};

describe("recorte", () => {
  test("no llega a la barra de scroll ni al panel de recompensas", () => {
    assert.ok(RELIC_GRID_CROP.x + RELIC_GRID_CROP.w <= 0.62);
    assert.ok(RELIC_GRID_CROP.y >= 0.15, "empieza por debajo de la fila OWNED/SEARCH");
  });
});

for (const [tema, datos] of [["tema por defecto", DEFECTO], ["tema claro", CLARO]]) {
  describe(`captura real · ${tema}`, () => {
    const leidas = parseRelicGrid(datos, { matchRelic });
    const mapa = Object.fromEntries(leidas.map((r) => [r.name, r.count]));

    test("ninguna cantidad es incorrecta", () => {
      const mal = Object.entries(mapa).filter(([n, c]) => REAL[n] !== c);
      assert.deepEqual(mal, [], "una cantidad mal leída pisa el inventario sin dejar rastro");
    });

    test("no se inventa reliquias que no están en pantalla", () => {
      assert.deepEqual(Object.keys(mapa).filter((n) => !(n in REAL)), []);
    });

    test("lee la mayoría de la rejilla", () => {
      // 19 casillas con reliquia (la 20ª es "No Relic"). Lo que no se lee en este frame
      // se lee en el siguiente: el servicio acumula, así que el listón es la cobertura
      // útil, no la perfección.
      assert.ok(leidas.length >= 16, `solo ${leidas.length} de 19`);
    });

    test("respeta el orden de la pantalla, que va por cantidad descendente", () => {
      // Comprobación independiente del OCR: si una cantidad estuviera mal, lo normal es
      // que rompa la monotonía.
      for (let i = 1; i < leidas.length; i++) {
        assert.ok(leidas[i].count <= leidas[i - 1].count,
          `${leidas[i - 1].name}=${leidas[i - 1].count} → ${leidas[i].name}=${leidas[i].count}`);
      }
    });

    test('la casilla "No Relic" no entra como reliquia', () => {
      assert.ok(!leidas.some((r) => /^No\b/i.test(r.name)));
    });
  });
}

describe("emparejado", () => {
  const celda = (words, x, y) => words.map((text, i) => ({
    text, x0: x + i * 70, x1: x + i * 70 + 55, y0: y, y1: y + 27,
  }));
  // Dos filas × dos columnas, con la geometría de la pantalla real: el contador va
  // 200 px por encima del nombre y el paso de fila es 304.
  const rejilla = (falta = null) => {
    const names = [], counts = [];
    const cel = [["Meso C6", 0, 0], ["Meso I1", 324, 0], ["Meso K4", 0, 1], ["Meso K3", 324, 1]];
    const cnt = [108, 106, 104, 103];
    cel.forEach(([n, x, r], i) => {
      names.push(...celda(n.split(" ").concat("Relic"), 100 + x, 239 + r * 304));
      if (falta !== i) counts.push(...celda([`x${cnt[i]}`], 22 + x, 39 + r * 304));
    });
    return { nameWords: names, countWords: counts };
  };

  test("cada nombre se queda con el contador de SU casilla", () => {
    const out = parseRelicGrid(rejilla(), { matchRelic });
    assert.deepEqual(out, [
      { name: "Meso C6", count: 108 }, { name: "Meso I1", count: 106 },
      { name: "Meso K4", count: 104 }, { name: "Meso K3", count: 103 },
    ]);
  });

  test("si falta un contador, esa reliquia se cae — no hereda el de la fila de arriba", () => {
    // Es el fallo que de verdad duele: Meso K3 se apuntaría con las 108 de Meso C6.
    const out = parseRelicGrid(rejilla(3), { matchRelic });
    assert.deepEqual(out.map((r) => r.name), ["Meso C6", "Meso I1", "Meso K4"]);
  });

  test("si las dos pasadas discrepan en una casilla, se descarta", () => {
    const g = rejilla();
    g.nameWords.push(...celda(["x999"], 22, 39));
    const out = parseRelicGrid(g, { matchRelic });
    assert.equal(out.find((r) => r.name === "Meso C6"), undefined);
    assert.equal(out.find((r) => r.name === "Meso I1").count, 106, "las demás casillas siguen");
  });

  test("un número sin la x no cuenta como cantidad", () => {
    const g = rejilla(0);
    g.countWords.push(...celda(["30"], 22, 39));
    assert.equal(parseRelicGrid(g, { matchRelic }).find((r) => r.name === "Meso C6"), undefined);
  });

  test("entradas vacías o sin matcher no revientan", () => {
    assert.deepEqual(parseRelicGrid({}, { matchRelic }), []);
    assert.deepEqual(parseRelicGrid(rejilla(), {}), []);
    assert.deepEqual(parseRelicGrid(undefined, { matchRelic }), []);
  });
});
