import fs from "node:fs";
import { makeInventoryFrame } from "./inventory-frame.mjs";
import { comoItemsDatabase } from "./prime-catalog.mjs";

const { ScannerService: S } = await import("../../deploy/js/services/scanner/scanner.service.js");
const { VisionService } = await import("../../deploy/js/services/scanner/vision.service.js");
const { OCRRepository } = await import("../../deploy/js/repositories/ocr.repository.js");
const { PaddleRepository } = await import("../../deploy/js/repositories/paddle.repository.js");
const { ScannerHUD } = await import("../../deploy/js/ui.components/ui_scanner_hud.js");
const { DucatKioskService } = await import("../../deploy/js/services/scanner/ducat_kiosk.service.js");
const { BusquedaInventarioService } = await import("../../deploy/js/services/scanner/busqueda_inventario.service.js");
const { SquadService } = await import("../../deploy/js/services/scanner/squad.service.js");
const M = await import("../../deploy/js/services/scanner/ocr_engine.service.js");
const { state } = await import("../../deploy/js/state.js");

const allRelics = JSON.parse(fs.readFileSync(new URL("../_fixtures/relic-names.json", import.meta.url), "utf8"));

function capturaConsola() {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const logs = [];
  const mete = (...args) => logs.push(args.join(" "));
  console.log = mete;
  console.warn = mete;
  console.error = mete;
  return {
    logs,
    para() {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
  };
}

function paginaSintetica(filled, seed = 1) {
  return makeInventoryFrame({
    width: 1920,
    height: 1080,
    gridX: 66,
    gridY: 177,
    cellW: 208,
    cellH: 222,
    cols: 6,
    rows: 3,
    art: [180, 160, 140],
    nameWidthFrac: 0.6,
    filled,
    seed
  });
}

function creaWorker(fn) {
  const reconoce = fn || (async () => {
    const text = "AKBRONCO PRIME BLUEPRINT";
    return {
      data: {
        text,
        words: [
          { text: "AKBRONCO", confidence: 90, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } },
          { text: "PRIME", confidence: 90, bbox: { x0: 55, y0: 0, x1: 100, y1: 20 } },
          { text: "BLUEPRINT", confidence: 90, bbox: { x0: 105, y0: 0, x1: 160, y1: 20 } }
        ],
        confidence: 90
      }
    };
  });
  return { llamadas: 0, setParameters: async () => {}, recognize: reconoce, terminate() {} };
}

function montaContexto(workerFn) {
  const origBusquedaLee = BusquedaInventarioService.lee;
  const origOcrWorkers = OCRRepository.workers;
  const origEnsureWorkers = OCRRepository.ensureWorkers;
  const origUpdateContext = ScannerHUD.updateContext;
  const origUpdateScrollStatus = ScannerHUD.updateScrollStatus;
  const origUpdateDetectedItems = ScannerHUD.updateDetectedItems;
  const origUpdateFrameCounter = ScannerHUD.updateFrameCounter;
  const origIsDebugOpen = ScannerHUD.isDebugOpen;
  const origSquadProbe = SquadService.probe;
  const origDucatProcess = DucatKioskService.process;

  const worker = creaWorker(workerFn);
  OCRRepository.workers = [worker];
  OCRRepository.ensureWorkers = async () => {};
  PaddleRepository.ultimoFallo = null;
  M.aplicaMotor(M.MOTOR_CLASICO);

  ScannerHUD.updateContext = () => {};
  ScannerHUD.updateScrollStatus = () => {};
  ScannerHUD.updateDetectedItems = () => {};
  ScannerHUD.updateFrameCounter = () => {};
  ScannerHUD.isDebugOpen = () => false;

  SquadService.probe = async () => false;
  DucatKioskService.process = async () => {};

  state.autoScanEnabled = true;
  state.scannerModsMode = false;
  state.itemsDatabase = comoItemsDatabase();
  state.allRelicNames = allRelics;
  state.primeInventory = { "Bronco Prime Barrel": 8, "Akbronco Prime Blueprint": 1 };
  state.inventory = [];
  state.lastStableTheme = { name: "Grineer", r: 255, g: 224, b: 153 };
  globalThis.state = state;

  VisionService._memoriasRejilla.clear();
  BusquedaInventarioService.reset();
  S.sessionInventory.clear();
  S.qtyVotes.clear();

  Object.assign(S, {
    _sampleRect: null,
    lastRowLums: null,
    autoScrollMuestra: null,
    sawScrollSinceScan: false,
    fotosSinScroll: 0,
    autoScrollStableTimer: null,
    detectionLocked: false,
    isScanning: true,
    lastHeaderText: "INVENTORY/SELL",
    _cabeceraConContexto: "INVENTORY/SELL",
    latchedContext: "INVENTORY",
    _frameZoneCache: null,
    _autoCalibCache: null,
    _temaCache: null,
    _nameColorCache: null,
    _gridReintentado: false,
    _invQueue: null,
    _categoriaHash: null,
    _categoriaTexto: "",
    _busquedaHash: null,
    _busquedaTexto: "",
    _invSnapshot: null,
    _sesion: (S._sesion ?? 0) + 1
  });

  const origCrear = globalThis.document.createElement;
  globalThis.document.createElement = (tag) => Object.assign(origCrear(tag), { querySelector: () => ({}) });
  globalThis.document._registrar("toast-container", origCrear("div"));

  const video = { videoWidth: 1920, videoHeight: 1080, width: 1920, height: 1080, data: null };
  globalThis.document._registrar("live-video", video);
  const dims = { width: 1920, height: 1080, scale: 1 };

  async function pasaPagina(frame, rawContext = "INVENTORY") {
    video.data = frame.data;
    for (let i = 0; i < 4; i++) {
      await S.routeFrameAction(rawContext, video, dims);
      if (S.autoScrollStableTimer) break;
    }
    await new Promise((r) => setTimeout(r, S.ESPERA_FOTO_MS + 60));
    while (S.autoScrollStableTimer || S.detectionLocked || S._invQueue?.isBusy || S._invQueue?.size) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async function scrollFrame(rawContext = "INVENTORY") {
    const sc = new Uint8ClampedArray(1920 * 1080 * 4);
    sc.fill(128);
    video.data = sc;
    await S.routeFrameAction(rawContext, video, dims);
  }

  return {
    worker,
    video,
    dims,
    pasaPagina,
    scrollFrame,
    limpia() {
      BusquedaInventarioService.lee = origBusquedaLee;
      OCRRepository.workers = origOcrWorkers;
      OCRRepository.ensureWorkers = origEnsureWorkers;
      ScannerHUD.updateContext = origUpdateContext;
      ScannerHUD.updateScrollStatus = origUpdateScrollStatus;
      ScannerHUD.updateDetectedItems = origUpdateDetectedItems;
      ScannerHUD.updateFrameCounter = origUpdateFrameCounter;
      ScannerHUD.isDebugOpen = origIsDebugOpen;
      SquadService.probe = origSquadProbe;
      DucatKioskService.process = origDucatProcess;
      globalThis.document.createElement = origCrear;
      globalThis.document._registrar("toast-container", null);
      globalThis.document._registrar("live-video", null);
      if (S.autoScrollStableTimer) {
        clearTimeout(S.autoScrollStableTimer);
        S.autoScrollStableTimer = null;
      }
      VisionService._memoriasRejilla.clear();
      BusquedaInventarioService.reset();
      S.sessionInventory.clear();
      S.qtyVotes.clear();
    }
  };
}

export { capturaConsola, paginaSintetica, creaWorker, montaContexto };
