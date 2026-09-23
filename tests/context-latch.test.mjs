// screen context hysteresis: the header OCR comes out unreadable now and then without a screen change,
// and trusting every frame makes the scanner jump from RELICS to REWARD and back

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nextLatchedContext, INITIAL_LATCH, enrutaGraciaRiven, intervaloCabecera, INTERVALO_FIN_MISION_MS, CADUCIDAD_CABECERA_MS, FRACCION_TITULO, tituloHaCambiado } from "../deploy/js/utils/vision/context_latch.js";

/** runs a sequence of raw contexts and returns the latched one after each */
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
  test("mucho: SELL -> MODS ya lo ve la franja del rótulo, el reloj solo acota una colisión", () => {
    assert.ok(CADUCIDAD_CABECERA_MS >= 10000);
  });
});

// title strip at 64×8: same screen 0 % samples changed, SELL -> MODS 14-19 %
describe("franja del título", () => {
  const franja = (cambiadas, delta = 100) => {
    const base = new Uint8Array(512).fill(60);
    const ahora = new Uint8Array(base);
    for (let i = 0; i < cambiadas; i++) ahora[i] = 60 + delta;
    return [ahora, base];
  };
  test("igual no ha cambiado; el 4 % de muestras sí", () => {
    assert.equal(tituloHaCambiado(...franja(0)), false);
    assert.equal(tituloHaCambiado(...franja(19)), false, "3,7 %");
    assert.equal(tituloHaCambiado(...franja(21)), true, "4,1 %");
    assert.equal(FRACCION_TITULO, 0.04);
  });
  test("el ruido de vídeo (poca diferencia en todas) no cuenta", () => {
    assert.equal(tituloHaCambiado(...franja(512, 20)), false);
  });
  test("sin base se relee", () => {
    assert.equal(tituloHaCambiado(new Uint8Array(512), null), true);
  });
});

test("en fin de misión, con el contexto asentado, la cabecera se relee cada 3 s", () => {
  assert.equal(intervaloCabecera(3, "MISSION_COMPLETE"), INTERVALO_FIN_MISION_MS);
  assert.equal(intervaloCabecera(1, "MISSION_COMPLETE"), intervaloCabecera(1), "recién entrado, el ritmo normal: aún hay que confirmar");
  assert.equal(intervaloCabecera(3, "REWARD"), intervaloCabecera(3), "las recompensas duran 15 s: ahí no se relaja");
});
