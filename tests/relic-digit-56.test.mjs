// 5 y 6 en el código de una reliquia: Tesseract los confunde en la fuente de los nombres y las dos
// reliquias existen, así que el texto no lo delata. El glifo sí, y solo cuando decide con margen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { distingue56, alternativa56, corrige56, binarizaTexto, MARGEN_56 } from "../deploy/js/utils/vision/relic_digit_56.js";
import { NW, NH } from "../deploy/js/utils/vision/badge_digit_ocr.js";

/** Un recorte RGBA con el glifo de la plantilla pintado en claro sobre oscuro (con margen alrededor). */
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
  // Un bloque macizo se parece igual a los dos: margen ~0.
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
  const recorta = (bbox) => { recortes.push(bbox); return recorteDe(P5); }; // el glifo real es un 5
  const existe = (n) => ["Lith A5", "Lith A6"].includes(n);
  const r = corrige56("Lith A6", words, recorta, existe);
  assert.deepEqual([r.nombre, r.cambiado], ["Lith A5", true]);
  assert.deepEqual(recortes[0], { x0: 34, x1: 60, y0: 0, y1: 20 }, "recorta la palabra del código");
  // El glifo confirma lo leído: no cambia.
  assert.equal(corrige56("Lith A6", words, () => recorteDe(P6), existe).cambiado, false);
  // La otra reliquia no existe: ni se mira el glifo.
  let miradas = 0;
  assert.equal(corrige56("Lith A6", words, () => { miradas++; return recorteDe(P5); }, (n) => n === "Lith A6").cambiado, false);
  assert.equal(miradas, 0);
  // Sin la palabra del código entre las leídas (o sin caja): se queda como está.
  assert.equal(corrige56("Lith A6", [{ text: "Lith A6" }], recorta, existe).cambiado, false);
  // Glifo sin margen: manda el OCR.
  assert.equal(corrige56("Lith A6", words, () => ({ width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4).fill(30) }), existe).cambiado, false);
});
