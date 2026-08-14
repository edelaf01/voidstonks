// OpenCV.js loading: 8 MB of wasm arriving from a CDN while the user is already scanning
// that window must break nothing: no double injection, a fallback CDN, a timeout that returns `false`
// instead of hanging, and `run()` swallowing C++ errors (a number, not an Error) instead of killing the
// frame

import { test } from "node:test";
import assert from "node:assert/strict";

const inyectados = [];
let alCargar = "load"; // "load" | "error"

globalThis.document = {
  head: {
    appendChild: (s) => {
      // alCargar can be a fixed value or a list, to simulate "the first CDN fails and the second loads"
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

test("con OpenCV ya presente no se descarga nada", async () => {
  reset();
  globalThis.cv = { getBuildInformation: () => "" };
  assert.equal(await R.waitReady(1000), true);
  assert.deepEqual(inyectados, []);
});

// the main CDN (docs.opencv.org) goes down now and then; without a fallback the scanner loses vision
// without saying why
test("si el CDN principal falla se intenta el de respaldo", async () => {
  reset();
  alCargar = ["error", "load"];
  await sinRuido(() => R.waitReady(150));
  assert.equal(inyectados.length, 2, `se intentaron: ${inyectados.join(", ")}`);
  assert.notEqual(inyectados[0], inyectados[1], "el respaldo tiene que ser otro host");
});

// rejecting here made the mobile scanner's general try close it entirely, skipping its own `if (!success)
// setVisionStatus("ERROR")`; without OpenCV the scanner still works, since colour detection and
// binarisation are pure JS
test("con los dos CDN caídos devuelve false, no lanza", async () => {
  reset();
  alCargar = "error";
  const r = await sinRuido(() => R.waitReady(150));
  assert.equal(r, false);
});

// a failure used to leave `initializationPromise` pending forever, hanging every later call instead of
// answering that there is no OpenCV
test("tras un fallo, la siguiente llamada responde en vez de colgarse", async () => {
  reset();
  alCargar = "error";
  await sinRuido(() => R.waitReady(150));
  const segunda = await sinRuido(() => R.waitReady(150));
  assert.equal(segunda, false);
});

// hanging would leave the scanner "loading" forever; returning false lets it fall back to the pure JS path
test("si OpenCV no llega, se rinde a tiempo devolviendo false", async () => {
  reset();
  const t0 = Date.now();
  const r = await sinRuido(() => R.waitReady(120));
  assert.equal(r, false);
  assert.ok(Date.now() - t0 < 2000, "no puede quedarse esperando");
});

// the scanner calls waitReady from several places (startup, each session, mobile): without memoizing, each
// call would inject another 8 MB <script>
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

// OpenCV.js comes from C++ through Emscripten and its exceptions arrive as a NUMBER (a pointer), not an
// Error: a `catch` assuming Error shows "[object Object]", and without one every failed op kills the
// scanner frame
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
