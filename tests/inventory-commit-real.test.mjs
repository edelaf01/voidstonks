import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// the full path with the user's REAL inventory: what the scanner reads on MISSION COMPLETE -> what ends up
// in state.primeInventory
// the commit is automatic and ADDS: a mistake leaves an inflated counter with nothing to compare it
// against
// made up inventories miss what the real export shows: parts kept at 0, two digit counters and names as
// the app DB writes them ("Ash Prime Chassis Blueprint")
// the chain runs for real: OCR text -> OCRService.getValidItemMatch -> hasComponentSiblings ->
// applyRewardCommit -> undo

// ocr.service.js imports vision.service.js, which creates canvases with `document` on load
globalThis.document ??= { createElement: () => ({ getContext: () => null }) };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

const { applyRewardCommit, undoRewardCommit } = await import("../deploy/js/utils/inventory/reward_commit.js");
const { hasComponentSiblings } = await import("../deploy/js/utils/inventory/component_siblings.js");
const { setHelpOf, pickBestForSets } = await import("../deploy/js/utils/inventory/reward_set_pick.js");
const { getSetName, getRequiredCount } = await import("../deploy/js/utils/ui_utils.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");

const RUTA = process.env.VOIDSTONKS_INV_EXPORT
  || "/home/ppsoy/Descargas/voidstonks_inv_2026-07-25.json";

// the export is heavy and the user's own, so it is not copied into the repo
// without it these cases skip with the reason written down, with it they have to really fail
const sinExport = !existsSync(RUTA)
  && `no está el export de inventario (${RUTA}); pásalo con VOIDSTONKS_INV_EXPORT`;

/** the file, read again from disk: the "before" state to compare the undo against */
const leerExport = () => JSON.parse(readFileSync(RUTA, "utf8"));

const EXPORT = sinExport ? { relics: [], parts: {} } : leerExport();
const PIEZAS = EXPORT.parts;

describe("el export real del inventario", { skip: sinExport }, () => {
  test("es {relics: [], parts: {nombre: entero >= 0}}", () => {
    assert.deepEqual(Object.keys(EXPORT).sort(), ["parts", "relics"]);
    assert.ok(Array.isArray(EXPORT.relics), "relics es un array (strings del formato viejo o {name,count})");
    assert.equal(typeof PIEZAS, "object");
    const malas = Object.entries(PIEZAS)
      .filter(([, v]) => !Number.isInteger(v) || v < 0)
      .map(([k, v]) => `${k}=${v}`);
    assert.deepEqual(malas, [], "los contadores son enteros no negativos, nunca arrays ni texto");
  });

  // these values come from the reference export (2026-07-25); after a new export this is the only case to
  // update, the rest reads the file
  test("el export de referencia trae 72 piezas, tres a cero y Lex Prime Receiver a 13", () => {
    assert.equal(Object.keys(PIEZAS).length, 72);
    assert.deepEqual(Object.keys(PIEZAS).filter((k) => PIEZAS[k] === 0), [
      "Saryn Prime Neuroptics Blueprint",
      "Garuda Prime Blueprint",
      "Fulmin Prime Blueprint",
    ]);
    assert.equal(PIEZAS["Lex Prime Receiver"], 13);
  });
});

describe("alta de recompensas sobre el inventario real", { skip: sinExport }, () => {
  test("una pieza que no estaba entra a 1 y no toca ninguna otra", () => {
    const nueva = "Nikana Prime Blade";
    assert.equal(nueva in PIEZAS, false, "el caso exige una pieza que el usuario NO tenga");

    const { inventario, anadidas } = applyRewardCommit(PIEZAS, [{ name: nueva }]);
    assert.equal(inventario[nueva], 1);
    assert.deepEqual(anadidas, [nueva]);

    const resto = { ...inventario };
    delete resto[nueva];
    assert.deepEqual(resto, leerExport().parts, "no puede cambiar nada más");
  });

  test("una pieza que ya está SUMA sobre lo que había, no la reemplaza", () => {
    const antes = PIEZAS["Lex Prime Receiver"];
    const { inventario } = applyRewardCommit(PIEZAS, [{ name: "Lex Prime Receiver" }]);
    assert.equal(inventario["Lex Prime Receiver"], antes + 1);
    assert.equal(Object.keys(inventario).length, Object.keys(PIEZAS).length,
      "sumar no puede crear una fila nueva");
  });

  test("el alta no muta el inventario que se le pasa", () => {
    applyRewardCommit(PIEZAS, [{ name: "Lex Prime Receiver", qty: 5 }]);
    assert.deepEqual(PIEZAS, leerExport().parts);
  });

  test("deshacer deja el inventario EXACTAMENTE como estaba", () => {
    // mixed batch on purpose: a new part, one with a counter, one kept at 0 and an ×N
    // the 0 one exposed the bug: the key was deleted and the user lost the row shown with "show empty"
    const { inventario, previo } = applyRewardCommit(PIEZAS, [
      { name: "Nikana Prime Blade" },
      { name: "Lex Prime Receiver", qty: 3 },
      { name: "Garuda Prime Blueprint" },
      { name: "Fang Prime Blade" },
    ]);
    assert.equal(inventario["Garuda Prime Blueprint"], 1);
    assert.equal(inventario["Lex Prime Receiver"], PIEZAS["Lex Prime Receiver"] + 3);

    const vuelta = undoRewardCommit(inventario, previo);
    assert.deepEqual(vuelta, leerExport().parts);
    assert.equal(Object.keys(vuelta).length, Object.keys(PIEZAS).length,
      "ni sobra ni falta una sola pieza");
  });

  test("dos altas seguidas de la misma pieza suman las dos", () => {
    // two reward screens in one session: the second starts from the inventory the first one left
    const antes = PIEZAS["Ballistica Prime Blueprint"];
    const uno = applyRewardCommit(PIEZAS, [{ name: "Ballistica Prime Blueprint" }]);
    const dos = applyRewardCommit(uno.inventario, [{ name: "Ballistica Prime Blueprint" }]);
    assert.equal(dos.inventario["Ballistica Prime Blueprint"], antes + 2);

    // undoing the second leaves what the first one left, not the original inventory
    assert.equal(undoRewardCommit(dos.inventario, dos.previo)["Ballistica Prime Blueprint"], antes + 1);
  });
});

/** the matcher index as the app builds it, with the real names */
function indexarCatalogo(nombres) {
  state.itemsDatabase = Object.fromEntries(nombres.map((n) => [n, [{ ducats: 15 }]]));
  OCRService.cachedDbItems = [];
  OCRService.knownParts = new Set();
  OCRService.initMatcherData();
  return OCRService.cachedDbItems;
}

/** what scanner.service.js does with each MISSION COMPLETE cell */
function leerCelda(texto, items) {
  const match = OCRService.getValidItemMatch(texto);
  if (!match?.isPrime) return { pieza: null, dudoso: false };
  return { pieza: match.originalName, dudoso: hasComponentSiblings(items, match.originalName) };
}

describe("de la celda de MISSION COMPLETE al inventario real", { skip: sinExport }, () => {
  const items = sinExport ? [] : indexarCatalogo(Object.keys(PIEZAS));

  test("lo leído se resuelve al nombre exacto con el que está guardado", () => {
    const { pieza } = leerCelda("LEX PRIME RECEIVER", items);
    assert.equal(pieza, "Lex Prime Receiver");
    const { inventario } = applyRewardCommit(PIEZAS, [{ name: pieza, qty: 2 }]);
    assert.equal(inventario["Lex Prime Receiver"], PIEZAS["Lex Prime Receiver"] + 2);
  });

  test("un rótulo ilegible no llega al inventario", () => {
    // getValidItemMatch resolves against the catalog or returns null; without that filter the commit would
    // write the junk as is
    // and create a row no set knows
    const { pieza } = leerCelda("QQQQQ WWWW ZZZZ", items);
    assert.equal(pieza, null);
    assert.deepEqual(applyRewardCommit(PIEZAS, []).inventario, leerExport().parts);
  });

  test("el plano pelado de un warframe se marca como dudoso: hay que mirar la tinta", () => {
    // "Ash Prime Chassis Blueprint" on two lines with the middle one lost reads like "Ash Prime Blueprint",
    // and both parts are in this inventory
    // without the flag the commit writes the wrong one and the user has no way to notice
    assert.equal(PIEZAS["Ash Prime Chassis Blueprint"] > 0, true);
    assert.deepEqual(leerCelda("ASH PRIME BLUEPRINT", items),
      { pieza: "Ash Prime Blueprint", dudoso: true });
  });

  test("el componente entero y los planos de arma no son dudosos: entran directos", () => {
    assert.deepEqual(leerCelda("ASH PRIME CHASSIS BLUEPRINT", items),
      { pieza: "Ash Prime Chassis Blueprint", dudoso: false });
    assert.deepEqual(leerCelda("BALLISTICA PRIME BLUEPRINT", items),
      { pieza: "Ballistica Prime Blueprint", dudoso: false });
  });

  test("los dudosos del inventario real son los planos de warframe con componente propio", () => {
    const planos = Object.keys(PIEZAS).filter((n) => n.toUpperCase().endsWith("BLUEPRINT"));
    const marcados = planos.filter((n) => hasComponentSiblings(items, n));
    // Ash, Atlas and Banshee are the three sets where the user has the bare blueprint AND some component: the
    // other blueprints have nothing to be confused with
    assert.deepEqual(marcados,
      ["Atlas Prime Blueprint", "Ash Prime Blueprint", "Banshee Prime Blueprint"].sort(
        (a, b) => planos.indexOf(a) - planos.indexOf(b)));
  });
});

// setsDatabase derived from the export itself: only the parts the user has a row for, not the whole
// catalog
// enough to measure whether the commit closes what was one part short, not how many parts a set really has
function setsDelExport(inventario) {
  const sets = {};
  for (const nombre of Object.keys(inventario)) {
    const set = getSetName(nombre);
    if (set === "Otros" || set === "Others") continue;
    (sets[set] ||= []).push(nombre);
  }
  return sets;
}

describe("cerrar un set con el alta", { skip: sinExport }, () => {
  const setsDatabase = sinExport ? {} : setsDelExport(PIEZAS);
  // getRequiredCount returns 1 for everything without state.primeManifest, which is not in the export
  const deps = (primeInventory) => ({ setsDatabase, primeInventory, getSetName, getRequiredCount });

  test("una pieza guardada a 0 cuenta como que falta", () => {
    const ayuda = setHelpOf("Saryn Prime Neuroptics Blueprint", deps(PIEZAS));
    assert.deepEqual(ayuda, { set: "Saryn Prime", left: 0, total: 1 });
  });

  test("tras el alta esa pieza deja de ayudar: ya está cubierta", () => {
    const { inventario } = applyRewardCommit(PIEZAS, [{ name: "Saryn Prime Neuroptics Blueprint" }]);
    assert.equal(setHelpOf("Saryn Prime Neuroptics Blueprint", deps(inventario)), null);
  });

  test("la última pieza de Banshee Prime cierra el set, y al deshacer vuelve a faltar", () => {
    // a state the user really went through: the same inventory without the Systems
    const sinSystems = { ...PIEZAS };
    delete sinSystems["Banshee Prime Systems Blueprint"];
    assert.deepEqual(setHelpOf("Banshee Prime Systems Blueprint", deps(sinSystems)),
      { set: "Banshee Prime", left: 0, total: 4 }, "left 0 = cierra el set");

    const { inventario, previo } = applyRewardCommit(sinSystems, [{ name: "Banshee Prime Systems Blueprint" }]);
    assert.equal(setHelpOf("Banshee Prime Systems Blueprint", deps(inventario)), null);

    const vuelta = undoRewardCommit(inventario, previo);
    assert.deepEqual(setHelpOf("Banshee Prime Systems Blueprint", deps(vuelta)),
      { set: "Banshee Prime", left: 0, total: 4 }, "deshacer devuelve el set a medias");
  });

  test("entre dos recompensas gana la que cierra el set, no la del set más lejos", () => {
    const aMedias = { ...PIEZAS };
    delete aMedias["Banshee Prime Systems Blueprint"];
    delete aMedias["Ballistica Prime String"];
    delete aMedias["Ballistica Prime Upper Limb"];

    assert.deepEqual(setHelpOf("Ballistica Prime String", deps(aMedias)),
      { set: "Ballistica Prime", left: 1, total: 5 }, "a Ballistica aún le faltaría otra");

    const mejor = pickBestForSets(
      [{ name: "Ballistica Prime String" }, { name: "Banshee Prime Systems Blueprint" }],
      deps(aMedias));
    assert.deepEqual(mejor, { name: "Banshee Prime Systems Blueprint", set: "Banshee Prime", left: 0, total: 4 });
  });
});
