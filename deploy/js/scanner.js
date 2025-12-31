import { state } from "./state.js";
import { showToast, getSlug } from "./ui.js";
import { getPriceValue } from "./api.js";

let videoStream = null;
let scannedInventory = [];

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

  stopCamera();
}

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

  const canvas = document.createElement("canvas");
  canvas.width = source.videoWidth || source.width;
  canvas.height = source.videoHeight || source.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

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
      window.toggleScannedList(true);
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

async function addToScannedInventory(names) {
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

async function renderScannedList() {
  const container = document.getElementById("scanned-list");
  container.innerHTML = "";

  for (const relicName of scannedInventory) {
    const card = document.createElement("div");
    card.className = "scanned-item-card";

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

    card.onclick = () => {
      closeScanner();
      document.getElementById("relicInput").value = relicName;
      if (window.manualRelicUpdate) window.manualRelicUpdate();
    };

    container.appendChild(card);
  }
}

async function calculateRelicStats(relicName) {
  const drops = state.relicsDatabase[relicName];

  if (!drops)
    return { evIntact: "?", evRad: "?", avgDucats: "?", vaulted: false };

  let evIntact = 0;
  let evRad = 0;
  let totalDucats = 0;

  for (const drop of drops) {
    const price = await getPriceValue(drop.name, getSlug(drop.name));

    let ducats = 15;
    if (drop.chance < 20) ducats = 45;
    if (drop.chance < 5) ducats = 100;

    let pIntact = 0.2533;
    if (drop.chance < 20) pIntact = 0.11;
    if (drop.chance < 5) pIntact = 0.02;

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

function preprocessImageForOCR(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    gray = gray > 100 ? 255 : 0;

    gray = 255 - gray;

    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
  ctx.putImageData(imageData, 0, 0);
}

function smartParse(text) {
  const results = new Set();

  const cleanText = text.replace(/\n/g, " ").replace(/\s+/g, " ").toUpperCase();

  const regex =
    /(LITH|MESO|NEO|AXI|REQUIEM|OMNIA|L1TH|MES0|NE0|AX1)\s+([A-Z][0-9]{1,2})/g;

  let match;
  while ((match = regex.exec(cleanText)) !== null) {
    let tier = match[1];
    let code = match[2];

    if (tier === "L1TH") tier = "LITH";
    if (tier === "MES0") tier = "MESO";
    if (tier === "NE0") tier = "NEO";
    if (tier === "AX1") tier = "AXI";

    const relicName = tier.charAt(0) + tier.slice(1).toLowerCase() + " " + code;
    results.add(relicName);
  }

  return Array.from(results);
}
