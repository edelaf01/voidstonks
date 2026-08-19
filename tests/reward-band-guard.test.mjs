import { test } from "node:test";
import assert from "node:assert/strict";
import { isImplausibleRewardBand, detectPlausibleRewardBand } from "../deploy/js/utils/vision/plausibility.js";

// Rechazo de bandas de recompensa imposibles. Los rects de abajo son los que devolvió
// detectRewardBand en vivo sobre un frame de 2560x1440: solo uno de ellos era la pantalla de
// recompensas, y aun así la banda que sacó era una mancha de la esquina — con ese recorte el
// escáner leía "a N A" y no encontraba ni un ítem.
//
// La referencia de una fila real es la geometría fija de prepareRewardOCRCanvas: 84 % del ancho
// y 25,5 % del alto, o sea ~2150x367 en este frame.

const W = 2560, H = 1440;

test("acepta la geometría fija con la que está calibrado el recorte", () => {
  const real = { w: Math.round(W * 0.84), h: Math.round(H * 0.255) };
  assert.equal(isImplausibleRewardBand(real, W, H), false);
});

// El caso que rompía el escaneo: pasaba el filtro de "1 card" y tapaba al recorte fijo.
test("rechaza la mancha de esquina que se colaba como una card", () => {
  assert.equal(isImplausibleRewardBand({ w: 319, h: 166 }, W, H), true);
});

test("rechaza lo que se enganchaba fuera de la pantalla de recompensas", () => {
  assert.equal(isImplausibleRewardBand({ w: 804, h: 437 }, W, H), true, "caja de chat");
  assert.equal(isImplausibleRewardBand({ w: 881, h: 749 }, W, H), true, "panel de progreso");
  assert.equal(isImplausibleRewardBand({ w: 1394, h: 693 }, W, H), true, "pantalla de carga");
});

test("rechaza la banda que se come media pantalla de alto", () => {
  assert.equal(isImplausibleRewardBand({ w: 2560, h: 971 }, W, H), true);
});

// Con esta banda el escáner leía "TheDeathstroke76 / PurpleCheetah / Steel Path Bonus /
// Target killed": los nombres de escuadra y el kill feed de la mitad inferior. Juntos tienen
// MÁS masa de texto que los nombres de ítem, y pickBest se queda con la de más masa.
test("rechaza la banda del HUD inferior (nombres de escuadra y kill feed)", () => {
  assert.equal(isImplausibleRewardBand({ y: 667, w: 2560, h: 773 }, W, H), true);
});

// La fila real empieza al 18,5 % y mide 25,5 %: su centro está al 31 %, muy lejos del corte.
test("acepta la fila real con su posición vertical", () => {
  const real = { y: Math.round(H * 0.185), w: Math.round(W * 0.84), h: Math.round(H * 0.255) };
  assert.equal(isImplausibleRewardBand(real, W, H), false);
});

// Medido sobre una captura REAL de 2560x1440 que sí se leyó (4 recompensas: Fang Prime
// Blueprint / Forma Blueprint / Euphona Prime Barrel / Quassus Prime Handle). Los demás cortes
// se dedujeron de bandas que FALLABAN; este es el único que fija una que funciona, así que es
// el que impide que endurecer los umbrales en el futuro deje de leer la pantalla buena.
//
// Nombres en y≈593 (41 % del alto) y texto de x≈666 a x≈1907 — o sea la mitad del ancho del
// frame, no el 84 % del recorte fijo. Aplicando el padding de detectRewardBand sobre una franja
// de texto de ~28px: y = 593-3*28 ≈ 496, h = 28+3*28+1.2*28 ≈ 146, x = 666-0.15*1241 ≈ 480,
// w = 1241+2*186 ≈ 1613.
test("acepta la fila medida en una captura real que se leyó bien", () => {
  const medida = { x: 480, y: 496, w: 1613, h: 146, cardCount: 4 };
  assert.equal(isImplausibleRewardBand(medida, W, H), false);

  // Y el margen con el que pasa cada corte, para que se vea cuánto hay antes de romperla.
  assert.ok(medida.w / W > 0.6, "ancho: 63 % del frame frente al corte del 25 %");
  assert.ok(medida.h / H < 0.11, "alto: 10 % del frame frente al techo del 35 %");
  assert.ok(medida.w / medida.h > 11, "proporción: 11:1 frente al mínimo de 2.5:1");
  assert.ok((medida.y + medida.h / 2) / H < 0.4, "centro al 39 % frente al corte del 70 %");
});

// El caso de webcam apuntando a un monitor: el juego ocupa una fracción del encuadre, así que la
// fila sale más pequeña en píxeles pero conserva la proporción. Es justo el escenario para el que
// se escribió detectRewardBand y no puede quedarse fuera.
test("acepta una fila proporcionada aunque el juego no llene el encuadre", () => {
  assert.equal(isImplausibleRewardBand({ w: 1100, h: 190 }, W, H), false);
});

// ---------------------------------------------------------------------------
// detectPlausibleRewardBand: el recorte se queda con el alto, nunca con el ancho
// ---------------------------------------------------------------------------

/** Frame sintético: fondo oscuro y una fila de nombres (rayado claro) en las X que se pidan. */
function frameConNombres({ width, height, y, alto, tramos }) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 28; data[i * 4 + 1] = 24; data[i * 4 + 2] = 32;
  }
  for (const [x0, x1] of tramos) {
    for (let yy = y; yy < y + alto; yy++) {
      // 3px encendidos / 2 apagados: el mismo patrón de trazo que usa el generador de
      // inventario, que es lo que produce la señal de bordes que busca la detección.
      for (let xx = x0; xx < x1; xx++) {
        if (xx % 5 >= 3) continue;
        const i = (yy * width + xx) * 4;
        data[i] = 240; data[i + 1] = 235; data[i + 2] = 220;
      }
    }
  }
  return { data, width, height };
}

// El caso que hacía leer UNA recompensa de cuatro: la señal de bordes solo engancha los nombres
// que caen sobre fondo limpio, y el rect que devuelve la detección los envuelve solo a ellos.
// Recortando por ahí, las recompensas no detectadas no llegan siquiera al OCR.
test("con nombres detectados solo en parte del frame, el recorte conserva el ancho completo", () => {
  const img = frameConNombres({
    width: 960, height: 540, y: 200, alto: 14,
    tramos: [[120, 260], [300, 440]], // dos nombres, ambos en la mitad izquierda
  });

  const rect = detectPlausibleRewardBand(img);
  assert.ok(rect, "la banda debería detectarse");
  assert.equal(rect.x, 0, "el recorte no puede empezar donde empieza el primer nombre");
  assert.equal(rect.w, 960, "las recompensas sin detectar quedarían fuera de la imagen");
  assert.ok(rect.y > 0 && rect.y < 200, `el alto sí sale de la detección (y=${rect.y})`);
  assert.ok(rect.h < 540 * 0.6, `y sigue siendo una banda, no media pantalla (h=${rect.h})`);
});

test("sin rect o sin dimensiones -> implausible", () => {
  assert.equal(isImplausibleRewardBand(null, W, H), true);
  assert.equal(isImplausibleRewardBand({}, W, H), true);
  assert.equal(isImplausibleRewardBand({ w: 0, h: 0 }, W, H), true);
  assert.equal(isImplausibleRewardBand({ w: 2150, h: 367 }, 0, 0), true);
});
