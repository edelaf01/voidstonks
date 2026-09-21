// El muestreador de rendimiento de la grabadora: una muestra cada 10 s con el heap, el retraso
// máximo del bucle de eventos y las tareas largas del intervalo; todo con relojes inyectados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaMuestreador } from "../deploy/js/utils/perf_sampler.js";

function entorno() {
  let t = 1000;
  const timers = [];
  const ahora = () => t;
  const programa = (fn, ms) => { timers.push({ fn, en: t + ms }); };
  const dispara = (retraso = 0) => { for (const x of timers.splice(0)) { t = x.en + retraso; x.fn(); } };
  const avanza = (ms) => { t += ms; };
  return { ahora, programa, dispara, avanza, set t(v) { t = v; } };
}

test("la primera muestra sale en el primer tick y luego una cada 10 s", () => {
  const e = entorno();
  const m = creaMuestreador({ ahora: e.ahora, programa: e.programa, perf: { memory: { usedJSHeapSize: 300 * 1048576, totalJSHeapSize: 400 * 1048576 } }, Observador: undefined });
  const primera = m.tick({ contexto: "INVENTORY" });
  assert.equal(primera.heapMB, 300);
  assert.equal(primera.contexto, "INVENTORY");
  e.avanza(5000);
  assert.equal(m.tick(), null);
  e.avanza(5000);
  assert.notEqual(m.tick(), null);
});

test("el retraso del bucle es lo que tarda de más la sonda de 100 ms, y se reinicia por muestra", () => {
  const e = entorno();
  const m = creaMuestreador({ ahora: e.ahora, programa: e.programa, perf: null, Observador: undefined });
  m.tick();
  e.dispara(320); // la sonda dispara 320 ms tarde: el hilo estuvo ocupado
  e.avanza(10000);
  const muestra = m.tick();
  assert.equal(muestra.retrasoMaxMs, 320);
  assert.equal(muestra.heapMB, null, "sin performance.memory no se inventa");
  e.dispara(0);
  e.avanza(10000);
  assert.equal(m.tick().retrasoMaxMs, 0);
});

test("las tareas largas del intervalo se suman y se cuentan", () => {
  const e = entorno();
  let cb = null;
  class Observador { constructor(f) { cb = f; } observe() {} disconnect() { cb = null; } }
  const m = creaMuestreador({ ahora: e.ahora, programa: e.programa, perf: null, Observador });
  m.tick();
  cb({ getEntries: () => [{ duration: 250 }, { duration: 80 }] });
  e.avanza(10000);
  const muestra = m.tick();
  assert.equal(muestra.tareasLargasMs, 330);
  assert.equal(muestra.tareasLargas, 2);
  m.para();
  assert.equal(cb, null);
});
