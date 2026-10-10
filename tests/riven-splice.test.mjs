import { test } from "node:test";
import assert from "node:assert/strict";

import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { cartaFlotante, zonasDeFirma, SPLICE_REJILLA, SPLICE_ELEGIDA } from "../deploy/js/utils/vision/riven_splice.js";

installFakeDocument();
globalThis.ImageData ??= class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };

const ANCHO = 262, ALTO = 306;

function rejilla(pinta) {
  const data = new Uint8ClampedArray(ANCHO * ALTO * 4);
  for (let y = 0; y < ALTO; y++) {
    for (let x = 0; x < ANCHO; x++) {
      const v = pinta(x, y) ?? 20, i = (y * ANCHO + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { width: ANCHO, height: ALTO, data };
}

const texto = (desde, hasta, x0 = 100, x1 = 150) => (x, y) => (y >= desde && y <= hasta && x >= x0 && x <= x1 && x % 3 === 0 ? 230 : null);
const capas = (...fs) => (x, y) => fs.reduce((v, f) => v ?? f(x, y), null);
const cerca = (a, b) => Math.abs(a - b) < 1e-3;

test("una carta flotante en la columna del centro da el recorte de su texto", () => {
  const r = cartaFlotante(rejilla(texto(100, 219)));
  const arriba = SPLICE_REJILLA.y + (100 / ALTO) * SPLICE_REJILLA.h;
  assert.ok(r);
  assert.ok(cerca(r.x, 0.165) && cerca(r.w, 0.15), JSON.stringify(r));
  assert.ok(cerca(r.y, arriba + 0.34 * 0.55) && cerca(r.h, 0.34 * 0.4), JSON.stringify(r));
});

test("los dos recortes del splice son de una sola carta, para no partirla en dos", () => {
  assert.equal(cartaFlotante(rejilla(texto(100, 219))).unaCarta, true);
  assert.equal(SPLICE_ELEGIDA.unaCarta, true);
});

test("las casillas normales no son una carta flotante", () => {
  assert.equal(cartaFlotante(rejilla(capas(texto(40, 75), texto(130, 165), texto(220, 255)))), null);
  assert.equal(cartaFlotante(rejilla(() => null)), null);
});

test("un fondo claro sin letras no cuenta como texto", () => {
  assert.equal(cartaFlotante(rejilla((x, y) => (y >= 100 && y <= 219 ? 230 : null))), null);
});

test("una carta cortada por arriba se coloca desde su borde de abajo", () => {
  const r = cartaFlotante(rejilla(texto(0, 119)));
  const abajo = SPLICE_REJILLA.y + (120 / ALTO) * SPLICE_REJILLA.h;
  assert.ok(r);
  assert.ok(cerca(r.y, abajo - 0.34 + 0.34 * 0.55), JSON.stringify(r));
});

test("en el splice la firma es solo la carta que se lee; en el resto, las cartas de la última lectura", () => {
  const recorte = { x: 0.5, y: 0.4, w: 0.1, h: 0.1 }, zonas = [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }];
  assert.deepEqual(zonasDeFirma(zonas, recorte, "RIVEN_SPLICING"), [recorte]);
  assert.deepEqual(zonasDeFirma(zonas, recorte, "INVENTORY_MODS"), zonas);
  assert.deepEqual(zonasDeFirma([], recorte, "INVENTORY_MODS"), [recorte]);
  assert.deepEqual(zonasDeFirma(null, recorte, "RIVEN_DETAILS"), [recorte]);
});

test("la firma de la carta elegida mira solo los stats, sin el arte de arriba ni los cristales del borde", () => {
  const [z] = zonasDeFirma(null, SPLICE_ELEGIDA, "RIVEN_SPLICING");
  const e = SPLICE_ELEGIDA;
  assert.ok(z.y > e.y && z.y + z.h <= e.y + e.h, JSON.stringify(z));
  assert.ok(z.x > e.x && z.x + z.w < e.x + e.w, JSON.stringify(z));
});

test("la carta elegida se lee entera aunque la línea más larga sea la única que llega al borde", async () => {
  const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
  const W = 1280, H = 720, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([20, 15, 30, 255], i * 4);
  const linea = (y, x0, x1) => {
    for (let x = x0; x < x1; x += 5) for (let dy = 0; dy < 9; dy++) for (let dx = 0; dx < 2; dx++) data.set([205, 185, 235], ((y + dy) * W + x + dx) * 4);
  };
  for (const y of [270, 286, 302, 318]) linea(y, 720, 800);
  linea(334, 700, 850);
  const [carta, otra] = VisionService.prepareRivenCardCanvases({ videoWidth: W, videoHeight: H, width: W, height: H, data }, 1080 / H, SPLICE_ELEGIDA);
  const z = carta.zonaVideo;
  assert.equal(otra, undefined);
  assert.ok(z.x * W <= 700 && (z.x + z.w) * W >= 850, `zona ${Math.round(z.x * W)}-${Math.round((z.x + z.w) * W)}`);
});
