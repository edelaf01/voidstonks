// Histéresis del contexto de pantalla.
//
// El OCR de cabecera sale ilegible a ratos incluso sin cambiar de pantalla ("WARFRAVE", "go TC",
// "(ims sovo Mesh" leídos en la selección de reliquias). Creerse cada frame hace que el escáner
// salte de RELICS a REWARD y vuelva, recortando y pasando OCR sobre zonas que no tocan — y el
// síntoma es solo "va saltarín", sin ningún error.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nextLatchedContext, INITIAL_LATCH, enrutaGraciaRiven, toleranciaCabecera, TOL_HEADER_BASE, intervaloCabecera, caducidadCabecera } from "../deploy/js/utils/vision/context_latch.js";

/** Pasa una secuencia de contextos crudos y devuelve el enganchado tras cada uno. */
function correr(secuencia, inicial = INITIAL_LATCH) {
  let s = inicial;
  return secuencia.map((raw) => { s = nextLatchedContext(s, raw); return s.latched; });
}

// El bug: la histéresis era de un solo lado. UNKNOWN pedía 3 frames para soltar, pero cualquier
// otro contexto enganchaba con UNO, así que un frame de basura cambiaba el pipeline entero.
test("un solo frame de otro contexto NO cambia el enganchado", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD"], s), ["RELICS"], "un frame suelto es ruido, no un cambio");
});

test("dos frames seguidos del mismo contexto sí lo cambian", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD", "REWARD"], s), ["RELICS", "REWARD"]);
});

// Dos lecturas de REWARD separadas por otra cosa no son dos frames seguidos de acuerdo: es
// justo el patrón del ruido, y contarlas juntas devolvería el bug.
test("el candidato se reinicia si entra otro contexto por medio", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD", "INVENTORY_MODS", "REWARD"], s), ["RELICS", "RELICS", "RELICS"]);
});

test("una racha de UNKNOWN también corta al candidato a medias", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD", "UNKNOWN", "REWARD"], s), ["RELICS", "RELICS", "RELICS"]);
});

// Soltar es más caro que confirmar: en una transición real la cabecera pasa por ilegible antes
// de estabilizarse, y soltar al primer UNKNOWN dejaría el escáner sin contexto a cada rato.
test("hacen falta 3 UNKNOWN seguidos para soltar el contexto", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["UNKNOWN", "UNKNOWN", "UNKNOWN"], s), ["RELICS", "RELICS", "UNKNOWN"]);
});

test("un frame bueno reinicia la cuenta de UNKNOWN", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["UNKNOWN", "UNKNOWN", "RELICS", "UNKNOWN", "UNKNOWN"], s),
    ["RELICS", "RELICS", "RELICS", "RELICS", "RELICS"]);
});

// Confirmar lo que ya está no cuesta nada: sin esto, quedarse en una pantalla acumularía
// `pending` y un cambio real tardaría de más.
test("confirmar el contexto actual es inmediato y no acumula estado", () => {
  const s = nextLatchedContext({ latched: "RELICS", unknownCount: 2, pending: "REWARD", pendingCount: 1 }, "RELICS");
  assert.deepEqual(s, { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 });
});

test("no muta el estado que recibe", () => {
  const prev = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  const copia = { ...prev };
  nextLatchedContext(prev, "REWARD");
  assert.deepEqual(prev, copia);
});

// Los dos frames existen para que la basura no robe un contexto YA confirmado. Venir de UNKNOWN
// no es eso: es adquirir. Pedirle dos frames solo retrasaba la primera lectura de recompensas,
// que es justo lo que el usuario espera ver rápido.
test("salir de UNKNOWN engancha al primer frame", () => {
  const s = { latched: "UNKNOWN", unknownCount: 5, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD"], s), ["REWARD"]);
});

test("pero cambiar entre dos contextos conocidos sigue pidiendo dos", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD"], s), ["RELICS"]);
});

describe("gracia de rivens", () => {
  test("sin gracia el contexto pasa tal cual", () => {
    assert.deepEqual(enrutaGraciaRiven("UNKNOWN", false, "INVENTORY_MODS"),
      { contexto: "UNKNOWN", cancelar: false });
  });

  test("durante la gracia, un header ilegible sigue leyéndose como la carta de riven", () => {
    assert.equal(enrutaGraciaRiven("UNKNOWN", true, "ITEM_DETAILS").contexto, "ITEM_DETAILS");
    assert.equal(enrutaGraciaRiven("INVENTORY", true, "INVENTORY_MODS").contexto, "INVENTORY_MODS");
  });

  test("llegar a fin de misión CANCELA la gracia", () => {
    // Faltaba: sin esto, los primeros frames de MISSION COMPLETE (cabecera aún ilegible) se
    // re-enrutaban a INVENTORY_MODS durante 8 s y la pantalla se iba entera en OCR de rivens.
    assert.deepEqual(enrutaGraciaRiven("MISSION_COMPLETE", true, "INVENTORY_MODS"),
      { contexto: "MISSION_COMPLETE", cancelar: true });
  });

  test("reliquias y recompensas también la cancelan", () => {
    for (const ctx of ["RELICS", "REWARD"]) {
      assert.deepEqual(enrutaGraciaRiven(ctx, true, "INVENTORY_MODS"), { contexto: ctx, cancelar: true });
    }
  });

  test("tras cancelar, un header ilegible ya no se enruta a rivens", () => {
    const { cancelar } = enrutaGraciaRiven("MISSION_COMPLETE", true, "INVENTORY_MODS");
    assert.equal(cancelar, true);
    assert.equal(enrutaGraciaRiven("UNKNOWN", false, "INVENTORY_MODS").contexto, "UNKNOWN");
  });
});

describe("tolerancia del corte de cabecera", () => {
  test("arranca estricta", () => {
    // Con el corte flojo desde el principio, el salto gameplay->recompensas queda por debajo y
    // el escáner reutiliza el texto viejo: se pierde la pantalla de elegir recompensa.
    assert.equal(toleranciaCabecera(0), TOL_HEADER_BASE);
  });

  test("se afloja mientras el contexto no cambie", () => {
    assert.ok(toleranciaCabecera(1) > toleranciaCabecera(0));
    assert.ok(toleranciaCabecera(3) > toleranciaCabecera(1));
  });

  test("tiene tope: una racha larga no la deja crecer sin fin", () => {
    assert.equal(toleranciaCabecera(50), toleranciaCabecera(3));
  });

  test("una racha negativa o ausente no rompe el corte", () => {
    assert.equal(toleranciaCabecera(), TOL_HEADER_BASE);
    assert.equal(toleranciaCabecera(-5), TOL_HEADER_BASE);
  });
});

describe("cada cuánto se relee la cabecera", () => {
  test("con el contexto recién cambiado no se limita nada", () => {
    // Es justo cuando importa: el salto a la pantalla de recompensas no puede esperar.
    assert.equal(intervaloCabecera(0), 0);
  });

  test("con el contexto quieto se espacía", () => {
    assert.ok(intervaloCabecera(2) > intervaloCabecera(1));
  });

  test("el tope deja al menos una lectura por segundo", () => {
    // La pantalla de recompensas dura unos 15 s: con esto siguen cabiendo más de diez lecturas.
    assert.ok(intervaloCabecera(99) <= 1200);
  });

  test("una racha ausente o negativa no espacía nada", () => {
    assert.equal(intervaloCabecera(), 0);
    assert.equal(intervaloCabecera(-3), 0);
  });
});

describe("cuánto vale la cabecera sin releerla", () => {
  test("en fin de misión dura mucho más: la pantalla no se mueve y no hay transición sutil", () => {
    // Con frames de 3 s y una caducidad de 2,5 s se releían las tres pasadas en cada vuelta.
    assert.ok(caducidadCabecera("MISSION_COMPLETE") >= 8000);
  });

  test("en el resto sigue siendo el reloj quien detecta INVENTORY -> INVENTORY_MODS", () => {
    // "SELL"/"MODS" no mueve un hash de 16×9: sin la caducidad corta, el cambio no se vería.
    assert.equal(caducidadCabecera("INVENTORY"), 2500);
    assert.equal(caducidadCabecera("UNKNOWN"), 2500);
  });
});
