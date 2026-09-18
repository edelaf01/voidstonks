import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nextLatchedContext, INITIAL_LATCH, enrutaGraciaRiven, toleranciaCabecera, TOL_HEADER_BASE, intervaloCabecera, caducidadCabecera } from "../deploy/js/utils/vision/context_latch.js";

function correr(secuencia, inicial = INITIAL_LATCH) {
  let s = inicial;
  return secuencia.map((raw) => { s = nextLatchedContext(s, raw); return s.latched; });
}

test("un solo frame de otro contexto NO cambia el enganchado", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD"], s), ["RELICS"], "un frame suelto es ruido, no un cambio");
});

test("dos frames seguidos del mismo contexto sí lo cambian", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD", "REWARD"], s), ["RELICS", "REWARD"]);
});

test("el candidato se reinicia si entra otro contexto por medio", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD", "INVENTORY_MODS", "REWARD"], s), ["RELICS", "RELICS", "RELICS"]);
});

test("una racha de UNKNOWN también corta al candidato a medias", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD", "UNKNOWN", "REWARD"], s), ["RELICS", "RELICS", "RELICS"]);
});

test("hacen falta 3 UNKNOWN seguidos para soltar el contexto", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["UNKNOWN", "UNKNOWN", "UNKNOWN"], s), ["RELICS", "RELICS", "UNKNOWN"]);
});

test("un frame bueno reinicia la cuenta de UNKNOWN", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["UNKNOWN", "UNKNOWN", "RELICS", "UNKNOWN", "UNKNOWN"], s),
    ["RELICS", "RELICS", "RELICS", "RELICS", "RELICS"]);
});

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
    assert.equal(intervaloCabecera(0), 0);
  });

  test("con el contexto quieto se espacía", () => {
    assert.ok(intervaloCabecera(2) > intervaloCabecera(1));
  });

  test("el tope deja al menos una lectura por segundo", () => {
    assert.ok(intervaloCabecera(99) <= 1200);
  });

  test("una racha ausente o negativa no espacía nada", () => {
    assert.equal(intervaloCabecera(), 0);
    assert.equal(intervaloCabecera(-3), 0);
  });
});

describe("cuánto vale la cabecera sin releerla", () => {
  test("en fin de misión dura mucho más: la pantalla no se mueve y no hay transición sutil", () => {
    assert.ok(caducidadCabecera("MISSION_COMPLETE") >= 8000);
  });

  test("en el resto sigue siendo el reloj quien detecta INVENTORY -> INVENTORY_MODS", () => {
    assert.equal(caducidadCabecera("INVENTORY"), 2500);
    assert.equal(caducidadCabecera("UNKNOWN"), 2500);
  });
});
