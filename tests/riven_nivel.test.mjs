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
  const regCero = N.registroSinWfm(modelo, 0, 1, "Rifle");
  assert.ok(regCero !== null);
  assert.equal(regCero.nivel, 0);
  assert.equal(regCero.cola, undefined);
  assert.equal(N.registroSinWfm(modelo, NaN, 1, "Rifle"), null);
  assert.equal(N.registroSinWfm(modelo, Infinity, 1, "Rifle"), null);
  assert.equal(N.registroSinWfm(modelo, 100, 0, "Rifle"), null);
  assert.equal(N.registroSinWfm(modelo, 100, -1, "Rifle"), null);
  assert.equal(N.registroSinWfm({ ...modelo, sin_wfm: undefined }, 100, 1, "Rifle"), null);
  const reg = N.registroSinWfm(modelo, 100, 1.2, "Rifle");
  assert.ok(Number.isFinite(reg.nivel));
  assert.equal(reg.nivel, 100);
  assert.equal(reg.cola, undefined);
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

test("cargarDe10 maneja fallos de red o datos incompletos y reintenta tras error", async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    assert.equal(await N.cargarDe10(), null);

    globalThis.fetch = async () => { throw new Error("red"); };
    assert.equal(await N.cargarDe10(), null);

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ mu: { l: {}, s: {} } }) });
    assert.equal(await N.cargarDe10(), null);

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ familias: {}, mu: { s: {} } }) });
    assert.equal(await N.cargarDe10(), null);

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ familias: {}, mu: { l: {} } }) });
    assert.equal(await N.cargarDe10(), null);

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        familias: { torid: [6, 1, 1000, 5, 10] },
        mu: { l: { "<1.5": 4.5 }, s: { "<1.5": 0.8 } }
      })
    });
    const d = await N.cargarDe10();
    assert.ok(d !== null);
    assert.ok(d.familias.torid);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("claveFamilia resuelve según base, slug y gestiona nulos", () => {
  assert.equal(N.claveFamilia("Kuva Kohm", { kohm: [1], kuva_kohm: [2] }), "kohm");
  assert.equal(N.claveFamilia("Kuva Kohm", { kuva_kohm: [2] }), "kuva_kohm");
  assert.equal(N.claveFamilia("Kuva Kohm", { braton: [1] }), null);
  assert.equal(N.claveFamilia(null, { kohm: [1] }), null);
  assert.equal(N.claveFamilia("Kuva Kohm", null), null);
  assert.equal(N.claveFamilia("Kuva Kohm", {}), null);
});

test("claseArma mapea tipos a su clase canónica", () => {
  assert.equal(N.claseArma("Sniper"), "Rifle");
  assert.equal(N.claseArma("Bow"), "Rifle");
  assert.equal(N.claseArma("Launcher"), "Rifle");
  assert.equal(N.claseArma("Companion Weapon"), "Rifle");
  assert.equal(N.claseArma("Dual Pistols"), "Pistol");
  assert.equal(N.claseArma("Throwing"), "Pistol");
  assert.equal(N.claseArma("Zaw Component"), "Melee");
  assert.equal(N.claseArma("Shotgun"), "Shotgun");
  assert.equal(N.claseArma("Rifle"), "Rifle");
  assert.equal(N.claseArma("Pistol"), "Pistol");
  assert.equal(N.claseArma(null), null);
  assert.equal(N.claseArma(undefined), null);
});

test("filaDe10 devuelve la fila de familia, encogida o fallback por defecto", () => {
  const de10 = {
    familias: { kohm: [5.1, 0.9, 1000, 4.2, 10] },
    mu: {
      l: { "<1.5": 4.0, "1.5-3": 4.5, ">=3": 5.0 },
      s: { "<1.5": 0.8, "1.5-3": 0.9, ">=3": 1.0 }
    }
  };
  assert.equal(N.filaDe10(null, "Kohm"), null);
  assert.deepEqual(N.filaDe10(de10, "Kuva Kohm"), [5.1, 0.9, 1000, 4.2, 10]);
  assert.deepEqual(N.filaDe10(de10, "Desconocida", null), [4.0, 0.8, 0, 0, 0]);
  assert.deepEqual(N.filaDe10(de10, "Desconocida", { median: 0 }), [4.0, 0.8, 0, 0, 0]);
  assert.deepEqual(N.filaDe10(de10, "Desconocida", { median: -5 }), [4.0, 0.8, 0, 0, 0]);

  const deVivo = { median: 100, pop: 10, stddev: 50, max_price: 500 };
  const filaEncogida = N.filaDe10(de10, "Desconocida", deVivo);
  const w = 10;
  const sEsperada = Math.sqrt(Math.log((1 + Math.sqrt(1 + 4 * (50 / 100) ** 2)) / 2));
  const lEsperada = (w * Math.log(100) + 3 * 4.0) / (w + 3);
  const s10Esperada = (w * sEsperada + 5 * 0.8) / (w + 5);
  assert.ok(Math.abs(filaEncogida[0] - lEsperada) < 1e-12);
  assert.ok(Math.abs(filaEncogida[1] - s10Esperada) < 1e-12);
  assert.equal(filaEncogida[2], 500);
  assert.equal(filaEncogida[3], 1);
  assert.equal(filaEncogida[4], 1);

  const deVivoMedia = { median: 100, pop: 20, stddev: 20, max_price: 300 };
  const filaMedia = N.filaDe10(de10, "Desconocida", deVivoMedia);
  const wMed = 20;
  const sMed = Math.sqrt(Math.log((1 + Math.sqrt(1 + 4 * (20 / 100) ** 2)) / 2));
  assert.ok(Math.abs(filaMedia[0] - ((wMed * Math.log(100) + 3 * 4.5) / (wMed + 3))) < 1e-12);
  assert.ok(Math.abs(filaMedia[1] - ((wMed * sMed + 5 * 0.9) / (wMed + 5))) < 1e-12);

  const deVivoAlta = { median: 100, pop: 35, stddev: 20, max_price: 300 };
  const filaAlta = N.filaDe10(de10, "Desconocida", deVivoAlta);
  const wAlta = 35;
  const sAlta = Math.sqrt(Math.log((1 + Math.sqrt(1 + 4 * (20 / 100) ** 2)) / 2));
  assert.ok(Math.abs(filaAlta[0] - ((wAlta * Math.log(100) + 3 * 5.0) / (wAlta + 3))) < 1e-12);
  assert.ok(Math.abs(filaAlta[1] - ((wAlta * sAlta + 5 * 1.0) / (wAlta + 5))) < 1e-12);
});

test("nivelSinWfm determina el nivel según nivel_pool, pop fiable o regresión", () => {
  const modelo = {
    nivel_pool: { kohm: 5.5 },
    sin_wfm: { nivel: [0.8, 0.4] }
  };
  assert.equal(N.nivelSinWfm(modelo, "Kuva Kohm", [5.0, 1, 0, 5, 10]), 5.5);
  assert.equal(N.nivelSinWfm(modelo, "Desconocida", [5.2, 1, 0, 3.0, 10]), 5.2);
  assert.equal(N.nivelSinWfm(modelo, "Desconocida", [5.2, 1, 0, 4.0, 10]), 5.2);
  assert.ok(Math.abs(N.nivelSinWfm(modelo, "Desconocida", [5.0, 1, 0, 2.5, 10]) - (0.8 * 5.0 + 0.4)) < 1e-12);
  assert.ok(Number.isNaN(N.nivelSinWfm(modelo, "Desconocida", null)));
  assert.ok(Number.isNaN(N.nivelSinWfm({}, "Desconocida", [5.0, 1, 0, 1.0, 10])));
});

test("poblacionTirada sigue el orden de prioridad pob, pool, pool_clase y null", () => {
  const modelo = {
    pob: { kohm: [100, 1, 2] },
    pool: { kohm: [150, 1, 2], braton: [200, 1, 2] },
    pool_clase: { Rifle: [300, 1, 2] }
  };
  assert.deepEqual(N.poblacionTirada(modelo, "Kuva Kohm", "Rifle"), [100, 1, 2]);
  assert.deepEqual(N.poblacionTirada(modelo, "Braton", "Rifle"), [200, 1, 2]);
  assert.deepEqual(N.poblacionTirada(modelo, "Desconocida", "Sniper"), [300, 1, 2]);
  assert.equal(N.poblacionTirada(modelo, "Desconocida", "Shotgun"), null);
  assert.equal(N.poblacionTirada(null, "Kuva Kohm", "Rifle"), null);
});

test("percentilTirada calcula el percentil con interpolación, empates y recortes", () => {
  assert.equal(N.percentilTirada(null, 5), 0.5);
  assert.equal(N.percentilTirada("no-array", 5), 0.5);
  assert.equal(N.percentilTirada([], 5), 0.5);
  assert.equal(N.percentilTirada([10, 1], 5), 0.5);
  assert.equal(N.percentilTirada([100, 10, 20], NaN), 0.5);
  assert.equal(N.percentilTirada([100, 10, 20], Infinity), 0.5);
  assert.equal(N.percentilTirada([100, 10, 20], -Infinity), 0.5);

  const pob = [100, 10, 20, 30];
  assert.equal(N.percentilTirada(pob, 5), 0.5 / 100);
  assert.equal(N.percentilTirada(pob, 35), 1 - 0.5 / 100);
  assert.equal(N.percentilTirada(pob, 15), 0.25);
  assert.equal(N.percentilTirada(pob, 20), 0.5);
  assert.equal(N.percentilTirada(pob, 25), 0.75);

  const pobEmpates = [100, 10, 20, 20, 30];
  assert.equal(N.percentilTirada(pobEmpates, 20), 0.5);

  const pob10 = [10, 10, 20, 30];
  assert.equal(N.percentilTirada(pob10, 5), 0.05);
  assert.equal(N.percentilTirada(pob10, 35), 0.95);
});

test("cuantilNormal aproxima la inversa de la normal con simetría y límites", () => {
  assert.equal(N.cuantilNormal(0), -Infinity);
  assert.equal(N.cuantilNormal(-0.5), -Infinity);
  assert.equal(N.cuantilNormal(1), Infinity);
  assert.equal(N.cuantilNormal(1.5), Infinity);
  assert.equal(N.cuantilNormal(0.5), 0);
  assert.ok(Math.abs(N.cuantilNormal(0.975) - 1.959963986) < 1e-6);

  const centroP = [0.1, 0.2, 0.3, 0.4];
  for (const p of centroP) {
    assert.ok(Math.abs(N.cuantilNormal(p) + N.cuantilNormal(1 - p)) < 1e-10);
  }
  const colaP = [0.01, 0.001];
  for (const p of colaP) {
    assert.ok(Math.abs(N.cuantilNormal(p) + N.cuantilNormal(1 - p)) < 1e-10);
  }
});

test("preciosDe10 genera precios monótonos con tope opcional y rho por defecto", () => {
  const l10 = Math.log(200);
  const filaSinTecho = [l10, 0.6, 0];
  const pCentral = N.preciosDe10(filaSinTecho, 0.5, [0.5]);
  assert.ok(Math.abs(pCentral[0] - 200) < 1e-9);

  const qs = [0.1, 0.25, 0.5, 0.8, 0.95];
  const precios = N.preciosDe10(filaSinTecho, 0.6, qs);
  for (let i = 1; i < precios.length; i++) {
    assert.ok(precios[i] >= precios[i - 1]);
  }

  const conRhoPorDefecto = N.preciosDe10(filaSinTecho, 0.6, qs);
  const conRhoExplicito = N.preciosDe10(filaSinTecho, 0.6, qs, 0.7);
  assert.deepEqual(conRhoPorDefecto, conRhoExplicito);

  const filaConTecho = [l10, 1.2, 300];
  const preciosTecho = N.preciosDe10(filaConTecho, 0.99, [0.99]);
  assert.ok(Math.abs(preciosTecho[0] - 300) < 1e-9);

  const preciosCeroTecho = N.preciosDe10(filaSinTecho, 0.99, [0.99]);
  assert.ok(preciosCeroTecho[0] > 300);
});

