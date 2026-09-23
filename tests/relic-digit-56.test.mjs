// 5 and 6 in a relic code: Tesseract confuses them in the name font and both relics exist, so text alone
// cannot tell
// the glyph does, and only when it decides with margin
import { test } from "node:test";
import assert from "node:assert/strict";
import { distingue56, alternativa56, corrige56, binarizaTexto, MARGEN_56 } from "../deploy/js/utils/vision/relic_digit_56.js";
import { NW, NH } from "../deploy/js/utils/vision/badge_digit_ocr.js";

/** an RGBA crop with the template glyph painted light on dark (with margin around it) */
function recorteDe(plantillaHex, { escala = 2, margen = 6, invertido = false } = {}) {
  const W = NW * escala + margen * 2, H = NH * escala + margen * 2;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = Math.floor((x - margen) / escala), gy = Math.floor((y - margen) / escala);
    const dentro = gx >= 0 && gx < NW && gy >= 0 && gy < NH;
    const v = dentro ? parseInt(plantillaHex[gy * NW + gx], 16) / 15 : 0;
    const on = invertido ? v < 0.5 : v >= 0.5;
    const c = on ? 230 : 25;
    const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = c; data[i + 3] = 255;
  }
  return { width: W, height: H, data };
}
const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../deploy/js/utils/vision/relic_digit_56.js", import.meta.url), "utf8"));
const P5 = /PLANTILLA_5 = "([0-9a-f]+)"/.exec(src)[1], P6 = /PLANTILLA_6 = "([0-9a-f]+)"/.exec(src)[1];

test("las plantillas se reconocen a sí mismas con margen de sobra", () => {
  const r5 = distingue56(recorteDe(P5)), r6 = distingue56(recorteDe(P6));
  assert.equal(r5.digito, "5"); assert.equal(r6.digito, "6");
  assert.ok(r5.margen > MARGEN_56 && r6.margen > MARGEN_56, `${r5.margen} ${r6.margen}`);
});

test("sin glifo, o con un glifo que no es ni 5 ni 6, se abstiene", () => {
  const liso = { width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4).fill(30) };
  assert.equal(distingue56(liso).digito, null);
  // a solid block matches both equally: margin ~0
  const bloque = { width: 30, height: 40, data: new Uint8ClampedArray(30 * 40 * 4) };
  for (let i = 0; i < 30 * 40; i++) { const x = i % 30, y = (i / 30) | 0; const on = x > 4 && x < 26 && y > 4 && y < 36; bloque.data[i * 4] = bloque.data[i * 4 + 1] = bloque.data[i * 4 + 2] = on ? 230 : 25; bloque.data[i * 4 + 3] = 255; }
  const r = distingue56(bloque);
  assert.equal(r.digito, null, `margen ${r.margen}`);
});

test("binarizaTexto deja el trazo claro en negro sobre blanco", () => {
  const b = binarizaTexto(recorteDe(P5, { escala: 1, margen: 2 }));
  assert.equal(b.data[0], 255, "el fondo oscuro queda blanco");
  const negros = [...b.data].filter((_, i) => i % 4 === 0 && b.data[i] === 0).length;
  assert.ok(negros > 100, "el glifo queda negro");
});

test("alternativa56 cambia solo el último dígito 5/6", () => {
  assert.equal(alternativa56("Lith A5"), "Lith A6");
  assert.equal(alternativa56("Axi A16"), "Axi A15");
  assert.equal(alternativa56("Meso K3"), null);
  assert.equal(alternativa56(null), null);
});

test("corrige56 solo cambia el nombre si la otra reliquia existe, hay caja del código y el glifo decide", () => {
  const words = [{ text: "Lith", bbox: { x0: 0, x1: 30, y0: 0, y1: 20 } }, { text: "A6", bbox: { x0: 34, x1: 60, y0: 0, y1: 20 } }];
  const recortes = [];
  const recorta = (bbox) => { recortes.push(bbox); return recorteDe(P5); }; // the real glyph is a 5
  const existe = (n) => ["Lith A5", "Lith A6"].includes(n);
  const r = corrige56("Lith A6", words, recorta, existe);
  assert.deepEqual([r.nombre, r.cambiado], ["Lith A5", true]);
  assert.deepEqual(recortes[0], { x0: 34, x1: 60, y0: 0, y1: 20 }, "recorta la palabra del código");
  // the glyph confirms the read: unchanged
  assert.equal(corrige56("Lith A6", words, () => recorteDe(P6), existe).cambiado, false);
  // the other relic does not exist: the glyph is not even checked
  let miradas = 0;
  assert.equal(corrige56("Lith A6", words, () => { miradas++; return recorteDe(P5); }, (n) => n === "Lith A6").cambiado, false);
  assert.equal(miradas, 0);
  // without the code word among reads (or without a box): stays as is
  assert.equal(corrige56("Lith A6", [{ text: "Lith A6" }], recorta, existe).cambiado, false);
  // glyph without margin: OCR rules
  assert.equal(corrige56("Lith A6", words, () => ({ width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4).fill(30) }), existe).cambiado, false);
});
