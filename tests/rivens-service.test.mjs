// building the riven weapon map (state.weaponMap and state.allRivenNames)
// failures are silent: wrong categories appraise against another class's table, and duplicates show twice
// with one copy empty
// joins cleaned_weapons.json and metastats.json, whose differing conventions cause the edge cases below

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let ARMAS = [];
let META = {};
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("cleaned_weapons")) return { ok: true, json: async () => ARMAS };
  if (u.includes("metastats")) return { ok: true, json: async () => META };
  return { ok: false, status: 404, json: async () => ({}) };
};

const { state } = await import("../deploy/js/state.js");
const { fetchRivenWeapons } = await import("../deploy/js/services/rivens/rivens.service.js");

const arma = (name, type = "Rifle", omegaAttenuation = 1.0) => ({ name, type, omegaAttenuation });

/** rebuilds the map from scratch with the two given sources */
async function construir(armas, meta = {}) {
  ARMAS = armas;
  META = meta;
  state.weaponMap = null;
  state.weaponDetailsDB = null;
  const ruido = console.error;
  console.error = () => {};
  try { await fetchRivenWeapons(); } finally { console.error = ruido; }
  return state.weaponMap;
}

test("un arma normal entra con su disposición y su tipo", async () => {
  const m = await construir([arma("Braton", "Rifle", 1.35)]);
  assert.deepEqual(m.Braton, { d: 1.35, t: "Rifle" });
});

test("allRivenNames queda ordenado alfabéticamente", async () => {
  await construir([arma("Zylok"), arma("Braton"), arma("Miter")]);
  assert.deepEqual(state.allRivenNames, ["Braton", "Miter", "Zylok"]);
});

// zaw parts (grips, links) do not take rivens: they are components, not weapons; including them would fill
// search with names that cannot have a riven
test("los componentes de zaw no son armas y no entran", async () => {
  const m = await construir([arma("Braton"), arma("JAYAP", "Zaw Component"), arma("RUHANG II", "Zaw Component")]);
  assert.deepEqual(Object.keys(m), ["Braton"]);
});

test("un zaw completo sí entra, y con stats de melee", async () => {
  const m = await construir([arma("Plague Kripath", "Zaw Component")]);
  assert.equal(m["Plague Kripath"].t, "Melee");
});

// companion weapons share the raw "Companion Weapon" type but not mechanics: hounds are melee and their
// rivens use melee stats, sentinels are ranged; appraising a Batoten with rifle stats gives non-existent
// ranges
test("las armas de Hound usan stats de melee; las de centinela, de rifle", async () => {
  const m = await construir([
    arma("Batoten", "Companion Weapon"),
    arma("Deconstructor", "Companion Weapon"),
  ]);
  assert.equal(m.Batoten.t, "Melee");
  assert.equal(m.Deconstructor.t, "Rifle");
});

test("un arma que solo está en metastats se añade con su disposición", async () => {
  const m = await construir([arma("Braton")], { Sydon: { disposition: 1.2, category: "Melee" } });
  assert.deepEqual(m.Sydon, { d: 1.2, t: "Melee" });
});

// cache bump v10 bug: the two sources use different separators for the same weapon, so "Ax 52" was added
// alongside "Ax-52" and the metastats copy showed in search without recipe data or image
test("el mismo arma con otro separador no se duplica", async () => {
  const m = await construir([arma("Ax-52")], { "Ax 52": { disposition: 0.9 } });
  assert.deepEqual(Object.keys(m), ["Ax-52"]);
  assert.equal(m["Ax-52"].d, 1.0, "gana la ficha de cleaned_weapons, no la de metastats");
});

test('el "And" de metastats se reconoce como el "&" del catálogo', async () => {
  const m = await construir([arma("Sigma & Octantis", "Melee")],
    { "Sigma And Octantis": { disposition: 0.5 } });
  assert.deepEqual(Object.keys(m), ["Sigma & Octantis"]);
});

// kitguns are not in cleaned_weapons.json and arrive from metastats with no category; without this rule
// they defaulted to "Rifle" and appraised with primary ranges
test("los kitguns llegan sin categoría y se tratan como secundarias", async () => {
  const m = await construir([], { Catchmoon: { disposition: 1.1 }, Tombfinger: { disposition: 1.0 } });
  assert.equal(m.Catchmoon.t, "Pistol");
  assert.equal(m.Tombfinger.t, "Pistol");
});

// weapons with a melee mode appear twice, and the "(Melee)" variant uses melee stats even if the base
// weapon is a rifle
test('la variante "(Melee)" de un arma se tasa como melee', async () => {
  const m = await construir([], { "Vinquibus (Melee)": { disposition: 1.0 } });
  assert.equal(m["Vinquibus (Melee)"].t, "Melee");
});

// with no category or telling name, the fallback checks whether meta stats are melee (Initial Combo, Heavy
// Attack Efficiency, Range)
test("sin categoría, los stats meta delatan que el arma es de melee", async () => {
  const m = await construir([], {
    ArmaRara: { disposition: 1.0, pos: ["Initial Combo", "Crit Damage"] },
    OtraRara: { disposition: 1.0, pos: ["Multishot", "Crit Damage"] },
  });
  assert.equal(m.ArmaRara.t, "Melee");
  assert.equal(m.OtraRara.t, "Rifle", "sin señal de melee se queda en el valor por defecto");
});

// detection must handle both list formats (bare array or {best: [...]}), or half the table is left
// unclassified
test("las listas de stats valen tanto en array como en {best}", async () => {
  const m = await construir([], {
    ConBest: { disposition: 1.0, pos: { best: ["Range"] } },
    ConNeg: { disposition: 1.0, neg: ["Heavy Attack Efficiency"] },
  });
  assert.equal(m.ConBest.t, "Melee");
  assert.equal(m.ConNeg.t, "Melee", "también cuentan los negativos");
});

// metastats is a separate file and may be missing or corrupt: the base map covers almost everything, so
// the app boots regardless
test("sin metastats el mapa base sigue construyéndose", async () => {
  ARMAS = [arma("Braton")];
  state.weaponMap = null;
  const real = globalThis.fetch;
  const ruido = console.error;
  console.error = () => {};
  globalThis.fetch = async (url) => {
    if (String(url).includes("cleaned_weapons")) return { ok: true, json: async () => ARMAS };
    throw new Error("sin red");
  };
  try {
    await fetchRivenWeapons();
    assert.ok(state.weaponMap.Braton, "el arma del catálogo tiene que estar");
  } finally {
    globalThis.fetch = real;
    console.error = ruido;
  }
});

// some sources add the {data: {...}} wrapper and others do not
test("metastats vale envuelto en data o pelado", async () => {
  const envuelto = await construir([], { data: { Sydon: { disposition: 1.2, category: "Melee" } } });
  assert.ok(envuelto.Sydon, "debe leer el objeto envuelto");
});

test("una disposición ausente no deja el arma sin valor", async () => {
  const m = await construir([{ name: "SinDispo", type: "Rifle" }], { SoloMeta: {} });
  assert.equal(m.SinDispo.d, 1);
  assert.equal(m.SoloMeta.d, 1);
});
