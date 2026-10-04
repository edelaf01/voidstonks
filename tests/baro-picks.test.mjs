import { test } from "node:test";
import assert from "node:assert/strict";
import { copiasQueSobran } from "../deploy/js/utils/inventory/baro_picks.js";

const setsDatabase = {
  "Akarius Prime": ["Akarius Prime Blueprint", "Akarius Prime Barrel", "Akarius Prime Receiver"],
  "Venato Prime": ["Venato Prime Blueprint", "Venato Prime Blade", "Venato Prime Handle"],
};
const getRequiredCount = (set, p) => (p === "Venato Prime Blade" ? 2 : 1);
const getSetName = (p) => /(.*? Prime)/.exec(p)?.[1];
const deps = (primeInventory) => ({ primeInventory, setsDatabase, getSetName, getRequiredCount });

test("del set que estás juntando se guarda una copia y sobra el resto", () => {
  const inv = { "Akarius Prime Barrel": 4, "Akarius Prime Blueprint": 1 };
  assert.deepEqual(copiasQueSobran("Akarius Prime Barrel", deps(inv)), { sobran: 3, guardas: 1, completos: 0 });
  assert.deepEqual(copiasQueSobran("Akarius Prime Blueprint", deps(inv)), { sobran: 0, guardas: 1, completos: 0 });
});

test("los sets que ya puedes montar no se tocan", () => {
  const inv = { "Akarius Prime Blueprint": 2, "Akarius Prime Barrel": 3, "Akarius Prime Receiver": 2 };
  assert.deepEqual(copiasQueSobran("Akarius Prime Barrel", deps(inv)), { sobran: 1, guardas: 2, completos: 2 });
  assert.equal(copiasQueSobran("Akarius Prime Receiver", deps(inv)).sobran, 0);
});

test("si el set pide varias copias de una pieza se guardan todas", () => {
  const inv = { "Venato Prime Blade": 3, "Venato Prime Handle": 2 };
  assert.deepEqual(copiasQueSobran("Venato Prime Blade", deps(inv)), { sobran: 1, guardas: 2, completos: 0 });
  assert.deepEqual(copiasQueSobran("Venato Prime Handle", deps(inv)), { sobran: 1, guardas: 1, completos: 0 });
});

test("sin copias, o fuera de un set conocido, no hay nada que guardar", () => {
  assert.deepEqual(copiasQueSobran("Akarius Prime Barrel", deps({})), { sobran: 0, guardas: 0, completos: 0 });
  assert.deepEqual(copiasQueSobran("Pieza Suelta", deps({ "Pieza Suelta": 2 })), { sobran: 2, guardas: 0, completos: 0 });
});

import { piezasParaBaro } from "../deploy/js/utils/inventory/baro_picks.js";

test("recomienda las copias sobrantes que rentan en ducados, de mejor a peor ratio", () => {
  const precios = { "Akarius Prime Barrel": 3, "Venato Prime Handle": 2, "Akarius Prime Blueprint": 40 };
  const lista = piezasParaBaro({
    ...deps({ "Akarius Prime Barrel": 4, "Akarius Prime Blueprint": 3, "Venato Prime Handle": 2, "Venato Prime Blueprint": 1 }),
    ducadosDe: (n) => (n.endsWith("Handle") ? 45 : 100),
    precioDe: (n) => (n in precios ? precios[n] : null),
    rentaFundir: (d, p) => d / 10 > p,
  });
  assert.deepEqual(lista.map((i) => [i.name, i.qty]), [["Akarius Prime Barrel", 3], ["Venato Prime Handle", 1]]);
});

test("sin respetar sets se recomiendan todas las copias", () => {
  const lista = piezasParaBaro({
    ...deps({ "Akarius Prime Barrel": 4 }), respetaSets: false,
    ducadosDe: () => 100, precioDe: () => 3, rentaFundir: () => true,
  });
  assert.equal(lista[0].qty, 4);
});
