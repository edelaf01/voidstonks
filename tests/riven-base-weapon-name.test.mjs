// Nombre base de un arma: de "Kuva Bramma" a "Bramma".
//
// Es la clave con la que se buscan las estadísticas meta de un riven, así que un fallo aquí no
// da error: devuelve `null` y la tasación cae a los pesos genéricos. El usuario ve un precio
// plausible pero calculado sin los datos de SU arma, y no hay forma de notarlo en pantalla.
//
// Las reglas no se deducen del código: son cuirks del juego (Dex Furis usa el riven de Afuris)
// y decisiones de mapeo de familias.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
// El módulo lanza loadDynamicMetaStats() al importarse y ahí toca el DOM; sin esto el aviso
// ensucia la salida de todos los tests del fichero.
const errorReal = console.error;
console.error = () => {};
const { getBaseWeaponName, getMetaStats } = await import(
  "../deploy/js/services/rivens/riven_market.service.js"
);
console.error = errorReal;

// Dex Furis es un arma dual que usa el riven de Afuris. No hay nada en el nombre que lo
// insinúe: es una regla del juego, y sin ella la tasación de un riven de Dex Furis busca una
// familia que no existe.
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

// MK1-Braton se escribe con guion en el juego y con espacio en varias fuentes de datos. Si solo
// se contemplara una forma, la mitad de los rivens de MK1 buscarían una familia inexistente.
test("el prefijo MK1 se quita con guion y con espacio", () => {
  for (const nombre of ["MK1-Braton", "MK1 Braton", "Mk-1 Braton", "mk1-braton"]) {
    assert.match(getBaseWeaponName(nombre), /braton/i, nombre);
    assert.ok(!/mk-?1/i.test(getBaseWeaponName(nombre)), `${nombre} conserva el MK1`);
  }
});

// El bucle repite hasta que no cambia nada: hay nombres con prefijo Y sufijo, y una sola
// pasada dejaría la mitad puesta.
test("prefijo y sufijo a la vez se quitan los dos", () => {
  assert.equal(getBaseWeaponName("Prisma Grakata Prime"), "Grakata");
  assert.equal(getBaseWeaponName("Kuva Bramma Vandal"), "Bramma");
});

// La tabla de overrides existe porque el despiece genérico daría el nombre equivocado: "Prime
// Laser Rifle" lleva el "Prime" delante, y "Pangolin Prime" es una espada cuyo nombre base
// lleva la palabra "Sword" que no está en el original.
test("los mapeos de familia mandan sobre el despiece genérico", () => {
  assert.equal(getBaseWeaponName("Prime Laser Rifle"), "Laser Rifle");
  assert.equal(getBaseWeaponName("Prime Burst Laser"), "Burst Laser");
  assert.equal(getBaseWeaponName("Vaykor Marelok"), "Marelok");
  assert.equal(getBaseWeaponName("Vaykor Hek"), "Hek");
  assert.equal(getBaseWeaponName("Pangolin Prime"), "Pangolin Sword");
  assert.equal(getBaseWeaponName("Pangolin"), "Pangolin Sword", "también sin variante");
});

// Las tres grafías salen de fuentes distintas (WFM, el catálogo local, el OCR del escáner).
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

// El OCR del escáner puede meter espacios de más al leer la pantalla de reroll.
test("los espacios sobrantes no impiden reconocer el arma", () => {
  assert.equal(getBaseWeaponName("  Kuva   Bramma  "), "Bramma");
  assert.equal(getBaseWeaponName("Braton    Prime"), "Braton");
});

// "Prime" sola no es un prefijo: el patrón exige que vaya seguida de espacio. Sin esa
// condición, cualquier arma que se llamara así desaparecería.
test("una palabra de prefijo suelta no se come el nombre entero", () => {
  assert.equal(getBaseWeaponName("Prime"), "Prime");
  assert.equal(getBaseWeaponName("Kuva"), "Kuva");
});

test("sin nombre devuelve cadena vacía, nunca null ni undefined", () => {
  for (const vacio of ["", null, undefined, "   "]) {
    assert.equal(getBaseWeaponName(vacio), "", JSON.stringify(vacio));
  }
});

// Documentado, no deseable: la función respeta las mayúsculas de lo que queda, así que
// "kuva bramma" sale como "bramma". No rompe la búsqueda porque getMetaStats compara familias
// en minúsculas, pero el acceso directo `rivenIndexData[baseName]` sí es sensible: quien añada
// otra vía de búsqueda tiene que recordar normalizar.
test("la caja del resto del nombre se conserva tal cual", () => {
  assert.equal(getBaseWeaponName("kuva bramma"), "bramma");
  assert.equal(getBaseWeaponName("KUVA BRAMMA"), "BRAMMA");
});

test("getMetaStats no inventa datos cuando no hay índice cargado", () => {
  assert.equal(getMetaStats(""), null);
  assert.equal(getMetaStats(null), null);
});
