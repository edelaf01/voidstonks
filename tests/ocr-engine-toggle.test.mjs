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

beforeEach(() => { almacen.clear(); calentadas = 0; PaddleRepository._service = null; PaddleRepository.ultimoFallo = null; M.aplicaMotor(M.MOTOR_CLASICO); almacen.clear(); });

describe("elección de motor", () => {
  test("sin contestar no se descarga nada y se lee con el clásico", () => {
    // El preciso era el defecto y su descarga arrancaba en startLiveSession(), antes de que el
    // HUD fuera visible: decir que no llegaba tarde justo la primera vez, que es la única que
    // importa. Ahora la pregunta va por delante de la descarga.
    assert.equal(M.motorDecidido(), false);
    assert.equal(M.motorElegido(), M.MOTOR_CLASICO);
    assert.equal(M.restauraMotor(), M.MOTOR_CLASICO);
    assert.equal(M.motorActivo(), M.MOTOR_CLASICO);
    assert.equal(calentadas, 0, "arrancar el escáner sin respuesta no puede descargar el modelo");
  });

  test("arrancar sin respuesta no da la pregunta por contestada", () => {
    // restauraMotor llamaba a aplicaMotor, que ESCRIBE la clave: la pregunta desaparecía sola
    // en el primer arranque y el usuario nunca llegaba a verla.
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
    // Una sola regla: lo que no sea exactamente el preciso es el clásico. Así un valor corrupto
    // en localStorage o una llamada mal escrita no descargan nada sin querer.
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
    PaddleRepository._service = {};                 // ya cargó
    assert.deepEqual(M.estadoMotor(), { decidido: true, elegido: M.MOTOR_PRECISO, listo: true });
  });

  test("el clásico está listo siempre: va dentro de la app", () => {
    M.aplicaMotor(M.MOTOR_CLASICO);
    assert.deepEqual(M.estadoMotor(), { decidido: true, elegido: M.MOTOR_CLASICO, listo: true });
  });
});

// Mientras el preciso CARGA, la página lo espera (recognizeStripWords hace warmUp): crear el pool
// de Tesseract en ese hueco dejaba un 2º worker (una instancia WASM) toda la sesión sin leer nada.
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
