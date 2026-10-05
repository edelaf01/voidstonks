// which screen the scanner thinks it sees from the header OCR text
// the strings are real: what Tesseract returned on the corpus captures and what showed up in live user logs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installFakeDocument, FakeCanvas, canvasLiso } from "./_helpers/fake-canvas.mjs";
import { decodePng } from "./_helpers/png.mjs";
import { FRANJA_CATEGORIA_VIDEO } from "../deploy/js/utils/vision/context_latch.js";

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

const casos = [
  // VOID RELICS/REFINEMENT, seven themes
  ["—— BAVOID RELICS/REFINEMENT ©).", "RELICS"],
  ["—— BVOID RELIGS/REFINEMENT ©:", "RELICS"],
  ["BOLD RELICS/REFINENENT®:.", "RELICS"],
  ["VOID RELICS/REFINEMENT >:", "RELICS"],
  ["BESVOND RELICS REFINEMENTS", "RELICS"],
  ["PA VOID RELICS/REFINEMENT", "RELICS"],
  ["B5VOID RELICSREFINEMENT", "RELICS"],
  // VOID FISSURE/REWARDS, the reward pick screen; the seven in the corpus
  ["Bim © #V 010 AISSURE/REWARDS", "REWARD"],
  ["PARi@ VOID FISSURE/REWARDS", "REWARD"],
  ["PI@ B11) FSS URE/REWARDS?", "REWARD"],
  ["Mi% VRBVOID FISSURE/REWARDS", "REWARD"],
  ["PAW Pr mV ND FISSURE/REWARDS", "REWARD"],
  ["PAAR VOID FISSURE/REWARDS", "REWARD"],
  ["BE PV 01D FISSURE/REWARDS", "REWARD"],
  // ...and the centered title, the second attempt of the cascade
  ["RE/REWARDS", "REWARD"],
  ["LE/ REWARDS", "REWARD"],
  ["NE/REWARDS :", "REWARD"],
  // end of Sanctuary Onslaught: centered title from a user capture (zone 3)
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

// the header crop is prepared on every loop tick; setting width/height reallocates the backing store even with the same value
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

// any 16:9 normalizes to 864×129 (height taken to 1080), so another format is needed
test("el recorte de cabecera se redimensiona al cambiar la resolución del vídeo", () => {
  const cvs = new FakeCanvas(10, 10);
  VisionService.prepareVirtualCanvas(video(1920, 1080, [255, 255, 255]), cvs);
  const buffer = cvs.data;
  VisionService.prepareVirtualCanvas(video(2560, 1080, [255, 255, 255]), cvs);
  assert.deepEqual([cvs.width, cvs.height], [1152, 129]);
  assert.notEqual(cvs.data, buffer);
});

const { leeCategoriaInventario } = await import("../deploy/js/services/scanner/header_read.service.js");
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
