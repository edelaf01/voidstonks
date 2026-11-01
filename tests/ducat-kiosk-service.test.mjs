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
const { state } = await import("../deploy/js/state.js");

const video = (gris) => {
  const W = 800, H = 450, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = gris; data[i + 3] = 255; }
  return { videoWidth: W, videoHeight: H, width: W, height: H, data };
};

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
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
    "", "", "1,480 99",
    "", "", "1,480 99",
  ]);
  K.reset();
  const ventas = [], paneles = [];
  K.onSale = (v) => ventas.push(v);
  K.onPanel = (items) => paneles.push(items.length);
  await K.process(video(40), "INVENTORY/DUCAT KIOSK");
  await K.process(video(20), "INVENTORY/DUCAT KIOSK");
  await K.process(video(60), "INVENTORY/DUCAT KIOSK");
  await K.process(video(60), "INVENTORY/DUCAT KIOSK");
  await K.process(video(60), "INVENTORY/DUCAT KIOSK");
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

const conRaya = (y, gris = 40, raya = 255) => {
  const W = 800, H = 450, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) {
    const x = (i / 4) % W, f = (i / 4 / W) | 0;
    data[i] = data[i + 1] = data[i + 2] = x >= 580 && x < 640 && f >= y && f < y + 8 ? raya : gris;
    data[i + 3] = 255;
  }
  return { videoWidth: W, videoHeight: H, width: W, height: H, data };
};

test("una línea del panel que cambia con la misma luma media se vuelve a leer", async () => {
  const ocr = conOcr([
    "", "1 X Vadarya Prime Receiver 45", "1,480 9",
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
  ]);
  K.reset();
  let llamadas = 0;
  const rec = OCRRepository.recognize;
  OCRRepository.recognize = async (...a) => { llamadas++; return rec(...a); };
  try {
    await K.process(conRaya(120), "INVENTORY/DUCAT KIOSK");
    await K.process(conRaya(160), "INVENTORY/DUCAT KIOSK");
    assert.equal(llamadas, 4);
    assert.equal(K.estado.lista[0].qty, 2);
  } finally {
    OCRRepository.recognize = rec;
    ocr.restaura();
  }
});

test("con el diálogo encima, el panel oscurecido se relee y se ve el diálogo", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
  ]);
  K.reset();
  try {
    await K.process(conRaya(120), "INVENTORY/DUCAT KIOSK");
    await K.process(conRaya(120, 20, 127), "INVENTORY/DUCAT KIOSK");
    assert.equal(K.estado.enDialogo, true);
    assert.equal(K.estado.lista.length, 1);
    assert.equal(K.estado.lista[0].qty, 2);
  } finally {
    ocr.restaura();
  }
});

const { pistasDelLog } = await import("../deploy/js/utils/ganchos.js");

test("confirmaPorLog con la suma correcta avisa de la venta y limpia el estado", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
  ]);
  K.reset(); K.vendiendo = null;
  K.enContexto(true);
  const ventas = [];
  K.onSale = (v) => ventas.push(v);
  const rec = OCRRepository.recognize;
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas.length, 1);
    assert.equal(ventas[0].length, 1);
    assert.equal(ventas[0][0].name, "Vadarya Prime Receiver");
    assert.equal(ventas[0][0].qty, 2);
    assert.equal(K.estado.lista.length, 0);
    assert.notEqual(K.lastHash, null);
    let llamadasOcr = 0;
    OCRRepository.recognize = async (...a) => { llamadasOcr++; return rec(...a); };
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    assert.equal(llamadasOcr, 0);
    assert.equal(ventas.length, 1);
    assert.equal(K.estado.lista.length, 0);
  } finally {
    OCRRepository.recognize = rec;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("confirmaPorLog con una suma distinta no descuenta nada y lo registra en el log", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
  ]);
  K.reset(); K.vendiendo = null;
  K.enContexto(true);
  const ventas = [];
  K.onSale = (v) => ventas.push(v);
  const origLog = console.log;
  const logs = [];
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    console.log = (msg) => { if (typeof msg === "string") logs.push(msg); };
    K.confirmaPorLog({ piezas: 3, ducados: 90 });
    assert.equal(ventas.length, 0);
    assert.equal(K.estado.lista.length, 1);
    const avisos = logs.filter((m) => m.startsWith("[KIOSKO]") && m.includes("3"));
    assert.equal(avisos.length, 1);
    assert.equal(K.vendiendo, null);
  } finally {
    console.log = origLog;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("venta leída por el OCR y luego avisada por el log: se descuenta una vez", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
    "", "", "1,480 99",
    "", "", "1,480 99",
  ]);
  K.reset(); K.vendiendo = null;
  K.enContexto(true);
  let ventas = 0;
  K.onSale = () => { ventas++; };
  const origLog = console.log;
  const logs = [];
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas, 1);
    assert.equal(K.vendiendo?.descontada, true);
    console.log = (msg) => { if (typeof msg === "string") logs.push(msg); };
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas, 1);
    assert.equal(K.vendiendo, null);
    const avisos = logs.filter((m) => m.includes("ya descontó"));
    assert.equal(avisos.length, 1);
  } finally {
    console.log = origLog;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("venta avisada por el log antes de que el OCR vea el panel vacío: se descuenta una vez", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
    "", "", "1,480 99",
    "", "", "1,480 99",
  ]);
  K.reset(); K.vendiendo = null;
  K.enContexto(true);
  let ventas = 0;
  K.onSale = () => { ventas++; };
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas, 1);
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas, 1);
  } finally {
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("el aviso de venta del log está conectado al kiosko de ducados en live_scanner", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../deploy/js/scanner/live_scanner.js", import.meta.url), "utf8");
  assert.match(src, /escucha\("vendido", \(venta\) => DucatKioskService\.confirmaPorLog\(venta\)\)/);
});

test("sin instantánea del diálogo de venta el log no descuenta", async () => {
  K.reset(); K.vendiendo = null;
  K.enContexto(true);
  const ventas = [];
  K.onSale = (v) => ventas.push(v);
  const origLog = console.log;
  const logs = [];
  let ocr = conOcr(["", "2 X Vadarya Prime Receiver 90", "1,480 9"]);
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    K.reset();
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas.length, 0);
    ocr.restaura();

    K.reset();
    K.vendiendo = null;
    ocr = conOcr(["", "2 X Vadarya Prime Receiver 90", "1,480 9"]);
    await K.process(video(50), "INVENTORY/DUCAT KIOSK");
    console.log = (msg) => { if (typeof msg === "string") logs.push(msg); };
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas.length, 0);
    assert.equal(K.estado.lista.length, 1);
    const avisos = logs.filter((m) => m.startsWith("[KIOSKO]"));
    assert.equal(avisos.length, 1);
  } finally {
    console.log = origLog;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("salir del kiosko olvida la lista", async () => {
  const ocr = conOcr(["", "2 X Vadarya Prime Receiver 90", "1,480 9"]);
  K.reset(); K.vendiendo = null;
  K.enContexto(true);
  const ventas = [];
  K.onSale = (v) => ventas.push(v);
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    K.enContexto(false);
    assert.equal(K.enKiosco, true);
    assert.equal(K.estado.lista.length, 1);
    assert.notEqual(K.lastHash, null);
    K.enContexto(true);
    K.enContexto(false);
    assert.equal(K.estado.lista.length, 1);
    K.enContexto(false);
    assert.equal(K.enKiosco, false);
    assert.equal(K.estado.lista.length, 0);
    assert.equal(K.lastHash, null);
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas.length, 0);
  } finally {
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("ducados del log que no coinciden no descuentan y mantienen la lista", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
  ]);
  K.reset(); K.vendiendo = null;
  K.enContexto(true);
  const ventas = [];
  K.onSale = (v) => ventas.push(v);
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    K.confirmaPorLog({ piezas: 2, ducados: 100 });
    assert.equal(ventas.length, 0);
    assert.equal(K.estado.lista.length, 1);
  } finally {
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("línea del panel sin ducados consulta la base de datos de ducados", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
    "Are you sure you want to sell 2 Items for 90?",
  ]);
  K.reset(); K.vendiendo = null;
  K.enContexto(true);
  const ventas = [];
  K.onSale = (v) => ventas.push(v);
  const origItems = state.itemsDatabase;
  const origDucats = state.ducatsDatabase;
  state.itemsDatabase = {};
  state.ducatsDatabase = {};
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas.length, 0);
    state.ducatsDatabase = { "Vadarya Prime Receiver": { ducats: 45 } };
    await K.process(video(0), "INVENTORY/DUCAT KIOSK");
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas.length, 1);
  } finally {
    state.itemsDatabase = origItems;
    state.ducatsDatabase = origDucats;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("el catálogo manda sobre un número mal leído en el panel", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 80", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
  ]);
  K.reset(); K.vendiendo = null;
  K.enContexto(true);
  const ventas = [];
  K.onSale = (v) => ventas.push(v);
  const origItems = state.itemsDatabase;
  const origDucats = state.ducatsDatabase;
  state.itemsDatabase = {};
  state.ducatsDatabase = { "Vadarya Prime Receiver": { ducats: 45 } };
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas.length, 1);
  } finally {
    state.itemsDatabase = origItems;
    state.ducatsDatabase = origDucats;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("cabecera vacía con diálogo de cantidad solo lee el centro y no vende nada", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Quantity 1",
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
  ]);
  let llamadasRec = 0;
  let llamadasPsm = 0;
  const origRec = OCRRepository.recognize;
  const origPsm = OCRRepository.recognizeWithPSM;
  OCRRepository.recognize = async (...a) => { llamadasRec++; return origRec(...a); };
  OCRRepository.recognizeWithPSM = async (...a) => { llamadasPsm++; return origPsm(...a); };
  K.reset(); K.vendiendo = null;
  K.enContexto(true);
  const ventas = [], paneles = [];
  K.onSale = (v) => ventas.push(v);
  K.onPanel = (i) => paneles.push(i);
  try {
    const frameA = video(40);
    const frameB = video(50);
    await K.process(frameA, "INVENTORY/DUCAT KIOSK");
    assert.equal(llamadasRec, 2);
    assert.equal(llamadasPsm, 1);

    paneles.length = 0;
    await K.process(frameB, "", true);
    assert.equal(llamadasRec, 3);
    assert.equal(llamadasPsm, 1);
    assert.equal(ventas.length, 0);
    assert.equal(paneles.length, 0);
    assert.equal(K.estado.lista.length, 1);
    assert.equal(K.estado.enDialogo, false);
    assert.equal(K.conDialogo, false);
    assert.equal(K.lastHash, null);

    await K.process(frameB, "", false);
    assert.equal(llamadasRec, 3);
    assert.equal(llamadasPsm, 1);

    await K.process(frameB, "INVENTORY/DUCAT KIOSK");
    assert.equal(llamadasRec, 5);
    assert.equal(llamadasPsm, 2);
  } finally {
    OCRRepository.recognize = origRec;
    OCRRepository.recognizeWithPSM = origPsm;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("cabecera vacía con diálogo de venta y retorno de cabecera descuenta una sola vez", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
    "", "", "1,480 99",
    "", "", "1,480 99",
  ]);
  let llamadasPsm = 0;
  const origPsm = OCRRepository.recognizeWithPSM;
  OCRRepository.recognizeWithPSM = async (...a) => { llamadasPsm++; return origPsm(...a); };
  K.reset(); K.vendiendo = null;
  K.enContexto(true);
  let ventas = 0;
  K.onSale = () => { ventas++; };
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    const psmAntes = llamadasPsm;
    await K.process(video(20), "", true);
    assert.equal(K.conDialogo, true);
    assert.equal(K.estado.enDialogo, true);
    assert.equal(K.lastHash, null);
    assert.equal(llamadasPsm, psmAntes);

    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas, 1);
    assert.equal(K.vendiendo?.descontada, true);

    const origLog = console.log;
    const logs = [];
    try {
      console.log = (msg) => { if (typeof msg === "string") logs.push(msg); };
      K.confirmaPorLog({ piezas: 2, ducados: 90 });
      assert.equal(ventas, 1);
      assert.equal(K.vendiendo, null);
      const avisos = logs.filter((m) => m.includes("ya descontó"));
      assert.equal(avisos.length, 1);
    } finally {
      console.log = origLog;
    }
  } finally {
    OCRRepository.recognizeWithPSM = origPsm;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("log tardío tras venta por OCR con otra lista en panel no duplica descuento", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
    "", "", "1,480 99",
    "", "", "1,480 99",
    "", "2 X Vadarya Prime Receiver 90", "1,480 99",
    "Are you sure you want to sell 2 Items for 90?",
    "", "", "1,480 189",
    "", "", "1,480 189",
  ]);
  K.reset(); K.vendiendo = null;
  K.enContexto(true);
  let ventas = 0;
  K.onSale = () => { ventas++; };
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas, 1);
    assert.equal(K.vendiendo?.descontada, true);

    await K.process(video(100), "INVENTORY/DUCAT KIOSK");
    assert.equal(K.estado.lista.length, 1);

    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas, 1);
    assert.equal(K.estado.lista.length, 1);

    await K.process(video(140), "INVENTORY/DUCAT KIOSK");
    await K.process(video(180), "INVENTORY/DUCAT KIOSK");
    await K.process(video(180), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas, 2);
    assert.equal(K.vendiendo?.descontada, true);

    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas, 2);
  } finally {
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("la ventana de espera del log caduca", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
    "", "", "1,480 99",
    "", "", "1,480 99",
    "", "2 X Vadarya Prime Receiver 90", "1,480 99",
    "Are you sure you want to sell 2 Items for 90?",
    "", "", "1,480 189",
    "", "", "1,480 189",
  ]);
  const origNow = Date.now;
  const origLogLeyendo = pistasDelLog.logLeyendo;
  pistasDelLog.logLeyendo = () => true;
  let ahora = 1_700_000_000_000;
  Date.now = () => ahora;
  K.reset(); K.vendiendo = null;
  K.enContexto(true);
  let ventas = 0;
  K.onSale = () => { ventas++; };
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas, 0);

    ahora = 1_700_000_000_000 + 29_999;
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas, 1);

    ahora = 1_700_000_100_000;
    await K.process(video(100), "INVENTORY/DUCAT KIOSK");
    await K.process(video(140), "INVENTORY/DUCAT KIOSK");
    await K.process(video(180), "INVENTORY/DUCAT KIOSK");
    await K.process(video(180), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas, 1);

    ahora = 1_700_000_100_000 + 30_001;
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas, 1);
    assert.equal(K.vendiendo, null);
  } finally {
    Date.now = origNow;
    pistasDelLog.logLeyendo = origLogLeyendo;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("con el diálogo abierto, enContexto no suelta conDialogo ni la lista", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
  ]);
  K.reset(); K.vendiendo = null;
  try {
    K.enContexto(true);
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    assert.equal(K.conDialogo, true);
    K.enContexto(true);
    K.enContexto(true);
    K.enContexto(true);
    assert.equal(K.conDialogo, true);
    assert.equal(K.estado.lista.length, 1);
    assert.equal(K.estado.enDialogo, true);
  } finally {
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("con el log leyendo el OCR no descuenta y el log descuenta la instantánea aunque llegue con el panel ya vacío", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
    "", "", "1,480 99",
    "", "", "1,480 99",
  ]);
  const origNow = Date.now;
  const origLogLeyendo = pistasDelLog.logLeyendo;
  pistasDelLog.logLeyendo = () => true;
  let ahora = 1_700_000_000_000;
  Date.now = () => ahora;
  const ventas = [];
  K.onSale = (v) => ventas.push(v);
  K.reset(); K.vendiendo = null;
  try {
    K.enContexto(true);
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas.length, 0);
    assert.equal(K.estado.lista.length, 0);
    assert.equal(K.vendiendo.lista.length, 1);
    ahora = 1_700_000_000_000 + 5_000;
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.deepEqual(ventas, [[{ name: "Vadarya Prime Receiver", qty: 2, ducats: 90 }]]);
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas.length, 1);
  } finally {
    Date.now = origNow;
    pistasDelLog.logLeyendo = origLogLeyendo;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("sin el log el OCR descuenta la venta él solo", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
    "", "", "1,480 99",
    "", "", "1,480 99",
  ]);
  const origLogLeyendo = pistasDelLog.logLeyendo;
  pistasDelLog.logLeyendo = () => false;
  let ventas = 0;
  K.onSale = () => { ventas++; };
  K.reset(); K.vendiendo = null;
  try {
    K.enContexto(true);
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas, 1);
    assert.equal(K.vendiendo?.descontada, true);
  } finally {
    pistasDelLog.logLeyendo = origLogLeyendo;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("el log de una venta que el OCR no vio no descuenta la lista siguiente aunque cuadre", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "", "", "1,480 99",
    "", "", "1,480 99",
    "", "2 X Vadarya Prime Receiver 90", "1,480 99",
    "Are you sure you want to sell 2 Items for 90?",
    "", "", "1,480 189",
    "", "", "1,480 189",
  ]);
  const origLogLeyendo = pistasDelLog.logLeyendo;
  pistasDelLog.logLeyendo = () => true;
  let ventas = 0;
  K.onSale = () => { ventas++; };
  K.reset(); K.vendiendo = null;
  try {
    K.enContexto(true);
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(100), "INVENTORY/DUCAT KIOSK");
    assert.equal(K.estado.lista.length, 1);
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas, 0);
    assert.equal(K.estado.lista.length, 1);
    await K.process(video(140), "INVENTORY/DUCAT KIOSK");
    await K.process(video(180), "INVENTORY/DUCAT KIOSK");
    await K.process(video(180), "INVENTORY/DUCAT KIOSK");
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas, 1);
  } finally {
    pistasDelLog.logLeyendo = origLogLeyendo;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("confirmaPorLog durante el await de process: la lista no reaparece y no hay doble descuento", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
    "2 X Vadarya Prime Receiver 90", "1,480 9",
    "", "", "1,480 99",
    "", "", "1,480 99",
  ]);
  const origLogLeyendo = pistasDelLog.logLeyendo;
  pistasDelLog.logLeyendo = () => false;
  let ventas = 0;
  K.onSale = () => { ventas++; };
  K.reset(); K.vendiendo = null;
  const rec = OCRRepository.recognize;
  try {
    K.enContexto(true);
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    let soltar;
    OCRRepository.recognize = () => new Promise((r) => { soltar = r; });
    const enCurso = K.process(video(60), "INVENTORY/DUCAT KIOSK");
    OCRRepository.recognize = rec;
    K.confirmaPorLog({ piezas: 2, ducados: 90 });
    assert.equal(ventas, 1);
    soltar({ data: { text: "" } });
    await enCurso;
    assert.equal(K.estado.lista.length, 0);
    await K.process(video(100), "INVENTORY/DUCAT KIOSK");
    await K.process(video(100), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas, 1);
  } finally {
    OCRRepository.recognize = rec;
    pistasDelLog.logLeyendo = origLogLeyendo;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("cancelar la venta con la cabecera ilegible y vaciar la lista no descuenta", async () => {
  const ocr = conOcr([
    "", "2 X Vadarya Prime Receiver 90", "1,480 9",
    "Are you sure you want to sell 2 Items for 90?",
    "",
    "", "", "1,480 9",
    "", "", "1,480 9",
  ]);
  const origLogLeyendo = pistasDelLog.logLeyendo;
  pistasDelLog.logLeyendo = () => false;
  let ventas = 0;
  K.onSale = () => { ventas++; };
  K.reset(); K.vendiendo = null;
  try {
    K.enContexto(true);
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "", true);
    assert.equal(K.estado.enDialogo, true);
    await K.process(video(0), "", true);
    assert.equal(K.estado.enDialogo, false);
    assert.equal(K.estado.lista.length, 1);
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas, 0);
  } finally {
    pistasDelLog.logLeyendo = origLogLeyendo;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

const A = { name: "Vadarya Prime Receiver", qty: 1, ducats: 45 };
const B = { name: "Zylok Prime Barrel", qty: 1, ducats: 45 };
const VENDER_45 = "Are you sure you want to sell 1 Items for 45?";

test("con el log leyendo, cancelar el diálogo de otra lista antes del log no hace que el log descuente la lista cancelada", async () => {
  const ocr = conOcr([
    "", "1 X Vadarya Prime Receiver 45", "1,480 9",
    VENDER_45,
    "", "", "1,480 54",
    "", "", "1,480 54",
    "", "1 X Zylok Prime Barrel 45", "1,480 54",
    VENDER_45,
    "", "1 X Zylok Prime Barrel 45", "1,480 54",
    "", "1 X Zylok Prime Barrel 45", "1,480 54",
  ]);
  OCRService.getValidItemMatch = (p) => { const s = p.join(" "); return s.includes("Vadarya") ? { originalName: "Vadarya Prime Receiver" } : s.includes("Zylok") ? { originalName: "Zylok Prime Barrel" } : null; };
  const origItems = state.itemsDatabase;
  const origDucats = state.ducatsDatabase;
  const origLogLeyendo = pistasDelLog.logLeyendo;
  state.itemsDatabase = {};
  state.ducatsDatabase = {};
  pistasDelLog.logLeyendo = () => true;
  const ventas = [];
  K.onSale = (v) => ventas.push(v);
  K.reset();
  K.vendiendo = null;
  K.enContexto(true);
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas.length, 0);
    assert.equal(K.vendiendo?.vista, true);
    await K.process(video(100), "INVENTORY/DUCAT KIOSK");
    await K.process(video(80), "INVENTORY/DUCAT KIOSK");
    await K.process(video(120), "INVENTORY/DUCAT KIOSK");
    await K.process(video(140), "INVENTORY/DUCAT KIOSK");
    K.confirmaPorLog({ piezas: 1, ducados: 45 });
    assert.deepEqual(ventas, [[A]]);
    assert.equal(ventas.flat().some((p) => p.name === "Zylok Prime Barrel"), false);
    assert.equal(K.vendiendo, null);
  } finally {
    state.itemsDatabase = origItems;
    state.ducatsDatabase = origDucats;
    pistasDelLog.logLeyendo = origLogLeyendo;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("con el log leyendo, dos ventas vistas antes de que llegue el log de la primera no descuentan nada dos veces", async () => {
  const ocr = conOcr([
    "", "1 X Vadarya Prime Receiver 45", "1,480 9",
    VENDER_45,
    "", "", "1,480 54",
    "", "", "1,480 54",
    "", "1 X Zylok Prime Barrel 45", "1,480 54",
    VENDER_45,
    "", "", "1,480 99",
    "", "", "1,480 99",
  ]);
  OCRService.getValidItemMatch = (p) => { const s = p.join(" "); return s.includes("Vadarya") ? { originalName: "Vadarya Prime Receiver" } : s.includes("Zylok") ? { originalName: "Zylok Prime Barrel" } : null; };
  const origItems = state.itemsDatabase;
  const origDucats = state.ducatsDatabase;
  const origLogLeyendo = pistasDelLog.logLeyendo;
  state.itemsDatabase = {};
  state.ducatsDatabase = {};
  pistasDelLog.logLeyendo = () => true;
  const ventas = [];
  K.onSale = (v) => ventas.push(v);
  K.reset();
  K.vendiendo = null;
  K.enContexto(true);
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(100), "INVENTORY/DUCAT KIOSK");
    await K.process(video(80), "INVENTORY/DUCAT KIOSK");
    await K.process(video(120), "INVENTORY/DUCAT KIOSK");
    await K.process(video(120), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas.length, 0);
    K.confirmaPorLog({ piezas: 1, ducados: 45 });
    assert.deepEqual(ventas, [[A]]);
    K.confirmaPorLog({ piezas: 1, ducados: 45 });
    assert.ok(ventas.length <= 2);
    if (ventas.length === 2) assert.deepEqual(ventas[1], [B]);
    const flat = ventas.flat();
    assert.equal(flat.filter((p) => p.name === "Vadarya Prime Receiver").length, 1);
    assert.ok(flat.filter((p) => p.name === "Zylok Prime Barrel").length <= 1);
  } finally {
    state.itemsDatabase = origItems;
    state.ducatsDatabase = origDucats;
    pistasDelLog.logLeyendo = origLogLeyendo;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("con el log leyendo, un diálogo cancelado tras una venta que el OCR no vio no deja que el log la descuente", async () => {
  const ocr = conOcr([
    "", "1 X Vadarya Prime Receiver 45", "1,480 9",
    VENDER_45,
    "", "1 X Zylok Prime Barrel 45", "1,480 54",
    VENDER_45,
    "", "1 X Zylok Prime Barrel 45", "1,480 54",
    "", "1 X Zylok Prime Barrel 45", "1,480 54",
  ]);
  OCRService.getValidItemMatch = (p) => { const s = p.join(" "); return s.includes("Vadarya") ? { originalName: "Vadarya Prime Receiver" } : s.includes("Zylok") ? { originalName: "Zylok Prime Barrel" } : null; };
  const origItems = state.itemsDatabase;
  const origDucats = state.ducatsDatabase;
  const origLogLeyendo = pistasDelLog.logLeyendo;
  state.itemsDatabase = {};
  state.ducatsDatabase = {};
  pistasDelLog.logLeyendo = () => true;
  const ventas = [];
  K.onSale = (v) => ventas.push(v);
  K.reset();
  K.vendiendo = null;
  K.enContexto(true);
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(80), "INVENTORY/DUCAT KIOSK");
    await K.process(video(100), "INVENTORY/DUCAT KIOSK");
    await K.process(video(120), "INVENTORY/DUCAT KIOSK");
    assert.equal(K.vendiendo, null);
    K.confirmaPorLog({ piezas: 1, ducados: 45 });
    assert.equal(ventas.length, 0);
  } finally {
    state.itemsDatabase = origItems;
    state.ducatsDatabase = origDucats;
    pistasDelLog.logLeyendo = origLogLeyendo;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("con el log leyendo, una sola lectura de la lista tras confirmar no cuenta como cancelación", async () => {
  const ocr = conOcr([
    "", "1 X Vadarya Prime Receiver 45", "1,480 9",
    VENDER_45,
    "", "1 X Vadarya Prime Receiver 45", "1,480 9",
    "", "", "1,480 54",
    "", "", "1,480 54",
  ]);
  OCRService.getValidItemMatch = (p) => { const s = p.join(" "); return s.includes("Vadarya") ? { originalName: "Vadarya Prime Receiver" } : s.includes("Zylok") ? { originalName: "Zylok Prime Barrel" } : null; };
  const origItems = state.itemsDatabase;
  const origDucats = state.ducatsDatabase;
  const origLogLeyendo = pistasDelLog.logLeyendo;
  state.itemsDatabase = {};
  state.ducatsDatabase = {};
  pistasDelLog.logLeyendo = () => true;
  const ventas = [];
  K.onSale = (v) => ventas.push(v);
  K.reset();
  K.vendiendo = null;
  K.enContexto(true);
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    await K.process(video(80), "INVENTORY/DUCAT KIOSK");
    await K.process(video(80), "INVENTORY/DUCAT KIOSK");
    assert.equal(ventas.length, 0);
    K.confirmaPorLog({ piezas: 1, ducados: 45 });
    assert.deepEqual(ventas, [[A]]);
  } finally {
    state.itemsDatabase = origItems;
    state.ducatsDatabase = origDucats;
    pistasDelLog.logLeyendo = origLogLeyendo;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
  }
});

test("las piezas vistas en el panel siguen en la mesa tras reset() y un frame fuera; al segundo se olvidan y se avisa una vez", async () => {
  K.reset();
  K.vendiendo = null;
  K.enMesa.clear();
  const ocr = conOcr(["", "2 X Vadarya Prime Receiver 90", "1,480 9"]);
  K.onSale = null;
  K.onPanel = null;
  const salidas = [];
  K.onSalida = (p) => salidas.push(p);
  try {
    K.enContexto(true);
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    assert.ok(K.enMesa.has("Vadarya Prime Receiver"));
    K.reset();
    assert.ok(K.enMesa.has("Vadarya Prime Receiver"));
    assert.equal(salidas.length, 0);
    K.enContexto(true);
    K.enContexto(false);
    assert.ok(K.enMesa.has("Vadarya Prime Receiver"));
    assert.equal(salidas.length, 0);
    K.enContexto(false);
    assert.equal(K.enMesa.size, 0);
    assert.deepEqual(salidas, [["Vadarya Prime Receiver"]]);
  } finally {
    ocr?.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.onSalida = null;
    K.reset();
    K.vendiendo = null;
    K.enMesa.clear();
  }
});

test("tras un reset por cambio de contexto, dos frames fuera también vacían la mesa; con la mesa vacía no se avisa", () => {
  K.reset();
  K.vendiendo = null;
  K.enMesa.clear();
  const salidas = [];
  K.onSalida = (p) => salidas.push(p);
  try {
    K.enContexto(false);
    K.enContexto(false);
    assert.equal(salidas.length, 0);
    K.enMesa.add("Vadarya Prime Receiver");
    K.enContexto(true);
    K.reset();
    assert.equal(K.enKiosco, false);
    K.enContexto(false);
    assert.ok(K.enMesa.has("Vadarya Prime Receiver"));
    assert.equal(salidas.length, 0);
    K.enContexto(false);
    assert.equal(K.enMesa.size, 0);
    assert.deepEqual(salidas, [["Vadarya Prime Receiver"]]);
  } finally {
    K.onSale = null;
    K.onPanel = null;
    K.onSalida = null;
    K.reset();
    K.vendiendo = null;
    K.enMesa.clear();
  }
});

test("al salir del kiosko, live_scanner borra los votos y la sesión de las piezas de la mesa y no los de otras", async () => {
  K.reset();
  K.vendiendo = null;
  K.enMesa.clear();
  const { ScannerService: S } = await import("../deploy/js/services/scanner/scanner.service.js");
  await import("../deploy/js/scanner/live_scanner.js");
  const origSessionInventory = S.sessionInventory;
  const origQtyVotes = S.qtyVotes;
  try {
    S.sessionInventory = new Map([["Vadarya Prime Receiver", 5], ["Nikana Prime Blade", 2]]);
    S.qtyVotes = new Map([["Vadarya Prime Receiver", new Map([[5, 2]])], ["Nikana Prime Blade", new Map([[2, 1]])]]);
    K.enMesa.add("Vadarya Prime Receiver");
    K.enContexto(true);
    K.enContexto(false);
    assert.ok(S.sessionInventory.has("Vadarya Prime Receiver"));
    K.enContexto(false);
    assert.ok(!S.sessionInventory.has("Vadarya Prime Receiver"));
    assert.ok(!S.qtyVotes.has("Vadarya Prime Receiver"));
    assert.equal(S.sessionInventory.get("Nikana Prime Blade"), 2);
    assert.equal(S.qtyVotes.get("Nikana Prime Blade").get(2), 1);
  } finally {
    S.sessionInventory = origSessionInventory;
    S.qtyVotes = origQtyVotes;
    K.onSale = null;
    K.onPanel = null;
    K.onSalida = null;
    K.reset();
    K.vendiendo = null;
    K.enMesa.clear();
  }
});

test("parar la sesión vacía la mesa", async () => {
  K.reset();
  K.vendiendo = null;
  K.enMesa.clear();
  const { stopLiveSession } = await import("../deploy/js/scanner/live_scanner.js");
  try {
    K.enMesa.add("Vadarya Prime Receiver");
    stopLiveSession();
    assert.equal(K.enMesa.size, 0);
  } finally {
    K.onSale = null;
    K.onPanel = null;
    K.onSalida = null;
    K.reset();
    K.vendiendo = null;
    K.enMesa.clear();
  }
});

test("noVota protege las piezas de una instantánea pendiente aunque la mesa esté vacía", () => {
  K.reset();
  K.vendiendo = null;
  K.enMesa.clear();
  const origNow = Date.now;
  let ahora = 1_000_000;
  Date.now = () => ahora;
  try {
    K.vendiendo = { lista: [{ name: "Vadarya Prime Receiver", qty: 2, ducats: 90 }], t: 1_000_000, vista: true };
    assert.equal(K.enMesa.size, 0);
    assert.equal(K.noVota("Vadarya Prime Receiver"), true);
    ahora = 1_000_000 + 29_999;
    assert.equal(K.noVota("Vadarya Prime Receiver"), true);
    assert.equal(K.noVota("Zylok Prime Barrel"), false);
    ahora = 1_000_000 + 30_001;
    assert.equal(K.noVota("Vadarya Prime Receiver"), false);
    ahora = 1_000_000;
    K.vendiendo = { lista: [{ name: "Vadarya Prime Receiver", qty: 2, ducats: 90 }], t: 1_000_000, vista: true, descontada: true };
    assert.equal(K.noVota("Vadarya Prime Receiver"), false);
  } finally {
    Date.now = origNow;
    K.reset();
    K.vendiendo = null;
    K.enMesa.clear();
  }
});

test("con el log leyendo, una lista cancelada y otra pieza con los mismos ducados en el panel: el log no descuenta la cancelada", async () => {
  const ocr = conOcr([
    "", "1 X Vadarya Prime Receiver 45", "1,480 9",
    VENDER_45,
    "", "1 X Vadarya Prime Receiver 45", "1,480 9",
    "", "1 X Zylok Prime Barrel 45", "1,480 9",
  ]);
  OCRService.getValidItemMatch = (p) => { const s = p.join(" "); return s.includes("Vadarya") ? { originalName: "Vadarya Prime Receiver" } : s.includes("Zylok") ? { originalName: "Zylok Prime Barrel" } : null; };
  const origItems = state.itemsDatabase;
  const origDucats = state.ducatsDatabase;
  const origLogLeyendo = pistasDelLog.logLeyendo;
  state.itemsDatabase = {};
  state.ducatsDatabase = {};
  pistasDelLog.logLeyendo = () => true;
  const ventas = [];
  K.onSale = (v) => ventas.push(v);
  K.reset();
  K.vendiendo = null;
  K.enMesa.clear();
  K.enContexto(true);
  try {
    await K.process(video(40), "INVENTORY/DUCAT KIOSK");
    await K.process(video(20), "INVENTORY/DUCAT KIOSK");
    assert.deepEqual(K.vendiendo?.lista, [A]);
    assert.equal(K.vendiendo?.vista, undefined);
    await K.process(video(60), "INVENTORY/DUCAT KIOSK");
    assert.equal(K.vendiendo?.veces, 1);
    await K.process(video(80), "INVENTORY/DUCAT KIOSK");
    assert.equal(K.vendiendo, null);
    K.confirmaPorLog({ piezas: 1, ducados: 45 });
    assert.equal(ventas.length, 0);
    assert.equal(K.vendiendo, null);
  } finally {
    state.itemsDatabase = origItems;
    state.ducatsDatabase = origDucats;
    pistasDelLog.logLeyendo = origLogLeyendo;
    ocr.restaura();
    K.onSale = null;
    K.onPanel = null;
    K.reset();
    K.vendiendo = null;
    K.enMesa.clear();
  }
});
