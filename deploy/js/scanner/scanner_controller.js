/**
 * Controlador del escáner por cámara: abre el vídeo, pasa los frames por OCR y vuelca el
 * resultado al inventario.
 *
 * Vivía en utils/ por accidente histórico y de util no tiene nada: monta un <canvas>, pinta
 * toasts, refresca el panel de inventario y guarda estado. Es un orquestador, hermano de
 * live_scanner.js y mobile_scanner.js, y por eso está en scanner/ — la capa que ARCHITECTURE.md
 * define como la que compone todas las demás a propósito.
 *
 * No se movió para esquivar el contrato de capas: mover aquí algo que SÍ fuera un util sería
 * justo eso, y por eso la exención es de esta carpeta y no de un fichero suelto.
 */
import { state, saveAppState, updateInventoryBatch } from "../state.js";
import { toggleInventoryPanel, renderInventory } from "../ui.components/inventory/ui_inventory.js";
import { showToast } from "../ui.components/ui_components.js";
import { TEXTS } from "../config.js";

/** Textos del escáner en el idioma activo. Se lee en cada uso: el idioma cambia en caliente. */
const st = () => TEXTS[state.currentLang]?.scanner || {};
console.log(" [SCANNER] Script cargado correctamente.");
let ocrWorker = null;
let videoStream = null;
let scannedInventory = [];
let lastFrameData = null;
let staticFrameCount = 0;
const STATIC_THRESHOLD = 5;
const processingCanvas = document.createElement("canvas");
const processingCtx = processingCanvas.getContext("2d", {
  willReadFrequently: true,
});

export async function openScanner() {
  console.log(" [SCANNER] Abriendo escáner...");
  const overlay = document.getElementById("ocr-overlay");
  const loading = document.getElementById("ocr-loading");

  if (loading) loading.classList.add("hidden");
  if (overlay) overlay.classList.remove("hidden");

  await startCamera();
}

export function closeScanner() {
  console.log("[SCANNER] Cerrando escáner...");

  stopCamera();

  if (isInventoryScanning) {
    finishInventoryScan();
  }

  const overlay = document.getElementById("ocr-overlay");
  if (overlay) overlay.classList.add("hidden");

  const resultsPanel = document.getElementById("scanned-results-panel");
  if (resultsPanel) resultsPanel.classList.add("hidden");
}

async function startCamera() {
  stopCamera();

  const video = document.getElementById("ocr-video");
  if (!video) return console.error(" [SCANNER] No existe elemento #ocr-video");

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    video.srcObject = videoStream;
    await video.play();
    video.classList.remove("hidden");
    console.log(" [SCANNER] Cámara iniciada");
  } catch (e) {
    console.error(" [SCANNER] Error cámara:", e);
    showToast(st().toastCameraDenied);
  }
}

function stopCamera() {
  const video = document.getElementById("ocr-video");

  if (videoStream) {
    videoStream.getTracks().forEach((t) => {
      t.stop();
    });
    videoStream = null;
  }

  if (video) {
    video.pause();
    video.srcObject = null;
    video.classList.add("hidden");
  }
}

export async function captureRelics() {
  console.log(" [SCANNER] Capturando...");
  const video = document.getElementById("ocr-video");
  if (!videoStream || video.readyState < 2 || video.videoWidth === 0) {
    return showToast(st().toastCameraNotReady);
  }
  processImageSource(video);
}

export async function handleFileUpload(event) {
  const files = Array.from(event.target.files);
  if (files.length === 0) return;
  console.log(` [SCANNER] Archivos subidos: ${files.length}`);
  showToast(`Procesando ${files.length} imágenes...`);

  for (const file of files) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.src = url;
    await new Promise((resolve) => (img.onload = resolve));
    await processImageSource(img);
    URL.revokeObjectURL(url);
  }
}

async function processImageSource(source) {
  console.log("[SCANNER] processImageSource called"); // early debug
  const loading = document.getElementById("ocr-loading");
  if (loading) loading.classList.remove("hidden");

  const w = source.videoWidth || source.width;
  const h = source.videoHeight || source.height;

  if (w < 10 || h < 10) {
    console.warn(`[SCANNER] Imagen ignorada por tamaño incorrecto: ${w}x${h}`);
    if (loading) loading.classList.add("hidden");
    showToast(st().toastImageTooSmall);
    return;
  }

  if (processingCanvas.width !== w) processingCanvas.width = w;
  if (processingCanvas.height !== h) processingCanvas.height = h;

  processingCtx.drawImage(source, 0, 0, w, h);

  // Falls back to simple grayscale if themes not loaded yet.
  const themes = globalThis._WF_THEMES;
  const TOL_SQ = 1944; // 10% tolerance of color
  const imageData = processingCtx.getImageData(0, 0, w, h);
  const data = imageData.data;
  if (themes?.length) {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      let isText = false;
      for (const t of themes) {
        const dr = r - t.r, dg = g - t.g, db = b - t.b;
        if (dr * dr + dg * dg + db * db < TOL_SQ) { isText = true; break; }
      }
      data[i] = data[i + 1] = data[i + 2] = isText ? 0 : 255;
    }
  } else {
    // Fallback: grayscale threshold
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = data[i + 1] = data[i + 2] = gray > 100 ? 0 : 255;
    }
  }
  processingCtx.putImageData(imageData, 0, 0);

  try {
    // Carga bajo demanda: el loader ya no está en index.html para no penalizar
    // en RAM/red a quien solo consulta precios
    if (!globalThis.Tesseract) {
      const { OCRRepository } = await import("../repositories/ocr.repository.js");
      await OCRRepository.loadTesseractScript();
    }
    if (!globalThis.Tesseract)
      throw new Error("No se pudo cargar la librería Tesseract");

    console.log(`[SCANNER] Iniciando OCR sobre imagen ${w}x${h} (temas: ${themes?.length ?? 0})...`);

    // Use pre-warmed OCR worker if available, otherwise use cold Tesseract
    let ocrData;
    const repo = globalThis._OCRRepository;
    if (repo?.workers?.length > 0) {
      console.log("[SCANNER] Usando worker pre-calentado");
      const result = await repo.recognize(repo.workers[0], processingCanvas);
      ocrData = result.data;
    } else {
      console.log("[SCANNER] Usando Tesseract.recognize en frío");
      const result = await globalThis.Tesseract.recognize(processingCanvas, "eng");
      ocrData = result.data;
    }

    const text = ocrData.text || "";
    const words = ocrData.words || [];

    console.log("[SCANNER] Texto crudo OCR:", text.replaceAll(/\n+/g, " ").trim());
    console.log(`[SCANNER] Palabras detectadas: ${words.length}`);

    // Auto-detect context from the raw text
    const upperText = text.toUpperCase();
    let context = "UNKNOWN";
    if (/REWARD|FISSURE|VOID/.test(upperText)) context = "REWARD";
    else if (/LITH|MESO|NEO|AXI|REQUIEM/.test(upperText)) context = "RELICS";
    else if (/INVEN|TORY|SELL/.test(upperText)) context = "INVENTORY";

    console.log(`[SCANNER] Contexto detectado: ${context}`);

    if (context === "REWARD") {
      // Route through the live scanner's services (already loaded via live_scanner.js)
      const ocrSvc = globalThis.ScannerService ? globalThis.ScannerService.ocrService : null;
      const OCRSvc = globalThis._OCRService;
      if (!OCRSvc) {
        console.warn("[SCANNER] OCRService not ready yet - start the live scanner first or wait for warm-up.");
        showToast(st().toastStartFirst);
      } else {
        OCRSvc.initMatcherData();
        ocrData.imageW = w;
        const foundItems = OCRSvc.parseRewards(ocrData);
        console.log(`[SCANNER] Items de recompensa encontrados: ${foundItems.length}`, foundItems.map(i => i.name));
        if (foundItems.length > 0 && globalThis._ScannerModal) {
          const snap = processingCanvas.toDataURL("image/jpeg", 0.85);
          globalThis._ScannerModal.open(snap, foundItems, w, h, 1, text);
          showToast(`¡${foundItems.length} reward(s) detected!`);
        } else {
          showToast(st().toastNoRewards);
        }
      }
    } else {
      // Relic / fallback path
      const found = parseRelicText(text);
      console.log(`[SCANNER] Reliquias encontradas: ${found.length}`, found);
      if (found.length > 0) {
        found.forEach((item) => {
          if (!scannedInventory.includes(item)) scannedInventory.push(item);
        });
        updateResultsUI();
        const resultsPanel = document.getElementById("scanned-results-panel");
        if (resultsPanel) resultsPanel.classList.remove("hidden");
        showToast(`¡${found.length} relic(s) detected!`);
      } else {
        showToast(st().toastNoItems);
      }
    }
  } catch (e) {
    console.error("[SCANNER] Error OCR:", e);
    showToast(st().toastScanFailed);
  } finally {
    if (loading) loading.classList.add("hidden");
  }
}

const RELIC_REGEX = /(LITH|MESO|NEO|AXI|REQUIEM)\s*([A-Z][0-9]+)/g;

function parseRelicText(text) {
  let clean = text.replaceAll(/\n/g, " ").toUpperCase();

  clean = clean.replaceAll(/\[.*?\]/g, "");
  clean = clean.replaceAll(/\bRADIANT\b/g, "");
  clean = clean.replaceAll(/\bRELIC\b/g, "");

  clean = clean.replaceAll(/\s+/g, " ").trim();

  RELIC_REGEX.lastIndex = 0;

  const found = new Set();
  let m;
  while ((m = RELIC_REGEX.exec(clean)) !== null) {
    const tier = m[1].charAt(0) + m[1].slice(1).toLowerCase();
    const name = m[2];
    found.add(`${tier} ${name}`);
  }
  return Array.from(found);
}

export function toggleScannedList() {
  const panel = document.getElementById("scanned-results-panel");
  if (panel) panel.classList.toggle("hidden");
}

export function clearScannedList() {
  console.log("[SCANNER] Limpiando lista temporal");
  scannedInventory = [];
  updateResultsUI();
  const panel = document.getElementById("scanned-results-panel");
  if (panel) panel.classList.add("hidden");
}

function updateResultsUI() {
  const list = document.getElementById("scanned-list");
  const badge = document.getElementById("scanned-badge");
  const countLabel = document.getElementById("scanned-total-count");

  if (badge) {
    badge.innerText = scannedInventory.length;
    badge.classList.toggle("hidden", scannedInventory.length === 0);
  }
  if (countLabel) countLabel.innerText = scannedInventory.length;

  if (list) {
    list.textContent = "";
    if (scannedInventory.length === 0) {
      list.textContent =
        "<div style='color:#888; text-align:center'>Lista vacía</div>";
      return;
    }
    scannedInventory.forEach((r) => {
      const d = document.createElement("div");
      d.className = "scanned-item-card";
      d.textContent = `<strong>${r}</strong>`;
      list.appendChild(d);
    });
  }
}

export function confirmScanResults() {
  if (scannedInventory.length === 0) return showToast(st().toastEmptyList);

  updateInventoryBatch(scannedInventory);
  saveAppState();

  const capturedCount = scannedInventory.length;
  scannedInventory = [];
  updateResultsUI();

  closeScanner();

  console.log(" Abriendo panel de inventario...");
  renderInventory();
  toggleInventoryPanel(true);

  showToast(` ${capturedCount} relics saved`);
}

let inventoryStream = null;
let inventoryInterval = null;
let sessionRelics = new Set();
let isInventoryScanning = false;

export async function startInventoryScrollScan() {
  try {
    showToast(st().toastEngineInit);

    if (!globalThis.Tesseract) {
      const { OCRRepository } = await import("../repositories/ocr.repository.js");
      await OCRRepository.loadTesseractScript();
    }
    if (!ocrWorker) {
      ocrWorker = await globalThis.Tesseract.createWorker("eng", 1, {
        workerPath: "js/worker.min.js",
        corePath: "js/tesseract-core.wasm.js",
        langPath: "js/",
        gzip: false,
        logger: (m) => console.log(m),
      });

      await ocrWorker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789[] ",
        tessedit_pageseg_mode: globalThis.Tesseract.PSM.SPARSE_TEXT,
      });
    }

    inventoryStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "never" },
      audio: false,
    });

    const videoTrack = inventoryStream.getVideoTracks()[0];
    const video = document.createElement("video");
    video.srcObject = inventoryStream;
    video.play();

    sessionRelics.clear();
    lastFrameData = null;
    staticFrameCount = 0;
    isInventoryScanning = true;

    showToast(st().toastEngineReady);

    const scanLoop = async () => {
      if (!isInventoryScanning) return;

      if (video.readyState === 4) {
        await processInventoryFrame(video);
      }

      requestAnimationFrame(scanLoop);
    };

    scanLoop();

    videoTrack.onended = () => {
      finishInventoryScan();
    };
  } catch (err) {
    console.error("Error al iniciar:", err);
    showToast((st().toastError || "Error: {msg}").replace("{msg}", err.message));
  }
}

async function processInventoryFrame(videoSource) {
  const w = videoSource.videoWidth;
  const h = videoSource.videoHeight;
  if (w < 10 || h < 10) return;

  const scale = 0.8;

  if (processingCanvas.width !== w * scale) processingCanvas.width = w * scale;
  if (processingCanvas.height !== h * scale)
    processingCanvas.height = h * scale;

  processingCtx.drawImage(videoSource, 0, 0, w * scale, h * scale);

  const imageData = processingCtx.getImageData(0, 0, w * scale, h * scale);
  const data = imageData.data;

  if (lastFrameData && lastFrameData.length === data.length) {
    let diff = 0;
    for (let i = 0; i < data.length; i += 400) {
      if (Math.abs(data[i] - lastFrameData[i]) > 40) diff++;
    }
    if (diff < 20) {
      staticFrameCount++;
      if (staticFrameCount > 20) {
        isInventoryScanning = false;
        if (confirm("Escaneo detenido por inactividad. ¿Finalizar?"))
          finishInventoryScan();
        else startInventoryScrollScan();
      }
      return;
    }
    staticFrameCount = 0;
  }
  lastFrameData = new Uint8ClampedArray(data);

  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const val = gray > 110 ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = val;
  }
  processingCtx.putImageData(imageData, 0, 0);

  try {
    const {
      data: { text },
    } = await ocrWorker.recognize(processingCanvas);

    const found = parseRelicText(text);
    let newCount = 0;

    found.forEach((relic) => {
      if (!sessionRelics.has(relic)) {
        sessionRelics.add(relic);
        scannedInventory.push(relic);
        newCount++;
      }
    });

    if (newCount > 0) {
      console.log(`⚡ +${newCount} | Total: ${sessionRelics.size}`);
      updateResultsUI();
    }
  } catch (e) {
    console.warn("OCR Error:", e);
  }
}
function detectScreenChange(prevData, currData) {
  if (prevData.length !== currData.length) return true;

  let diffPixels = 0;

  for (let i = 0; i < currData.length; i += 100) {
    if (Math.abs(prevData[i] - currData[i]) > 30) {
      diffPixels++;
    }
  }

  return diffPixels > 50;
}
export async function finishInventoryScan() {
  isInventoryScanning = false;
  if (inventoryStream) {
    inventoryStream.getTracks().forEach((t) => t.stop());
  }

  if (ocrWorker) {
    await ocrWorker.terminate();
    ocrWorker = null;
  }

  const resultsPanel = document.getElementById("scanned-results-panel");
  const overlay = document.getElementById("ocr-overlay");
  const stopBtn = document.getElementById("manual-stop-btn");

  if (stopBtn) stopBtn.classList.add("hidden");
  if (overlay) overlay.classList.add("hidden");
  if (resultsPanel) resultsPanel.classList.remove("hidden");

  showToast(`🏁 FINISHED. ${sessionRelics.size} RELICS FOUND.`);
}

const globalFuncs = {
  openScanner,
  closeScanner,
  captureRelics,
  handleFileUpload,
  toggleScannedList,
  clearScannedList,
  confirmScanResults,
  startInventoryScrollScan,
  finishInventoryScan,
};

Object.assign(window, globalFuncs);
