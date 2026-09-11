import { test } from "node:test";
import assert from "node:assert/strict";

const { PaddleRepository: P } = await import("../deploy/js/repositories/paddle.repository.js");

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

test("las palabras de una línea se reparten a lo ancho de su caja, en orden", async () => {
  conServicio({ lines: [[linea("Uno Dos Cuatro", caja(0, 0, 300, 20))]] });
  const words = await P.recognizeWordsWithBoxes(null);

  assert.deepEqual(words.map((w) => [w.bbox.x0, w.bbox.x1]), [[0, 100], [100, 200], [200, 300]]);
});

test("las pegadas viajan enteras: el vocabulario decide dónde cortar", async () => {
  conServicio({ lines: [[linea("YareliPrime Blueprint", caja(0, 0, 300, 20))]] });
  const words = await P.recognizeWordsWithBoxes(null);
  assert.deepEqual(words.map((w) => w.text), ["YareliPrime", "Blueprint"]);
});

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

// tiny is 4.8 MB and ~630 ms vs 12 MB and ~1.5 s for large model with same accuracy: pinned
test("por defecto se cargan los modelos que servimos nosotros", async () => {
  reiniciaPaddle();
  const ruido = console.log;
  console.log = () => {};
  try { await P.warmUp(); } finally { console.log = ruido; }
  assert.deepEqual(globalThis.__paddleModelo, {
    detection: "assets/ocr/PP-OCRv6_tiny_det.ort",
    recognition: "assets/ocr/PP-OCRv6_tiny_rec.ort",
    charactersDictionary: "assets/ocr/ppocrv6_tiny_dict.txt",
  });
});

test("se puede pedir otro modelo por nombre, y uno inexistente cae al nuestro", async () => {
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
    assert.equal(globalThis.__paddleModelo.detection, "assets/ocr/PP-OCRv6_tiny_det.ort",
      "no puede quedarse sin modelo");
  } finally {
    console.log = ruido;
    delete globalThis.PADDLE_MODEL;
    P._service = null;
    P._initPromise = null;
  }
});
