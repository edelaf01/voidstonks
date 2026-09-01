import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCardRow } from "../deploy/js/utils/vision/reward_cards.js";

function makeImage(w, h, fillLuma = 20) {
  const data = new Uint8ClampedArray(w * h * 4);
  data.fill(fillLuma);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width: w, height: h };
}

function drawRect(img, x, y, w, h, luma = 240) {
  for (let r = y; r < y + h; r++) {
    for (let c = x; c < x + w; c++) {
      const idx = (r * img.width + c) * 4;
      img.data[idx] = luma;
      img.data[idx + 1] = luma;
      img.data[idx + 2] = luma;
    }
  }
}

test("detecta una fila de 3 tarjetas brillantes sobre fondo oscuro", () => {
  const img = makeImage(1000, 500, 20);
  drawRect(img, 200, 100, 60, 90, 240);
  drawRect(img, 500, 100, 60, 90, 240);
  drawRect(img, 800, 100, 60, 90, 240);

  const res = detectCardRow(img);
  assert.deepEqual({ x: res.x, w: res.w, y: res.y, h: res.h, cardCount: res.cardCount }, {
    x: 0, w: 1000, y: 190, h: 126, cardCount: 3,
  });
  // Las columnas son las TARJETAS, no las manchas de arte: el arte va centrado y es estrecho
  // (aquí 60 px de un paso de 300), así que su caja dejaba el rótulo fuera de su propia
  // columna. El ancho sale del paso entre manchas, que es lo que mide la tarjeta.
  assert.deepEqual(res.columnas, [{ x0: 0.08, x1: 0.38 }, { x0: 0.38, x1: 0.68 }, { x0: 0.68, x1: 0.98 }]);
});

test("colaRotulo extiende la banda por debajo del borde inferior del arte", () => {
  const img = makeImage(1000, 500, 20);
  const y0 = 100;
  const altoArte = 90;
  drawRect(img, 200, y0, 60, altoArte, 240);
  drawRect(img, 500, y0, 60, altoArte, 240);
  drawRect(img, 800, y0, 60, altoArte, 240);

  const res = detectCardRow(img, { colaRotulo: 0.6 });
  assert.equal(res.y, 190);
  assert.equal(res.h, 54);
  assert.equal(res.y + res.h > y0 + altoArte, true);
  assert.equal(res.y + res.h, 244);
});

test("un solo rectangulo no forma fila y devuelve null", () => {
  const img = makeImage(1000, 500, 20);
  drawRect(img, 400, 100, 180, 90, 240);

  const res = detectCardRow(img);
  assert.equal(res, null);
});

test("manchas de anchos dispares no son una fila de tarjetas", () => {
  // Los anchos salen de una captura real: el arte del fondo daba siluetas de 86, 51 y 30 px
  // y tapaba las dos tarjetas de verdad, que medían 61 y 62. Una fila de tarjetas tiene el
  // mismo ancho en todas por construcción.
  const img = makeImage(400, 300, 10);
  drawRect(img, 20, 100, 86, 40, 250);
  drawRect(img, 140, 100, 51, 40, 250);
  drawRect(img, 220, 100, 30, 40, 250);

  assert.equal(detectCardRow(img), null);
});

test("dos tarjetas del mismo ancho sí forman fila aunque el fondo tenga manchas mayores", () => {
  const img = makeImage(400, 300, 10);
  drawRect(img, 40, 60, 61, 40, 250);    // tarjeta
  drawRect(img, 160, 60, 62, 40, 250);   // tarjeta
  drawRect(img, 30, 200, 86, 40, 250);   // arte de fondo, más grande y en otra fila
  drawRect(img, 200, 200, 51, 40, 250);

  const res = detectCardRow(img);
  assert.equal(res.cardCount, 2);
  assert.equal(res.y, 100);
});

test("un fondo liso sin contraste devuelve null", () => {
  const img = makeImage(1000, 500, 50);

  const res = detectCardRow(img);
  assert.equal(res, null);
});

test("el umbral relativo por percentil produce la misma banda con brillo escalado", () => {
  const imgOriginal = makeImage(1000, 500, 20);
  drawRect(imgOriginal, 200, 100, 60, 90, 240);
  drawRect(imgOriginal, 500, 100, 60, 90, 240);
  drawRect(imgOriginal, 800, 100, 60, 90, 240);

  const imgOscura = makeImage(1000, 500, 10);
  drawRect(imgOscura, 200, 100, 60, 90, 120);
  drawRect(imgOscura, 500, 100, 60, 90, 120);
  drawRect(imgOscura, 800, 100, 60, 90, 120);

  const resOriginal = detectCardRow(imgOriginal);
  const resOscura = detectCardRow(imgOscura);

  assert.deepEqual(resOscura, resOriginal);
  assert.deepEqual({ x: resOscura.x, y: resOscura.y, h: resOscura.h, cardCount: resOscura.cardCount },
    { x: 0, y: 190, h: 126, cardCount: 3 });
});

test("la banda respeta el limite inferior del frame si colaRotulo sobrepasa H", () => {
  const img = makeImage(1000, 500, 20);
  drawRect(img, 200, 390, 60, 90, 240);
  drawRect(img, 500, 390, 60, 90, 240);
  drawRect(img, 800, 390, 60, 90, 240);

  const res = detectCardRow(img, { colaRotulo: 0.6 });
  assert.deepEqual({ x: res.x, w: res.w, y: res.y, h: res.h, cardCount: res.cardCount }, {
    x: 0, w: 1000, y: 480, h: 20, cardCount: 3,
  });
});
