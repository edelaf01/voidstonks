// Primes recién salidos que todavía no están en ninguna reliquia (deploy/js/utils/inventory/catalog_parts.js).
//
// Visto en vivo el día de la Update 44: la pantalla de recompensas enseñaba "Steflos Prime
// Blueprint" y el escáner leía las otras tres piezas pero no esa. El vocabulario salía solo de
// las tablas de drops, que publican las reliquias nuevas días después de la update.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document ??= { getElementById: () => null, createElement: () => ({ getContext: () => null }) };

const { state } = await import("../deploy/js/state.js");
const { piezasSinReliquias, ducadosDePieza } = await import("../deploy/js/utils/inventory/catalog_parts.js");

const CITRINE = { name: "Citrine Prime", category: "Warframes", isPrime: true, components: [
  { name: "Blueprint", ducats: 45 }, { name: "Chassis", ducats: 15 }, { name: "Neuroptics", ducats: 100 },
  { name: "Orokin Cell", ducats: 0 }, { name: "Systems", ducats: 45 },
] };
const STEFLOS = { name: "Steflos Prime", category: "Primary", isPrime: true, components: [
  { name: "Barrel", ducats: 100 }, { name: "Blueprint", ducats: 45 }, { name: "Receiver", ducats: 15 },
] };

test("un prime sin reliquias entra con los nombres de la pantalla de recompensas", () => {
  assert.deepEqual(piezasSinReliquias([CITRINE, STEFLOS], []), [
    "Citrine Prime Blueprint", "Citrine Prime Chassis Blueprint", "Citrine Prime Neuroptics Blueprint",
    "Citrine Prime Systems Blueprint", "Steflos Prime Barrel", "Steflos Prime Blueprint", "Steflos Prime Receiver",
  ]);
});

// Los sistemas de un sentinel no son un plano: con la regla de los warframes salía "Carrier
// Prime Systems Blueprint", un nombre que no existe en el juego.
test("las piezas de sentinel no llevan Blueprint; las de archwing sí", () => {
  assert.deepEqual(piezasSinReliquias([
    { name: "Carrier Prime", category: "Sentinels", isPrime: true, components: [{ name: "Systems", ducats: 45 }] },
    { name: "Odonata Prime", category: "Archwing", isPrime: true, components: [{ name: "Harness", ducats: 45 }] },
  ], []), ["Carrier Prime Systems", "Odonata Prime Harness Blueprint"]);
});

// Por set y no por pieza: comparar pieza a pieza metía nombres paralelos a los de las reliquias
// ("Xaku Prime Chassis" junto a "Xaku Prime Chassis Blueprint") en sets que ya estaban completos.
test("si alguna pieza del set ya sale en reliquias, el set no se toca", () => {
  const xaku = { name: "Xaku Prime", category: "Warframes", isPrime: true, components: [{ name: "Chassis", ducats: 45 }] };
  assert.deepEqual(piezasSinReliquias([xaku], ["Xaku Prime Blueprint"]), []);
});

test("lo que no es prime o no da ducados no entra, y un componente con nombre propio se queda como está", () => {
  assert.deepEqual(piezasSinReliquias([
    { name: "Narin", category: "Warframes", isPrime: false, components: [{ name: "Chassis", ducats: 0 }] },
    { name: "Kavasa Prime Kubrow Collar", category: "Misc", isPrime: true, components: [{ name: "Kavasa Prime Buckle", ducats: 45 }] },
  ], []), ["Kavasa Prime Buckle"]);
});

test("los ducados salen de la reliquia y, si la pieza aún no está en ninguna, del catálogo", () => {
  state.itemsDatabase = { "Braton Prime Barrel": [{ relic: "Lith B1", ducats: 45 }], "Steflos Prime Blueprint": [] };
  state.ducatsDatabase = { "Steflos Prime Blueprint": { name: "Steflos Prime Blueprint", ducats: 45 } };
  assert.equal(ducadosDePieza("Braton Prime Barrel"), 45);
  assert.equal(ducadosDePieza("Steflos Prime Blueprint"), 45);
  assert.equal(ducadosDePieza("Pieza Inventada"), 0);
});

// --- La cadena entera: tablas de drops sin el prime nuevo -> escáner que lo reconoce ---------

test("con las reliquias sin publicar, el escáner reconoce la pieza nueva y el set existe", async () => {
  const { dbHelper } = await import("../deploy/js/repositories/storage.repository.js");
  const { updateDucatsDB, downloadRelics } = await import("../deploy/js/services/inventory/relics.service.js");
  const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
  const reliquias = [{ tier: "Axi", relicName: "A5", state: "Intact", rewards: [
    { itemName: "Chroma Prime Systems Blueprint", rarity: "Uncommon", chance: 11 },
    { itemName: "Daikyu Prime Blueprint", rarity: "Common", chance: 25.33 },
  ] }];
  const orig = { get: dbHelper.get, set: dbHelper.set, fetch: globalThis.fetch };
  dbHelper.get = async () => null;
  dbHelper.set = async () => {};
  globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes("relics_opt") ? { relics: reliquias } : {}) });
  try {
    Object.assign(state, { primeManifest: [], primeWeaponsManifest: [STEFLOS], ducatsDatabase: {}, activeResurgenceList: new Set() });
    updateDucatsDB([STEFLOS]);
    await downloadRelics();

    assert.deepEqual(state.itemsDatabase["Steflos Prime Blueprint"], [], "entra sin reliquias");
    assert.equal(state.itemsDatabase["Daikyu Prime Blueprint"].length, 1, "lo que ya estaba no cambia");
    assert.deepEqual([...state.setsDatabase["Steflos Prime"]].sort(), ["Steflos Prime Barrel", "Steflos Prime Blueprint", "Steflos Prime Receiver"]);

    OCRService.cachedDbItems = [];
    OCRService.initMatcherData();
    const m = OCRService.getValidItemMatch("STEFLOS PRIME BLUEPRINT");
    assert.equal(m?.originalName ?? m?.name, "Steflos Prime Blueprint");
    assert.equal(OCRService.cachedDbItems.find((x) => x.originalName === "Steflos Prime Blueprint").ducats, 45);
  } finally {
    Object.assign(dbHelper, { get: orig.get, set: orig.set });
    globalThis.fetch = orig.fetch;
  }
});
