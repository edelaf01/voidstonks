// which screen the scanner thinks it sees from the header OCR text
// the strings are real: what Tesseract returned on the corpus captures and what showed up in live user logs
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas, canvasLiso } from "./_helpers/fake-canvas.mjs";

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
