// Descontando en fin de misión, una fisura sin fin de cuatro rondas restaba una sola reliquia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { makeRewardFrameEnEncuadre } from "./_helpers/reward-frame.mjs";
import { comoItemsDatabase } from "./_helpers/prime-catalog.mjs";

installFakeDocument();
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { ScannerService: S } = await import("../deploy/js/services/scanner/scanner.service.js");
const { RelicScreenService } = await import("../deploy/js/services/scanner/relic_screen.service.js");
const { ScannerModal } = await import("../deploy/js/ui.components/ui_scanner_modal.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { PaddleRepository } = await import("../deploy/js/repositories/paddle.repository.js");
const { aplicaMotor, MOTOR_CLASICO, MOTOR_PRECISO } = await import("../deploy/js/services/scanner/ocr_engine.service.js");
const { state } = await import("../deploy/js/state.js");

state.itemsDatabase = comoItemsDatabase(["Braton Prime Barrel", "Forma Blueprint"]);
OCRService.cachedDbItems = [];
OCRService.knownParts = new Set();
OCRService._vocabCache = null;
OCRService.initMatcherData();

const W = 1280, H = 720;
const video = { ...makeRewardFrameEnEncuadre({ width: W, height: H }), videoWidth: W, videoHeight: H };
const rotulo = (cvs, palabras) => palabras.map((text, i) => {
  const x = cvs.width * (0.35 + i * 0.08);
  return { text, confidence: 90, bbox: { x0: x, x1: x + cvs.width * 0.06, y0: cvs.height * 0.6, y1: cvs.height * 0.6 + 12 } };
});

test("cada pantalla de recompensas gasta la reliquia de su ronda, y una sola vez", async () => {
  const gastadas = [];
  let modales = 0;
  const orig = { open: ScannerModal.open, gasta: globalThis.gastaReliquiaAbierta, paddle: PaddleRepository.recognizeWordsWithBoxes };
  ScannerModal.open = () => { modales++; };
  globalThis.gastaReliquiaAbierta = (nombre) => gastadas.push(nombre);
  PaddleRepository.recognizeWordsWithBoxes = async (cvs) => rotulo(cvs, ["Braton", "Prime", "Barrel"]);
  aplicaMotor(MOTOR_PRECISO);
  PaddleRepository._service = {};
  // El modal suelta el candado al cerrarse; aquí se suelta a mano entre pantallas.
  const pantalla = () => {
    Object.assign(S, { detectionLocked: false, lastHeaderText: "VOID FISSURE/REWARDS", _cabeceraVigente: true, lastRewardNoResult: { hash: null, time: 0 } });
    return S.processRewards(video, { width: W, height: H, scale: 1.5 });
  };
  try {
    RelicScreenService.reset();
    RelicScreenService.reliquiaElegida = "AXI A6";
    await pantalla();
    assert.equal(modales, 1, "la pantalla no se llegó a leer");
    assert.deepEqual(gastadas, ["AXI A6"]);
    await pantalla(); // la misma pantalla otra vez tras cerrarse el modal
    assert.deepEqual(gastadas, ["AXI A6"], "se descontó dos veces la misma ronda");
    RelicScreenService.reliquiaElegida = "AXI A6"; // SELECT RELIC de la ronda 2, misma reliquia
    await pantalla();
    assert.deepEqual(gastadas, ["AXI A6", "AXI A6"]);
  } finally {
    ScannerModal.open = orig.open;
    globalThis.gastaReliquiaAbierta = orig.gasta;
    PaddleRepository.recognizeWordsWithBoxes = orig.paddle;
    aplicaMotor(MOTOR_CLASICO);
    PaddleRepository._service = null;
    S.detectionLocked = false;
    RelicScreenService.reset();
  }
});

// El modal paraba el escáner 20 s: la SELECT RELIC de la ronda siguiente, a mitad de partida, no se leía.
test("con el modal abierto, la SELECT RELIC de la ronda siguiente se lee sin esperar a que se cierre", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const { INITIAL_LATCH } = await import("../deploy/js/utils/vision/context_latch.js");
  const { FakeCanvas } = await import("./_helpers/fake-canvas.mjs");
  let cabecera = "VOID FISSURE/REWARDS";
  const rutas = [];
  const orig = { workers: OCRRepository.workers, ruta: S.routeFrameAction };
  OCRRepository.workers = [{ recognize: async () => ({ data: { text: cabecera } }) }];
  S.routeFrameAction = async (ctx) => { rutas.push(ctx); };
  const tick = () => {
    Object.assign(S, { lastHeaderText: null, lastHeaderOcrTime: 0, _ultimoRescate: Date.now() });
    return S.processFrame(video, new FakeCanvas(16, 9));
  };
  try {
    Object.assign(S, { isScanning: true, detectionLocked: true, _recompensaLeida: true, latchedContext: "REWARD", ctxLatch: { ...INITIAL_LATCH, latched: "REWARD" } });
    await tick();
    assert.deepEqual(rutas, [], "la misma pantalla de recompensas no se relee");
    cabecera = "VOID FISSURE/SELECT RELIC";
    await tick();
    await tick();
    assert.deepEqual(rutas, ["RELICS"]);
    assert.equal(S.detectionLocked, false);
  } finally {
    OCRRepository.workers = orig.workers;
    S.routeFrameAction = orig.ruta;
    Object.assign(S, { isScanning: false, detectionLocked: false, _recompensaLeida: false, latchedContext: "UNKNOWN", ctxLatch: INITIAL_LATCH });
  }
});

// Elegir reliquia para la ronda siguiente y extraer antes de abrirla: el fin de misión trae piezas
// prime de las rondas anteriores y la descontaba.
test("tras una pantalla de recompensas en la misión, el fin de misión no descuenta la reliquia elegida después", async () => {
  const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
  const W2 = 640, H2 = 360;
  const cuadro = { videoWidth: W2, videoHeight: H2, width: W2, height: H2, data: new Uint8ClampedArray(W2 * H2 * 4).fill(40) };
  const grid = { cells: [{ x: 300, y: 60, w: 50, h: 50, row: 0, col: 0, named: true, badge: "", qty: 1 }], accent: [190, 169, 102], pitch: 60, occluded: false, cut: false };
  const orig = { workers: OCRRepository.workers, listo: PaddleRepository.listo, commit: globalThis.commitMissionCompleteRewards };
  OCRRepository.workers = [{ recognize: async () => ({ data: { text: "BRATON PRIME BARREL", blocks: [] } }) }];
  PaddleRepository.listo = () => false;
  const gastadas = [];
  globalThis.commitMissionCompleteRewards = (_items, gastada) => gastadas.push(gastada);
  const finDeMision = async (recompensasVistas) => {
    RelicScreenService.reset();
    RelicScreenService.reliquiaElegida = "AXI A5";
    Object.assign(S, { _mcStableHash: null, _mcGrid: null, _mcDormido: null, mcLedger: { consensus: { items: {} }, committed: null }, _recompensasEnMision: recompensasVistas });
    S._mcCache.clear();
    const dims = { width: W2, height: H2, scale: 1 };
    await S.processMissionComplete(cuadro, dims);
    S._mcGrid = { hash: S._mcStableHash, grid };
    await S.processMissionComplete(cuadro, dims);
    await S.processMissionComplete(cuadro, dims);
  };
  try {
    await finDeMision(false);
    assert.deepEqual(gastadas, ["AXI A5"], "control: sin pantalla de recompensas vista, el fin de misión la descuenta");
    gastadas.length = 0;
    await finDeMision(true);
    assert.ok(gastadas.every((g) => g === null), "se descontó una reliquia que no se abrió");
  } finally {
    OCRRepository.workers = orig.workers;
    PaddleRepository.listo = orig.listo;
    globalThis.commitMissionCompleteRewards = orig.commit;
    Object.assign(S, { _mcGrid: null, _mcStableHash: null, _mcDormido: null, _recompensasEnMision: false });
    S._mcCache.clear();
    RelicScreenService.reset();
  }
});
