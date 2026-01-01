/* js/scanner.js - Versión Final Integrada */
import { state, saveAppState, updateInventoryCount } from "./state.js";
import { showToast, toggleInventoryPanel, renderInventory } from "./ui.js";

let videoStream = null;
let scannedInventory = [];

// --- ABRIR Y CERRAR ESCÁNER ---
export async function openScanner() {
  const overlay = document.getElementById("ocr-overlay");
  overlay.classList.remove("hidden");
  startCamera();
}

export function closeScanner() {
  stopCamera();
  document.getElementById("ocr-overlay").classList.add("hidden");
  document.getElementById("scanned-results-panel").classList.add("hidden");
}

async function startCamera() {
  const video = document.getElementById("ocr-video");
  try {
    // Pedir cámara trasera con buena resolución
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    video.srcObject = videoStream;
    video.classList.remove("hidden");
  } catch (e) {
    console.warn(e);
    showToast("Error: No se pudo acceder a la cámara.");
  }
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach((t) => t.stop());
    videoStream = null;
  }
}

// --- CAPTURA Y PROCESADO ---
export async function captureRelics() {
  const video = document.getElementById("ocr-video");
  if (!videoStream || video.readyState < 2) {
    return showToast("Cámara no lista...");
  }
  processImageSource(video);
}

export function handleFileUpload(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => processImageSource(img);
      img.src = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function processImageSource(source) {
  const loading = document.getElementById("ocr-loading");
  loading.classList.remove("hidden");

  // 1. Crear Canvas temporal
  const canvas = document.createElement("canvas");
  const w = source.videoWidth || source.width;
  const h = source.videoHeight || source.height;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, w, h);

  // 2. Filtro de Imagen (Inversión Suave)
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    // Invertir colores (Warframe: Texto Blanco -> Negro para Tesseract)
    // Usamos una media simple para pasar a gris e invertimos
    const gray =
      255 - (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11);
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
  ctx.putImageData(imageData, 0, 0);

  // 3. OCR con Tesseract
  try {
    const {
      data: { text },
    } = await window.Tesseract.recognize(canvas, "eng", {
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ",
    });

    const found = parseRelicText(text);

    if (found.length > 0) {
      // Añadir a lista temporal
      found.forEach((item) => {
        if (!scannedInventory.includes(item)) scannedInventory.push(item);
      });
      updateResultsUI();
      showToast(`🔍 ${found.length} reliquias encontradas`);
    } else {
      showToast("No se detectó texto claro. Intenta acercarte.");
    }
  } catch (e) {
    console.error(e);
    showToast("Error en el reconocimiento.");
  } finally {
    loading.classList.add("hidden");
  }
}

// --- PARSEO DE TEXTO ---
function parseRelicText(text) {
  const clean = text.replace(/\n/g, " ").toUpperCase();
  const regex = /(LITH|MESO|NEO|AXI|REQUIEM)\s+([A-Z][0-9]+)/g;
  const found = new Set();
  let m;
  while ((m = regex.exec(clean)) !== null) {
    // Normalizar: "LITH G1"
    const tier = m[1].charAt(0) + m[1].slice(1).toLowerCase();
    found.add(`${tier} ${m[2]}`);
  }
  return Array.from(found);
}

// --- UI DE RESULTADOS ---
export function toggleScannedList(forceOpen = false) {
  const panel = document.getElementById("scanned-results-panel");
  if (forceOpen) panel.classList.remove("hidden");
  else panel.classList.toggle("hidden");
}

function updateResultsUI() {
  const list = document.getElementById("scanned-list");
  const badge = document.getElementById("scanned-badge");

  if (badge) {
    badge.innerText = scannedInventory.length;
    badge.classList.remove("hidden");
  }

  list.innerHTML = "";
  scannedInventory.forEach((r) => {
    const d = document.createElement("div");
    d.className = "scanned-item-card";
    d.innerHTML = `<span style="color:#fff; font-weight:bold;">${r}</span>`;
    list.appendChild(d);
  });

  toggleScannedList(true); // Abrir cajón automáticamente
}

export function confirmScanResults() {
  if (scannedInventory.length === 0) return;

  let addedCount = 0;

  // Procesar cada reliquia escaneada
  scannedInventory.forEach((relicName) => {
    updateInventoryCount(relicName, 1); // Sumar 1 por cada detección
    addedCount++;
  });

  saveAppState();
  renderInventory();

  showToast(`✅ ${addedCount} reliquias añadidas/actualizadas.`);

  // Limpiar
  scannedInventory = [];
  closeScanner();
  toggleInventoryPanel(true); // Mostrar el panel actualizado
}
// EXPORTAR A WINDOW PARA EL HTML
Object.assign(window, {
  openScanner,
  closeScanner,
  captureRelics,
  handleFileUpload,
  toggleScannedList,
  confirmScanResults,
});
