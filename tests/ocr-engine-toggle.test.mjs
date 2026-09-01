import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ===========================================================================
// El selector de motor de OCR: qué queda activo, qué se guarda y qué se le enseña al usuario.
//
// Lo que hay que proteger no es que el botón cambie de color, sino tres cosas que, mal hechas,
// dejan el escáner peor de lo que estaba:
//   - que la preferencia sobreviva a la recarga (si no, el usuario la pone cada sesión);
//   - que elegir el motor de red lance su descarga ANTES de hacer falta (si se pide en el
//     primer frame de recompensa, ese frame se pierde esperando 4,8 MB);
//   - que mientras no esté cargado se diga, porque hasta entonces lee el clásico y si no se
//     avisa parece que el botón no hizo nada.
// ===========================================================================

const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k),
};
globalThis.document ??= { createElement: () => ({ getContext: () => null }) };

const { PaddleRepository } = await import("../deploy/js/repositories/paddle.repository.js");
const M = await import("../deploy/js/services/scanner/ocr_engine.service.js");

let calentadas = 0;
PaddleRepository.warmUp = () => { calentadas++; return Promise.resolve({}); };

beforeEach(() => { almacen.clear(); calentadas = 0; PaddleRepository._service = null; M.aplicaMotor(M.MOTOR_CLASICO); almacen.clear(); });

describe("elección de motor", () => {
  test("por defecto el clásico: es el que no depende de nada externo", () => {
    assert.equal(M.motorElegido(), M.MOTOR_CLASICO);
    assert.equal(M.restauraMotor(), M.MOTOR_CLASICO);
    assert.equal(M.motorActivo(), M.MOTOR_CLASICO);
    assert.equal(calentadas, 0, "el clásico no descarga nada");
  });

  test("la elección se guarda y se recupera en la siguiente sesión", () => {
    M.aplicaMotor(M.MOTOR_PRECISO);
    assert.equal(M.motorElegido(), M.MOTOR_PRECISO, "queda en localStorage");
    assert.equal(M.motorActivo(), M.MOTOR_PRECISO, "y es el que se usa ya");
    assert.equal(M.restauraMotor(), M.MOTOR_PRECISO);
  });

  test("elegir el motor de red lanza su descarga en ese momento", () => {
    M.aplicaMotor(M.MOTOR_PRECISO);
    assert.equal(calentadas, 1);
  });

  test("un valor desconocido cae al clásico en vez de dejar el escáner sin motor", () => {
    almacen.set("vs_ocr_engine", "loquesea");
    assert.equal(M.motorElegido(), M.MOTOR_CLASICO);
    assert.equal(M.aplicaMotor("otro"), M.MOTOR_CLASICO);
  });

  test("sin localStorage (modo privado) sigue funcionando, solo que sin recordar", () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); } };
    try {
      assert.equal(M.motorElegido(), M.MOTOR_CLASICO);
      assert.equal(M.aplicaMotor(M.MOTOR_PRECISO), M.MOTOR_PRECISO, "la sesión actual sí lo usa");
    } finally {
      globalThis.localStorage = real;
    }
  });
});

describe("lo que ve el usuario mientras carga", () => {
  test("el motor preciso no se da por listo hasta que puede leer", () => {
    M.aplicaMotor(M.MOTOR_PRECISO);
    assert.deepEqual(M.estadoMotor(), { elegido: M.MOTOR_PRECISO, listo: false });
    PaddleRepository._service = {};                 // ya cargó
    assert.deepEqual(M.estadoMotor(), { elegido: M.MOTOR_PRECISO, listo: true });
  });

  test("el clásico está listo siempre: va dentro de la app", () => {
    M.aplicaMotor(M.MOTOR_CLASICO);
    assert.deepEqual(M.estadoMotor(), { elegido: M.MOTOR_CLASICO, listo: true });
  });
});
