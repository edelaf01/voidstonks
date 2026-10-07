import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { makeRewardFrameEnEncuadre } from "./_helpers/reward-frame.mjs";
import { comoItemsDatabase } from "./_helpers/prime-catalog.mjs";

installFakeDocument();
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { ScannerService: S } = await import("../deploy/js/services/scanner/scanner.service.js");
const { FirmasTitulo } = await import("../deploy/js/services/scanner/title_signatures.service.js");

beforeEach(() => { FirmasTitulo._clave = null; FirmasTitulo._catalogo = null; });
const { ScannerModal } = await import("../deploy/js/ui.components/ui_scanner_modal.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { aplicaMotor, MOTOR_CLASICO } = await import("../deploy/js/services/scanner/ocr_engine.service.js");
const { state } = await import("../deploy/js/state.js");
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");

state.itemsDatabase = comoItemsDatabase(["Braton Prime Barrel", "Forma Blueprint"]);
OCRService.cachedDbItems = [];
OCRService.knownParts = new Set();
OCRService._vocabCache = null;
OCRService.initMatcherData();

const W = 1280, H = 720;
const video = { ...makeRewardFrameEnEncuadre({ width: W, height: H }), videoWidth: W, videoHeight: H };

test("con el motor clásico cada recorte se pasa por Tesseract una sola vez aunque no lea nada", async () => {
  aplicaMotor(MOTOR_CLASICO);
  const orig = { open: ScannerModal.open, recognize: OCRRepository.recognize, prepare: VisionService.prepareRewardOCRCanvas };
  ScannerModal.open = () => {};
  OCRRepository.recognize = async () => ({ data: { text: "", words: [] } });
  const recortes = [];
  VisionService.prepareRewardOCRCanvas = (...args) => {
    recortes.push(JSON.stringify(args[5]));
    return orig.prepare.apply(VisionService, args);
  };
  try {
    Object.assign(S, { detectionLocked: false, lastHeaderText: "VOID FISSURE/REWARDS", _cabeceraVigente: true, lastRewardNoResult: { hash: null, time: 0 }, _recompensaParcial: null });
    await S.processRewards(video, { width: W, height: H, scale: 1.5 });
    assert.ok(recortes.length > 0, "debe haber probado recortes");
    assert.equal(new Set(recortes).size, recortes.length, "un recorte se binarizó dos veces");
  } finally {
    ScannerModal.open = orig.open;
    OCRRepository.recognize = orig.recognize;
    VisionService.prepareRewardOCRCanvas = orig.prepare;
  }
});
