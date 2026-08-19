// riven stat weight resolution: which attributes to value and which to avoid
// data indexes by EXACT weapon name but rivens apply family-wide: variants without data fall back to base
// weapons, while retaining their own data when present
// silent failures alter recommendation advice, sending players rerolling for stats never sold on that
// weapon

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

const { state } = await import("../deploy/js/state.js");
const {
  metaConPesosDeFamilia,
  pesosFinosDeArma,
  statsSinDatoPropio,
  isStatAllowedForWeaponType,
} = await import("../deploy/js/services/rivens/riven_weights.service.js");

// real case: endpoint returned DIFFERENT curated lists for Obex and Prisma Obex (-Combo Duration marked
// worst curse on one, harmless on the other) for the SAME mod
test("una variante hereda del arma base las listas curadas", () => {
  globalThis.dynamicMetaStats = {
    Obex: { pos: ["Critical Chance"], neg: ["Combo Duration"], dynamic_weights: { cc: 1 } },
  };
  const meta = { name: "Prisma Obex", pos: [], neg: [], disposition: 1.35 };
  const salida = metaConPesosDeFamilia(meta, "Prisma Obex");

  assert.deepEqual(salida.pos, ["Critical Chance"]);
  assert.deepEqual(salida.neg, ["Combo Duration"]);
  assert.deepEqual(salida.dynamic_weights, { cc: 1 });
});

// only lists and weights are inherited: disposition, prices and liquidity belong to EACH variant and
// copying them misprices the weapon
test("no se hereda nada que sea propio de la variante", () => {
  globalThis.dynamicMetaStats = {
    Obex: { pos: ["Critical Chance"], disposition: 1.0, wfm_avg_price: 50, popularity_pct: 90 },
  };
  const meta = { name: "Prisma Obex", pos: [], disposition: 1.35, wfm_avg_price: 200 };
  const salida = metaConPesosDeFamilia(meta, "Prisma Obex");

  assert.equal(salida.disposition, 1.35, "la disposición es de la variante");
  assert.equal(salida.wfm_avg_price, 200, "el precio también");
  assert.equal(salida.popularity_pct, undefined, "no se cuela nada que no sea lista ni peso");
});

test("sin familia en la tabla, el meta se devuelve intacto", () => {
  globalThis.dynamicMetaStats = {};
  const meta = { name: "Arma Rara", pos: ["X"] };
  assert.equal(metaConPesosDeFamilia(meta, "Arma Rara"), meta, "misma referencia: no se copia");
  assert.equal(metaConPesosDeFamilia(null, "Lo Que Sea"), null);
});

test("la familia se busca sin depender de mayúsculas", () => {
  globalThis.dynamicMetaStats = { obex: { pos: ["Critical Chance"] } };
  const salida = metaConPesosDeFamilia({ name: "Prisma Obex", pos: [] }, "Prisma Obex");
  assert.deepEqual(salida.pos, ["Critical Chance"]);
});

// dynamic_weights saturate at 1.00: Torid has CD, CC and Multishot all at 1.00 with no way to rank them;
// fine weights from S/A/B/F tiers are flattened to break ties
test("los tiers se aplanan en una sola tabla de stat -> peso", () => {
  state.rivenStatWeights = {
    Torid: { pos: { S: { Multishot: 0.998 }, A: { "Critical Damage": 0.756, "Critical Chance": 0.754 } } },
  };
  const pesos = pesosFinosDeArma("Torid");
  assert.deepEqual(pesos, { Multishot: 0.998, "Critical Damage": 0.756, "Critical Chance": 0.754 });
  assert.ok(pesos.Multishot > pesos["Critical Damage"], "es justo lo que dynamic_weights no deja ver");
});

// Prisma Obex is missing from stat_weights.json but Obex is present: the riven is the same
test("si la variante no está, se caen a los pesos de la familia", () => {
  state.rivenStatWeights = { Obex: { pos: { S: { "Critical Chance": 0.9 } } } };
  assert.deepEqual(pesosFinosDeArma("Prisma Obex"), { "Critical Chance": 0.9 });
});

test("el nombre exacto manda sobre la familia", () => {
  state.rivenStatWeights = {
    Obex: { pos: { S: { "Critical Chance": 0.9 } } },
    "Prisma Obex": { pos: { S: { Multishot: 0.5 } } },
  };
  assert.deepEqual(pesosFinosDeArma("Prisma Obex"), { Multishot: 0.5 });
});

// on curses a HIGH weight means harmless, so "higher is better" applies to both groups and they share
// logic
test("el grupo de negativos se lee igual que el de positivos", () => {
  state.rivenStatWeights = {
    Obex: { neg: { S: { "Puncture Damage": 1.0, "Impact Damage": 0.947 } } },
  };
  assert.deepEqual(pesosFinosDeArma("Obex", "neg"), { "Puncture Damage": 1.0, "Impact Damage": 0.947 });
});

test("sin tabla cargada devuelve null, no un objeto vacío", () => {
  state.rivenStatWeights = null;
  assert.equal(pesosFinosDeArma("Torid"), null);

  state.rivenStatWeights = { Torid: { pos: {} } };
  assert.equal(pesosFinosDeArma("Torid"), null, "un grupo vacío tampoco cuenta como dato");
});

// baja_confianza flags stats that never appeared in auctions for that weapon: usable for appraisal, but
// recommending them suggests chasing stats never sold there
test("los stats sin evidencia propia se devuelven en minúsculas para comparar", () => {
  state.rivenStatWeights = { Torid: { baja_confianza: ["Zoom", "Punch Through"] } };
  const sinDato = statsSinDatoPropio("Torid");
  assert.ok(sinDato.has("zoom"));
  assert.ok(sinDato.has("punch through"));
  assert.equal(sinDato.size, 2);
});

// baja_confianza only checks POSITIVES: Torid has 561 auctions with -Zoom, but rare +Zoom dropped Zoom
// into the low-confidence list and excluded it from best curses
test("la lista de positivos NO se aplica a las negativas", () => {
  state.rivenStatWeights = { Torid: { baja_confianza: ["Zoom"] } };
  assert.equal(statsSinDatoPropio("Torid", "neg").size, 0,
    "sin lista propia del lado negativo no hay evidencia de que falte el dato");
});

test("cuando llegue baja_confianza_neg se usará esa", () => {
  state.rivenStatWeights = {
    Torid: { baja_confianza: ["Zoom"], baja_confianza_neg: ["Recoil"] },
  };
  const neg = statsSinDatoPropio("Torid", "neg");
  assert.ok(neg.has("recoil"));
  assert.ok(!neg.has("zoom"), "cada lado usa la suya");
});

test("sin datos se devuelve un conjunto vacío, nunca null", () => {
  state.rivenStatWeights = null;
  assert.equal(statsSinDatoPropio("Torid").size, 0);

  state.rivenStatWeights = { Torid: {} };
  assert.equal(statsSinDatoPropio("Torid").size, 0);
});

// stats from the wrong archetype do not exist on that weapon: recommending them prompts rerolling for the
// impossible
test("los stats de cuerpo a cuerpo no se ofrecen en armas a distancia", () => {
  for (const s of ["Range", "Combo Duration", "Heavy Attack Efficiency", "Finisher Damage"]) {
    assert.equal(isStatAllowedForWeaponType(s, "Rifle"), false, s);
    assert.equal(isStatAllowedForWeaponType(s, "Melee"), true, s);
  }
});

test("y al revés con los de armas a distancia", () => {
  for (const s of ["Multishot", "Punch Through", "Magazine Capacity", "Zoom", "Reload Speed"]) {
    assert.equal(isStatAllowedForWeaponType(s, "Melee"), false, s);
    assert.equal(isStatAllowedForWeaponType(s, "Rifle"), true, s);
  }
});

// zaws and glaives count as melee even if their type omits the word "melee"
test("zaws y glaives cuentan como cuerpo a cuerpo", () => {
  for (const t of ["Zaw", "Glaive", "zaw", "Melee (Heavy)"]) {
    assert.equal(isStatAllowedForWeaponType("Range", t), true, t);
    assert.equal(isStatAllowedForWeaponType("Multishot", t), false, t);
  }
});

test("un stat que vale para todo se permite en cualquier arma", () => {
  for (const t of ["Rifle", "Melee", "Shotgun", "Pistol"]) {
    assert.equal(isStatAllowedForWeaponType("Critical Chance", t), true, t);
    assert.equal(isStatAllowedForWeaponType("Damage", t), true, t);
  }
});

test("un nombre vacío o con espacios no rompe la comprobación", () => {
  assert.doesNotThrow(() => isStatAllowedForWeaponType("", "Rifle"));
  assert.doesNotThrow(() => isStatAllowedForWeaponType(null, null));
  assert.equal(isStatAllowedForWeaponType("  Multishot  ", "Melee"), false, "se normaliza antes");
});
