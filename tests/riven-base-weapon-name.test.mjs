import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
const errorReal = console.error;
console.error = () => {};
const { getBaseWeaponName, getMetaStats } = await import(
  "../deploy/js/services/rivens/riven_market.service.js"
);
console.error = errorReal;

test("Dex Furis y Dex Afuris comparten el riven de Afuris", () => {
  assert.equal(getBaseWeaponName("Dex Furis"), "Afuris");
  assert.equal(getBaseWeaponName("Dex Afuris"), "Afuris");
  assert.equal(getBaseWeaponName("dex furis"), "Afuris", "también en minúsculas");
});

test("los prefijos de facción y variante se quitan", () => {
  const casos = {
    "Kuva Bramma": "Bramma",
    "Tenet Envoy": "Envoy",
    "Coda Motovore": "Motovore",
    "Prisma Grakata": "Grakata",
    "Telos Boltor": "Boltor",
    "Synoid Gammacor": "Gammacor",
    "Secura Dual Cestra": "Dual Cestra",
    "Rakta Cernos": "Cernos",
    "Sancti Tigris": "Tigris",
    "Mara Detron": "Detron",
    "Carmine Penta": "Penta",
    "Dragon Nikana": "Nikana",
    "Dex Dakra": "Dakra",
  };
  for (const [entrada, esperado] of Object.entries(casos)) {
    assert.equal(getBaseWeaponName(entrada), esperado, entrada);
  }
});

test("los sufijos de variante también", () => {
  assert.equal(getBaseWeaponName("Braton Prime"), "Braton");
  assert.equal(getBaseWeaponName("Braton Vandal"), "Braton");
  assert.equal(getBaseWeaponName("Latron Wraith"), "Latron");
});

test("el prefijo MK1 se quita con guion y con espacio", () => {
  for (const nombre of ["MK1-Braton", "MK1 Braton", "Mk-1 Braton", "mk1-braton"]) {
    assert.match(getBaseWeaponName(nombre), /braton/i, nombre);
    assert.ok(!/mk-?1/i.test(getBaseWeaponName(nombre)), `${nombre} conserva el MK1`);
  }
});

test("prefijo y sufijo a la vez se quitan los dos", () => {
  assert.equal(getBaseWeaponName("Prisma Grakata Prime"), "Grakata");
  assert.equal(getBaseWeaponName("Kuva Bramma Vandal"), "Bramma");
});

test("los mapeos de familia mandan sobre el despiece genérico", () => {
  assert.equal(getBaseWeaponName("Prime Laser Rifle"), "Laser Rifle");
  assert.equal(getBaseWeaponName("Prime Burst Laser"), "Burst Laser");
  assert.equal(getBaseWeaponName("Vaykor Marelok"), "Marelok");
  assert.equal(getBaseWeaponName("Vaykor Hek"), "Hek");
  assert.equal(getBaseWeaponName("Pangolin Prime"), "Pangolin Sword");
  assert.equal(getBaseWeaponName("Pangolin"), "Pangolin Sword", "también sin variante");
});

test("las tres formas de Dual Decurion caen en la misma familia", () => {
  assert.equal(getBaseWeaponName("Prisma Dual Decurions"), "Dual Decurion");
  assert.equal(getBaseWeaponName("Dual Decurions"), "Dual Decurion");
  assert.equal(getBaseWeaponName("Prisma Dual Decurion"), "Dual Decurion");
});

test("un arma sin prefijo ni sufijo se queda como está", () => {
  for (const nombre of ["Hek", "Nikana", "Boltor", "Dual Cestra"]) {
    assert.equal(getBaseWeaponName(nombre), nombre);
  }
});

test("los espacios sobrantes no impiden reconocer el arma", () => {
  assert.equal(getBaseWeaponName("  Kuva   Bramma  "), "Bramma");
  assert.equal(getBaseWeaponName("Braton    Prime"), "Braton");
});

test("una palabra de prefijo suelta no se come el nombre entero", () => {
  assert.equal(getBaseWeaponName("Prime"), "Prime");
  assert.equal(getBaseWeaponName("Kuva"), "Kuva");
});

test("sin nombre devuelve cadena vacía, nunca null ni undefined", () => {
  for (const vacio of ["", null, undefined, "   "]) {
    assert.equal(getBaseWeaponName(vacio), "", JSON.stringify(vacio));
  }
});

test("la caja del resto del nombre se conserva tal cual", () => {
  assert.equal(getBaseWeaponName("kuva bramma"), "bramma");
  assert.equal(getBaseWeaponName("KUVA BRAMMA"), "BRAMMA");
});

test("getMetaStats no inventa datos cuando no hay índice cargado", () => {
  assert.equal(getMetaStats(""), null);
  assert.equal(getMetaStats(null), null);
});
