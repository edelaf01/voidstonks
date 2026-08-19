import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

const { extractFamilyName } = await import("../deploy/js/utils/rivens/riven_family.js");
const errorReal = console.error;
console.error = () => {};
const { getBaseWeaponName } = await import("../deploy/js/services/rivens/riven_market.service.js");
console.error = errorReal;

const DIVERGENCIAS = {
  "Ceti Lacera": ["Lacera", "Ceti Lacera"],
  "Mutalist Cernos": ["Cernos", "Mutalist Cernos"],
  "Shadow Dex Dakra": ["Dex Dakra", "Shadow Dex Dakra"],
  "Braton Prime Blueprint": ["Braton Prime", "Braton Prime Blueprint"],
  "Excalibur Umbra": ["Excalibur", "Excalibur Umbra"],
  "Dragon Nikana": ["Dragon Nikana", "Nikana"],
};

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

test("con prefijo y sufijo a la vez solo una de las dos los quita todos", () => {
  assert.equal(extractFamilyName("Prisma Grakata Prime"), "Grakata", "una pasada de cada basta aquí");
  assert.equal(getBaseWeaponName("Prisma Grakata Prime"), "Grakata");

  assert.equal(extractFamilyName("Shadow Dex Dakra"), "Dex Dakra", "solo quita el primero");
  assert.equal(getBaseWeaponName("Shadow Dex Dakra"), "Shadow Dex Dakra", "no conoce 'Shadow'");
});
