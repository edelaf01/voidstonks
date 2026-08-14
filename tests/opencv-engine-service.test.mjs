// La parte del motor de visión que es JS puro, sin OpenCV.
//
// `detectAccentColor` y `binarizeNearColor` corren SIEMPRE (con o sin OpenCV cargado) y son las
// que deciden si el texto llega legible al OCR. Su fallo no da error: el escáner devuelve
// celdas vacías o basura, y desde fuera parece que "no lee bien hoy".
//
// El caso que motivó la mitad de estos tests: el color del texto no es el del tema, es el que
// llega a la cámara/captura después del bloom, el glow y el balance de blancos. Por eso se
// detecta votando contra la paleta y devolviendo el PROMEDIO real de los píxeles ganadores, no
// el color canónico del tema.
//
// El resto de métodos (los que llaman a `cv.*`) se comprueban solo en su guarda de "OpenCV no
// está listo": probar la binarización HSV de verdad necesita OpenCV compilado, y eso se mide
// contra capturas reales, no aquí.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeCanvas, canvasLiso } from "./_helpers/fake-canvas.mjs";

const { OpenCVEngine: E } = await import("../deploy/js/services/scanner/opencv_engine.service.js");

const DORADO = [232, 213, 93];   // tema Orokin por defecto
const CIAN = [111, 229, 253];

// --- Detección del color de acento ----------------------------------------------------------

test("un texto dorado sobre fondo oscuro se detecta como dorado", () => {
  // Franja de texto en el centro, fondo oscuro: es la forma de una celda del inventario.
  const c = fakeCanvas(40, 40, (x, y) => (y > 15 && y < 25 ? DORADO : [10, 10, 12]));
  const [r, g, b] = E.detectAccentColor(c);
  assert.ok(Math.abs(r - 232) < 20 && Math.abs(g - 213) < 20 && Math.abs(b - 93) < 20,
    `detectó ${[r, g, b]}`);
});

test("otro tema se detecta como ese tema, no como el dorado por defecto", () => {
  const c = fakeCanvas(40, 40, (x, y) => (y > 15 && y < 25 ? CIAN : [10, 10, 12]));
  const [r, g, b] = E.detectAccentColor(c);
  assert.ok(b > r, `el cian tiene más azul que rojo; salió ${[r, g, b]}`);
});

// Devuelve el PROMEDIO de los píxeles que votaron al tema ganador, no el color canónico: eso es
// lo que captura el desvío de la captura (bloom, glow, balance de blancos de la cámara).
test("devuelve el color medido, no el canónico del tema", () => {
  const DESVIADO = [200, 185, 80];
  const c = fakeCanvas(40, 40, (x, y) => (y > 15 && y < 25 ? DESVIADO : [10, 10, 12]));
  assert.deepEqual(E.detectAccentColor(c), DESVIADO);
});

// Los píxeles oscuros son fondo y no votan: si contaran, el promedio se iría al negro y la
// binarización posterior borraría el texto.
test("el fondo oscuro no arrastra el color detectado", () => {
  const conMuchoFondo = fakeCanvas(80, 80, (x, y) => (y > 38 && y < 42 ? DORADO : [5, 5, 6]));
  const [r, g, b] = E.detectAccentColor(conMuchoFondo);
  assert.ok(r > 150 && g > 150, `el fondo se comió el color: ${[r, g, b]}`);
});

// Sin texto no se inventa un color: quien llama cae a la calibración manual o al tema guardado.
test("una imagen sin texto brillante devuelve null", () => {
  assert.equal(E.detectAccentColor(canvasLiso(20, 20, [8, 8, 10])), null);
});

test("un canvas inexistente o vacío no revienta", () => {
  assert.equal(E.detectAccentColor(null), null);
  assert.equal(E.detectAccentColor({ width: 0, height: 0 }), null);
  assert.equal(E.detectAccentColor({ width: 10, height: 0 }), null);
});

// --- Binarización por cercanía --------------------------------------------------------------

test("el texto del color buscado queda negro y el resto blanco", () => {
  const c = fakeCanvas(10, 10, (x, y) => (y === 5 ? DORADO : [10, 10, 12]));
  E.binarizeNearColor(c, DORADO, 2500);

  assert.deepEqual(c.px(3, 5).slice(0, 3), [0, 0, 0], "el texto va en negro (lo que mejor lee Tesseract)");
  assert.deepEqual(c.px(3, 0).slice(0, 3), [255, 255, 255], "el fondo, en blanco");
});

// La tolerancia es distancia² en RGB: con la captura desviada por el bloom, un umbral corto deja
// el texto en blanco (o sea, lo borra) y el OCR devuelve la celda vacía.
test("la tolerancia decide cuánto desvío se sigue considerando el mismo color", () => {
  const CASI = [232 - 20, 213 - 20, 93 - 20];   // distancia² = 1200

  const holgado = fakeCanvas(4, 4, () => CASI);
  E.binarizeNearColor(holgado, DORADO, 2500);
  assert.deepEqual(holgado.px(0, 0).slice(0, 3), [0, 0, 0], "con 2500 de tolerancia entra");

  const estricto = fakeCanvas(4, 4, () => CASI);
  E.binarizeNearColor(estricto, DORADO, 500);
  assert.deepEqual(estricto.px(0, 0).slice(0, 3), [255, 255, 255], "con 500 se queda fuera");
});

test("el resultado es siempre blanco o negro puros, sin grises", () => {
  const c = fakeCanvas(8, 8, (x, y) => [x * 30, y * 30, 128]);
  E.binarizeNearColor(c, DORADO, 2500);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const [r, g, b] = c.px(x, y);
      assert.ok((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255),
        `(${x},${y}) = ${[r, g, b]}`);
    }
  }
});

test("sin color de referencia no se toca la imagen", () => {
  const c = fakeCanvas(4, 4, () => DORADO);
  E.binarizeNearColor(c, null, 2500);
  assert.deepEqual(c.px(0, 0).slice(0, 3), DORADO);
  assert.doesNotThrow(() => E.binarizeNearColor(null, DORADO, 2500));
});

// --- La paleta ------------------------------------------------------------------------------

// El live scanner publica los temas medidos de la partida real; el fallback embebido solo entra
// si aún no ha corrido.
test("la paleta viene del live scanner cuando existe, y si no del fallback", () => {
  const antes = globalThis._WF_THEMES;
  try {
    delete globalThis._WF_THEMES;
    const fallback = E.WF_PALETTE();
    assert.ok(fallback.length > 5, "el fallback tiene que traer los temas del juego");
    for (const t of fallback) {
      for (const k of ["r", "g", "b"]) {
        assert.ok(t[k] >= 0 && t[k] <= 255, `${k}=${t[k]} fuera de rango`);
      }
    }

    globalThis._WF_THEMES = [{ r: 1, g: 2, b: 3 }];
    assert.deepEqual(E.WF_PALETTE(), [{ r: 1, g: 2, b: 3 }]);
  } finally {
    if (antes === undefined) delete globalThis._WF_THEMES; else globalThis._WF_THEMES = antes;
  }
});

// --- Las guardas de "OpenCV no está listo" --------------------------------------------------

// El escáner llama a estos métodos ANTES de que OpenCV termine de cargar (son 8 MB de wasm por
// CDN). Sin las guardas, cada frame de ese rato tira una excepción por `cv is not defined`.
test("sin OpenCV cargado, los métodos que lo necesitan no explotan", () => {
  const antes = E.isReady;
  E.isReady = false;
  try {
    const c = canvasLiso(10, 10, DORADO);
    assert.doesNotThrow(() => E.processForOCR(c));
    assert.doesNotThrow(() => E.isolateAccentText(c));
    assert.equal(E.glareLevel(c), 0, "sin datos, 0 de reflejo: no bloquea el escaneo");
    assert.equal(E.sampleTextColor(c, 0, 0, 5, 5), null);
    assert.equal(E.sharpness(c), 0);
  } finally { E.isReady = antes; }
});
