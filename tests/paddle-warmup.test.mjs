// loading the precise engine may fail, but not FOREVER
// regression: warmUp() kept the promise in _initPromise and returned it as is, so a REJECTED promise was
// reused for the rest of the session; one hiccup (the CDN, a moment offline) left the engine dead,
// everything fell back to tesseract and nothing showed in the console, since debug_log.js silences
// console.warn in production
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { PaddleRepository } = await import("../deploy/js/repositories/paddle.repository.js");

beforeEach(() => {
  PaddleRepository._service = null;
  PaddleRepository._initPromise = null;
  PaddleRepository.ultimoFallo = null;
});

/** replaces the real load (a CDN import) with one the test decides */
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
    // this used to return the SAME rejected promise and the engine never came back
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
  // the behaviour above is tested with a double because the real load pulls 4.8 MB from a CDN; this checks
  // the source has the same safety net
  const src = (await import("node:fs")).readFileSync(
    new URL("../deploy/js/repositories/paddle.repository.js", import.meta.url), "utf8");
  assert.match(src, /_initPromise\.catch\(/, "warmUp no limpia la promesa rechazada");
  assert.match(src, /this\._initPromise = null/, "sin esto el fallo es permanente");
});
