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
