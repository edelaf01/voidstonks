import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

// ===========================================================================
// Preprocesado del recorte que va al OCR (VisionService.prepareCropForOCR).
//
// Lo que se protege aquí es por qué NO se usa `filter: grayscale(100%)`: sus pesos de
// luminancia (0.2126·R) hunden el rojo puro hasta ~54 de 255, y con el tema rojo del juego
// el texto de VOID RELICS/REFINEMENT quedaba pegado a su propio fondo — Tesseract sacaba
// CERO nombres y CERO contadores de la captura del usuario. Con el canal máximo, 17 y 19.
//
// El invariante: un texto SATURADO sobre un fondo del mismo tono tiene que salir separado.
// ===========================================================================

installFakeDocument(); // antes del import: vision.service.js crea canvases al cargarse
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { maxChannelInvert } = await import("../deploy/js/utils/vision/channel_max.js");

/** Frame de mentira con el aspecto de un canvas de vídeo: fondo liso y una franja de "texto". */
function frame({ fondo, texto, w = 40, h = 20 }) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = y >= 8 && y < 12 ? texto : fondo;
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { videoWidth: w, videoHeight: h, width: w, height: h, data };
}

const TODO = { x: 0, y: 0, w: 1, h: 1 };
const gris = (cvs, x, y) => cvs.getContext("2d").getImageData(x, y, 1, 1).data[0];

// Muestrea en el centro del canvas de salida: la fila 8-12 de 20 cae en la mitad vertical.
function separacion(video, clave) {
  const cvs = VisionService.prepareCropForOCR(video, TODO, 1, clave);
  const medio = Math.floor(cvs.height / 2);
  return Math.abs(gris(cvs, Math.floor(cvs.width / 2), medio) - gris(cvs, Math.floor(cvs.width / 2), 1));
}

test("tema rojo: el texto rojo puro se separa de su fondo rojo oscuro", () => {
  // Con pesos de luminancia esta pareja daba 54 vs 8 (46 de diferencia): al invertir y
  // umbralizar, indistinguibles. Por canal máximo son 255 vs 40.
  const sep = separacion(frame({ fondo: [40, 0, 0], texto: [255, 0, 0] }), "testRojo");
  assert.ok(sep > 180, `el texto rojo tiene que destacar; separación medida: ${sep}`);
});

test("tema naranja y tema claro siguen separándose", () => {
  const naranja = separacion(frame({ fondo: [20, 25, 35], texto: [253, 132, 2] }), "testNaranja");
  assert.ok(naranja > 180, `naranja sobre azul oscuro; separación: ${naranja}`);
  const claro = separacion(frame({ fondo: [30, 30, 30], texto: [255, 255, 255] }), "testClaro");
  assert.ok(claro > 180, `blanco sobre gris; separación: ${claro}`);
});

test("el texto sale OSCURO sobre fondo CLARO, que es lo que espera Tesseract", () => {
  const cvs = VisionService.prepareCropForOCR(frame({ fondo: [40, 0, 0], texto: [255, 0, 0] }), TODO, 1, "testInv");
  const medio = Math.floor(cvs.height / 2);
  assert.equal(gris(cvs, Math.floor(cvs.width / 2), medio), 0);     // 255 - max(255,0,0)
  assert.equal(gris(cvs, Math.floor(cvs.width / 2), 1), 215);       // 255 - max(40,0,0)
});

test("maxChannelInvert: cada píxel sale a 255 - max(R,G,B)", () => {
  const px = new Uint8ClampedArray([255, 0, 0, 255, 40, 0, 0, 255, 253, 132, 2, 255, 0, 0, 0, 255]);
  const img = { width: 4, height: 1, data: px };
  const ctx = { getImageData: () => img, putImageData() {} };
  maxChannelInvert(ctx, 4, 1);
  assert.deepEqual([px[0], px[4], px[8], px[12]], [0, 215, 2, 255]);
});
