// Las DOS funciones que resuelven la familia de un arma — y por qué NO son la misma.
//
// `extractFamilyName` (utils/riven_family.js) y `getBaseWeaponName`
// (services/riven_market.service.js) comparten la tabla de overrides palabra por palabra, así
// que parecen una copia sin sincronizar. No lo son: tienen trabajos distintos, y confundirlos
// lleva a "unificarlas", que es un cambio silencioso en la tasación.
//
//   getBaseWeaponName  resuelve las stats meta de ESTA arma. Las variantes tienen entrada
//                      propia en metastats.json (están "Lacera" Y "Ceti Lacera", "Nikana" Y
//                      "Dragon Nikana"), así que despellejar de más le haría usar los datos del
//                      arma base para una variante que tiene los suyos.
//   extractFamilyName  es el FALLBACK de agrupación: `[weaponName, extractFamilyName(...)]` se
//                      prueba en ese orden. Existe justo para el caso contrario — "Prisma Obex
//                      no está en stat_weights.json pero Obex sí: el riven es el mismo"
//                      (ui_rivens.js:164). Ahí despellejar de más es lo que se busca.
//
// Por eso una recorre en bucle y la otra quita un prefijo y un sufijo, y por eso sus listas no
// tienen que ser idénticas. Lo que sí conviene vigilar es que la deriva sea la conocida: si
// alguien añade un prefijo pensando que da igual cuál de las dos toca, aquí sale con el nombre
// del arma y con esta explicación delante.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

const { extractFamilyName } = await import("../deploy/js/utils/rivens/riven_family.js");
const errorReal = console.error;
console.error = () => {};
const { getBaseWeaponName } = await import("../deploy/js/services/rivens/riven_market.service.js");
console.error = errorReal;

/**
 * Divergencias conocidas: nombre -> [extractFamilyName, getBaseWeaponName].
 *
 * Que estén aquí NO significa que haya que igualarlas. Significa que se han mirado una a una y
 * son las que son. Si aparece una nueva, hay que decidir a cuál de los dos trabajos pertenece.
 */
const DIVERGENCIAS = {
  // Solo riven.repository conoce estos prefijos/sufijos.
  "Ceti Lacera": ["Lacera", "Ceti Lacera"],
  "Mutalist Cernos": ["Cernos", "Mutalist Cernos"],
  "Shadow Dex Dakra": ["Dex Dakra", "Shadow Dex Dakra"],
  "Braton Prime Blueprint": ["Braton Prime", "Braton Prime Blueprint"],
  "Excalibur Umbra": ["Excalibur", "Excalibur Umbra"],
  // Y solo riven_market conoce "Dragon".
  "Dragon Nikana": ["Dragon Nikana", "Nikana"],
};

/** Nombres en los que las dos deben coincidir. Si uno cae aquí, la deriva ha crecido. */
const COINCIDEN = [
  "Kuva Bramma", "Tenet Envoy", "Prisma Grakata", "Prisma Grakata Prime",
  "Dex Furis", "Dex Afuris", "MK1-Braton", "Mk1 Paris",
  "Pangolin Prime", "Vaykor Hek", "Vaykor Marelok", "Telos Boltor",
  "Sancti Tigris", "Carmine Penta", "Secura Dual Cestra", "Rakta Cernos",
  "Synoid Gammacor", "Prime Laser Rifle", "Prime Burst Laser",
  "Prisma Dual Decurions", "Dual Decurions", "Braton Prime", "Nikana", "Hek",
];

test("las dos funciones coinciden en todo lo que no está en la lista de divergencias", () => {
  const nuevas = [];
  for (const nombre of COINCIDEN) {
    const a = extractFamilyName(nombre);
    const b = getBaseWeaponName(nombre);
    if (a !== b) nuevas.push(`${nombre}: extractFamilyName=${a} vs getBaseWeaponName=${b}`);
  }
  assert.equal(
    nuevas.length,
    0,
    "La deriva entre las dos listas ha crecido. Antes de igualarlas, mira para qué sirve cada\n" +
      "una (arriba): extractFamilyName agrupa hacia el arma base a propósito, getBaseWeaponName\n" +
      "resuelve las stats de ESTA arma y despellejar de más le da las del arma equivocada.\n" +
      `Armas afectadas:\n  ${nuevas.join("\n  ")}\n`,
  );
});

test("las divergencias conocidas siguen siendo exactamente esas", () => {
  const cambiadas = [];
  for (const [nombre, [esperadoA, esperadoB]] of Object.entries(DIVERGENCIAS)) {
    const a = extractFamilyName(nombre);
    const b = getBaseWeaponName(nombre);
    if (a === b) {
      cambiadas.push(`${nombre}: YA COINCIDEN (${a}) -> bórralo de DIVERGENCIAS`);
    } else if (a !== esperadoA || b !== esperadoB) {
      cambiadas.push(`${nombre}: ahora ${a} vs ${b}, se esperaba ${esperadoA} vs ${esperadoB}`);
    }
  }
  assert.equal(cambiadas.length, 0, `\n  ${cambiadas.join("\n  ")}\n`);
});

// La tabla de overrides es idéntica en las dos, palabra por palabra. Es la prueba de que una es
// copia de la otra, y el sitio más fácil de que se separen sin querer.
test("los mapeos de familia dan lo mismo por las dos vías", () => {
  const overrides = {
    "prisma dual decurions": "Dual Decurion",
    "dual decurions": "Dual Decurion",
    "prisma dual decurion": "Dual Decurion",
    "dex furis": "Afuris",
    "dex afuris": "Afuris",
    "pangolin prime": "Pangolin Sword",
    "prime laser rifle": "Laser Rifle",
    "prime burst laser": "Burst Laser",
    "prime robo-deth": "Robo-Deth",
    "prime deth machine rifle": "Deth Machine Rifle",
    "vaykor marelok": "Marelok",
    "vaykor hek": "Hek",
  };
  for (const [entrada, esperado] of Object.entries(overrides)) {
    assert.equal(extractFamilyName(entrada), esperado, `extractFamilyName(${entrada})`);
    assert.equal(getBaseWeaponName(entrada), esperado, `getBaseWeaponName(${entrada})`);
  }
});

// extractFamilyName quita UN prefijo y UN sufijo (rompe el bucle al primero). getBaseWeaponName
// repite hasta que no cambia nada. Con un solo modificador da igual; con dos, no.
test("con prefijo y sufijo a la vez solo una de las dos los quita todos", () => {
  assert.equal(extractFamilyName("Prisma Grakata Prime"), "Grakata", "una pasada de cada basta aquí");
  assert.equal(getBaseWeaponName("Prisma Grakata Prime"), "Grakata");

  // Dos prefijos encadenados: ahí sí se ve la diferencia de enfoque.
  assert.equal(extractFamilyName("Shadow Dex Dakra"), "Dex Dakra", "solo quita el primero");
  assert.equal(getBaseWeaponName("Shadow Dex Dakra"), "Shadow Dex Dakra", "no conoce 'Shadow'");
});
