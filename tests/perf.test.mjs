import { test } from "node:test";
import assert from "node:assert/strict";
import { cronometro } from "../deploy/js/utils/perf.js";

function capturando(fn) {
  const original = console.log;
  const lineas = [];
  console.log = (...a) => lineas.push(a.join(" "));
  try { fn(); } finally { console.log = original; }
  return lineas;
}

const gastar = (ms) => { const t = performance.now(); while (performance.now() - t < ms) {} };

test("cada fase mide su propio tramo, no desde el principio", () => {
  const c = cronometro("prueba");
  gastar(12);
  c.fase("uno");
  gastar(12);
  c.fase("dos");
  const [linea] = capturando(() => c.fin());
  const [, a, b] = /uno (\d+) · dos (\d+)/.exec(linea) || [];
  assert.ok(Number(a) >= 8, `la primera fase midió ${a} ms`);
  assert.ok(Number(b) >= 8 && Number(b) < Number(a) + 12, `la segunda midió ${b} ms, ¿acumulando?`);
});

test("el total es el total, no la suma de las fases nombradas", () => {
  const c = cronometro("prueba");
  gastar(10);
  c.fase("solo-una");
  gastar(15);
  const [linea] = capturando(() => c.fin());
  const total = Number(/prueba (\d+) ms/.exec(linea)?.[1]);
  assert.ok(total >= 23, `total ${total} ms: se perdió el tramo sin nombrar`);
});

test("la etiqueta y el extra salen en la línea, para poder buscarla en consola", () => {
  const c = cronometro("inventario");
  c.fase("rejilla");
  const [linea] = capturando(() => c.fin("18 badges 40 ms"));
  assert.match(linea, /^\[PERF\] inventario /);
  assert.match(linea, /rejilla \d+/);
  assert.match(linea, /· 18 badges 40 ms$/);
});

test("sin extra no deja el separador colgando", () => {
  const c = cronometro("x");
  c.fase("a");
  const [linea] = capturando(() => c.fin());
  assert.doesNotMatch(linea, /· $/);
});

test("fin() devuelve el total para poder decidir con él", () => {
  const c = cronometro("x");
  gastar(5);
  let total;
  capturando(() => { total = c.fin(); });
  assert.ok(total >= 4 && total < 5000);
});

test("por debajo del mínimo no imprime, pero sigue devolviendo el total", () => {
  // scanner loop runs every 300 ms: without a threshold the console fills with idle frames
  const c = cronometro("frame", 5000);
  c.fase("nada");
  let total;
  const lineas = capturando(() => { total = c.fin(); });
  assert.deepEqual(lineas, []);
  assert.equal(typeof total, "number");
});

test("por encima del mínimo sí imprime", () => {
  const c = cronometro("frame", 1);
  gastar(3);
  c.fase("algo");
  const lineas = capturando(() => c.fin());
  assert.equal(lineas.length, 1);
});
