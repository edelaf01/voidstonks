import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };

let fallar = false;

globalThis.fetch = async (url) => {
  if (fallar) throw new Error("sin red");
  const base = url.split("/").pop().split("?")[0];
  const buf = fs.readFileSync(new URL(`../deploy/assets/ml/${base}`, import.meta.url));
  return { ok: true, json: async () => JSON.parse(buf.toString()) };
};

const N = await import("../deploy/js/utils/rivens/riven_nivel.js");

test("si falla la carga devuelve null y reintenta después", async () => {
  fallar = true;
  assert.equal(await N.cargarNivelTirada(), null);
  fallar = false;
  const m = await N.cargarNivelTirada();
  assert.ok(m);
  assert.ok(m.armas.Larkspur);
});

test("prepararNivelTirada rechaza datos incompletos", () => {
  assert.equal(N.prepararNivelTirada(null), null);
  assert.equal(N.prepararNivelTirada({}), null);
});

test("las características y los residuos casan con Python", async () => {
  const buf = fs.readFileSync(new URL("./fixtures/nivel_y_tirada_paridad.json", import.meta.url));
  const fixtures = JSON.parse(buf.toString());
  const modelo = await N.cargarNivelTirada();
  for (let i = 0; i < fixtures.length; i++) {
    const fila = fixtures[i];
    const x = N.caracteristicas(modelo, fila.arma, fila.positivos, fila.negativo);
    assert.equal(x.length, fila.x.length);
    for (let j = 0; j < fila.x.length; j++) {
      if (fila.x[j] === null) {
        assert.ok(Number.isNaN(x[j]), `fila ${i} ${modelo.columnas[j]}`);
      } else {
        assert.ok(Math.abs(x[j] - fila.x[j]) <= 1e-12, `fila ${i} ${modelo.columnas[j]}`);
      }
    }
    const r = N.residuosTirada(modelo, fila.arma, fila.positivos, fila.negativo);
    assert.equal(r.length, 5);
    for (let q = 0; q < 5; q++) {
      assert.ok(Math.abs(r[q] - fila.r[q]) <= 1e-5, `fila ${i} q${q}: ${r[q]} vs ${fila.r[q]}`);
    }
  }
  assert.ok(fixtures.length >= 40);
});

test("el nombre del arma no distingue mayúsculas y un arma sin nivel no da residuos", async () => {
  const modelo = await N.cargarNivelTirada();
  assert.equal(N.nombreArma(modelo, " larkspur "), "Larkspur");
  assert.equal(N.residuosTirada(modelo, "ArmaInventadaTest", [["Critical Chance", 100]], null), null);
  assert.equal(N.residuosTirada(null, "Torid", [], null), null);
});

test("las variantes de un arma usan los datos de su familia", async () => {
  const modelo = await N.cargarNivelTirada();
  const casos = [
    ["Kuva Drakgoon", "Drakgoon"],
    ["Seer", "Kuva Seer"],
    ["Penta", "Carmine Penta"],
    ["Synoid Simulor", "Simulor"],
    ["Hirudo", "Coda Hirudo"],
    ["Prisma Dual Decurions", "Dual Decurion"],
    ["Prisma Grakata", "Grakata"],
    ["Dual Skana", "Dual Skana"],
    ["Rakta Dark Dagger", "Dark Dagger"],
    ["Telos Boltace", "Boltace"],
    ["Pangolin Sword", "Pangolin Prime"],
    ["Kuva Karak", "Karak"],
    ["Dark Split-Sword", null],
    ["Torid", null],
    ["Kuva Sobek", null],
    ["Dex Furis", null]
  ];
  for (const [nombre, esperado] of casos) {
    assert.equal(N.nombreArma(modelo, nombre), esperado, nombre);
  }
  const pos = [["Critical Chance", 150], ["Multishot", 90]];
  const neg = ["Zoom", 30];
  assert.deepEqual(N.residuosTirada(modelo, "Drakgoon", pos, neg), N.residuosTirada(modelo, "Kuva Drakgoon", pos, neg));
  assert.ok(N.residuosTirada(modelo, "Drakgoon", pos, neg));
  assert.equal(N.slugArma("Cobra & Crane Prime"), "cobra_and_crane_prime");
  assert.equal(N.baseFamilia("kuva_sobek"), "sobek");
  assert.equal(N.baseFamilia("dex_furis"), "furis");
  assert.equal(N.baseFamilia("prisma_dual_decurions"), "dual_decurion");
});

test("los residuos salen ordenados", async () => {
  const modelo = await N.cargarNivelTirada();
  const r = N.residuosTirada(modelo, "Larkspur", [["Critical Chance", 150], ["Critical Damage", 120]], ["Zoom", 30]);
  assert.equal(r.length, 5);
  for (let i = 0; i < 4; i++) {
    assert.ok(r[i] <= r[i + 1]);
    assert.ok(Number.isFinite(r[i]));
  }
  assert.ok(Number.isFinite(r[4]));
});

test("el adaptador pasa nombres y unidades de la app a WFM", () => {
  const comp = (a, b) => {
    assert.equal(a[0], b[0]);
    assert.ok(Math.abs(a[1] - b[1]) <= 1e-12);
  };
  let r = N.atributosAWfm([{name:"Damage to Corpus",value:45,isPositive:true}], 0);
  assert.equal(r.positivos.length, 1);
  comp(r.positivos[0], ["Damage Vs Corpus", 1.45]);
  assert.equal(r.negativo, null);
  r = N.atributosAWfm([{name:"Critical Chance",value:120,isPositive:true},{name:"Damage to Grineer",value:-20,isPositive:false}], 0);
  assert.equal(r.positivos.length, 1);
  comp(r.positivos[0], ["Critical Chance", 120]);
  comp(r.negativo, ["Damage Vs Grineer", 0.8]);
  r = N.atributosAWfm([{name:"Chance not to gain Combo",value:30,isPositive:true}], 3);
  comp(r.positivos[0], ["Chance To Gain Extra Combo Count", 30]);
  r = N.atributosAWfm([{name:"Chance not to gain Combo",value:30,isPositive:false}], 3);
  comp(r.negativo, ["Chance To Gain Combo Count", 30]);
  r = N.atributosAWfm([{name:"Fire Rate",value:10,isPositive:true}], 0);
  comp(r.positivos[0], ["Fire Rate / Attack Speed", 10]);
  r = N.atributosAWfm([{name:"Attack Speed",value:10,isPositive:true}], 3);
  comp(r.positivos[0], ["Fire Rate / Attack Speed", 10]);
  r = N.atributosAWfm([{name:"Toxin",value:10,isPositive:true}], 0);
  comp(r.positivos[0], ["Toxin Damage", 10]);
  r = N.atributosAWfm([{name:"Damage",value:10,isPositive:true}], 0);
  comp(r.positivos[0], ["Base Damage / Melee Damage", 10]);
  r = N.atributosAWfm([{name:"Slide Attack Critical Chance",value:10,isPositive:true}], 0);
  comp(r.positivos[0], ["Critical Chance On Slide Attack", 10]);
  r = N.atributosAWfm([{name:"Damage to Orokin",value:20,isPositive:true}], 0);
  comp(r.positivos[0], ["Damage To Orokin", 1.2]);
  r = N.atributosAWfm([{name:"Radiation",value:50,isPositive:true}], 0);
  comp(r.positivos[0], ["Radiation", 50]);
  r = N.atributosAWfm([{name:"Damage",value:-150,isPositive:true}], 0);
  comp(r.positivos[0], ["Base Damage / Melee Damage", 150]);
  r = N.atributosAWfm([
    {name:"A",value:1,isPositive:true},
    {name:"B",value:2,isPositive:true},
    {name:"C",value:3,isPositive:true},
    {name:"D",value:4,isPositive:true}
  ], 0);
  assert.equal(r.positivos.length, 3);
  comp(r.positivos[0], ["A", 1]);
  comp(r.positivos[1], ["B", 2]);
  comp(r.positivos[2], ["C", 3]);
});

test("la precisión por arma sale del modelo", async () => {
  const modelo = await N.cargarNivelTirada();
  const p = N.precisionNivel(modelo, "Larkspur");
  assert.ok(Number.isFinite(p.mape));
  assert.ok(p.n >= 8);
  assert.equal(N.precisionNivel(modelo, "ArmaInventadaTest"), null);
  assert.equal(N.precisionNivel(null, "Torid"), null);
});

test("un arma sin datos de WFM sale del modelo con el registro de DE", async () => {
  const modelo = await N.cargarNivelTirada();
  const pos = [["Critical Chance", 150], ["Critical Damage", 120]];
  const neg = ["Zoom", 30];
  assert.equal(N.registroSinWfm(modelo, 0, 1, "Rifle"), null);
  assert.equal(N.registroSinWfm(modelo, 100, 0, "Rifle"), null);
  assert.equal(N.registroSinWfm({ ...modelo, sin_wfm: undefined }, 100, 1, "Rifle"), null);
  const reg = N.registroSinWfm(modelo, 100, 1.2, "Rifle");
  assert.ok(Number.isFinite(reg.nivel));
  assert.equal(reg.log_n, modelo.sin_wfm.log_n);
  const stat = Object.keys(modelo.sin_wfm.ref_pos)[0];
  assert.ok(Math.abs(reg.ref_pos[stat] - modelo.sin_wfm.ref_pos[stat] * 1.2) < 1e-9);
  assert.equal(N.residuosTirada(modelo, "ArmaInventadaTest", pos, neg), null);
  const r = N.residuosTirada(modelo, "ArmaInventadaTest", pos, neg, reg);
  assert.equal(r.length, modelo.cuantiles.length);
  assert.ok(r.every(Number.isFinite));
  for (let i = 1; i < r.length; i++) assert.ok(r[i] >= r[i - 1]);
  assert.deepEqual(N.residuosTirada(modelo, "Larkspur", pos, neg, reg), N.residuosTirada(modelo, "Larkspur", pos, neg));
  const flojo = N.residuosTirada(modelo, "ArmaInventadaTest", [["Zoom", 10]], ["Critical Chance", 50], reg);
  assert.ok(flojo[1] < r[1]);
});

test("con DE fiable el registro toma la mediana de DE como nivel", async () => {
  const modelo = await N.cargarNivelTirada();
  assert.ok(Math.abs(N.registroSinWfm(modelo, 100, 1.2, "Rifle", 3).nivel - Math.log(100)) < 1e-12);
  assert.ok(Math.abs(N.registroSinWfm(modelo, 100, 1.2, "Rifle", 2.9).nivel - (modelo.sin_wfm.nivel[0] * Math.log(100) + modelo.sin_wfm.nivel[1])) < 1e-12);
  assert.ok(Object.keys(modelo.sin_wfm.de_ref).length >= 20);
  assert.ok(modelo.sin_wfm.de_ref.Torid > 0);
  assert.ok(modelo.sin_wfm.cola_de > 0 && modelo.sin_wfm.cola_de <= 1);
  assert.equal(N.registroSinWfm(modelo, 100, 1.2, "Rifle", 3).cola, modelo.sin_wfm.cola_de);
  assert.equal(N.registroSinWfm(modelo, 100, 1.2, "Rifle", 2.9).cola, 1);
  assert.equal(N.registroSinWfm({ ...modelo, sin_wfm: { ...modelo.sin_wfm, cola_de: undefined } }, 100, 1.2, "Rifle", 3).cola, 1);
});

test("el índice de DE es la mediana del cambio en las armas con DE fiable", () => {
  const ref = {};
  for (let i = 0; i <= 21; i++) {
    ref[`A${i}`] = 100;
  }
  const modelo = { sin_wfm: { de_ref: { ...ref, Z: 100 } } };
  const metas = {};
  for (let i = 0; i <= 10; i++) {
    metas[`A${i}`] = { de_rerolled: { median: 100, pop: 5 } };
  }
  for (let i = 11; i <= 21; i++) {
    metas[`A${i}`] = { de_rerolled: { median: 400, pop: 5 } };
  }
  metas.Z = { de_rerolled: { median: 100000, pop: 1 } };

  assert.ok(Math.abs(N.indiceDE(modelo, metas) - Math.log(2)) < 1e-12);

  delete metas.A0;
  assert.ok(Math.abs(N.indiceDE(modelo, metas) - Math.log(4)) < 1e-12);

  delete metas.A1;
  assert.ok(Math.abs(N.indiceDE(modelo, metas) - Math.log(4)) < 1e-12);

  delete metas.A2;
  assert.equal(N.indiceDE(modelo, metas), 0);

  assert.equal(N.indiceDE(modelo, null), 0);
  assert.equal(N.indiceDE({ sin_wfm: {} }, metas), 0);
  assert.equal(N.indiceDE(null, metas), 0);
});
