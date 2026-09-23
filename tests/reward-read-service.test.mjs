import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { makeRewardFrameEnEncuadre } from "./_helpers/reward-frame.mjs";
import { comoItemsDatabase } from "./_helpers/prime-catalog.mjs";

// ===========================================================================
// El intento de lectura de recompensas, con sus DOS motores.
//
// El OCR de verdad no corre en Node, así que se sustituye por lecturas fijas: lo que se mide es
// la orquestación, que es donde han estado los fallos —qué lienzo recibe cada motor, si las dos
// pasadas de Tesseract se fusionan, y que el motor de red se salte la binarización—.
// La calidad de lectura se mide en scripts-actu/banco-recompensas, con Tesseract de verdad.
// ===========================================================================

installFakeDocument();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { leeRecompensas } = await import("../deploy/js/services/scanner/reward_read.service.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
const { PaddleRepository } = await import("../deploy/js/repositories/paddle.repository.js");
const { aplicaMotor, MOTOR_CLASICO, MOTOR_PRECISO } = await import("../deploy/js/services/scanner/ocr_engine.service.js");
const { state } = await import("../deploy/js/state.js");

state.itemsDatabase = comoItemsDatabase(["Braton Prime Stock", "Braton Prime Barrel", "Forma Blueprint"]);
OCRService.cachedDbItems = [];
OCRService.knownParts = new Set();
OCRService._vocabCache = null;
OCRService.initMatcherData();

const FRAME = makeRewardFrameEnEncuadre({ width: 1280, height: 720 });
/** Palabras de un rótulo, colocadas en el centro del lienzo que reciba el motor. */
const rotulo = (cvs, palabras, y = 0.6) => palabras.map((text, i) => {
  const x = cvs.width * (0.35 + i * 0.08);
  return { text, confidence: 90, bbox: { x0: x, x1: x + cvs.width * 0.06, y0: cvs.height * y, y1: cvs.height * y + 12 } };
});

describe("motor Tesseract", () => {
  test("fusiona la pasada de nombres con la de badges", () => {
    // Es la razón de que haya dos: los nombres salen de la máscara de color y el "N Owned" del
    // grayscale. Si dejaran de fusionarse, las recompensas saldrían sin cantidad y el auto-sync
    // no podría escribir nada.
    const original = OCRRepository.recognize;
    let llamadas = 0;
    OCRRepository.recognize = async (_w, cvs) => {
      llamadas++;
      const words = llamadas === 1
        ? rotulo(cvs, ["3", "Owned"], 0.2)          // pasada gris: el badge
        : rotulo(cvs, ["Braton", "Prime", "Stock"]); // pasada de color: el nombre
      return { data: { text: words.map((w) => w.text).join(" "), words } };
    };
    try {
      return leeRecompensas(FRAME, 1280, 720, 1.5, "STANDARD", null, undefined).then((r) => {
        assert.equal(r.foundItems.length, 1);
        assert.equal(r.foundItems[0].name, "Braton Prime Stock");
        assert.equal(r.foundItems[0].owned, 3, "la cantidad viene de la OTRA pasada");
        assert.ok(r.rawOcr.includes("Owned"), "rawOcr es la pasada gris");
      });
    } finally {
      OCRRepository.recognize = original;
    }
  });
});

describe("motor PaddleOCR", () => {
  test("lee el recorte a COLOR y no binarizado", async () => {
    // La red detecta el texto ella sola: binarizar sería tirarle información que sabe usar.
    // Si alguien le enchufa el lienzo binarizado, esta comprobación lo caza.
    const original = PaddleRepository.recognizeWordsWithBoxes;
    let tonos = 0;
    PaddleRepository.recognizeWordsWithBoxes = async (cvs) => {
      const d = cvs.getContext("2d").getImageData(0, 0, cvs.width, cvs.height).data;
      const vistos = new Set();
      for (let i = 0; i < d.length; i += 4) vistos.add(d[i]);
      tonos = vistos.size;
      return rotulo(cvs, ["Braton", "Prime", "Barrel"]);
    };
    aplicaMotor(MOTOR_PRECISO);
    PaddleRepository._service = {};   // ya cargado: si no, se lee con el clásico a propósito
    try {
      const r = await leeRecompensas(FRAME, 1280, 720, 1.5, "STANDARD", null, undefined);
      assert.ok(tonos > 2, `el lienzo llegó binarizado (${tonos} tonos): la red pierde información`);
      assert.deepEqual(r.foundItems.map((i) => i.name), ["Braton Prime Barrel"]);
      assert.equal(r.namesCanvas, null, "un solo lienzo: no hay segunda pasada que fusionar");
    } finally {
      PaddleRepository.recognizeWordsWithBoxes = original;
      aplicaMotor(MOTOR_CLASICO);
      PaddleRepository._service = null;
    }
  });

  test("no arranca Tesseract cuando el motor es la red", async () => {
    // El coste de la escalera de Tesseract es justo lo que se evita: si se llamara igual, el
    // cambio de motor no ahorraría nada.
    const original = OCRRepository.recognize;
    const originalPaddle = PaddleRepository.recognizeWordsWithBoxes;
    let tesseract = 0;
    OCRRepository.recognize = async () => { tesseract++; return { data: { text: "", words: [] } }; };
    PaddleRepository.recognizeWordsWithBoxes = async (cvs) => rotulo(cvs, ["Forma", "Blueprint"]);
    aplicaMotor(MOTOR_PRECISO);
    PaddleRepository._service = {};   // ya cargado: si no, se lee con el clásico a propósito
    try {
      await leeRecompensas(FRAME, 1280, 720, 1.5, "STANDARD", null, undefined);
      assert.equal(tesseract, 0);
    } finally {
      OCRRepository.recognize = original;
      PaddleRepository.recognizeWordsWithBoxes = originalPaddle;
      aplicaMotor(MOTOR_CLASICO);
      PaddleRepository._service = null;
    }
  });
});

test("si el motor de red aún no ha cargado, se lee con el clásico sin esperarlo", async () => {
  // Un frame en vivo no puede quedarse esperando 4,8 MB de modelo. Es la diferencia entre
  // "elegido" y "listo": hasta que puede leer, lee el otro.
  const original = OCRRepository.recognize;
  let tesseract = 0;
  OCRRepository.recognize = async (_w, cvs) => {
    tesseract++;
    const words = rotulo(cvs, ["Forma", "Blueprint"]);
    return { data: { text: words.map((w) => w.text).join(" "), words } };
  };
  aplicaMotor(MOTOR_PRECISO);
  PaddleRepository._service = null;          // elegido pero todavía descargando
  try {
    const r = await leeRecompensas(FRAME, 1280, 720, 1.5, "STANDARD", null, undefined);
    assert.ok(tesseract > 0, "tenía que leer con el clásico");
    assert.deepEqual(r.foundItems.map((i) => i.name), ["Forma Blueprint"]);
  } finally {
    OCRRepository.recognize = original;
    aplicaMotor(MOTOR_CLASICO);
  }
});

describe("cascada por coste", () => {
  test('con motor "preciso", si la red no lee nada NO se paga Tesseract', async () => {
    // La pantalla de recompensas tiene 15 segundos de reloj y Tesseract cuesta un orden de
    // magnitud más que la red (medido en navegador: ~1500 ms contra ~150). Antes los dos motores
    // estaban al mismo nivel del bucle, así que un recorte malo pagaba una pasada entera de
    // Tesseract antes de probar el siguiente recorte. Visto en un log real: recorte 1 red 0
    // ítems, recorte 1 Tesseract 0 ítems, recorte 2 red 4 ítems.
    aplicaMotor(MOTOR_PRECISO);
    PaddleRepository.listo = () => true;
    PaddleRepository.recognizeWordsWithBoxes = async () => [];
    let tesseract = 0;
    OCRRepository.recognize = async () => { tesseract++; return { data: { text: "", words: [] } }; };

    const frame = makeRewardFrameEnEncuadre();
    const r = await leeRecompensas(frame, frame.width, frame.height, 1, "STANDARD", null, null, "preciso");
    assert.deepEqual(r.foundItems, []);
    assert.equal(tesseract, 0, "no debe llamarse a Tesseract en el barrido barato");
  });

  test('con motor "clasico" la red no se toca aunque esté cargada', async () => {
    // La escalera de presets es de Tesseract: la red no binariza, así que repetirla por preset
    // sería gastar tres veces lo mismo.
    aplicaMotor(MOTOR_PRECISO);
    PaddleRepository.listo = () => true;
    let red = 0;
    PaddleRepository.recognizeWordsWithBoxes = async () => { red++; return []; };
    OCRRepository.recognize = async () => ({ data: { text: "", words: [] } });

    const frame = makeRewardFrameEnEncuadre();
    await leeRecompensas(frame, frame.width, frame.height, 1, "LOW_LIGHT", null, null, "clasico");
    assert.equal(red, 0);
  });
});

const { leeCasillaMissionComplete } = await import("../deploy/js/services/scanner/reward_read.service.js");
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

// Visto en vivo: a 1,5x el stream dio "PRIME IMB BLUEPRINT" por "Limbo Prime Blueprint" (rótulo
// sobre el arte) y el matcher no llega; a 2x el mismo montaje lee "LIMBOPRIME".
test("los rótulos de fin de misión se montan a 2x", async () => {
  const { leeRotulosMissionComplete } = await import("../deploy/js/services/scanner/reward_read.service.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  const frame = new FakeCanvas(600, 400);
  const origListo = PaddleRepository.listo, origLines = PaddleRepository.recognizeLines;
  let montaje = null;
  PaddleRepository.listo = () => true;
  PaddleRepository.recognizeLines = async (canvas) => { montaje = canvas; return []; };
  try {
    await leeRotulosMissionComplete(frame, [{ row: 0, col: 0, x: 0, y: 0, w: 240, h: 240 }]);
    assert.equal(montaje.width, 480, "ancho de la tira a 2x");
    assert.equal(montaje.height, Math.round(240 * 0.45) * 2);
  } finally { PaddleRepository.listo = origListo; PaddleRepository.recognizeLines = origLines; }
});

describe("una casilla de fin de misión", () => {
  const st = state;
  const celda = { row: 0, col: 2, x: 0, y: 0, w: 240, h: 240, qty: 1 };
  const cvs = { width: 480, height: 480, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) }) };
  st.allRelicNames = ["Lith K12", "Lith K2"];

  test("con texto del motor preciso no se toca Tesseract y una reliquia sale marcada", async () => {
    let tesseract = 0;
    OCRRepository.recognize = async () => { tesseract++; return { data: { text: "", blocks: [] } }; };
    const r = await leeCasillaMissionComplete({}, {}, celda, [200, 170, 90], cvs, "LITH K12 RELIC");
    assert.deepEqual(r, { name: "Lith K12", reliquia: true, raw: "LITH K12 RELIC", motor: "preciso" });
    assert.equal(tesseract, 0);
  });

  test("sin texto preciso lee con el clásico sobre la máscara de la casilla", async () => {
    let preparada = 0;
    const origPrep = VisionService.prepareMissionCompleteCellCanvas;
    VisionService.prepareMissionCompleteCellCanvas = () => { preparada++; return cvs; };
    OCRRepository.recognize = async () => ({ data: { text: "Braton Prime\nStock", blocks: [] } });
    try {
      const r = await leeCasillaMissionComplete({}, {}, celda, [200, 170, 90], cvs, undefined);
      assert.deepEqual(r, { name: "Braton Prime Stock", reliquia: false, raw: "BRATON PRIME STOCK", motor: "clásico" });
      assert.equal(preparada, 1);
    } finally { VisionService.prepareMissionCompleteCellCanvas = origPrep; }
  });

  test("un recurso (Credits, Endo) no es nada: name null, y se guarda igual", async () => {
    const r = await leeCasillaMissionComplete({}, {}, celda, [200, 170, 90], cvs, "CREDITS");
    assert.deepEqual(r, { name: null, reliquia: false, raw: "CREDITS", motor: "preciso" });
  });
});
