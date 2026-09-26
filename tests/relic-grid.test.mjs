import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseRelicGrid, RELIC_GRID_CROP } from "../deploy/js/utils/vision/relic_grid.js";

globalThis.document ??= { createElement: () => ({ getContext: () => null }) };
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");

// default theme uses pure orange (253,132,2), the other pure white (255,255,255)

const fx = (n) => JSON.parse(readFileSync(new URL(`./_fixtures/${n}.json`, import.meta.url), "utf8"));
const DEFECTO = fx("relic-grid-words-default");
const CLARO = fx("relic-grid-words-tema-claro");

const nombres = [];
for (const T of ["Lith", "Meso", "Neo", "Axi"]) {
  for (const L of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") for (let n = 1; n <= 20; n++) nombres.push(`${T} ${L}${n}`);
}
state.allRelicNames = nombres;
const matchRelic = (w) => OCRService.getRelicMatch(w);

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
      assert.ok(leidas.length >= 16, `solo ${leidas.length} de 19`);
    });

    test("respeta el orden de la pantalla, que va por cantidad descendente", () => {
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

  const conRefinada = (falta = null) => {
    const names = [], counts = [];
    const cel = [["Meso C6", 0, 0], ["Meso C6", 324, 0], ["Meso K4", 0, 1], ["Meso K3", 324, 1]];
    [3, 2, 104, 103].forEach((n, i) => {
      const [nombre, x, r] = cel[i];
      names.push(...celda(nombre.split(" ").concat("Relic"), 100 + x, 239 + r * 304));
      if (i === 0) names.push(...celda(["[Radiant]"], 170 + x, 269 + r * 304));
      if (falta !== i) counts.push(...celda([`x${n}`], 22 + x, 39 + r * 304));
    });
    return { nameWords: names, countWords: counts };
  };

  test("las casillas de una misma reliquia con distinto refinamiento se suman", () => {
    assert.deepEqual(parseRelicGrid(conRefinada(), { matchRelic }), [{ name: "Meso C6", count: 5 }, { name: "Meso K4", count: 104 }, { name: "Meso K3", count: 103 }]);
  });

  test("si a una de ellas le falta el contador, esa reliquia no se escribe", () => {
    assert.deepEqual(parseRelicGrid(conRefinada(0), { matchRelic }), [{ name: "Meso K4", count: 104 }, { name: "Meso K3", count: 103 }]);
  });

  test("cada nombre se queda con el contador de SU casilla", () => {
    const out = parseRelicGrid(rejilla(), { matchRelic });
    assert.deepEqual(out, [
      { name: "Meso C6", count: 108 }, { name: "Meso I1", count: 106 },
      { name: "Meso K4", count: 104 }, { name: "Meso K3", count: 103 },
    ]);
  });

  test("si falta un contador, esa reliquia se cae — no hereda el de la fila de arriba", () => {
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
