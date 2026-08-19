// Construcción del mapa de armas con riven.
//
// De aquí salen `state.weaponMap` (disposición + categoría de stats) y `state.allRivenNames`, o
// sea: qué armas existen en el buscador y con qué stats se tasan sus rivens. Los fallos son
// todos del mismo tipo y ninguno da error — un arma con la categoría equivocada se tasa contra
// la tabla de stats de otra clase, y un arma duplicada aparece dos veces en el buscador con una
// de las dos copias vacía.
//
// El mapa se arma cruzando dos fuentes con criterios distintos (cleaned_weapons.json y
// metastats.json), que es de donde vienen todos los casos raros de abajo.

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

/** Reconstruye el mapa desde cero con las dos fuentes que se le pasen. */
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

// Las piezas de zaw (mangos, uniones) no llevan riven propio: son componentes, no armas. Si se
// colaran, el buscador se llenaría de nombres que no aceptan riven.
test("los componentes de zaw no son armas y no entran", async () => {
  const m = await construir([arma("Braton"), arma("JAYAP", "Zaw Component"), arma("RUHANG II", "Zaw Component")]);
  assert.deepEqual(Object.keys(m), ["Braton"]);
});

test("un zaw completo sí entra, y con stats de melee", async () => {
  const m = await construir([arma("Plague Kripath", "Zaw Component")]);
  assert.equal(m["Plague Kripath"].t, "Melee");
});

// Las armas de compañero comparten el tipo crudo "Companion Weapon" pero no la mecánica: los
// Hound pegan cuerpo a cuerpo y sus rivens llevan stats de melee; los de centinela son a
// distancia. Tasar un Batoten con stats de rifle da rangos que no existen.
test("las armas de Hound usan stats de melee; las de centinela, de rifle", async () => {
  const m = await construir([
    arma("Batoten", "Companion Weapon"),
    arma("Deconstructor", "Companion Weapon"),
  ]);
  assert.equal(m.Batoten.t, "Melee");
  assert.equal(m.Deconstructor.t, "Rifle");
});

// --- El cruce con metastats -----------------------------------------------------------------

test("un arma que solo está en metastats se añade con su disposición", async () => {
  const m = await construir([arma("Braton")], { Sydon: { disposition: 1.2, category: "Melee" } });
  assert.deepEqual(m.Sydon, { d: 1.2, t: "Melee" });
});

// El bug que documenta el bump de caché v10: las dos fuentes escriben el mismo arma con
// separadores distintos, así que "Ax 52" entraba como un arma nueva junto a "Ax-52" y la copia
// de metastats salía en el buscador sin datos de recetas ni imagen.
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

// Los kitguns no están en cleaned_weapons.json, así que llegan por metastats sin categoría. Sin
// esta regla caían al "Rifle" por defecto y se tasaban con rangos de primaria.
test("los kitguns llegan sin categoría y se tratan como secundarias", async () => {
  const m = await construir([], { Catchmoon: { disposition: 1.1 }, Tombfinger: { disposition: 1.0 } });
  assert.equal(m.Catchmoon.t, "Pistol");
  assert.equal(m.Tombfinger.t, "Pistol");
});

// Las armas con modo cuerpo a cuerpo aparecen dos veces, y la variante "(Melee)" usa stats de
// melee aunque el arma base sea un rifle.
test('la variante "(Melee)" de un arma se tasa como melee', async () => {
  const m = await construir([], { "Vinquibus (Melee)": { disposition: 1.0 } });
  assert.equal(m["Vinquibus (Melee)"].t, "Melee");
});

// Sin categoría ni nombre revelador queda el último recurso: si sus stats meta son de melee
// (Initial Combo, Heavy Attack Efficiency, Range), el arma es de melee.
test("sin categoría, los stats meta delatan que el arma es de melee", async () => {
  const m = await construir([], {
    ArmaRara: { disposition: 1.0, pos: ["Initial Combo", "Crit Damage"] },
    OtraRara: { disposition: 1.0, pos: ["Multishot", "Crit Damage"] },
  });
  assert.equal(m.ArmaRara.t, "Melee");
  assert.equal(m.OtraRara.t, "Rifle", "sin señal de melee se queda en el valor por defecto");
});

// La misma detección tiene que funcionar con las dos formas en que se publican las listas
// (array pelado o `{best: [...]}`), o media tabla se queda sin clasificar.
test("las listas de stats valen tanto en array como en {best}", async () => {
  const m = await construir([], {
    ConBest: { disposition: 1.0, pos: { best: ["Range"] } },
    ConNeg: { disposition: 1.0, neg: ["Heavy Attack Efficiency"] },
  });
  assert.equal(m.ConBest.t, "Melee");
  assert.equal(m.ConNeg.t, "Melee", "también cuentan los negativos");
});

// --- Que nada de esto tumbe el arranque -----------------------------------------------------

// metastats es un fichero aparte y puede faltar o venir roto: el mapa base ya sirve para casi
// todo, así que la app arranca igual.
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

// El envoltorio `{data: {...}}` lo añaden unas fuentes y otras no.
test("metastats vale envuelto en data o pelado", async () => {
  const envuelto = await construir([], { data: { Sydon: { disposition: 1.2, category: "Melee" } } });
  assert.ok(envuelto.Sydon, "debe leer el objeto envuelto");
});

test("una disposición ausente no deja el arma sin valor", async () => {
  const m = await construir([{ name: "SinDispo", type: "Rifle" }], { SoloMeta: {} });
  assert.equal(m.SinDispo.d, 1);
  assert.equal(m.SoloMeta.d, 1);
});
