import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// ===========================================================================
// El camino completo con el INVENTARIO REAL del usuario: lo que el escáner lee en
// MISSION COMPLETE -> lo que acaba escrito en state.primeInventory.
//
// El alta es automática y de SUMA: si se equivoca, el contador queda inflado y no hay con qué
// compararlo. Los inventarios inventados no destapan lo que sí destapa el export real —piezas
// guardadas a 0, contadores de dos cifras, y los nombres tal y como los escribe la BD que
// corre en la app ("Ash Prime Chassis Blueprint", no "Ash Prime Chassis").
//
// La cadena se recorre de verdad: texto OCR -> OCRService.getValidItemMatch ->
// hasComponentSiblings -> applyRewardCommit -> deshacer.
// ===========================================================================

// ocr.service.js importa vision.service.js, que crea canvases con `document` al cargar.
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

// El export pesa y es del usuario: no se copia al repo. Sin él estos casos se saltan con el
// motivo escrito, pero cuando está tienen que fallar de verdad.
const sinExport = !existsSync(RUTA)
  && `no está el export de inventario (${RUTA}); pásalo con VOIDSTONKS_INV_EXPORT`;

/** El fichero, releído del disco: el "estado de antes" contra el que comparar el deshacer. */
const leerExport = () => JSON.parse(readFileSync(RUTA, "utf8"));

const EXPORT = sinExport ? { relics: [], parts: {} } : leerExport();
const PIEZAS = EXPORT.parts;

// --- Forma del fichero -------------------------------------------------------------------

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

  // Estos valores son los del export de referencia (2026-07-25). Si el usuario vuelve a
  // exportar, este caso es el único que hay que actualizar: el resto lee del fichero.
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

// --- Alta y deshacer sobre el inventario real ---------------------------------------------

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
    // Tanda mixta a propósito: pieza nueva, pieza con contador, pieza guardada a 0 y un ×N.
    // La de 0 es la que destapaba el fallo: se borraba la clave y el usuario perdía la fila
    // que ve con "mostrar vacías".
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
    // Dos pantallas de recompensa en la misma sesión: la segunda parte del inventario que
    // dejó la primera.
    const antes = PIEZAS["Ballistica Prime Blueprint"];
    const uno = applyRewardCommit(PIEZAS, [{ name: "Ballistica Prime Blueprint" }]);
    const dos = applyRewardCommit(uno.inventario, [{ name: "Ballistica Prime Blueprint" }]);
    assert.equal(dos.inventario["Ballistica Prime Blueprint"], antes + 2);

    // Deshacer la segunda deja lo que dejó la primera, no el inventario original.
    assert.equal(undoRewardCommit(dos.inventario, dos.previo)["Ballistica Prime Blueprint"], antes + 1);
  });
});

// --- La cadena entera: lo leído -> lo escrito ---------------------------------------------

/** El índice del matcher tal y como lo construye la app, pero con los nombres reales. */
function indexarCatalogo(nombres) {
  state.itemsDatabase = Object.fromEntries(nombres.map((n) => [n, [{ ducats: 15 }]]));
  OCRService.cachedDbItems = [];
  OCRService.knownParts = new Set();
  OCRService.initMatcherData();
  return OCRService.cachedDbItems;
}

/** Lo que hace scanner.service.js con cada celda de MISSION COMPLETE. */
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
    // getValidItemMatch resuelve contra el catálogo o devuelve null; sin ese filtro, el alta
    // escribiría la basura tal cual y crearía una fila que ningún set reconoce.
    const { pieza } = leerCelda("QQQQQ WWWW ZZZZ", items);
    assert.equal(pieza, null);
    assert.deepEqual(applyRewardCommit(PIEZAS, []).inventario, leerExport().parts);
  });

  test("el plano pelado de un warframe se marca como dudoso: hay que mirar la tinta", () => {
    // "Ash Prime Chassis Blueprint" a dos líneas, con la del medio perdida, se lee igual que
    // "Ash Prime Blueprint" — y las dos piezas están en este mismo inventario. Sin la marca,
    // el alta escribe la que no es y el usuario no tiene forma de notarlo.
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
    // Ash, Atlas y Banshee son los tres sets de los que el usuario tiene el plano pelado Y
    // algún componente: los demás planos del export no tienen con qué confundirse.
    assert.deepEqual(marcados,
      ["Atlas Prime Blueprint", "Ash Prime Blueprint", "Banshee Prime Blueprint"].sort(
        (a, b) => planos.indexOf(a) - planos.indexOf(b)));
  });
});

// --- Sets que se cierran con el alta -------------------------------------------------------

// setsDatabase derivado del propio export: solo lleva las piezas de las que el usuario tiene
// fila, no el catálogo entero. Sirve para lo que se mide aquí —si el alta cierra lo que estaba
// a falta de una pieza—, no para saber cuántas piezas tiene un set de verdad.
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
  // getRequiredCount devuelve 1 para todo sin state.primeManifest, que no viaja en el export.
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
    // Estado por el que el usuario pasó de verdad: el mismo inventario sin el Systems.
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
