import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };

let pedidos = [];
let fallan = [];

globalThis.fetch = async (url) => {
  const base = url.split("/").pop().split("?")[0];
  pedidos.push(base);
  if (fallan.includes(base)) throw new Error("mock falla");
  const buf = fs.readFileSync(new URL(`../deploy/assets/ml/${base}`, import.meta.url));
  return { ok: true, json: async () => JSON.parse(buf.toString()) };
};

test("sin nivel_y_tirada.json la tasación usa la curva y no pide el modelo viejo", async () => {
  pedidos = [];
  fallan = ["nivel_y_tirada.json"];
  const N = await import("../deploy/js/utils/rivens/riven_ml.js");
  const TORID = { name: "Torid", official_median: 357, wfm_avg: 7966, de_rerolled: { median: 450, pop: 12, stddev: 300, max_price: 3000 }, de_unrolled: { median: 357, pop: 8 } };
  const STATS = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 }
  ];
  const band = await N.predictRivenMLBand(TORID, STATS, TORID, null, 75);
  assert.equal(band.fuente, "curva");
  assert.ok(band.p25 <= band.p50 && band.p50 <= band.p80 && band.p80 <= band.p90 && band.p90 <= band.p95);
  const prohibidos = ["model_quantiles_slim.json", "model_trees_slim.json", "feature_order_slim.json", "feature_defaults_slim.json"];
  for (const p of prohibidos) {
    assert.ok(!pedidos.includes(p));
  }
  fallan = [];
});

test("el modelo publicado solo lleva lo que lee el navegador", () => {
  const buf = fs.readFileSync(new URL("../deploy/assets/ml/nivel_y_tirada.json", import.meta.url));
  const modelo = JSON.parse(buf.toString());
  const keys = Object.keys(modelo).sort();
  assert.deepEqual(keys, ["armas","columnas","cuantiles","efectos","fecha_datos","mag_por_defecto","modelo","nivel_pool","pob","pool","pool_clase","precision","ref_neg","ref_pos","rho","sin_wfm","stats_neg","stats_pos","tipos"]);
  assert.equal(modelo.sin_wfm.nivel.length, 2);
  assert.ok(modelo.sin_wfm.nivel.every(Number.isFinite));
  assert.ok(Number.isFinite(modelo.sin_wfm.log_n));
  assert.ok(Object.keys(modelo.sin_wfm.ref_pos).length > 10);
  assert.ok(Object.values(modelo.sin_wfm.ref_pos).every(v => Number.isFinite(v) && v > 0));
  assert.deepEqual(modelo.cuantiles, [0.25, 0.5, 0.8, 0.9, 0.95]);
  assert.equal(modelo.modelo.base.length, 5);
  assert.equal(modelo.modelo.arboles.length, 5);
  assert.equal(modelo.columnas.length, 13 + modelo.stats_pos.length + modelo.stats_neg.length + modelo.tipos.length);
  for (let q = 0; q < 5; q++) {
    for (const t of modelo.modelo.arboles[q]) {
      assert.equal(Object.keys(t).sort().join(), "L,R,dl,sc,si");
      const len = t.si.length;
      const idx = [t.sc, t.L, t.R, t.dl].findIndex(arr => arr.length !== len);
      assert.equal(idx, -1);
    }
  }
});

test("de10.json publicado tiene la estructura y rangos esperados", () => {
  const buf = fs.readFileSync(new URL("../deploy/assets/ml/de10.json", import.meta.url));
  const de10 = JSON.parse(buf.toString());
  assert.match(de10.semana, /^\d{4}-\d{2}-\d{2}$/);
  const tramos = ["<1.5", "1.5-3", ">=3"];
  for (const t of tramos) {
    assert.ok(Number.isFinite(de10.mu.l[t]));
    assert.ok(Number.isFinite(de10.mu.s[t]));
  }
  const nombres = Object.keys(de10.familias);
  assert.ok(nombres.length > 100);
  for (const f of nombres) {
    const fila = de10.familias[f];
    assert.equal(fila.length, 5);
    assert.ok(fila.every(Number.isFinite));
    const [, s10, max10, pop10, nsem] = fila;
    assert.ok(s10 > 0);
    assert.ok(max10 >= 0);
    assert.ok(pop10 >= 0);
    assert.ok(Number.isInteger(nsem) && nsem >= 1 && nsem <= 10);
  }
});

