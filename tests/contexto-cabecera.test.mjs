// ¿Qué pantalla cree el escáner que ve, a partir del texto que el OCR saca de la cabecera?
//
// Las cadenas de abajo NO son inventadas: son las que Tesseract devolvió sobre las capturas del
// corpus (tests/corpus-contexto.test.mjs las produce ejecutando la cascada real) y las que
// aparecieron en logs del usuario en vivo. Este fichero fija esas decisiones sin necesitar las
// imágenes, que viven fuera del repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas, canvasLiso } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

const casos = [
  // VOID RELICS/REFINEMENT, siete temas distintos.
  ["—— BAVOID RELICS/REFINEMENT ©).", "RELICS"],
  ["—— BVOID RELIGS/REFINEMENT ©:", "RELICS"],
  ["BOLD RELICS/REFINENENT®:.", "RELICS"],
  ["VOID RELICS/REFINEMENT >:", "RELICS"],
  ["BESVOND RELICS REFINEMENTS", "RELICS"],
  ["PA VOID RELICS/REFINEMENT", "RELICS"],
  ["B5VOID RELICSREFINEMENT", "RELICS"],
  // VOID FISSURE/REWARDS: la pantalla de elegir recompensa. Las siete del corpus.
  ["Bim © #V 010 AISSURE/REWARDS", "REWARD"],
  ["PARi@ VOID FISSURE/REWARDS", "REWARD"],
  ["PI@ B11) FSS URE/REWARDS?", "REWARD"],
  ["Mi% VRBVOID FISSURE/REWARDS", "REWARD"],
  ["PAW Pr mV ND FISSURE/REWARDS", "REWARD"],
  ["PAAR VOID FISSURE/REWARDS", "REWARD"],
  ["BE PV 01D FISSURE/REWARDS", "REWARD"],
  // ...y el título centrado, que es el segundo intento de la cascada.
  ["RE/REWARDS", "REWARD"],
  ["LE/ REWARDS", "REWARD"],
  ["NE/REWARDS :", "REWARD"],
  // Fin de Sanctuary Onslaught: título centrado de una captura del usuario (zona 3).
  ["ZONE 3 REACHED", "MISSION_COMPLETE"],
];

for (const [texto, esperado] of casos) {
  test(`"${texto}" -> ${esperado}`, () => {
    assert.equal(VisionService.determineContext(texto.toUpperCase()), esperado);
  });
}

// La LISTA DE FISURAS del mapa estelar no es nada que escanear. Llevaba "VOID" y "FISSURES",
// que estaban sueltos en el regex de REWARD, así que se trataba como pantalla de recompensa:
// nueve pasadas de OCR por frame para leer cero ítems, y de ahí el "todo va más lento".
for (const texto of ["iS VOID FISSURES", "3 VOID FISSURES", "VOID FISSURES"]) {
  test(`la lista de fisuras no se escanea: "${texto}"`, () => {
    assert.equal(VisionService.determineContext(texto.toUpperCase()), "UNKNOWN");
  });
}

// El recorte de cabecera se prepara en cada tick del bucle; asignar width/height realoca el
// backing store aunque el valor no cambie (FakeCanvas imita eso: `data` es otro búfer).
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

// Cualquier 16:9 se normaliza a 864×129 (el alto se lleva a 1080): hace falta otro formato.
test("el recorte de cabecera se redimensiona al cambiar la resolución del vídeo", () => {
  const cvs = new FakeCanvas(10, 10);
  VisionService.prepareVirtualCanvas(video(1920, 1080, [255, 255, 255]), cvs);
  const buffer = cvs.data;
  VisionService.prepareVirtualCanvas(video(2560, 1080, [255, 255, 255]), cvs);
  assert.deepEqual([cvs.width, cvs.height], [1152, 129]);
  assert.notEqual(cvs.data, buffer);
});
