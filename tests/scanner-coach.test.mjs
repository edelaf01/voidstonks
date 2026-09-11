import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ===========================================================================
// Qué se le enseña al usuario y UNA sola vez.
//
// Lo que hay que proteger es que no se vuelva pesado: un aviso que reaparece cada vez que
// vuelves a la misma pantalla es peor que no tenerlo, y en la pantalla de recompensas —15
// segundos de reloj para elegir— cualquier aviso estorba justo en el peor momento.
// ===========================================================================

const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k),
};

const C = await import("../deploy/js/utils/scanner_coach.js");

beforeEach(() => almacen.clear());

describe("un aviso por pantalla, y solo la primera vez", () => {
  test("la primera vez toca avisar; la segunda ya no", () => {
    assert.equal(C.tocaAvisar("INVENTORY"), true);
    assert.equal(C.marcaVisto("INVENTORY"), true);
    assert.equal(C.tocaAvisar("INVENTORY"), false);
  });

  test("marcar dos veces el mismo contexto no cuenta como aviso nuevo", () => {
    C.marcaVisto("RELICS");
    assert.equal(C.marcaVisto("RELICS"), false, "ya estaba visto");
  });

  test("cada pantalla lleva su propia cuenta", () => {
    C.marcaVisto("INVENTORY");
    assert.equal(C.tocaAvisar("RELICS"), true, "haber visto el inventario no explica las reliquias");
  });

  test("la pantalla de RECOMPENSA nunca avisa sola: tiene reloj", () => {
    // 15 segundos para elegir premio; un aviso encima es justo lo que no puede pasar.
    assert.equal(C.tienePista("REWARD"), false);
    assert.equal(C.tocaAvisar("REWARD"), false);
  });

  test("un contexto sin pista (UNKNOWN) tampoco avisa", () => {
    assert.equal(C.tocaAvisar("UNKNOWN"), false);
  });

  test("con los avisos desactivados no se enseña nada", () => {
    assert.equal(C.tocaAvisar("INVENTORY", false), false);
  });

  test("olvidar lo visto los vuelve a enseñar", () => {
    C.marcaVisto("INVENTORY");
    C.olvidaVistos();
    assert.equal(C.tocaAvisar("INVENTORY"), true);
  });

  test("sin localStorage (modo privado) no revienta: avisa y sigue", () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem() { throw new Error("bloqueado"); },
      setItem() { throw new Error("bloqueado"); },
      removeItem() { throw new Error("bloqueado"); },
    };
    try {
      assert.equal(C.tocaAvisar("INVENTORY"), true);
      assert.equal(C.marcaVisto("INVENTORY"), true, "no puede guardar, pero no puede fallar");
      C.olvidaVistos();
    } finally {
      globalThis.localStorage = real;
    }
  });

  test("un localStorage corrupto se ignora en vez de tumbar el escáner", () => {
    almacen.set("vs_scanner_coach", "{no es json");
    assert.equal(C.yaVisto("INVENTORY"), false);
    assert.equal(C.tocaAvisar("INVENTORY"), true);
  });
});

describe("recorrido guiado", () => {
  test("avanza en orden y termina", () => {
    assert.equal(C.siguientePaso(0), 1);
    assert.equal(C.siguientePaso(C.PASOS_TOUR.length - 1), -1, "el último paso cierra el tour");
  });

  test("el primer paso no resalta nada: es la bienvenida", () => {
    assert.equal(C.PASOS_TOUR[0].id, null);
  });

  test("cada paso con elemento apunta a un id del HUD, sin repetirse", () => {
    const ids = C.PASOS_TOUR.map((p) => p.id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, "dos pasos resaltando lo mismo");
    assert.ok(ids.length >= 4);
  });
});
