// El servicio del kiosko con el OCR y los recortes sustituidos: qué lee, cuándo relee y cuándo
// avisa de una venta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { DucatKioskService: K } = await import("../deploy/js/services/scanner/ducat_kiosk.service.js");
const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

// Un vídeo de 800x450 con un gris distinto por "pantalla", para que el hash del panel cambie
// cuando toca y no cuando no.
const video = (gris) => {
  const W = 800, H = 450, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = gris; data[i + 3] = 255; }
  return { videoWidth: W, videoHeight: H, width: W, height: H, data };
};

// Guion de lo que "lee" el OCR, en orden: el centro (diálogo), el panel y la barra de ducados.
function conOcr(guion) {
  const original = { rec: OCRRepository.recognize, psm: OCRRepository.recognizeWithPSM, workers: OCRRepository.workers, match: OCRService.getValidItemMatch };
  OCRRepository.workers = [{}];
  OCRRepository.recognize = async () => ({ data: { text: guion.shift() ?? "" } });
  OCRRepository.recognizeWithPSM = async () => ({ data: { text: guion.shift() ?? "" } });
  OCRService.getValidItemMatch = (palabras) => (palabras.join(" ").includes("Vadarya") ? { originalName: "Vadarya Prime Receiver" } : null);
  return {
    restaura() {
      OCRRepository.recognize = original.rec; OCRRepository.recognizeWithPSM = original.psm;
      OCRRepository.workers = original.workers; OCRService.getValidItemMatch = original.match;
    },
  };
}

test("fuera del kiosko no lee nada", async () => {
  const ocr = conOcr(["lo que sea"]);
  K.reset();
  let llamadas = 0;
  OCRRepository.recognize = async () => { llamadas++; return { data: { text: "" } }; };
  await K.process(video(40), "INVENTORY/SELL");
  ocr.restaura();
  assert.equal(llamadas, 0);
});

test("lista, diálogo, panel vacío: avisa de la venta una sola vez", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",   // frame 1: sin diálogo, lista, ducados
    "Are you sure you want to sell 2 Items for 90?", // frame 2: diálogo (el panel no se lee)
    "", "", "1,480 99",                               // frame 3: sin diálogo, panel vacío
    "", "", "1,480 99",                               // frame 4: relectura forzada, vacío otra vez
  ]);
  K.reset();
  const ventas = [], paneles = [];
  K.onSale = (v) => ventas.push(v);
  K.onPanel = (items) => paneles.push(items.length);
  await K.process(video(40), "INVENTORY/DUCAT KIOSK");
  await K.process(video(20), "INVENTORY/DUCAT KIOSK");   // la pantalla se atenúa
  await K.process(video(60), "INVENTORY/DUCAT KIOSK");   // vuelve, vacía
  await K.process(video(60), "INVENTORY/DUCAT KIOSK");   // mismo hash: relee porque la anterior salió vacía
  await K.process(video(60), "INVENTORY/DUCAT KIOSK");   // mismo hash y ya confirmada: no relee
  ocr.restaura();
  K.onSale = null; K.onPanel = null;
  assert.deepEqual(ventas, [[{ name: "Vadarya Prime Receiver", qty: 2, ducats: 90 }]]);
  assert.deepEqual(paneles, [1, 0, 0], "el HUD ve la lista en cuanto se lee, y el vacío después");
});

test("con el panel quieto no vuelve a pasar el OCR", async () => {
  const ocr = conOcr(["", "2 X Vadarya Prime Receiver 90", "1,480 9"]);
  K.reset();
  let llamadas = 0;
  const rec = OCRRepository.recognize;
  OCRRepository.recognize = async (...a) => { llamadas++; return rec(...a); };
  await K.process(video(40), "INVENTORY/DUCAT KIOSK");
  await K.process(video(40), "INVENTORY/DUCAT KIOSK");
  ocr.restaura();
  assert.equal(llamadas, 2, "centro + panel una vez (la barra va por otro camino); el segundo frame no lee");
  assert.equal(K.estado.lista.length, 1);
});

test("el recorte del panel y el del diálogo caen donde están en pantalla", () => {
  const v = video(0);
  const panel = VisionService.prepareKioskPanelCanvas(v);
  const dialogo = VisionService.prepareCenterDialogCanvas(v);
  assert.deepEqual([panel.width, panel.height], [Math.floor(800 * 0.26), Math.floor(450 * 0.59)]);
  assert.deepEqual([dialogo.width, dialogo.height], [Math.floor(800 * 0.34), Math.floor(450 * 0.08)]);
});
