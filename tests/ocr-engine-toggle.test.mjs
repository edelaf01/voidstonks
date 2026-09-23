import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// the ocr engine selector: what stays active, what is saved and what the user is told
// three things to protect: the choice survives a reload; picking the network engine starts its download
// before it is needed (a first reward frame waiting on 4.8 MB is lost); and while it loads the user is
// told, since the classic engine reads until then

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

beforeEach(() => { almacen.clear(); calentadas = 0; PaddleRepository._service = null; PaddleRepository.ultimoFallo = null; M.aplicaMotor(M.MOTOR_CLASICO); almacen.clear(); });

describe("elección de motor", () => {
  test("sin contestar no se descarga nada y se lee con el clásico", () => {
    // the question must come before the download: starting it in startLiveSession(), before the hud shows,
    // made the warning late exactly the first time
    assert.equal(M.motorDecidido(), false);
    assert.equal(M.motorElegido(), M.MOTOR_CLASICO);
    assert.equal(M.restauraMotor(), M.MOTOR_CLASICO);
    assert.equal(M.motorActivo(), M.MOTOR_CLASICO);
    assert.equal(calentadas, 0, "arrancar el escáner sin respuesta no puede descargar el modelo");
  });

  test("arrancar sin respuesta no da la pregunta por contestada", () => {
    // restauraMotor must not write the key: going through aplicaMotor made the question vanish on first start
    // before the user saw it
    M.restauraMotor();
    assert.equal(M.motorDecidido(), false);
  });

  test("quien no quiera descargar nada puede quedarse en el clásico", () => {
    M.aplicaMotor(M.MOTOR_CLASICO);
    assert.equal(M.motorElegido(), M.MOTOR_CLASICO, "la preferencia se guarda");
    assert.equal(M.restauraMotor(), M.MOTOR_CLASICO);
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

  test("un valor desconocido cae al clásico, no deja el escáner sin motor", () => {
    // one rule: anything not exactly the precise engine is the classic one, so a corrupt localStorage value or
    // a typo downloads nothing
    almacen.set("vs_ocr_engine", "loquesea");
    assert.equal(M.motorElegido(), M.MOTOR_CLASICO);
    assert.equal(M.aplicaMotor("otro"), M.MOTOR_CLASICO);
    assert.equal(calentadas, 0);
  });

  test("sin localStorage (modo privado) sigue funcionando, solo que sin recordar", () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); } };
    try {
      assert.equal(M.motorDecidido(), false, "sin poder leer la respuesta, se pregunta");
      assert.equal(M.motorElegido(), M.MOTOR_CLASICO, "y mientras tanto no se descarga nada");
      assert.equal(M.aplicaMotor(M.MOTOR_PRECISO), M.MOTOR_PRECISO, "se puede aceptar en la sesión");
    } finally {
      globalThis.localStorage = real;
    }
  });
});

describe("lo que ve el usuario mientras carga", () => {
  test("sin contestar, la UI tiene que poder pintar la pregunta", () => {
    assert.deepEqual(M.estadoMotor(), { decidido: false, elegido: M.MOTOR_CLASICO, listo: true });
  });

  test("el motor preciso no se da por listo hasta que puede leer", () => {
    M.aplicaMotor(M.MOTOR_PRECISO);
    assert.deepEqual(M.estadoMotor(), { decidido: true, elegido: M.MOTOR_PRECISO, listo: false });
    PaddleRepository._service = {};                 // already loaded
    assert.deepEqual(M.estadoMotor(), { decidido: true, elegido: M.MOTOR_PRECISO, listo: true });
  });

  test("el clásico está listo siempre: va dentro de la app", () => {
    M.aplicaMotor(M.MOTOR_CLASICO);
    assert.deepEqual(M.estadoMotor(), { decidido: true, elegido: M.MOTOR_CLASICO, listo: true });
  });
});

// while the precise engine LOADS the page waits for it (recognizeStripWords does warmUp): creating the
// tesseract pool in that gap left a 2nd worker (a WASM instance) idle for the whole session
describe("quién lee la rejilla", () => {
  test("con el preciso cargando o listo, la rejilla no es del clásico", () => {
    M.aplicaMotor(M.MOTOR_PRECISO);
    assert.equal(M.rejillaConClasico(), false, "cargando");
    PaddleRepository._service = {};
    assert.equal(M.rejillaConClasico(), false, "listo");
  });

  test("con el preciso caído, o con el clásico elegido, lee Tesseract", () => {
    M.aplicaMotor(M.MOTOR_PRECISO);
    PaddleRepository.ultimoFallo = new Error("CDN");
    assert.equal(M.rejillaConClasico(), true);
    PaddleRepository.ultimoFallo = null;
    M.aplicaMotor(M.MOTOR_CLASICO);
    assert.equal(M.rejillaConClasico(), true);
  });
});
