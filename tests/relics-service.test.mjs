// relic value and ducat catalog: expected platinum and average ducats determine relic list ordering
// if rarity distribution desyncs, the list looks unchanged and properly ordered but sorts by the wrong
// criteria with no on-screen warning

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

const { state } = await import("../deploy/js/state.js");
const { MEMORY_CACHE } = await import("../deploy/js/repositories/storage.repository.js");
const { DROP_CHANCES } = await import("../deploy/js/config.js");
const { updateDucatsDB, calculateRelicValue } = await import(
  "../deploy/js/services/inventory/relics.service.js"
);

// weapon parts share names across weapons ("Barrel", "Chassis"): without prepending the item name, the
// last weapon processed overwrote previous ones
test("las piezas genéricas se guardan con el nombre del ítem delante", () => {
  state.ducatsDatabase = {};
  updateDucatsDB([
    { name: "Braton Prime", components: [{ name: "Barrel", ducats: 45 }] },
    { name: "Boltor Prime", components: [{ name: "Barrel", ducats: 15 }] },
  ]);

  assert.equal(state.ducatsDatabase["Braton Prime Barrel"].ducats, 45);
  assert.equal(state.ducatsDatabase["Boltor Prime Barrel"].ducats, 15);
  assert.equal(state.ducatsDatabase.Barrel, undefined, "no puede quedar la clave desnuda");
});

// unique component names already include the weapon: prepending it again would duplicate it ("Nikana Prime
// Nikana Prime Blade")
test("un componente con nombre propio conserva el suyo", () => {
  state.ducatsDatabase = {};
  updateDucatsDB([
    { name: "Kavasa Prime", components: [{ name: "Kavasa Prime Collar Blueprint", ducats: 100 }] },
  ]);
  assert.ok(state.ducatsDatabase["Kavasa Prime Collar Blueprint"]);
  assert.equal(Object.keys(state.ducatsDatabase).length, 1);
});

// warframe components sell as both part and blueprint for the same value: without the duplicate entry half
// the inventory rows lack ducats
test("las partes de warframe generan también su entrada de plano", () => {
  state.ducatsDatabase = {};
  updateDucatsDB([
    { name: "Mag Prime", components: [{ name: "Chassis", ducats: 45 }, { name: "Barrel", ducats: 15 }] },
  ]);

  assert.equal(state.ducatsDatabase["Mag Prime Chassis Blueprint"].ducats, 45);
  assert.equal(state.ducatsDatabase["Mag Prime Barrel Blueprint"], undefined,
    "Barrel no es una parte de warframe: no lleva plano aparte");
});

test("un componente sin valor en ducados no entra en el catálogo", () => {
  state.ducatsDatabase = {};
  updateDucatsDB([
    { name: "Forma", components: [{ name: "Blueprint", ducats: 0 }, { name: "Barrel", ducats: -1 }] },
  ]);
  assert.deepEqual(state.ducatsDatabase, {}, "0 ducados significa que no se vende, no que valga 0");
});

test("un ítem sin componentes no rompe la carga del catálogo", () => {
  state.ducatsDatabase = {};
  assert.doesNotThrow(() => updateDucatsDB([{ name: "Sin Piezas" }, { name: "Vacío", components: [] }]));
  assert.deepEqual(state.ducatsDatabase, {});
});

/**
 * seeds a relic with its drops and prices in memory; defaults to solo so values do not depend on state
 * default squad size
 */
function reliquia(nombre, drops, precios = {}, squadSize = 1) {
  state.relicsDatabase = { [nombre]: drops };
  // squadSize, not playerCount: the recruitment "needed" counter no longer feeds odds
  state.squadSize = squadSize;
  MEMORY_CACHE.clear();
  for (const [slug, plat] of Object.entries(precios)) MEMORY_CACHE.set(slug, plat);
  return nombre;
}

test("una reliquia que no está en la base vale 0 en vez de reventar", async () => {
  state.relicsDatabase = {};
  assert.deepEqual(await calculateRelicValue("Lith Inventada"), { intact: 0, rad: 0, ducats: 0 });
});

// odds distribute by SLOT, not by item: a relic has 1 rare, 2 uncommon, 3 common slots; without dividing
// group odds by slot count, multi-common relic values triple
test("la probabilidad del grupo se reparte entre los huecos de ese grupo", async () => {
  const r = reliquia("Lith T1", [
    { name: "Raro", chance: 2 },
    { name: "Comun", chance: 25.33 },
  ], { raro: 100, comun: 100 });

  const v = await calculateRelicValue(r);
  const esperado = 100 * DROP_CHANCES.Intact.rare + 100 * (DROP_CHANCES.Intact.common / 3);
  assert.equal(v.intact, Number(esperado.toFixed(1)));
});

test("los tres tramos de rareza se deciden por la probabilidad del drop", async () => {
  const solo = async (chance) => {
    const r = reliquia("Lith T2", [{ name: "Pieza", chance }], { pieza: 100 });
    return (await calculateRelicValue(r)).intact;
  };

  assert.equal(await solo(2), Number((100 * DROP_CHANCES.Intact.rare).toFixed(1)), "raro (<5)");
  assert.equal(await solo(11), Number((100 * DROP_CHANCES.Intact.uncommon / 2).toFixed(1)), "poco común (<20)");
  assert.equal(await solo(25.33), Number((100 * DROP_CHANCES.Intact.common / 3).toFixed(1)), "común");
});

// radiant increases rare odds (0.02 -> 0.10) and lowers common odds: refining only pays off if the rare is
// valuable
test("refinar sube el valor de un raro y baja el de un común", async () => {
  const conRaro = reliquia("Lith R", [{ name: "Raro", chance: 2 }], { raro: 100 });
  const vr = await calculateRelicValue(conRaro);
  assert.ok(vr.rad > vr.intact, `radiante debería valer más: ${vr.rad} vs ${vr.intact}`);

  const conComun = reliquia("Lith C", [{ name: "Comun", chance: 25.33 }], { comun: 100 });
  const vc = await calculateRelicValue(conComun);
  assert.ok(vc.rad < vc.intact, `radiante debería valer menos: ${vc.rad} vs ${vc.intact}`);
});

// drops lacking ducats infer them from rarity using fixed game values
test("sin ducados en el dato se deducen de la rareza", async () => {
  const soloDucats = async (chance) => {
    const r = reliquia("Lith D", [{ name: "Pieza", chance }], { pieza: 0 });
    return (await calculateRelicValue(r)).ducats;
  };

  assert.equal(await soloDucats(2), Math.round(100 * DROP_CHANCES.Intact.rare), "raro: 100 ducados");
  assert.equal(await soloDucats(11), Math.round(45 * DROP_CHANCES.Intact.uncommon / 2), "poco común: 45");
  assert.equal(await soloDucats(25.33), Math.round(15 * DROP_CHANCES.Intact.common / 3), "común: 15");
});

test("los ducados que vienen en el dato mandan sobre la deducción", async () => {
  const r = reliquia("Lith E", [{ name: "Pieza", chance: 2, ducats: 65 }], { pieza: 0 });
  assert.equal((await calculateRelicValue(r)).ducats, Math.round(65 * DROP_CHANCES.Intact.rare));
});

// a relic with six drops fetches prices in parallel instead of six sequential trips per row
test("los precios de una reliquia se piden a la vez, no en cadena", async () => {
  const drops = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, chance: 25.33 }));
  const r = reliquia("Lith P", drops, Object.fromEntries(drops.map((d, i) => [`p${i}`, 10])));

  const t0 = Date.now();
  await calculateRelicValue(r);
  assert.ok(Date.now() - t0 < 200, "no debería encadenar esperas");
});

// in a squad of 4 the group picks the BEST reward, heavily weighting expensive drops over raw rates
// previously showed solo values while the Relics tab accounted for squad, giving conflicting values
test("la escuadra sube el valor: te quedas con la mejor de 4 tiradas", async () => {
  const drops = [
    { name: "Raro", chance: 2 },
    { name: "Comun1", chance: 25.33 },
    { name: "Comun2", chance: 25.33 },
    { name: "Comun3", chance: 25.33 },
  ];
  const precios = { raro: 200, comun1: 10, comun2: 10, comun3: 10 };

  const solo = await calculateRelicValue(reliquia("Lith S", drops, precios, 1));
  const grupo = await calculateRelicValue(reliquia("Lith S", drops, precios, 4));

  assert.ok(grupo.intact > solo.intact, `4 jugadores deberían valer más: ${grupo.intact} vs ${solo.intact}`);
  // rare chance of being the best of 4 jumps from 2% to ~7.8%, driving almost the entire increase
  assert.ok(grupo.intact > solo.intact * 1.5, `el salto se queda corto: ${grupo.intact} vs ${solo.intact}`);
});

// an unlisted reward is unpriced (0): previously treated as implicitly above the highest price, eating
// into relic value in squads
test("un hueco sin valorar cuenta como 0, no como el mejor premio", async () => {
  const r = reliquia("Lith H", [{ name: "Raro", chance: 2 }], { raro: 100 }, 4);
  const v = await calculateRelicValue(r);

  // P(best of 4 is rare) = 1 - 0.98^4 = 0.0776
  const esperado = 100 * (1 - Math.pow(1 - 0.02, 4));
  assert.equal(v.intact, Number(esperado.toFixed(1)));
});

test("un precio desconocido cuenta como 0 y no contamina el total", async () => {
  const r = reliquia("Lith Z", [
    { name: "Conocida", chance: 2 },
    { name: "Desconocida", chance: 2 },
  ], { conocida: 100 });

  const v = await calculateRelicValue(r);
  assert.equal(v.intact, Number((100 * DROP_CHANCES.Intact.rare).toFixed(1)));
  assert.ok(Number.isFinite(v.rad) && Number.isFinite(v.ducats), "nada puede salir NaN");
});
