import { state, saveAppState, updateInventoryBatch } from "./state.js";
import { showToast, toggleInventoryPanel, renderInventory } from "./ui.js";

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
    showToast("Error: Can't access camera.");
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
    video.classList.add("hidden"); }
}

export async function captureRelics() {
  console.log(" [SCANNER] Capturando...");
  const video = document.getElementById("ocr-video");
  if (!videoStream || video.readyState < 2 || video.videoWidth === 0) {
    return showToast("Cámara no lista...");
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
    img.src = URL.createObjectURL(file);
    await new Promise((resolve) => (img.onload = resolve));
    await processImageSource(img);
  }
}


async function processImageSource(source) {
  const loading = document.getElementById("ocr-loading");
  if (loading) loading.classList.remove("hidden");

  const w = source.videoWidth || source.width;
  const h = source.videoHeight || source.height;

  if (w < 10 || h < 10) {
    console.warn(`[SCANNER] Imagen ignorada por tamaño incorrecto: ${w}x${h}`);
    if (loading) loading.classList.add("hidden");
    showToast("Error: Imagen demasiado pequeña o inválida.");
    return;
  }

  if (processingCanvas.width !== w) processingCanvas.width = w;
  if (processingCanvas.height !== h) processingCanvas.height = h;

  processingCtx.drawImage(source, 0, 0, w, h);

  const imageData = processingCtx.getImageData(0, 0, w, h);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const contrast = gray > 100 ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = contrast;
  }
  processingCtx.putImageData(imageData, 0, 0);

  try {
    if (!window.Tesseract)
      throw new Error("Librería Tesseract no cargada en index.html");

    console.log(" [SCANNER] Iniciando reconocimiento OCR...");

    const {
      data: { text },
    } = await window.Tesseract.recognize(processingCanvas, "eng", {
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789[] ",
    });

    console.log("[SCANNER] Texto crudo detectado:", text);

    const found = parseRelicText(text);

    if (found.length > 0) {
      console.log("[SCANNER] Reliquias válidas encontradas:", found);

      found.forEach((item) => {
        if (!scannedInventory.includes(item)) scannedInventory.push(item);
      });

      updateResultsUI();

      const resultsPanel = document.getElementById("scanned-results-panel");
      if (resultsPanel) resultsPanel.classList.remove("hidden");

      showToast(`¡${found.length} detected!`);
    } else {
      console.warn(" [SCANNER] No se detectó patrón de reliquia.");
      showToast("NO RELICS DETECTED TRY AGAIN.");
    }
  } catch (e) {
    console.error(" [SCANNER] Error OCR:", e);
    showToast("SCANNER ERROR TRY AGAIN.");
  } finally {
    if (loading) loading.classList.add("hidden");
  }
}

const RELIC_REGEX = /(LITH|MESO|NEO|AXI|REQUIEM)\s*([A-Z][0-9]+)/g;

function parseRelicText(text) {
  let clean = text.replace(/\n/g, " ").toUpperCase();

  clean = clean.replace(/\[.*?\]/g, "");
  clean = clean.replace(/\bRADIANT\b/g, "");
  clean = clean.replace(/\bRELIC\b/g, "");

  clean = clean.replace(/\s+/g, " ").trim();

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
    list.innerHTML = "";
    if (scannedInventory.length === 0) {
      list.innerHTML =
        "<div style='color:#888; text-align:center'>Lista vacía</div>";
      return;
    }
    scannedInventory.forEach((r) => {
      const d = document.createElement("div");
      d.className = "scanned-item-card";
      d.innerHTML = `<strong>${r}</strong>`;
      list.appendChild(d);
    });
  }
}

export function confirmScanResults() {
  if (scannedInventory.length === 0) return showToast("Lista vacía");

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
    showToast("🚀 INITIALIZING OCR ENGINE...");

    if (!ocrWorker) {
      ocrWorker = await window.Tesseract.createWorker("eng", 1, {
        workerPath: 'js/worker.min.js',
        corePath: 'js/tesseract-core.wasm.js',
        langPath: 'js/', 
        gzip: false,
        logger: m => console.log(m) 
      });

      await ocrWorker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789[] ",
        tessedit_pageseg_mode: window.Tesseract.PSM.SPARSE_TEXT, 
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

    showToast("⚡ READY. SCROLL SLOWLY AND STEADILY.");

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
    showToast("Error: " + err.message);
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
