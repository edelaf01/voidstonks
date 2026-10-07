import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.document ??= { createElement: () => ({ getContext: () => null }) };

const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { readCellCuttingArt } = await import("../deploy/js/services/scanner/name_color.service.js");

function lienzoFalso(alto) {
  const rellenos = [];
  return {
    width: 300, height: alto, rellenos,
    getContext: () => ({ set fillStyle(v) { this._f = v; }, fillRect: (x, y, w, h) => rellenos.push([x, y, w, h]) }),
  };
}

test("corta por arriba en franjas crecientes y para en la primera que casa", async () => {
  const recortes = [];
  const origCrop = VisionService.cropThemeBinarized, origRead = OCRService.extractCellText;
  const origRelic = OCRService.getRelicMatch, origItem = OCRService.getValidItemMatch;
  try {
    VisionService.cropThemeBinarized = () => { const c = lienzoFalso(400); recortes.push(c); return c; };
    OCRService.extractCellText = async (_w, cvs) => (cvs.rellenos[0][3] >= 100 ? ["NEZHA", "PRIME", "NEUROPTICS", "BLUEPRINT"] : ["V", "LV", "WER", "ARIN", "NEUROPTICS", "BLUEPRINT"]);
    OCRService.getRelicMatch = () => null;
    OCRService.getValidItemMatch = (ws) => (ws[0] === "NEZHA" ? { originalName: "Nezha Prime Neuroptics Blueprint" } : null);

    const r = await readCellCuttingArt({}, {}, { sx: 0, sy: 0 }, 277, 148, 142, null, null, () => true);

    assert.equal(r.bestItem.originalName, "Nezha Prime Neuroptics Blueprint");
    assert.equal(r.corte, 0.25);
    assert.deepEqual(r.words, ["NEZHA", "PRIME", "NEUROPTICS", "BLUEPRINT"]);
    assert.equal(recortes.length, 2);
    assert.deepEqual(recortes.map((c) => c.rellenos[0]), [[0, 0, 300, 60], [0, 0, 300, 100]]);
  } finally {
    VisionService.cropThemeBinarized = origCrop; OCRService.extractCellText = origRead;
    OCRService.getRelicMatch = origRelic; OCRService.getValidItemMatch = origItem;
  }
});

test("si ningún corte da un nombre devuelve null tras los tres intentos", async () => {
  const origCrop = VisionService.cropThemeBinarized, origRead = OCRService.extractCellText;
  const origRelic = OCRService.getRelicMatch, origItem = OCRService.getValidItemMatch;
  let intentos = 0;
  try {
    VisionService.cropThemeBinarized = () => lienzoFalso(400);
    OCRService.extractCellText = async () => { intentos++; return ["XX", "QZ"]; };
    OCRService.getRelicMatch = () => null;
    OCRService.getValidItemMatch = () => null;
    assert.equal(await readCellCuttingArt({}, {}, { sx: 0, sy: 0 }, 277, 148, 142, null, null, () => true), null);
    assert.equal(intentos, 3);
  } finally {
    VisionService.cropThemeBinarized = origCrop; OCRService.extractCellText = origRead;
    OCRService.getRelicMatch = origRelic; OCRService.getValidItemMatch = origItem;
  }
});

test("con reconoce delega el veredicto y salta las primes (éxito)", async () => {
  const origCrop = VisionService.cropThemeBinarized, origRead = OCRService.extractCellText;
  try {
    VisionService.cropThemeBinarized = () => lienzoFalso(400);
    OCRService.extractCellText = async () => ["ARCANO", "CUALQUIERA"];
    const r = await readCellCuttingArt({}, {}, {}, 0, 0, 0, null, null, () => true, (ws) => ws[0] === "ARCANO");
    assert.equal(r.relicMatch, null);
    assert.equal(r.bestItem, null);
    assert.equal(r.corte, 0.15);
    assert.deepEqual(r.words, ["ARCANO", "CUALQUIERA"]);
  } finally {
    VisionService.cropThemeBinarized = origCrop; OCRService.extractCellText = origRead;
  }
});

test("con reconoce si nunca acepta devuelve null", async () => {
  const origCrop = VisionService.cropThemeBinarized, origRead = OCRService.extractCellText;
  let intentos = 0;
  try {
    VisionService.cropThemeBinarized = () => lienzoFalso(400);
    OCRService.extractCellText = async () => { intentos++; return ["BASURA"]; };
    const r = await readCellCuttingArt({}, {}, {}, 0, 0, 0, null, null, () => true, () => false);
    assert.equal(r, null);
    assert.equal(intentos, 3);
  } finally {
    VisionService.cropThemeBinarized = origCrop; OCRService.extractCellText = origRead;
  }
});

test("una lectura ilegible no se intenta casar", async () => {
  const origCrop = VisionService.cropThemeBinarized, origRead = OCRService.extractCellText, origItem = OCRService.getValidItemMatch;
  let casados = 0;
  try {
    VisionService.cropThemeBinarized = () => lienzoFalso(400);
    OCRService.extractCellText = async () => ["V", "LV", "WER"];
    OCRService.getValidItemMatch = () => { casados++; return null; };
    await readCellCuttingArt({}, {}, { sx: 0, sy: 0 }, 277, 148, 142, null, null, () => false);
    assert.equal(casados, 0);
  } finally {
    VisionService.cropThemeBinarized = origCrop; OCRService.extractCellText = origRead; OCRService.getValidItemMatch = origItem;
  }
});
