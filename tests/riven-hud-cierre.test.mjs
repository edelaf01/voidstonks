import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { ScannerService: S } = await import("../deploy/js/services/scanner/scanner.service.js");
const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { ESTADO_INICIAL } = await import("../deploy/js/utils/vision/no_result_skip.js");
const { SquadService } = await import("../deploy/js/services/scanner/squad.service.js");
const { state } = await import("../deploy/js/state.js");

function resetScanner() {
  Object.assign(S, {
    lastParsedL: null,
    lastParsedR: null,
    lastHashL: null,
    lastTwoCardHash: null,
    lastNoResult: ESTADO_INICIAL,
    _cartaRivenVista: 0,
    lastRivenContextTime: 0,
    lastRivenContextType: null,
    _cartaVigilada: null,
    _zonasCartas: null,
    rivenConsensusBuffer: [],
    oneCardStreak: 0,
    newCardStreak: 0,
    weaponSwitchCandidate: null,
    weaponSwitchStreak: 0,
    detectionLocked: false,
    _sampleRect: null,
    lastRowLums: null,
    autoScrollStableTimer: null,
  });
}

describe("_cierraSinCarta", () => {
  let dismissedCount;
  const origDateNow = Date.now;
  const origHUD = globalThis.RivenScannerHUD;

  beforeEach(() => {
    resetScanner();
    dismissedCount = 0;
    globalThis.RivenScannerHUD = {
      dismiss: () => {
        dismissedCount++;
        S.lastParsedL = null;
        S.lastParsedR = null;
        S.lastHashL = null;
      },
    };
  });

  afterEach(() => {
    Date.now = origDateNow;
    if (origHUD !== undefined) {
      globalThis.RivenScannerHUD = origHUD;
    } else {
      delete globalThis.RivenScannerHUD;
    }
    resetScanner();
  });

  test("cierra cuando se supera el umbral y hay lastParsedL", () => {
    S.lastParsedL = { weaponName: "Dread" };
    S.lastParsedR = null;
    S._cartaRivenVista = 1000;
    Date.now = () => S._cartaRivenVista + S.RIVEN_SIN_CARTA_MS + 1;
    S._cierraSinCarta();
    assert.equal(dismissedCount, 1);
    S._cierraSinCarta();
    assert.equal(dismissedCount, 1);
  });

  test("cierra igual con solo lastParsedR", () => {
    S.lastParsedL = null;
    S.lastParsedR = { weaponName: "Dread" };
    S._cartaRivenVista = 1000;
    Date.now = () => S._cartaRivenVista + S.RIVEN_SIN_CARTA_MS + 1;
    S._cierraSinCarta();
    assert.equal(dismissedCount, 1);
  });

  test("NO cierra si no hay ninguno de los dos", () => {
    S.lastParsedL = null;
    S.lastParsedR = null;
    S._cartaRivenVista = 1000;
    Date.now = () => S._cartaRivenVista + S.RIVEN_SIN_CARTA_MS + 1;
    S._cierraSinCarta();
    assert.equal(dismissedCount, 0);
  });

  test("NO cierra dentro del umbral", () => {
    S.lastParsedL = { weaponName: "Dread" };
    S._cartaRivenVista = 1000;
    Date.now = () => S._cartaRivenVista + S.RIVEN_SIN_CARTA_MS;
    S._cierraSinCarta();
    assert.equal(dismissedCount, 0);

    Date.now = () => S._cartaRivenVista + S.RIVEN_SIN_CARTA_MS - 1;
    S._cierraSinCarta();
    assert.equal(dismissedCount, 0);

    Date.now = () => S._cartaRivenVista;
    S._cierraSinCarta();
    assert.equal(dismissedCount, 0);
  });

  test("NO falla si globalThis.RivenScannerHUD no existe", () => {
    delete globalThis.RivenScannerHUD;
    S.lastParsedL = { weaponName: "Dread" };
    S._cartaRivenVista = 1000;
    Date.now = () => S._cartaRivenVista + S.RIVEN_SIN_CARTA_MS + 1;
    assert.doesNotThrow(() => {
      S._cierraSinCarta();
    });
  });
});

describe("integración en el flujo del escáner", () => {
  const W = 640;
  const H = 360;
  const dims = { width: W, height: H, scale: 3 };
  const CARTA_TEXTO = "Dread Acricron\n+187.6% Critical Chance\n+150.9% Critical Damage\nMR 10";

  const videoCarta = {
    videoWidth: W,
    videoHeight: H,
    width: W,
    height: H,
    data: new Uint8ClampedArray(W * H * 4).fill(25),
  };
  const videoSinCartaA = {
    videoWidth: W,
    videoHeight: H,
    width: W,
    height: H,
    data: new Uint8ClampedArray(W * H * 4).fill(120),
  };
  const videoSinCartaB = {
    videoWidth: W,
    videoHeight: H,
    width: W,
    height: H,
    data: new Uint8ClampedArray(W * H * 4).fill(210),
  };

  const origDateNow = Date.now;
  const origHUD = globalThis.RivenScannerHUD;
  const origRecognize = OCRRepository.recognizeWithChars;
  const origRecognizeOCR = OCRRepository.recognize;
  const origWorkers = OCRRepository.workers;
  const origEnsureSecondWorker = OCRRepository.ensureSecondWorker;
  const origPrepare = VisionService.prepareRivenCardCanvases;
  const origProbe = SquadService.probe;
  const origAllRivenNames = state.allRivenNames;
  const origWeaponMap = state.weaponMap;

  let dismissedCount;
  let simulatedTime;
  let ocrResultText;

  beforeEach(() => {
    resetScanner();
    dismissedCount = 0;
    simulatedTime = 10000;
    Date.now = () => simulatedTime;

    globalThis.RivenScannerHUD = {
      dismiss: () => {
        dismissedCount++;
        S.lastParsedL = null;
        S.lastParsedR = null;
        S.lastHashL = null;
      },
    };

    ocrResultText = CARTA_TEXTO;
    OCRRepository.workers = [{}];
    OCRRepository.ensureSecondWorker = async () => {};
    OCRRepository.recognizeWithChars = async () => ({
      data: { text: ocrResultText },
    });
    VisionService.prepareRivenCardCanvases = () => [
      { width: 400, height: 300 },
    ];
    SquadService.probe = async () => false;
    state.allRivenNames = ["Dread"];
    state.weaponMap = { Dread: { d: 1.25, t: "Bow" } };
  });

  afterEach(() => {
    Date.now = origDateNow;
    if (origHUD !== undefined) {
      globalThis.RivenScannerHUD = origHUD;
    } else {
      delete globalThis.RivenScannerHUD;
    }
    OCRRepository.recognizeWithChars = origRecognize;
    OCRRepository.recognize = origRecognizeOCR;
    OCRRepository.workers = origWorkers;
    OCRRepository.ensureSecondWorker = origEnsureSecondWorker;
    VisionService.prepareRivenCardCanvases = origPrepare;
    SquadService.probe = origProbe;
    state.allRivenNames = origAllRivenNames;
    state.weaponMap = origWeaponMap;
    resetScanner();
  });

  test("ver la carta actualiza _cartaRivenVista vía OCR y al dejar de verla más del umbral cierra el HUD", async () => {
    const base = 10000;
    simulatedTime = base;
    await S.processRivenCard(videoCarta, dims, "INVENTORY_MODS");
    assert.equal(S._cartaRivenVista, base);
    assert.equal(dismissedCount, 0);

    simulatedTime = base + 100;
    await S.processRivenCard(videoCarta, dims, "INVENTORY_MODS");
    assert.equal(S._cartaRivenVista, base + 100);
    assert.ok(S.lastParsedL);
    assert.equal(dismissedCount, 0);

    ocrResultText = "";
    simulatedTime = base + S.RIVEN_SIN_CARTA_MS - 500;
    await S.processRivenCard(videoSinCartaA, dims, "INVENTORY_MODS");
    assert.equal(dismissedCount, 0);
    assert.equal(S._cartaRivenVista, base + 100);

    simulatedTime = base + S.RIVEN_SIN_CARTA_MS + 500;
    await S.processRivenCard(videoSinCartaB, dims, "INVENTORY_MODS");
    assert.equal(dismissedCount, 1);

    simulatedTime = base + S.RIVEN_SIN_CARTA_MS + 1000;
    await S.processRivenCard(videoSinCartaB, dims, "INVENTORY_MODS");
    assert.equal(dismissedCount, 1);
  });

  test("mantener la carta quieta refresca _cartaRivenVista por firma y el salto estático sin resultado cierra el HUD", async () => {
    const base = 10000;
    simulatedTime = base;
    await S.processRivenCard(videoCarta, dims, "INVENTORY_MODS");
    simulatedTime = base + 100;
    await S.processRivenCard(videoCarta, dims, "INVENTORY_MODS");
    assert.ok(S.lastParsedL);
    assert.ok(S.lastHashL);

    simulatedTime = base + 300;
    await S.processRivenCard(videoCarta, dims, "INVENTORY_MODS");
    assert.equal(S._cartaRivenVista, base + 300);
    assert.equal(dismissedCount, 0);

    ocrResultText = "";
    simulatedTime = base + S.RIVEN_SIN_CARTA_MS - 500;
    await S.processRivenCard(videoSinCartaA, dims, "INVENTORY_MODS");
    assert.equal(dismissedCount, 0);

    simulatedTime = base + S.RIVEN_SIN_CARTA_MS + 500;
    await S.processRivenCard(videoSinCartaA, dims, "INVENTORY_MODS");
    assert.equal(dismissedCount, 1);

    simulatedTime = base + S.RIVEN_SIN_CARTA_MS + 1000;
    await S.processRivenCard(videoSinCartaA, dims, "INVENTORY_MODS");
    assert.equal(dismissedCount, 1);
  });

  test("cabecera INVENTORY/MODS -> UPGRADE -> ilegible enruta a UPGRADES, resetea gracia y cierra HUD", async () => {
    const campos = [
      "isScanning", "latchedContext", "ctxLatch", "lastHeaderText",
      "lastHeaderOcrTime", "lastHeaderHash", "_franjaTickAnterior",
      "_headerEstable", "_headerCtxPrevio", "_cabeceraVigente",
      "_cambioLogVisto", "currentRate", "lastRivenContextTime",
      "lastRivenContextType", "detectionLocked", "scanCounter",
      "_ctxGrabado", "_cartaRivenVista",
    ];
    const snapshot = Object.fromEntries(campos.map((k) => [k, S[k]]));
    try {
      const lienzo = new FakeCanvas(16, 9);
      let cabecera = "";
      OCRRepository.workers = [{}];
      OCRRepository.recognize = async () => ({ data: { text: cabecera } });

      const llega = async (header, txt = "") => {
        cabecera = header;
        ocrResultText = txt;
        S.lastHeaderText = null;
        S.lastHeaderOcrTime = 0;
        S.lastHeaderHash = null;
        await S.processFrame(videoCarta, lienzo);
      };

      S.isScanning = true;
      S.detectionLocked = false;
      S.latchedContext = "UNKNOWN";
      S.ctxLatch = { latched: "UNKNOWN", unknownCount: 0, pending: null, pendingCount: 0 };
      S.lastRivenContextTime = 0;

      await llega("INVENTORY/MODS", CARTA_TEXTO);
      assert.equal(S.latchedContext, "INVENTORY_MODS");
      assert.ok(S.lastRivenContextTime > 0);
      assert.equal(dismissedCount, 0);

      await llega("UPGRADE");
      assert.equal(S.lastRivenContextTime, 0);

      await llega("UPGRADE");
      assert.equal(S.latchedContext, "UPGRADES");
      assert.equal(S.lastRivenContextTime, 0);
      assert.ok(dismissedCount >= 1);

      await llega("");
      assert.equal(S.latchedContext, "UPGRADES");
      assert.equal(S.lastRivenContextTime, 0);
    } finally {
      Object.assign(S, snapshot);
    }
  });
});
