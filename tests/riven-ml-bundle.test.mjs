import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const ML_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../deploy/assets/ml");
const CLAVES_ARBOL = ["default_left", "left_children", "right_children", "split_conditions", "split_indices"];

const modelo = { learner: { learner_model_param: { base_score: "[5E-1]" }, gradient_booster: { model: { trees: [] } } } };
let pedidos;
let fallan;
globalThis.fetch = async (url) => {
  const f = String(url).split("/").pop().split("?")[0];
  pedidos.push(f);
  if (fallan.includes(f)) throw new Error("sin red");
  const datos = {
    "model_quantiles_slim.json": { quantiles: [0.25, 0.5], models: { "0.25": modelo, "0.5": modelo } },
    "feature_order_slim.json": ["a", "b"],
    "model_trees_slim.json": modelo,
  }[f] ?? {};
  return { ok: true, json: async () => datos };
};

const carga = async (caso, sinRed = []) => {
  pedidos = [];
  fallan = sinRed;
  const ML = await import(`../deploy/js/utils/rivens/riven_ml.js?${caso}`);
  return ML.loadRivenML();
};

test("con el bundle de cuantiles no se descarga el modelo de punto", async () => {
  const ml = await carga("con-bundle");
  assert.deepEqual(ml.quantiles, [0.25, 0.5]);
  assert.ok(pedidos.includes("model_quantiles_slim.json"));
  assert.ok(!pedidos.includes("model_trees_slim.json"));
});

test("sin el bundle de cuantiles el modelo de punto hace de p50", async () => {
  const ml = await carga("sin-bundle", ["model_quantiles_slim.json"]);
  assert.deepEqual(ml.quantiles, [0.5]);
  assert.ok(pedidos.includes("model_trees_slim.json"));
  assert.equal(ml.qmodels[0.5].baseScore, 0.5);
});

test("sin ninguno de los dos no hay cuantiles", async () => {
  const ml = await carga("sin-modelos", ["model_quantiles_slim.json", "model_trees_slim.json"]);
  assert.deepEqual(ml.quantiles, []);
  assert.deepEqual(Object.keys(ml.qmodels), []);
});

test("el bundle publicado solo lleva lo que lee el navegador", () => {
  const bundle = JSON.parse(fs.readFileSync(path.join(ML_ROOT, "model_quantiles_slim.json"), "utf8"));
  for (const [q, m] of Object.entries(bundle.models)) {
    assert.deepEqual(Object.keys(m), ["learner"], `cuantil ${q}`);
    assert.deepEqual(Object.keys(m.learner).sort(), ["gradient_booster", "learner_model_param"], `cuantil ${q}`);
    assert.deepEqual(Object.keys(m.learner.learner_model_param), ["base_score"], `cuantil ${q}`);
    const arboles = m.learner.gradient_booster.model.trees;
    assert.ok(arboles.length > 0, `cuantil ${q} sin árboles`);
    const sobran = arboles.findIndex((t) => Object.keys(t).sort().join() !== CLAVES_ARBOL.join());
    assert.equal(sobran, -1, `cuantil ${q}: el árbol ${sobran} lleva campos que el navegador no usa`);
  }
});
