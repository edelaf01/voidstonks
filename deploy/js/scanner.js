/* scanner.js */
import { state } from "./state.js";
import { showToast, getSlug } from "./ui.js";
import { getPriceValue } from "./api.js"; // Asegúrate de exportar esto en api.js

let videoStream = null;
let scannedInventory = []; // Aquí guardamos lo que encuentra el OCR

// --- GESTIÓN DE UI ---
export async function openScanner() {
  document.getElementById("ocr-overlay").classList.remove("hidden");
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
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 } },
    });
    video.srcObject = videoStream;
    video.classList.remove("hidden");
  } catch (e) {
    console.warn("Cámara no disponible, usa Subir Foto");
  }
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach((t) => t.stop());
    videoStream = null;
  }
}

// --- SUBIDA DE FOTOS ---
export function handleFileUpload(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => processImageSource(img);
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);

  // Ocultar video, mostrar preview estática si quieres, o procesar directo
  stopCamera();
}

// --- CAPTURA Y PROCESAMIENTO ---
export async function captureRelics() {
  const video = document.getElementById("ocr-video");
  if (videoStream && video.readyState === 4) {
    processImageSource(video);
  } else {
    showToast("Cámara no lista");
  }
}

async function processImageSource(source) {
  const loading = document.getElementById("ocr-loading");
  loading.classList.remove("hidden");

  // Dibujar en canvas temporal
  const canvas = document.createElement("canvas");
  canvas.width = source.videoWidth || source.width;
  canvas.height = source.videoHeight || source.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  // Preprocesado (Inversión + Contraste)
  preprocessImageForOCR(ctx, canvas.width, canvas.height);

  try {
    const {
      data: { text },
    } = await Tesseract.recognize(canvas, "eng", {
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ",
    });

    const foundNames = smartParse(text);

    if (foundNames.length > 0) {
      addToScannedInventory(foundNames);
      showToast(`✅ ${foundNames.length} reliquias añadidas`);
      window.toggleScannedList(true); // Abrir cajón automáticamente
    } else {
      showToast("No se detectaron reliquias.");
    }
  } catch (e) {
    console.error(e);
    showToast("Error OCR");
  } finally {
    loading.classList.add("hidden");
  }
}

// --- GESTIÓN DE INVENTARIO Y PRECIOS ---

async function addToScannedInventory(names) {
  // Evitar duplicados en la sesión actual
  const newItems = names.filter((n) => !scannedInventory.includes(n));
  scannedInventory = [...scannedInventory, ...newItems];

  updateScannedBadge();
  renderScannedList();
}

export function toggleScannedList(forceOpen = false) {
  const panel = document.getElementById("scanned-results-panel");
  if (forceOpen) panel.classList.remove("hidden");
  else panel.classList.toggle("hidden");
}

function updateScannedBadge() {
  const badge = document.getElementById("scanned-badge");
  badge.innerText = scannedInventory.length;
  badge.classList.remove("hidden");
}

// Aquí calculamos la magia: Platino y Ducados
async function renderScannedList() {
  const container = document.getElementById("scanned-list");
  container.innerHTML = "";

  for (const relicName of scannedInventory) {
    const card = document.createElement("div");
    card.className = "scanned-item-card";

    // 1. Calcular Valor Medio (EV) y Ducados
    // Esto usa tu base de datos state.relicsDatabase
    const stats = await calculateRelicStats(relicName);

    card.innerHTML = `
            <div>
                <div style="font-weight:bold; color:#fff;">${relicName}</div>
                <div style="font-size:0.75em; color:#888;">
                   ${stats.vaulted ? "VAULTED" : "Active"} • Avg Duc: ${
      stats.avgDucats
    }
                </div>
            </div>
            <div style="text-align:right;">
                <div class="ev-badge">${
                  stats.evIntact
                } <span style="font-size:0.7em">pl</span></div>
                <div style="font-size:0.7em; color:var(--wf-blue);">Rad: ${
                  stats.evRad
                }</div>
            </div>
        `;

    // Click para buscar en la app principal
    card.onclick = () => {
      closeScanner();
      document.getElementById("relicInput").value = relicName;
      // Disparar búsqueda manual
      if (window.manualRelicUpdate) window.manualRelicUpdate();
    };

    container.appendChild(card);
  }
}

async function calculateRelicStats(relicName) {
  // Buscar drops en la base de datos ya cargada
  const drops = state.relicsDatabase[relicName];

  if (!drops)
    return { evIntact: "?", evRad: "?", avgDucats: "?", vaulted: false };

  let evIntact = 0;
  let evRad = 0;
  let totalDucats = 0;

  // Calculamos EV sumando (Probabilidad * Precio) de cada parte
  // Nota: Esto requiere que los precios estén cacheados.
  // Si no lo están, getPriceValue intentará buscarlos (puede ser lento la primera vez)

  for (const drop of drops) {
    const price = await getPriceValue(drop.name, getSlug(drop.name));

    // Ducados aproximados (Común: 15, Poco Común: 45, Raro: 100)
    let ducats = 15;
    if (drop.chance < 20) ducats = 45;
    if (drop.chance < 5) ducats = 100;

    // Drop Chances (Intact)
    let pIntact = 0.2533; // Común / 3
    if (drop.chance < 20) pIntact = 0.11; // Uncommon / 2
    if (drop.chance < 5) pIntact = 0.02; // Rare / 1

    // Drop Chances (Radiant)
    let pRad = 0.166;
    if (drop.chance < 20) pRad = 0.2;
    if (drop.chance < 5) pRad = 0.1;

    evIntact += price * pIntact;
    evRad += price * pRad;
    totalDucats += ducats * pIntact;
  }

  return {
    evIntact: evIntact.toFixed(1),
    evRad: evRad.toFixed(1),
    avgDucats: Math.round(totalDucats),
    vaulted: state.relicStatusDB[relicName] !== "active",
  };
}

// ... (Aquí van las funciones auxiliares preprocessImageForOCR y smartParse que ya tienes)
function preprocessImageForOCR(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Recorremos cada píxel
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // 1. Escala de Grises (Luma)
    let gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    // 2. Aumento de Contraste Dinámico
    // Hacemos los oscuros más oscuros y los claros más claros
    gray = gray > 100 ? 255 : 0;

    // 3. INVERSIÓN (Vital para Warframe)
    // Warframe es texto blanco sobre fondo oscuro.
    // Tesseract prefiere texto NEGRO sobre fondo BLANCO.
    gray = 255 - gray;

    data[i] = gray; // R
    data[i + 1] = gray; // G
    data[i + 2] = gray; // B
  }
  ctx.putImageData(imageData, 0, 0);
}

// --- PARSEO INTELIGENTE ---

function smartParse(text) {
  const results = new Set();

  // Limpiamos el texto: saltos de línea por espacios, quitamos dobles espacios
  const cleanText = text.replace(/\n/g, " ").replace(/\s+/g, " ").toUpperCase();

  // Regex que busca patrones aproximados:
  // (TIER) + espacio + (LETRA)(NUMERO)
  // Ejemplo: LITH G1, MESO N5
  const regex =
    /(LITH|MESO|NEO|AXI|REQUIEM|OMNIA|L1TH|MES0|NE0|AX1)\s+([A-Z][0-9]{1,2})/g;

  let match;
  while ((match = regex.exec(cleanText)) !== null) {
    let tier = match[1];
    let code = match[2];

    // CORRECCIÓN DE ERRORES COMUNES (Fuzzy fixing)
    if (tier === "L1TH") tier = "LITH";
    if (tier === "MES0") tier = "MESO";
    if (tier === "NE0") tier = "NEO";
    if (tier === "AX1") tier = "AXI";

    // Formato bonito
    const relicName = tier.charAt(0) + tier.slice(1).toLowerCase() + " " + code;
    results.add(relicName);
  }

  return Array.from(results);
}
