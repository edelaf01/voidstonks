// Cargar el motor preciso puede fallar; lo que no puede es fallar PARA SIEMPRE.
//
// Regresión real: warmUp() guardaba la promesa en _initPromise y la devolvía tal cual, así que
// una promesa RECHAZADA se reutilizaba el resto de la sesión. Un tropiezo puntual —el CDN, un
// momento sin red— dejaba el motor preciso muerto, todo pasaba a leerse con Tesseract (más
// lento y con bastantes menos aciertos) y no había ni una línea en consola que lo dijera: el
// aviso iba por console.warn, que debug_log.js silencia en producción.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { PaddleRepository } = await import("../deploy/js/repositories/paddle.repository.js");

beforeEach(() => {
  PaddleRepository._service = null;
  PaddleRepository._initPromise = null;
  PaddleRepository.ultimoFallo = null;
});

/** Sustituye la carga real (import de un CDN) por una que decide el test. */
function conCarga(fn) {
  const original = Object.getOwnPropertyDescriptor(PaddleRepository, "warmUp");
  let llamadas = 0;
  PaddleRepository.warmUp = function () {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      llamadas++;
      this._service = await fn(llamadas);
      this.ultimoFallo = null;
      return this._service;
    })();
    this._initPromise.catch((e) => { this.ultimoFallo = e; this._initPromise = null; });
    return this._initPromise;
  };
  return { llamadas: () => llamadas, restaura: () => Object.defineProperty(PaddleRepository, "warmUp", original) };
}

test("un fallo de carga se puede reintentar", async () => {
  const h = conCarga((n) => (n === 1 ? Promise.reject(new Error("CDN caído")) : { ok: true }));
  try {
    await assert.rejects(PaddleRepository.warmUp(), /CDN caído/);
    // Sin el arreglo esto devolvía la MISMA promesa rechazada y el motor no volvía nunca.
    const svc = await PaddleRepository.warmUp();
    assert.deepEqual(svc, { ok: true });
    assert.equal(h.llamadas(), 2, "no reintentó: el fallo se quedó cacheado");
    assert.equal(PaddleRepository.listo(), true);
  } finally { h.restaura(); }
});

test("mientras carga bien, no se arranca dos veces", async () => {
  const h = conCarga(() => Promise.resolve({ ok: true }));
  try {
    await Promise.all([PaddleRepository.warmUp(), PaddleRepository.warmUp()]);
    assert.equal(h.llamadas(), 1);
  } finally { h.restaura(); }
});

test("el fallo queda anotado para que la UI lo pueda decir", async () => {
  const h = conCarga(() => Promise.reject(new Error("sin red")));
  try {
    await PaddleRepository.warmUp().catch(() => {});
    assert.match(String(PaddleRepository.ultimoFallo?.message), /sin red/);
    assert.equal(PaddleRepository.listo(), false);
  } finally { h.restaura(); }
});

test("el código real limpia _initPromise al fallar", async () => {
  // El comportamiento de arriba se prueba con un doble porque la carga real baja 4,8 MB de un
  // CDN. Esto comprueba que la fuente de verdad lleva la misma red de seguridad.
  const src = (await import("node:fs")).readFileSync(
    new URL("../deploy/js/repositories/paddle.repository.js", import.meta.url), "utf8");
  assert.match(src, /_initPromise\.catch\(/, "warmUp no limpia la promesa rechazada");
  assert.match(src, /this\._initPromise = null/, "sin esto el fallo es permanente");
});
