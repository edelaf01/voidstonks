/**
 * Verificación end-to-end del escáner de recompensas por FOTO, sobre imágenes reales.
 *
 * No es un test de `node --test`: necesita navegador (OpenCV.js + Tesseract) y lanza el
 * escáner real (MobileScanner.processUploadedPhoto), no una réplica del pipeline, para que
 * un fallo de integración no pase desapercibido.
 *
 * Requiere servir deploy/ por HTTPS (getUserMedia lo exige fuera de localhost) y ajustar
 * BASE / DIR a tu entorno.
 *
 *   node scripts/verify-reward-scan.mjs
 *
 * Referencia (jul 2026): 16/16 aciertos, 0 falsos positivos, ~2.2 s por imagen.
 */
import { chromium } from "playwright";
import fs from "node:fs";
const BASE = "https://192.168.1.141:8443";
const DIR = "/home/ppsoy/Imágenes/Capturas de pantalla/nofunciona";
const IMAGES = [
  ["nofunca.jpeg", ["Panthera Prime Blueprint","Epitaph Prime Blueprint","Baza Prime Barrel","Lex Prime Receiver"]],
  ["no funciona-gunseng.jpeg", ["Braton Prime Receiver","Gunsen Prime Blueprint","Grendel Prime Neuroptics Blueprint","Quassus Prime Blueprint"]],
  ["descarga.jpeg", ["Bronco Prime Receiver","Braton Prime Blueprint","Braton Prime Receiver","Forma Blueprint"]],
  ["descarga (1).jpeg", ["Akbolto Prime Receiver","Paris Prime String","Yareli Prime Chassis Blueprint","Forma Blueprint"]],
  ["WhatsApp Image 2026-07-27 at 22.41.22.jpeg", ["Braton Prime Receiver","Gunsen Prime Blueprint","Grendel Prime Neuroptics Blueprint","Quassus Prime Blueprint"]],
];
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport:{width:480,height:900} })).newPage();
page.on("pageerror", e => console.log("[PAGE ERROR]", e.message));
page.on("console", m => { const t = m.text(); if (t.startsWith("[SCAN]")) console.log("   " + t); });
await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });

let H=0,T=0,F=0,MS=0;
for (const [file, targets] of IMAGES) {
  // Una imagen de referencia puede haberse movido o borrado: se avisa y se sigue, en vez de
  // abortar la verificación entera.
  if (!fs.existsSync(`${DIR}/${file}`)) { console.log(`\n### ${file}  (no encontrada, se omite)`); continue; }
  const b64 = fs.readFileSync(`${DIR}/${file}`).toString("base64");
  const r = await page.evaluate(async ({b64}) => {
    const { MobileScanner } = await import("./js/scanner/mobile_scanner.js");
    const { OCRRepository } = await import("./js/repositories/ocr.repository.js");
    const { OpenCVEngine } = await import("./js/utils/opencv_engine.js");
    if (!globalThis.__sc) {
      const s = new MobileScanner();
      s.createOverlay();
      globalThis.currentScanner = s; globalThis.__sc = s;
      await OpenCVEngine.waitReady(30000);
      await OCRRepository.warmUp();
    }
    const s = globalThis.__sc;
    document.getElementById("scan-results-sheet")?.remove();
    document.getElementById("scanner-no-results-panel")?.remove();

    const bc = atob(b64); const arr = new Uint8Array(bc.length);
    for (let i=0;i<bc.length;i++) arr[i]=bc.charCodeAt(i);
    const file = new File([arr], "x.jpeg", { type: "image/jpeg" });
    const t0 = performance.now();
    await s.processUploadedPhoto(file);   // ruta REAL del escáner
    const ms = Math.round(performance.now()-t0);

    // showResults pinta las tarjetas dentro de un .then() de precios: hay que esperar a
    // que el DOM se rellene, no leerlo inmediatamente después de processUploadedPhoto.
    for (let i = 0; i < 60; i++) {
      const n = document.querySelectorAll("#scan-results-sheet .mobile-card-header").length;
      if (n > 0) break;
      if (document.getElementById("scanner-no-results-panel")) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const sheet = document.getElementById("scan-results-sheet");
    const names = sheet ? [...sheet.querySelectorAll(".mobile-card-header")].map(e=>e.innerText.trim()) : [];
    return { ms, names, noResults: !!document.getElementById("scanner-no-results-panel") };
  }, { b64 });

  // La UI pinta en mayúsculas por CSS (text-transform), así que se compara normalizado.
  const U = a => a.map(x => x.toUpperCase());
  const shown = U(r.names);
  const hits = targets.filter(t => shown.includes(t.toUpperCase()));
  const missing = targets.filter(t => !shown.includes(t.toUpperCase()));
  const fp = r.names.filter(n => !U(targets).includes(n.toUpperCase()));
  H+=hits.length; T+=targets.length; F+=fp.length; MS+=r.ms;
  console.log(`\n### ${file}  ${r.ms}ms  -> ${hits.length}/${targets.length}${fp.length?` (+${fp.length} falsos)`:""}`);
  console.log(`    UI muestra: ${JSON.stringify(r.names)}`);
  if (missing.length) console.log(`    FALTAN: ${JSON.stringify(missing)}`);
  if (fp.length) console.log(`    FALSOS: ${JSON.stringify(fp)}`);
}
console.log(`\n===== INTEGRADO: ${H}/${T} · ${F} falsos · ${Math.round(MS/IMAGES.length)}ms media =====`);
await browser.close();
