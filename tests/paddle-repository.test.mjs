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

// glued words are NOT split here: cutting at every case change also splits words with a misread capital
// ("ReceIver" -> "Rece Iver", the part was lost); splitFusedWords does that, with the catalog vocabulary
// to know whether there is anything to split
test("las pegadas viajan enteras: el vocabulario decide dónde cortar", async () => {
  conServicio({ lines: [[linea("YareliPrime Blueprint", caja(0, 0, 300, 20))]] });
  const words = await P.recognizeWordsWithBoxes(null);
  assert.deepEqual(words.map((w) => w.text), ["YareliPrime", "Blueprint"]);
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
test("por defecto se cargan los modelos que servimos nosotros", async () => {
  reiniciaPaddle();
  const ruido = console.log;
  console.log = () => {};
  try { await P.warmUp(); } finally { console.log = ruido; }
  // not from HuggingFace: when that host went down the scanner did not start
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

// the inference runs in paddle.worker.js and only the client stays on the page; without browser APIs
// (node) everything above stays on the thread, so fake ones are installed here
import { existsSync } from "node:fs";
import { crearWorkerFalso, libreriaFalsa } from "./_helpers/fake-paddle-worker.mjs";
const { RUTA_WORKER_PADDLE } = await import("../deploy/js/repositories/paddle.repository.js");

function conWorker({ muereAlArrancar = false, recognize } = {}) {
  reiniciaPaddle();
  P._arranquesWorker = 0; P._modo = null; P.ultimoFallo = null;
  const { mod, inits } = libreriaFalsa({ recognize });
  const urls = [];
  const { WorkerFalso, creados } = crearWorkerFalso({ importar: async (u) => { urls.push(u); return mod; }, muereAlArrancar });
  globalThis.Worker = WorkerFalso;
  globalThis.OffscreenCanvas = class {};
  globalThis.createImageBitmap = async () => ({ width: 8, height: 4 }); // no functions: it travels cloned over the channel
  globalThis.document = { baseURI: "https://voidstonks.com/scanner.html" };
  const ruido = { log: console.log, error: console.error };
  const errores = [];
  console.log = () => {}; console.error = (...a) => errores.push(a.map(String).join(" "));
  return {
    inits, urls, creados, errores,
    restaura() {
      console.log = ruido.log; console.error = ruido.error;
      for (const c of creados) c.terminate();
      delete globalThis.Worker; delete globalThis.OffscreenCanvas; delete globalThis.createImageBitmap; delete globalThis.document; delete globalThis.PADDLE_WORKER;
      reiniciaPaddle(); P._arranquesWorker = 0; P._modo = null;
    },
  };
}

test("con Worker disponible el motor arranca en el worker y la página no importa la librería", async () => {
  const h = conWorker();
  try {
    await P.warmUp();
    assert.equal(P.modo(), "worker");
    assert.deepEqual(h.urls, [MODULO_FALSO], "el CDN configurado viaja al worker");
    assert.equal(globalThis.__paddleInits, 0, "la página no cargó la librería");
    assert.equal(h.creados.length, 1);
    assert.match(h.creados[0].url, /\/deploy\/js\/repositories\/paddle\.worker\.js\?v=/);
    assert.deepEqual(h.creados[0].opts, { type: "module" });
    assert.equal(h.inits[0].model.detection, "https://voidstonks.com/assets/ocr/PP-OCRv6_tiny_det.ort", "rutas absolutas desde la página");
    assert.equal(P.ultimoFallo, null);
  } finally { h.restaura(); }
});

test("si el worker no arranca cae al hilo principal y lo dice por console.error", async () => {
  const h = conWorker({ muereAlArrancar: true });
  try {
    await P.warmUp();
    assert.equal(P.modo(), "hilo");
    assert.equal(globalThis.__paddleInits, 1);
    assert.equal(P.ultimoFallo, null);
    assert.ok(h.errores.some((e) => /no arrancó/.test(e)), h.errores.join("\n"));
  } finally { h.restaura(); }
});

test("si el worker muere a mitad, la lectura en vuelo falla y el motor vuelve solo", async () => {
  const h = conWorker({ recognize: () => new Promise(() => {}) }); // never answers: simulates the hang
  try {
    await P.warmUp();
    const primero = h.creados[0];
    const lectura = P.recognizeWords({ canvas: true });
    await new Promise((r) => setTimeout(r, 0));
    primero.onerror({ message: "boom" });
    await assert.rejects(lectura, /boom/);
    assert.match(String(P.ultimoFallo?.message), /boom/, "en el hueco rejillaConClasico() da true");
    await P.warmUp();
    assert.equal(P.modo(), "worker");
    assert.equal(P._arranquesWorker, 2);
    assert.equal(P.ultimoFallo, null);
  } finally { h.restaura(); }
});

test("tras dos muertes se queda en el hilo principal", async () => {
  const h = conWorker();
  try {
    await P.warmUp();
    h.creados[0].onerror({ message: "1" });
    await new Promise((r) => setTimeout(r, 0));
    await P.warmUp();
    h.creados[1].onerror({ message: "2" });
    await new Promise((r) => setTimeout(r, 0));
    await P.warmUp();
    assert.equal(P.modo(), "hilo");
    assert.equal(h.creados.length, 2);
  } finally { h.restaura(); }
});

test("PADDLE_WORKER=false fuerza el hilo aunque haya Worker", async () => {
  const h = conWorker();
  try {
    globalThis.PADDLE_WORKER = false;
    await P.warmUp();
    assert.equal(P.modo(), "hilo");
    assert.equal(h.creados.length, 0);
  } finally { h.restaura(); }
});

test("el fichero del worker existe donde apunta el repositorio", () => {
  // import-graph does not look at `new URL(...)`: this is the only warning of a rename
  const ruta = new URL(RUTA_WORKER_PADDLE.split("?")[0], new URL("../deploy/js/repositories/paddle.repository.js", import.meta.url));
  assert.equal(existsSync(ruta), true, String(ruta));
});

// on scanner close the worker (onnxruntime + models, ~200 MB) stayed alive between sessions
test("apaga() termina el worker y deja el motor listo para recargarse", async () => {
  const h = conWorker();
  try {
    await P.warmUp();
    assert.equal(P.modo(), "worker");
    P.apaga();
    assert.equal(h.creados[0].terminado, true);
    assert.equal(P.listo(), false);
    assert.equal(P._initPromise, null);
    await P.warmUp();
    assert.equal(P.modo(), "worker", "la siguiente sesión lo vuelve a arrancar");
    assert.equal(h.creados.length, 2);
  } finally { h.restaura(); }
});

test("apaga() no toca el servicio en hilo principal: no se puede liberar", async () => {
  reiniciaPaddle();
  const ruido = console.log; console.log = () => {};
  try { await P.warmUp(); } finally { console.log = ruido; }
  assert.equal(P.modo(), "hilo");
  P.apaga();
  assert.equal(P.listo(), true);
});

// the 5/6 of a relic code needs WHERE the word is: per strip the batch keeps its boxed lines and the
// colour montage they fall on
test("el lote guarda por tira las palabras con caja y un recorte del montaje", async () => {
  const { FakeCanvas, installFakeDocument } = await import("./_helpers/fake-canvas.mjs");
  const habiaDocument = globalThis.document;
  installFakeDocument(); // montaTiras creates the montage canvas with document.createElement
  const frame = new FakeCanvas(600, 400);
  P._service = { recognize: async (canvas) => ({ lines: [[{ text: "Lith A5", box: { x: 10, y: 4, width: 120, height: 30 }, confidence: 0.9 }], [{ text: "Relic", box: { x: 10, y: 60, width: 80, height: 30 }, confidence: 0.9 }]] }) };
  P._initPromise = Promise.resolve(P._service);
  const salida = await P.recognizeStripWords(frame, [{ clave: "r0c0", sx: 0, sy: 0, sw: 277, sh: 140 }]);
  assert.deepEqual(salida.get("r0c0"), ["LITH", "A5", "RELIC"]);
  const palabras = P.palabrasDelLote("r0c0");
  assert.deepEqual(palabras.map((w) => w.text), ["Lith", "A5", "Relic"]);
  assert.deepEqual(palabras[1].bbox, { x0: 70, x1: 130, y0: 4, y1: 34 }, "la caja del código, repartida por caracteres dentro de su línea");
  const recorte = P.recorteDelLote("r0c0")(palabras[1].bbox);
  assert.equal(recorte.width, 60 + 6); assert.equal(recorte.height, 30 + 6);
  assert.equal(P.palabrasDelLote("r9c9").length, 0);
  assert.equal(P.recorteDelLote("r9c9")({ x0: 0, y0: 0, x1: 10, y1: 10 }), null);
  if (habiaDocument === undefined) delete globalThis.document; else globalThis.document = habiaDocument;
});
