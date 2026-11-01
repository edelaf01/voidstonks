import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installFakeDocument, FakeCanvas, canvasLiso, fakeCanvas } from "./_helpers/fake-canvas.mjs";
import { decodePng } from "./_helpers/png.mjs";
import { FRANJA_CATEGORIA_VIDEO, FRANJA_BUSQUEDA_VIDEO } from "../deploy/js/utils/vision/context_latch.js";

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

const casos = [
  ["—— BAVOID RELICS/REFINEMENT ©).", "RELICS"],
  ["—— BVOID RELIGS/REFINEMENT ©:", "RELICS"],
  ["BOLD RELICS/REFINENENT®:.", "RELICS"],
  ["VOID RELICS/REFINEMENT >:", "RELICS"],
  ["BESVOND RELICS REFINEMENTS", "RELICS"],
  ["PA VOID RELICS/REFINEMENT", "RELICS"],
  ["B5VOID RELICSREFINEMENT", "RELICS"],
  ["Bim © #V 010 AISSURE/REWARDS", "REWARD"],
  ["PARi@ VOID FISSURE/REWARDS", "REWARD"],
  ["PI@ B11) FSS URE/REWARDS?", "REWARD"],
  ["Mi% VRBVOID FISSURE/REWARDS", "REWARD"],
  ["PAW Pr mV ND FISSURE/REWARDS", "REWARD"],
  ["PAAR VOID FISSURE/REWARDS", "REWARD"],
  ["BE PV 01D FISSURE/REWARDS", "REWARD"],
  ["RE/REWARDS", "REWARD"],
  ["LE/ REWARDS", "REWARD"],
  ["NE/REWARDS :", "REWARD"],
  ["ZONE 3 REACHED", "MISSION_COMPLETE"],
  ["TRADING POST", "TRADE"],
  ["| + TRADING POST 0 :", "TRADE"],
  ["ITEM DETAILS\nRifle Riven Mod", "RIVEN_DETAILS"],
  ["+ ITEM DETAILS ©:\nRifle Riven Mod", "RIVEN_DETAILS"],
  ["ITEM DETAILS\nMod Agrietado de Rifle", "RIVEN_DETAILS"],
  ["ITEM DETAILS\nRhino Prime", "ITEM_DETAILS"],
  ["BE ARCANE DISSOLUTION", "ARCANE_DISSOLUTION"],
  ["BARCANE DISSOLUTION", "ARCANE_DISSOLUTION"],
  ["ARCANE DISSOLUTION", "ARCANE_DISSOLUTION"],
  ["BX MODSRIVEN SPLICING", "RIVEN_SPLICING"],
  ["MODS/RIVEN SPL1CING", "RIVEN_SPLICING"],
  ["UPGRADES", "UPGRADES"],
  ["UPGRADE", "UPGRADES"],
  ["MEJORAS", "UPGRADES"],
  ["UPGRADE MODS", "UPGRADES"],
  ["INVENTORY/MODS", "INVENTORY_MODS"],
];

for (const [texto, esperado] of casos) {
  test(`"${texto}" -> ${esperado}`, () => {
    assert.equal(VisionService.determineContext(texto.toUpperCase()), esperado);
  });
}

for (const texto of ["iS VOID FISSURES", "3 VOID FISSURES", "VOID FISSURES"]) {
  test(`la lista de fisuras no se escanea: "${texto}"`, () => {
    assert.equal(VisionService.determineContext(texto.toUpperCase()), "UNKNOWN");
  });
}

for (const texto of ["upgrades", "upgrade", "mejoras"]) {
  test(`determineContext insensible a mayúsculas: "${texto}"`, () => {
    assert.equal(VisionService.determineContext(texto), "UPGRADES");
  });
}

const video = (w, h, rgb) => Object.assign(canvasLiso(w, h, rgb), { videoWidth: w, videoHeight: h });

test("el recorte de cabecera conserva su backing store si la resolución no cambia", () => {
  const cvs = new FakeCanvas(10, 10);
  VisionService.prepareVirtualCanvas(video(1920, 1080, [255, 255, 255]), cvs);
  assert.deepEqual([cvs.width, cvs.height], [864, 129]);
  const buffer = cvs.data;
  VisionService.prepareVirtualCanvas(video(1920, 1080, [0, 0, 0]), cvs);
  assert.equal(cvs.data, buffer, "misma resolución: se reasignó width/height");
  assert.deepEqual(cvs.px(863, 128), [0, 0, 0, 255], "el drawImage sigue cubriendo el lienzo entero");
});

test("el recorte de cabecera se redimensiona al cambiar la resolución del vídeo", () => {
  const cvs = new FakeCanvas(10, 10);
  VisionService.prepareVirtualCanvas(video(1920, 1080, [255, 255, 255]), cvs);
  const buffer = cvs.data;
  VisionService.prepareVirtualCanvas(video(2560, 1080, [255, 255, 255]), cvs);
  assert.deepEqual([cvs.width, cvs.height], [1152, 129]);
  assert.notEqual(cvs.data, buffer);
});

const { leeCategoriaInventario, leeBusquedaInventario } = await import("../deploy/js/services/scanner/header_read.service.js");
const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");

test("leeCategoriaInventario lee y memoiza con la misma franja", async () => {
  const v = video(1920, 1080, [100, 100, 100]);
  const escaner = {};

  let ocrLlamadas = 0;
  const originalRecognize = OCRRepository.recognize;
  OCRRepository.recognize = async () => {
    ocrLlamadas++;
    return { data: { text: "arcanes" } };
  };

  try {
    const r1 = await leeCategoriaInventario(escaner, v, null);
    assert.equal(r1, "ARCANES");
    assert.equal(ocrLlamadas, 1);
    assert.ok(escaner._categoriaHash);

    const r2 = await leeCategoriaInventario(escaner, v, null);
    assert.equal(r2, "ARCANES");
    assert.equal(ocrLlamadas, 1, "No debería volver a hacer OCR si el hash no cambia");
  } finally {
    OCRRepository.recognize = originalRecognize;
  }
});

test("la franja de categoría cubre el rótulo ARCANES entero", () => {
  const img = decodePng(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "_fixtures/inventory_arcanes_1920x1080.png")));
  const { x, y, w, h } = FRANJA_CATEGORIA_VIDEO;
  const [x0, x1] = [Math.round(x * img.width), Math.round((x + w) * img.width)];
  const [y0, y1] = [Math.round(y * img.height), Math.round((y + h) * img.height)];
  const tinta = [];
  for (let yy = y0; yy < y1; yy++) {
    let n = 0;
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * img.width + xx) * 4;
      if (0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2] > 140) n++;
    }
    tinta.push(n);
  }
  assert.ok(tinta.filter((n) => n > 0).length >= 12, `filas con texto: ${tinta.join(",")}`);
  assert.equal(tinta[0], 0);
  assert.equal(tinta.at(-1), 0);
});

const MANCHA = [0.585, 0.620, 0.140, 0.158];
const cuadroBusqueda = (rects = [], w = 960, h = 540, video = true) => {
  const c = fakeCanvas(w, h, (x, y) => {
    const fx = x / w, fy = y / h;
    return rects.some(([x0, x1, y0, y1]) => fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1) ? [240, 230, 180] : [20, 20, 20];
  });
  return video ? Object.assign(c, { videoWidth: w, videoHeight: h }) : c;
};

const conOcrDeBusqueda = async (fn) => {
  const ocr = { llamadas: 0, psm: null };
  const original = OCRRepository.recognizeWithPSM;
  OCRRepository.recognizeWithPSM = async (_w, _l, psm) => {
    ocr.llamadas++;
    ocr.psm = psm;
    return { data: { text: "bronco|" } };
  };
  try {
    await fn(ocr);
  } finally {
    OCRRepository.recognizeWithPSM = original;
  }
};

test("leeBusquedaInventario: fotograma oscuro devuelve vacío sin OCR", () => conOcrDeBusqueda(async (ocr) => {
  assert.equal(await leeBusquedaInventario({}, cuadroBusqueda(), null), "");
  assert.equal(ocr.llamadas, 0);
}));

test("leeBusquedaInventario: texto dentro de la franja pasa por OCR de una línea", () => conOcrDeBusqueda(async (ocr) => {
  assert.equal(await leeBusquedaInventario({}, cuadroBusqueda([MANCHA]), null), "bronco|");
  assert.equal(ocr.llamadas, 1);
  assert.equal(ocr.psm, 7);
}));

test("leeBusquedaInventario: texto que llega al borde derecho no se lee", () => conOcrDeBusqueda(async (ocr) => {
  const fin = FRANJA_BUSQUEDA_VIDEO.x + FRANJA_BUSQUEDA_VIDEO.w;
  assert.equal(await leeBusquedaInventario({}, cuadroBusqueda([[0.585, fin, 0.140, 0.158]]), null), "");
  assert.equal(ocr.llamadas, 0);
}));

test("leeBusquedaInventario: el aspa de borrar y la lupa quedan fuera de la franja", () => conOcrDeBusqueda(async (ocr) => {
  assert.equal(await leeBusquedaInventario({}, cuadroBusqueda([[0.687, 0.697, 0.140, 0.158], [0.55, 0.70, 0.165, 0.168]]), null), "");
  assert.equal(ocr.llamadas, 0);
}));

test("leeBusquedaInventario: el subrayado solo no cuenta como texto", () => conOcrDeBusqueda(async (ocr) => {
  assert.equal(await leeBusquedaInventario({}, cuadroBusqueda([[0.55, 0.70, 0.165, 0.168]]), null), "");
  assert.equal(ocr.llamadas, 0);
}));

test("leeBusquedaInventario: acepta un canvas sin videoWidth ni videoHeight", () => conOcrDeBusqueda(async (ocr) => {
  assert.equal(await leeBusquedaInventario({}, cuadroBusqueda([MANCHA], 960, 540, false), null), "bronco|");
  assert.equal(ocr.llamadas, 1);
  assert.equal(ocr.psm, 7);
}));

test("leeBusquedaInventario: memoiza con la misma franja y relee si cambia", () => conOcrDeBusqueda(async (ocr) => {
  const escaner = {};
  const v1 = cuadroBusqueda([MANCHA]);
  assert.equal(await leeBusquedaInventario(escaner, v1, null), "bronco|");
  assert.equal(await leeBusquedaInventario(escaner, v1, null), "bronco|");
  assert.equal(ocr.llamadas, 1);
  const v2 = cuadroBusqueda([[0.600, 0.640, 0.140, 0.158]]);
  assert.equal(await leeBusquedaInventario(escaner, v2, null), "bronco|");
  assert.equal(ocr.llamadas, 2);
}));

test("leeBusquedaInventario: fuente sin tamaño devuelve vacío sin OCR", () => conOcrDeBusqueda(async (ocr) => {
  for (const f of [{ videoWidth: 0, videoHeight: 540 }, { videoWidth: 960, videoHeight: 0 }, { width: 0, height: 540 }, { width: 960, height: 0 }]) {
    assert.equal(await leeBusquedaInventario({}, f, null), "");
  }
  assert.equal(ocr.llamadas, 0);
}));
