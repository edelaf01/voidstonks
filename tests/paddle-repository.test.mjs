// Adaptador de PaddleOCR al formato que espera el resto del escáner.
//
// Paddle es el motor alternativo a Tesseract y devuelve las cosas de OTRA forma: una caja por
// LÍNEA en vez de por palabra, y a veces con dos palabras pegadas ("YareliPrime"). Todo lo que
// hay aquí es la traducción a lo que ya consumen `getValidItemMatch` y `parseRewards`; si la
// traducción se desvía, el escáner deja de reconocer recompensas solo con el motor Paddle
// activado, que es justo el caso que nadie prueba.
//
// No hace falta ni la librería ni una imagen: se le enchufa un servicio falso.

import { test } from "node:test";
import assert from "node:assert/strict";

const { PaddleRepository: P } = await import("../deploy/js/repositories/paddle.repository.js");

/** Sustituye el servicio real por uno que devuelve lo que se le diga. */
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

// Devolver null y no `[]` es lo que permite al escáner distinguir "no leí nada" de "leí una
// celda vacía" y reintentar con el otro motor.
test("sin texto devuelve null, no una lista vacía", async () => {
  conServicio({ text: "" });
  assert.equal(await P.recognizeWords(null), null);
  conServicio({});
  assert.equal(await P.recognizeWords(null), null);
  conServicio({ text: "..." });
  assert.equal(await P.recognizeWords(null), null);
});

// --- Cajas: el formato que consume parseRewards ---------------------------------------------

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

// Paddle da una caja por línea; las palabras se reparten a lo ancho. No hace falta el píxel
// exacto —solo saber a qué card pertenece cada nombre— pero sí que vayan en orden y sin huecos.
test("las palabras de una línea se reparten a lo ancho de su caja, en orden", async () => {
  conServicio({ lines: [[linea("Uno Dos Cuatro", caja(0, 0, 300, 20))]] });
  const words = await P.recognizeWordsWithBoxes(null);

  assert.deepEqual(words.map((w) => [w.bbox.x0, w.bbox.x1]), [[0, 100], [100, 200], [200, 300]]);
});

// Las palabras pegadas NO se separan aquí: cortar en cada cambio de caja parte también las
// palabras con una mayúscula por error de lectura ("ReceIver" -> "Rece Iver", medido, la pieza
// se perdía). De eso se encarga splitFusedWords, que tiene el vocabulario del catálogo para
// saber si hay algo que partir. Aquí solo se reparte la línea en sus palabras.
test("las pegadas viajan enteras: el vocabulario decide dónde cortar", async () => {
  conServicio({ lines: [[linea("YareliPrime Blueprint", caja(0, 0, 300, 20))]] });
  const words = await P.recognizeWordsWithBoxes(null);
  assert.deepEqual(words.map((w) => w.text), ["YareliPrime", "Blueprint"]);
});

// La confianza se usa como porcentaje aguas abajo, pero Paddle la da de 0 a 1.
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

// Paddle devuelve las líneas anidadas y a veces con entradas incompletas: una sola de ellas no
// puede tumbar el escaneo del frame entero.
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

// --- Arranque -------------------------------------------------------------------------------

// La librería se carga por import dinámico desde un CDN configurable; aquí se le da un módulo
// de datos, así que esto ejercita el warmUp de verdad y no una promesa precargada.
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

// Son varios MB de librería y modelos: cargarlos por celda escaneada haría inusable el motor.
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

// El TINY son 4,8 MB y ~630 ms por imagen frente a los 12 MB y ~1,5 s del modelo grande con la
// misma precisión. Un cambio de modelo por defecto se nota en cada escaneo, así que se fija.
test("por defecto se cargan los modelos que servimos nosotros", async () => {
  reiniciaPaddle();
  const ruido = console.log;
  console.log = () => {};
  try { await P.warmUp(); } finally { console.log = ruido; }
  // Ya no se baja de HuggingFace: si ese host cae, el escáner seguía sin arrancar.
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

// --- Worker ---------------------------------------------------------------------------------
//
// La inferencia va en paddle.worker.js; en la página solo queda el cliente. Sin las APIs del
// navegador (Node) todo lo de arriba sigue por el hilo, así que aquí se instalan de mentira.
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
  globalThis.createImageBitmap = async () => ({ width: 8, height: 4 }); // sin funciones: por el canal viaja clonado
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
  const h = conWorker({ recognize: () => new Promise(() => {}) }); // nunca contesta: simula el cuelgue
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
  // import-graph no mira `new URL(...)`: esto es lo único que avisa de un renombrado.
  const ruta = new URL(RUTA_WORKER_PADDLE.split("?")[0], new URL("../deploy/js/repositories/paddle.repository.js", import.meta.url));
  assert.equal(existsSync(ruta), true, String(ruta));
});

// Al cerrar el escáner el worker (onnxruntime + modelos, ~200 MB) se quedaba entre sesiones.
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

// Para el 5/6 del código de una reliquia hace falta DÓNDE está la palabra: el lote guarda, por
// tira, sus líneas con caja y el montaje a color donde caen.
test("el lote guarda por tira las palabras con caja y un recorte del montaje", async () => {
  const { FakeCanvas, installFakeDocument } = await import("./_helpers/fake-canvas.mjs");
  const habiaDocument = globalThis.document;
  installFakeDocument(); // montaTiras crea el canvas del montaje con document.createElement
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
