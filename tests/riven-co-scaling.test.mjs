// Escalado de Condition Overload (`coScaling`) que se muestra como insignia en la vista de rivens.
//
// El dato no está en WFCD: sale de una lista curada contra la hoja de tests de la comunidad
// ("Galvanized GunCO on Projectiles"). El fallo típico no da error — la insignia dice
// "Multiplicativo" en verde sobre un arma que en realidad suma plano, y el usuario moda con eso.
//
// Los casos de abajo son justamente los que la regla vieja ("proyectil ⇒ multiplicativo",
// "melee ⇒ multiplicativo") ponía en verde por error.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let WFCD = {};
// applyCombatOverrides memoiza el JSON a nivel de módulo (en el navegador es un fichero
// estático), así que el override es fijo para todo el fichero y no un parámetro por test.
const OVERRIDES = { Torid: { coScaling: "additive" }, Haalvu: { coScaling: "multiplicative" } };
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("cleaned_weapons")) return { ok: true, json: async () => [] };
  if (u.includes("metastats")) return { ok: true, json: async () => ({}) };
  if (u.includes("combat_stats_overrides")) return { ok: true, json: async () => OVERRIDES };
  const cat = /data\/json\/([A-Za-z-]+)\.json/.exec(u);
  if (cat) return { ok: true, json: async () => WFCD[cat[1]] || [] };
  return { ok: false, status: 404, json: async () => ({}) };
};

const { state } = await import("../deploy/js/state.js");
const { fetchRivenWeapons } = await import("../deploy/js/services/rivens/rivens.service.js");

const proyectil = (name, type) => ({ name, type, attacks: [{ name: "Normal Attack", shot_type: "Projectile" }] });
const hitscan = (name, type) => ({ name, type, attacks: [{ name: "Normal Attack", shot_type: "Hit-Scan" }] });

/** Construye combatStatsDB desde cero con las armas WFCD que se le pasen. */
async function combatStats(porCategoria) {
  WFCD = porCategoria;
  state.weaponMap = null;
  state.combatStatsDB = null;
  const ruido = console.error;
  console.error = () => {};
  try {
    await fetchRivenWeapons();
    // fetchWeaponCombatStats se lanza sin await desde fetchRivenWeapons.
    for (let i = 0; i < 200 && !state.combatStatsDB; i++) await new Promise(r => setTimeout(r, 5));
  } finally { console.error = ruido; }
  return state.combatStatsDB;
}

const co = (db, name) => db[name].coScaling;

// El criterio de la hoja: lo que no aparece listado suma plano. Acceltra, Boltor, Lenz y compañía
// son proyectiles y están listados explícitamente como "Adds" — la regla vieja los daba por
// multiplicativos solo por ser proyectiles.
test("un proyectil que no está en la lista suma plano", async () => {
  const db = await combatStats({
    Primary: [proyectil("Boltor", "Rifle"), proyectil("Kuva Bramma", "Rifle"), proyectil("Lenz", "Rifle")],
  });
  assert.equal(co(db, "Boltor"), "additive");
  assert.equal(co(db, "Kuva Bramma"), "additive");
  assert.equal(co(db, "Lenz"), "additive");
});

test("Acceltra suma plano pese a ser proyectil", async () => {
  const db = await combatStats({ Primary: [proyectil("Acceltra", "Rifle"), proyectil("Acceltra Prime", "Rifle")] });
  assert.equal(co(db, "Acceltra"), "additive");
  assert.equal(co(db, "Acceltra Prime"), "additive");
});

// "Normal Melee Hits: Adds" — Condition Overload cae en el mismo saco de daño base que
// Pressure Point, así que no multiplica.
test("el melee normal suma plano", async () => {
  const db = await combatStats({ Melee: [hitscan("Skana", "Melee"), hitscan("Nikana Prime", "Melee")] });
  assert.equal(co(db, "Skana"), "additive");
  assert.equal(co(db, "Nikana Prime"), "additive");
});

// Los melee que sí multiplican lo hacen solo en un ataque secundario (onda pesada, proyectil de
// bloqueo). Marcar el arma entera diría que el combo normal multiplica, y no es verdad.
test("un melee que solo multiplica en su ataque pesado no se marca", async () => {
  const db = await combatStats({ Melee: [hitscan("Corufell", "Melee"), hitscan("Syam", "Melee")] });
  assert.equal(co(db, "Corufell"), "additive");
  assert.equal(co(db, "Syam"), "additive");
});

test("las armas de la lista multiplican, sean proyectil o hitscan", async () => {
  const db = await combatStats({
    Primary: [hitscan("Shedu", "Rifle"), proyectil("Stahlta", "Rifle")],
    Secondary: [hitscan("Seer", "Pistol"), proyectil("Epitaph", "Pistol")],
    "Arch-Gun": [proyectil("Velocitus", "Arch-Gun")],
  });
  for (const n of ["Shedu", "Stahlta", "Seer", "Epitaph", "Velocitus"]) {
    assert.equal(co(db, n), "multiplicative", n);
  }
});

// Kitgun: en el catálogo de la app "Sporelacer" es la secundaria, y la hoja separa
// "Sporelacer Primary" (multiplica) de "Sporelacer Pistol" (suma). Catchmoon multiplica en las dos.
test("Sporelacer suma plano y Catchmoon multiplica", async () => {
  const db = await combatStats({ Secondary: [proyectil("Sporelacer", "Pistol"), proyectil("Catchmoon", "Pistol")] });
  assert.equal(co(db, "Sporelacer"), "additive");
  assert.equal(co(db, "Catchmoon"), "multiplicative");
});

// Las que solo multiplican en alt-fire/carga/arpón/ADS quedan fuera a propósito.
test("multiplicar solo en un modo secundario no marca el arma", async () => {
  const db = await combatStats({
    Primary: [proyectil("Cedo", "Shotgun"), hitscan("Quellor", "Rifle"), hitscan("Harpak", "Rifle"), hitscan("Zenith", "Rifle")],
    Secondary: [hitscan("Tenet Diplos", "Pistol"), proyectil("Zymos", "Pistol")],
  });
  for (const n of ["Cedo", "Quellor", "Harpak", "Zenith", "Tenet Diplos", "Zymos"]) {
    assert.equal(co(db, n), "additive", n);
  }
});

// Torid está en la lista curada como multiplicativo y Haalvu no está en ninguna: el override
// tiene que poder darle la vuelta a las dos.
test("el override manda sobre la lista curada", async () => {
  const db = await combatStats({ Primary: [proyectil("Torid", "Rifle"), proyectil("Haalvu", "Rifle")] });
  assert.equal(co(db, "Torid"), "additive");
  assert.equal(co(db, "Haalvu"), "multiplicative");
});

// Sin attacks[] no hay shot_type que consultar; antes eso era el único camino al "additive"
// por defecto y ahora es simplemente el caso general.
test("un arma sin datos de ataque sigue teniendo insignia", async () => {
  const db = await combatStats({ Primary: [{ name: "Braton", type: "Rifle" }] });
  assert.equal(co(db, "Braton"), "additive");
});
