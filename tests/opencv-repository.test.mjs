// Carga de OpenCV.js.
//
// Son 8 MB de wasm que llegan por CDN mientras el usuario ya está escaneando. Lo que se protege
// aquí es que ese rato no rompa nada: que no se inyecte el script dos veces, que haya un CDN de
// respaldo, que un timeout devuelva `false` en vez de colgar el escáner para siempre, y que
// `run()` se trague los errores de C++ —que llegan como un número, no como un Error— en vez de
// tumbar el frame.
//
// El `document` es de mentira: aquí solo importa qué se inyecta y cuántas veces.

import { test } from "node:test";
import assert from "node:assert/strict";

const inyectados = [];
let alCargar = "load"; // "load" | "error"

globalThis.document = {
  head: {
    appendChild: (s) => {
      // alCargar puede ser un valor fijo o una lista, para simular "el primer CDN falla y el
      // segundo carga".
      const modo = Array.isArray(alCargar) ? (alCargar.shift() ?? "load") : alCargar;
      setTimeout(() => (modo === "load" ? s.onload() : s.onerror()), 0);
    },
  },
  querySelector: (sel) => inyectados.find((u) => sel.includes(u)) ? {} : null,
  createElement: () => {
    const s = {};
    Object.defineProperty(s, "src", { set(v) { inyectados.push(v); }, get() { return inyectados.at(-1); } });
    return s;
  },
};

const { OpenCVRepository: R } = await import("../deploy/js/repositories/opencv.repository.js");

function reset() {
  inyectados.length = 0;
  alCargar = "load";
  R.isReady = false;
  R.initializationPromise = null;
  R.DISABLE_OPENCV = false;
  delete globalThis.cv;
}

const sinRuido = async (fn) => {
  const w = console.warn, e = console.error;
  console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; }
};

// --- Carga ----------------------------------------------------------------------------------

// Si la librería ya está en la página (otro módulo la cargó, o el navegador la cacheó) no hay
// nada que descargar.
test("con OpenCV ya presente no se descarga nada", async () => {
  reset();
  globalThis.cv = { getBuildInformation: () => "" };
  assert.equal(await R.waitReady(1000), true);
  assert.deepEqual(inyectados, []);
});

// El CDN principal (docs.opencv.org) se cae con cierta frecuencia; sin respaldo, el escáner se
// queda sin visión sin decir por qué.
test("si el CDN principal falla se intenta el de respaldo", async () => {
  reset();
  alCargar = ["error", "load"];
  await sinRuido(() => R.waitReady(150));
  assert.equal(inyectados.length, 2, `se intentaron: ${inyectados.join(", ")}`);
  assert.notEqual(inyectados[0], inyectados[1], "el respaldo tiene que ser otro host");
});

// Con los dos CDN caídos esto RECHAZABA. El escáner móvil lo capturaba en su try general y se
// cerraba entero, saltándose su propio `if (!success) setVisionStatus("ERROR")`. Y sin OpenCV el
// escáner sigue siendo usable: la detección de color y la binarización son JS puro.
test("con los dos CDN caídos devuelve false, no lanza", async () => {
  reset();
  alCargar = "error";
  const r = await sinRuido(() => R.waitReady(150));
  assert.equal(r, false);
});

// Antes, tras un fallo, `initializationPromise` quedaba pendiente para siempre y CUALQUIER
// llamada posterior se colgaba en vez de responder que no hay OpenCV.
test("tras un fallo, la siguiente llamada responde en vez de colgarse", async () => {
  reset();
  alCargar = "error";
  await sinRuido(() => R.waitReady(150));
  const segunda = await sinRuido(() => R.waitReady(150));
  assert.equal(segunda, false);
});

// Colgarse esperando dejaría el escáner en "cargando" para siempre; devolver false le permite
// caer al camino de JS puro.
test("si OpenCV no llega, se rinde a tiempo devolviendo false", async () => {
  reset();
  const t0 = Date.now();
  const r = await sinRuido(() => R.waitReady(120));
  assert.equal(r, false);
  assert.ok(Date.now() - t0 < 2000, "no puede quedarse esperando");
});

// El escáner llama a waitReady desde varios sitios (arranque, cada sesión, el móvil): sin
// memorizar, cada llamada metería otro <script> de 8 MB.
test("varias llamadas a la vez comparten una sola carga", async () => {
  reset();
  await sinRuido(() => Promise.all([R.waitReady(60), R.waitReady(60), R.waitReady(60)]));
  assert.ok(inyectados.length <= 2, `se inyectaron ${inyectados.length} scripts`);
});

test("el interruptor de código corta la carga sin efectos secundarios", async () => {
  reset();
  R.DISABLE_OPENCV = true;
  assert.equal(await sinRuido(() => R.waitReady(50)), false);
  assert.deepEqual(inyectados, []);
  R.DISABLE_OPENCV = false;
});

// --- run() ----------------------------------------------------------------------------------

test("sin OpenCV listo, run no ejecuta nada y devuelve null", () => {
  reset();
  let corrio = false;
  assert.equal(R.run(() => { corrio = true; return 1; }), null);
  assert.equal(corrio, false);
});

test("con OpenCV listo, run entrega la librería y devuelve el resultado", () => {
  reset();
  R.isReady = true;
  globalThis.cv = { marca: "ok" };
  assert.equal(R.run((cv) => cv.marca), "ok");
});

// OpenCV.js viene de C++ por Emscripten y sus excepciones llegan como un NÚMERO (un puntero),
// no como un Error. Un `catch` que asuma Error deja el mensaje en "[object Object]"; peor, sin
// catch cada operación fallida tumba el frame entero del escáner.
test("una excepción de C++ (un puntero numérico) se traduce en vez de propagarse", () => {
  reset();
  R.isReady = true;
  globalThis.cv = { exceptionFromPtr: (p) => ({ msg: `error real ${p}` }) };

  let visto = null;
  const real = console.error;
  console.error = (...a) => { visto = a.join(" "); };
  try {
    assert.equal(R.run(() => { throw 12345; }), null, "devuelve null, no propaga");
  } finally { console.error = real; }
  assert.match(visto, /error real 12345/);
});

test("un error normal dentro de run tampoco escapa", () => {
  reset();
  R.isReady = true;
  globalThis.cv = {};
  const real = console.error;
  console.error = () => {};
  try {
    assert.equal(R.run(() => { throw new Error("boom"); }), null);
  } finally { console.error = real; }
});
