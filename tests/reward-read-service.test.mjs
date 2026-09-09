import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { makeRewardFrameEnEncuadre } from "./_helpers/reward-frame.mjs";
import { comoItemsDatabase } from "./_helpers/prime-catalog.mjs";

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
const rotulo = (cvs, palabras, y = 0.6) => palabras.map((text, i) => {
  const x = cvs.width * (0.35 + i * 0.08);
  return { text, confidence: 90, bbox: { x0: x, x1: x + cvs.width * 0.06, y0: cvs.height * y, y1: cvs.height * y + 12 } };
});

describe("motor Tesseract", () => {
  test("fusiona la pasada de nombres con la de badges", () => {
    const original = OCRRepository.recognize;
    let llamadas = 0;
    OCRRepository.recognize = async (_w, cvs) => {
      llamadas++;
      const words = llamadas === 1
        ? rotulo(cvs, ["3", "Owned"], 0.2)
        : rotulo(cvs, ["Braton", "Prime", "Stock"]);
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
    PaddleRepository._service = {};
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
    const original = OCRRepository.recognize;
    const originalPaddle = PaddleRepository.recognizeWordsWithBoxes;
    let tesseract = 0;
    OCRRepository.recognize = async () => { tesseract++; return { data: { text: "", words: [] } }; };
    PaddleRepository.recognizeWordsWithBoxes = async (cvs) => rotulo(cvs, ["Forma", "Blueprint"]);
    aplicaMotor(MOTOR_PRECISO);
    PaddleRepository._service = {};
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
  const original = OCRRepository.recognize;
  let tesseract = 0;
  OCRRepository.recognize = async (_w, cvs) => {
    tesseract++;
    const words = rotulo(cvs, ["Forma", "Blueprint"]);
    return { data: { text: words.map((w) => w.text).join(" "), words } };
  };
  aplicaMotor(MOTOR_PRECISO);
  PaddleRepository._service = null;
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
    // reward screen has a 15-second timer and Tesseract is 10x slower than the net (~1500 ms vs ~150 ms)
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
