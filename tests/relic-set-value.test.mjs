import { test } from "node:test";
import assert from "node:assert/strict";
import { relicSetValue, partDropChance } from "../deploy/js/utils/inventory/relic_set_value.js";

// Tramo radiante de DROP_CHANCES (config.js).
const RAD = { rare: 0.1, uncommon: 0.4, common: 0.5 };

const SETS = {
  "Nidus Prime": ["Nidus Prime Blueprint", "Nidus Prime Neuroptics", "Nidus Prime Chassis", "Nidus Prime Systems"],
  "Gara Prime": ["Gara Prime Blueprint", "Gara Prime Neuroptics", "Gara Prime Chassis", "Gara Prime Systems"],
};
const getSetName = (part) => (part.match(/(.*?) (Prime|Vandal|Wraith)/) || [])[0]?.trim() || "Otros";
const deps = (primeInventory) => ({
  setsDatabase: SETS, primeInventory,
  getSetName, getRequiredCount: () => 1, dropChances: RAD, squadSize: 4,
});

const RARE = { chance: 2 }, UNCOMMON = { chance: 11 }, COMMON = { chance: 25 };
const drop = (name, rarity) => ({ name, ...rarity });

test("runs: sin piezas que falten, la reliquia no sirve para sets", () => {
  const owned = Object.fromEntries(SETS["Nidus Prime"].map((p) => [p, 1]));
  const r = relicSetValue([drop("Nidus Prime Systems", COMMON)], deps(owned));
  assert.equal(r.runs, Infinity);
  assert.deepEqual(r.missing, []);
});

test("runs: Forma y demás no cuentan como set", () => {
  const r = relicSetValue([drop("Forma Blueprint", COMMON)], deps({}));
  assert.equal(r.runs, Infinity);
});

test("runs: más piezas que faltan ⇒ menos runs", () => {
  const una = relicSetValue([drop("Nidus Prime Systems", COMMON)], deps({}));
  const tres = relicSetValue([
    drop("Nidus Prime Systems", COMMON),
    drop("Nidus Prime Chassis", COMMON),
    drop("Gara Prime Chassis", COMMON),
  ], deps({}));
  assert.ok(tres.runs < una.runs, `${tres.runs} debería ser menor que ${una.runs}`);
});

test("runs: una común que falta cuesta menos runs que una rara", () => {
  const comun = relicSetValue([drop("Nidus Prime Systems", COMMON)], deps({}));
  const rara = relicSetValue([drop("Nidus Prime Systems", RARE)], deps({}));
  assert.ok(comun.runs < rara.runs, `común ${comun.runs} vs rara ${rara.runs}`);
});

test("runs: la escuadra de 4 baja las runs frente a ir solo", () => {
  const solo = relicSetValue([drop("Nidus Prime Systems", RARE)], { ...deps({}), squadSize: 1 });
  const grupo = relicSetValue([drop("Nidus Prime Systems", RARE)], deps({}));
  assert.equal(Math.round(solo.runs), 10);   // rara radiante en solitario: 10%
  assert.ok(grupo.runs < solo.runs / 2, `en grupo ${grupo.runs} vs solo ${solo.runs}`);
});

test("runs: bestSet es el set más cerca de cerrarse", () => {
  // A Nidus le falta 1 pieza; a Gara le faltan 3.
  const owned = {
    "Nidus Prime Blueprint": 1, "Nidus Prime Neuroptics": 1, "Nidus Prime Chassis": 1,
    "Gara Prime Blueprint": 1,
  };
  const r = relicSetValue([
    drop("Gara Prime Chassis", COMMON),
    drop("Nidus Prime Systems", RARE),
  ], deps(owned));
  assert.equal(r.bestSet, "Nidus Prime");
  assert.equal(r.bestSetMissing, 1, "a Nidus le queda 1 pieza");
});

test("runs: una pieza a medias (requiere 2, tienes 1) sigue faltando", () => {
  const d = { ...deps({ "Nidus Prime Systems": 1 }), getRequiredCount: () => 2 };
  const r = relicSetValue([drop("Nidus Prime Systems", COMMON)], d);
  assert.ok(Number.isFinite(r.runs));
  assert.equal(r.missing.length, 1);
});

test("bestSet: un set EMPEZADO gana a uno pequeño sin tocar", () => {
  // Akbronco tiene 2 piezas y no has tocado ninguna; a Nidus (4) le falta 1.
  const SETS2 = { ...SETS, "Akbronco Prime": ["Akbronco Prime Blueprint", "Akbronco Prime Link"] };
  const owned = {
    "Nidus Prime Blueprint": 1, "Nidus Prime Neuroptics": 1, "Nidus Prime Chassis": 1,
  };
  const r = relicSetValue([
    drop("Akbronco Prime Link", COMMON),
    drop("Nidus Prime Systems", RARE),
  ], { ...deps(owned), setsDatabase: SETS2 });
  assert.equal(r.bestSet, "Nidus Prime", "un set a medias manda sobre uno sin empezar");
  assert.equal(r.bestSetMissing, 1);
  assert.equal(r.bestSetTotal, 4);
  assert.equal(r.bestSetStarted, true);
});

test("bestSet: sin nada empezado, decide la pieza más probable", () => {
  const SETS2 = { ...SETS, "Akbronco Prime": ["Akbronco Prime Blueprint", "Akbronco Prime Link"] };
  const r = relicSetValue([
    drop("Akbronco Prime Link", RARE),
    drop("Nidus Prime Systems", COMMON),
  ], { ...deps({}), setsDatabase: SETS2 });
  assert.equal(r.bestSetStarted, false);
  assert.equal(r.bestSet, "Nidus Prime", "ninguno empezado: gana la que de verdad vas a sacar");
});

test("odds: tener más copias sube la probabilidad de cerrar el set", () => {
  const una = relicSetValue([drop("Nidus Prime Systems", RARE)], { ...deps({}), stock: 1 });
  const doce = relicSetValue([drop("Nidus Prime Systems", RARE)], { ...deps({}), stock: 12 });
  assert.ok(doce.odds > una.odds, `12 copias ${doce.odds} vs 1 copia ${una.odds}`);
  assert.ok(doce.odds > 0.95, `con 12 copias debería ser casi seguro, es ${doce.odds}`);
  // Las runs NO cambian con el stock: son por apertura. Lo que cambia es cuántas puedes hacer.
  assert.equal(una.runs, doce.runs);
});

test("odds: sin nada que falte, ni runs ni odds", () => {
  const owned = Object.fromEntries(SETS["Nidus Prime"].map((p) => [p, 1]));
  const r = relicSetValue([drop("Nidus Prime Systems", COMMON)], { ...deps(owned), stock: 99 });
  assert.equal(r.odds, 0);
});

test("partDropChance reparte la probabilidad entre las piezas del tramo", () => {
  assert.equal(partDropChance(2, RAD), 0.1);        // 1 rara
  assert.equal(partDropChance(11, RAD), 0.2);       // 2 poco comunes
  assert.ok(Math.abs(partDropChance(25, RAD) - 0.5 / 3) < 1e-9); // 3 comunes
});
