import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const MODELO = {
  armas: {
    Larkspur: { nivel: 4.66, log_n: 3, tipo: "Rifle" },
    Boar: { nivel: 4.569, log_n: 3, tipo: "Shotgun" },
    Braton: { nivel: 4.086, log_n: 3, tipo: "Rifle" },
    Redeemer: { nivel: 6, log_n: 3, tipo: "Melee" }
  },
  efectos: { pos_local: {}, pos_global: {}, neg_local: {}, neg_global: {} },
  ref_pos: {},
  ref_neg: {},
  mag_por_defecto: 0.5,
  stats_pos: [],
  stats_neg: [],
  tipos: [],
  modelo: { base: [0, 0, 0, 0, 0], arboles: [[], [], [], [], []] },
  rho: 0.7
};

globalThis.fetch = async (url) => {
  const base = String(url).split("/").pop().split("?")[0];
  if (base === "de10.json") {
    const buf = fs.readFileSync(new URL("./fixtures/de10_fijo.json", import.meta.url));
    return { ok: true, json: async () => JSON.parse(buf.toString()) };
  }
  if (base === "nivel_y_tirada.json") {
    return { ok: true, json: async () => JSON.parse(JSON.stringify(MODELO)) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const NT = await import("../deploy/js/utils/rivens/riven_nivel.js");

test("filaConNivelModelo devuelve la fila tal cual si falta o el arma no tiene nivel finito", () => {
  const modelo = NT.prepararNivelTirada({
    armas: { Known: { nivel: 4.5 }, NonFinite: { nivel: NaN } },
    modelo: {},
    efectos: {}
  });
  const fila = [4.0, 1.0, 1000, 5, 10];
  assert.equal(NT.filaConNivelModelo(modelo, "Known", null), null);
  assert.equal(NT.filaConNivelModelo(modelo, "UnknownWeapon", fila), fila);
  assert.equal(NT.filaConNivelModelo(modelo, "NonFinite", fila), fila);
});

test("filaConNivelModelo sustituye el nivel por el del modelo en una fila nueva", () => {
  const modelo = NT.prepararNivelTirada({
    armas: { Known: { nivel: 4.5 } },
    modelo: {},
    efectos: {}
  });
  const fila = [4.0, 1.0, 1000, 5, 10];
  const resultado = NT.filaConNivelModelo(modelo, "Known", fila);
  assert.notEqual(resultado, fila);
  assert.deepEqual(fila, [4.0, 1.0, 1000, 5, 10]);
  assert.deepEqual(resultado, [4.5, 1.0, 1000, 5, 10]);
});
