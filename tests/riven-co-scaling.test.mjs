import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let WFCD = {};
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

async function combatStats(porCategoria) {
  WFCD = porCategoria;
  state.weaponMap = null;
  state.combatStatsDB = null;
  const ruido = console.error;
  console.error = () => {};
  try {
    await fetchRivenWeapons();
    // fetchWeaponCombatStats is called without await from fetchRivenWeapons
    for (let i = 0; i < 200 && !state.combatStatsDB; i++) await new Promise(r => setTimeout(r, 5));
  } finally { console.error = ruido; }
  return state.combatStatsDB;
}

const co = (db, name) => db[name].coScaling;

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

test("el melee normal suma plano", async () => {
  const db = await combatStats({ Melee: [hitscan("Skana", "Melee"), hitscan("Nikana Prime", "Melee")] });
  assert.equal(co(db, "Skana"), "additive");
  assert.equal(co(db, "Nikana Prime"), "additive");
});

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

test("Sporelacer suma plano y Catchmoon multiplica", async () => {
  const db = await combatStats({ Secondary: [proyectil("Sporelacer", "Pistol"), proyectil("Catchmoon", "Pistol")] });
  assert.equal(co(db, "Sporelacer"), "additive");
  assert.equal(co(db, "Catchmoon"), "multiplicative");
});

test("multiplicar solo en un modo secundario no marca el arma", async () => {
  const db = await combatStats({
    Primary: [proyectil("Cedo", "Shotgun"), hitscan("Quellor", "Rifle"), hitscan("Harpak", "Rifle"), hitscan("Zenith", "Rifle")],
    Secondary: [hitscan("Tenet Diplos", "Pistol"), proyectil("Zymos", "Pistol")],
  });
  for (const n of ["Cedo", "Quellor", "Harpak", "Zenith", "Tenet Diplos", "Zymos"]) {
    assert.equal(co(db, n), "additive", n);
  }
});

test("el override manda sobre la lista curada", async () => {
  const db = await combatStats({ Primary: [proyectil("Torid", "Rifle"), proyectil("Haalvu", "Rifle")] });
  assert.equal(co(db, "Torid"), "additive");
  assert.equal(co(db, "Haalvu"), "multiplicative");
});

test("un arma sin datos de ataque sigue teniendo insignia", async () => {
  const db = await combatStats({ Primary: [{ name: "Braton", type: "Rifle" }] });
  assert.equal(co(db, "Braton"), "additive");
});
