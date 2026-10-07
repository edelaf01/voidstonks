import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { makeRewardFrameEnEncuadre } from "./_helpers/reward-frame.mjs";
import { comoItemsDatabase } from "./_helpers/prime-catalog.mjs";

// reward read attempt across BOTH OCR engines, mocking reads to test orchestration without
// Node-incompatible native OCR
// pins bugs in canvas routing, ensuring Tesseract merges its two passes and neural net skips binarisation
// read accuracy is measured in scripts-actu/banco-recompensas with real Tesseract

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
/** label words positioned at canvas centre for the OCR engine */
const rotulo = (cvs, palabras, y = 0.6) => palabras.map((text, i) => {
  const x = cvs.width * (0.35 + i * 0.08);
  return { text, confidence: 90, bbox: { x0: x, x1: x + cvs.width * 0.06, y0: cvs.height * y, y1: cvs.height * y + 12 } };
});

describe("motor Tesseract", () => {
  test("fusiona la pasada de nombres con la de badges", () => {
    // why two passes exist: names come from color mask and "N Owned" from grayscale
    // if they stop merging, rewards lack quantity and auto-sync cannot commit
    const original = OCRRepository.recognize;
    let llamadas = 0;
    OCRRepository.recognize = async (_w, cvs) => {
      llamadas++;
      const words = llamadas === 1
        ? rotulo(cvs, ["3", "Owned"], 0.2)          // grayscale pass: the badge
        : rotulo(cvs, ["Braton", "Prime", "Stock"]); // color pass: the name
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
    // neural net detects text directly: binarising discards information it knows how to use
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
    PaddleRepository._service = {};   // already loaded: otherwise intentionally falls back to classic
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
    // tesseract ladder cost is what we avoid: calling it anyway would forfeit the speed gain of switching
    // engines
    const original = OCRRepository.recognize;
    const originalPaddle = PaddleRepository.recognizeWordsWithBoxes;
    let tesseract = 0;
    OCRRepository.recognize = async () => { tesseract++; return { data: { text: "", words: [] } }; };
    PaddleRepository.recognizeWordsWithBoxes = async (cvs) => rotulo(cvs, ["Forma", "Blueprint"]);
    aplicaMotor(MOTOR_PRECISO);
    PaddleRepository._service = {};   // already loaded: otherwise intentionally falls back to classic
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
  // live frame cannot block on 4.8 MB model download: the difference between "selected" and "ready"
  const original = OCRRepository.recognize;
  let tesseract = 0;
  OCRRepository.recognize = async (_w, cvs) => {
    tesseract++;
    const words = rotulo(cvs, ["Forma", "Blueprint"]);
    return { data: { text: words.map((w) => w.text).join(" "), words } };
  };
  aplicaMotor(MOTOR_PRECISO);
  PaddleRepository._service = null;          // selected but still downloading
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
    // reward screen has a 15-second timer and Tesseract is 10x slower than the net (~1500 ms vs ~150 ms in
    // browser)
    // engines used to sit at the same loop tier, so a bad crop ran full Tesseract before trying the next crop
    // seen in logs: crop 1 net 0, crop 1 Tesseract 0, crop 2 net 4 items
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

  test('con motor clásico activo, el barrido barato "preciso" aborta sin tocar Tesseract', async () => {
    aplicaMotor(MOTOR_CLASICO);
    let tesseract = 0;
    OCRRepository.recognize = async () => { tesseract++; return { data: { text: "", words: [] } }; };

    const frame = makeRewardFrameEnEncuadre();
    const r = await leeRecompensas(frame, frame.width, frame.height, 1, "STANDARD", null, null, "preciso");
    assert.deepEqual(r.foundItems, []);
    assert.equal(r.ocrCanvas, null);
    assert.equal(tesseract, 0);
  });

  test('con motor preciso activo pero red no lista, el barrido barato "preciso" aborta sin tocar Tesseract', async () => {
    aplicaMotor(MOTOR_PRECISO);
    PaddleRepository.listo = () => false;
    let tesseract = 0;
    OCRRepository.recognize = async () => { tesseract++; return { data: { text: "", words: [] } }; };

    const frame = makeRewardFrameEnEncuadre();
    const r = await leeRecompensas(frame, frame.width, frame.height, 1, "STANDARD", null, null, "preciso");
    assert.deepEqual(r.foundItems, []);
    assert.equal(r.ocrCanvas, null);
    assert.equal(tesseract, 0);
  });

  test('con motor "clasico" la red no se toca aunque esté cargada', async () => {
    // preset ladder belongs to Tesseract: neural net does not binarise, so repeating per preset wastes 3x work
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

// seen live: at 1.5x stream gave "PRIME IMB BLUEPRINT" for "Limbo Prime Blueprint" (label over art) and
// matcher failed; at 2x same montage reads "LIMBOPRIME"
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
