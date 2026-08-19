// PaddleOCR adapter to the format the rest of the scanner expects
// paddle returns one box per LINE instead of per word, sometimes with two words glued ("YareliPrime");
// this translates it to what `getValidItemMatch` and `parseRewards` consume, and a drift breaks rewards
// only with paddle on, the case nobody tests
// no library or image needed: a fake service is plugged in

import { test } from "node:test";
import assert from "node:assert/strict";

const { PaddleRepository: P } = await import("../deploy/js/repositories/paddle.repository.js");

/** replaces the real service with one that returns whatever it is told */
function conServicio(respuesta) {
  P._service = { recognize: async () => respuesta, initialize: async () => {} };
  P._initPromise = Promise.resolve(P._service);
}

const linea = (text, box, confidence = 0.9) => ({ text, box, confidence });
const caja = (x, y, width, height) => ({ x, y, width, height });

test("el texto sale en palabras y en mayúsculas, como el otro motor", async () => {
  conServicio({ text: "Braton Prime Blueprint" });
  assert.deepEqual(await P.recognizeWords(null), ["BRATON", "PRIME", "BLUEPRINT"]);
});

test("la puntuación y el ruido no generan palabras vacías", async () => {
  conServicio({ text: "  Braton-Prime,  ??  Receiver " });
  assert.deepEqual(await P.recognizeWords(null), ["BRATON", "PRIME", "RECEIVER"]);
});

// null and not `[]` lets the scanner tell "read nothing" from "read an empty cell" and retry with the
// other engine
test("sin texto devuelve null, no una lista vacía", async () => {
  conServicio({ text: "" });
  assert.equal(await P.recognizeWords(null), null);
  conServicio({});
  assert.equal(await P.recognizeWords(null), null);
  conServicio({ text: "..." });
  assert.equal(await P.recognizeWords(null), null);
});

test("cada palabra sale con la caja que espera el agrupado por columnas", async () => {
  conServicio({ lines: [[linea("Braton Prime", caja(100, 50, 200, 20))]] });
  const words = await P.recognizeWordsWithBoxes(null);

  assert.equal(words.length, 2);
  for (const w of words) {
    for (const k of ["x0", "x1", "y0", "y1"]) assert.equal(typeof w.bbox[k], "number", k);
    assert.equal(w.bbox.y0, 50);
    assert.equal(w.bbox.y1, 70);
  }
  assert.deepEqual(words.map((w) => w.text), ["Braton", "Prime"]);
});

// paddle gives one box per line and words are spread across its width; the exact pixel does not matter,
// only which card each name belongs to, but they must be in order and without gaps
test("las palabras de una línea se reparten a lo ancho de su caja, en orden", async () => {
  conServicio({ lines: [[linea("Uno Dos Cuatro", caja(0, 0, 300, 20))]] });
  const words = await P.recognizeWordsWithBoxes(null);

  assert.deepEqual(words.map((w) => [w.bbox.x0, w.bbox.x1]), [[0, 100], [100, 200], [200, 300]]);
});

test("dos palabras pegadas se separan por el cambio de caja", async () => {
  conServicio({ lines: [[linea("YareliPrime Blueprint", caja(0, 0, 300, 20))]] });
  const words = await P.recognizeWordsWithBoxes(null);
  assert.deepEqual(words.map((w) => w.text), ["Yareli", "Prime", "Blueprint"]);
});

// confidence is used as a percentage downstream, but paddle gives it from 0 to 1
test("la confianza se convierte a porcentaje", async () => {
  conServicio({ lines: [[linea("Braton", caja(0, 0, 100, 20), 0.87)]] });
  const [w] = await P.recognizeWordsWithBoxes(null);
  assert.equal(w.confidence, 87);
});

test("una línea sin confianza no deja el campo en undefined", async () => {
  conServicio({ lines: [[{ text: "Braton", box: caja(0, 0, 100, 20) }]] });
  const [w] = await P.recognizeWordsWithBoxes(null);
  assert.equal(w.confidence, 100);
});

// paddle returns nested lines, sometimes with incomplete entries: one of them must not kill the whole
// frame's scan
test("las líneas incompletas se descartan sin romper el resto", async () => {
  conServicio({
    lines: [[
      linea("Braton", caja(0, 0, 100, 20)),
      { text: "sin caja" },
      { box: caja(0, 0, 10, 10) },
      null,
    ]],
  });
  const words = await P.recognizeWordsWithBoxes(null);
  assert.deepEqual(words.map((w) => w.text), ["Braton"]);
});

test("sin líneas devuelve una lista vacía, no una excepción", async () => {
  conServicio({});
  assert.deepEqual(await P.recognizeWordsWithBoxes(null), []);
  conServicio({ lines: [] });
  assert.deepEqual(await P.recognizeWordsWithBoxes(null), []);
});

// the library loads by dynamic import from a configurable CDN; here it gets a data module, so the real
// warmUp runs, not a preloaded promise
const MODULO_FALSO = "data:text/javascript," + encodeURIComponent(`
  globalThis.__paddleArranques = (globalThis.__paddleArranques || 0) + 1;
  export const V6_TINY_MODEL = { nombre: "tiny" };
  export const V5_MODEL = { nombre: "grande" };
  export class PaddleOcrService {
    constructor(opts) { globalThis.__paddleModelo = opts.model; }
    async initialize() { globalThis.__paddleInits = (globalThis.__paddleInits || 0) + 1; }
    async recognize() { return { text: "OK" }; }
  }
`);

function reiniciaPaddle() {
  P._service = null;
  P._initPromise = null;
  globalThis.__paddleArranques = 0;
  globalThis.__paddleInits = 0;
  globalThis.PADDLE_CDN = MODULO_FALSO;
}

// several MB of library and models: loading them per scanned cell would make the engine unusable
test("la librería se carga una sola vez aunque se pida en paralelo", async () => {
  reiniciaPaddle();
  const ruido = console.log;
  console.log = () => {};
  try {
    await Promise.all([P.warmUp(), P.warmUp(), P.warmUp()]);
    await P.warmUp();
  } finally { console.log = ruido; }

  assert.equal(globalThis.__paddleInits, 1, "un solo initialize()");
  assert.equal(globalThis.__paddleArranques, 1, "un solo import del módulo");
});

// TINY is 4.8 MB and ~630 ms per image against 12 MB and ~1.5 s for the large model with the same
// accuracy; a default model change shows on every scan, so it is pinned
test("por defecto se carga el modelo pequeño", async () => {
  reiniciaPaddle();
  const ruido = console.log;
  console.log = () => {};
  try { await P.warmUp(); } finally { console.log = ruido; }
  assert.deepEqual(globalThis.__paddleModelo, { nombre: "tiny" });
});

test("se puede pedir otro modelo, y uno inexistente cae al pequeño", async () => {
  reiniciaPaddle();
  const ruido = console.log;
  console.log = () => {};
  try {
    globalThis.PADDLE_MODEL = "V5_MODEL";
    await P.warmUp();
    assert.deepEqual(globalThis.__paddleModelo, { nombre: "grande" });

    reiniciaPaddle();
    globalThis.PADDLE_MODEL = "MODELO_QUE_NO_EXISTE";
    await P.warmUp();
    assert.deepEqual(globalThis.__paddleModelo, { nombre: "tiny" }, "no puede quedarse sin modelo");
  } finally {
    console.log = ruido;
    delete globalThis.PADDLE_MODEL;
    P._service = null;
    P._initPromise = null;
  }
});
