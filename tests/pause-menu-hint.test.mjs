// La pista del menú de pausa: 9 filas de texto a paso constante en la franja izquierda. Es lo
// que evita pagar un OCR de Tesseract cada 1,5 s mientras el jugador simplemente juega, así que
// lo que se fija es qué SÍ pasa (pausas reales, texto rojo tenue, fila resaltada) y qué NO
// (celdas de inventario, cartas, pasos irregulares).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";
import { decodePng } from "./_helpers/png.mjs";

installFakeDocument();
const { pareceMenuPausa, hayPistaMenuPausa, FRANJA_MENU_PAUSA, umbralTexto } =
  await import("../deploy/js/utils/vision/pause_menu_hint.js");

const { cols, filas } = FRANJA_MENU_PAUSA;

/** Franja sintética en max-canal: `bandas` = [{ centro, alto, huecos? }], `texto` y `fondo` son valores 0..255. */
function franja({ bandas = [], texto = 240, fondo = 10, huecos = [] }) {
  const m = new Uint8Array(cols * filas).fill(fondo);
  for (const b of bandas) {
    const ini = Math.round(b.centro - b.alto / 2);
    for (let y = ini; y < ini + b.alto; y++) {
      if (huecos.includes(y)) continue;
      for (let x = 2; x < cols - 2; x++) m[y * cols + x] = texto;
    }
  }
  return m;
}
const nueve = (alto = 8, paso = 15, desde = 12) => Array.from({ length: 9 }, (_, i) => ({ centro: desde + i * paso, alto }));

test("nueve filas a paso constante son el menú de pausa", () => {
  const r = pareceMenuPausa(franja({ bandas: nueve() }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.bandas, 9);
});

// Luma del rojo (165,30,30) = 70 < umbral 90; max-canal 165 > 90. Por luma el menú rojo era invisible.
test("el texto rojo cuenta aunque su luma sea baja", () => {
  const r = pareceMenuPausa(franja({ bandas: nueve(), texto: 165, fondo: 40 }));
  assert.equal(r.umbral, 90);
  assert.equal(r.ok, true);
});

test("cuatro filas de celdas de inventario no son el menú", () => {
  const r = pareceMenuPausa(franja({ bandas: Array.from({ length: 4 }, (_, i) => ({ centro: 20 + i * 36, alto: 30 })) }));
  assert.equal(r.ok, false);
});

test("nueve bandas a paso irregular no son el menú", () => {
  const centros = [10, 25, 40, 65, 75, 90, 105, 120, 135];
  const r = pareceMenuPausa(franja({ bandas: centros.map((c) => ({ centro: c, alto: 8 })) }));
  assert.equal(r.ok, false);
  assert.ok(r.pasos.some((p) => p > 19 || p < 11));
});

test("nueve cartas altas no son el menú", () => {
  const r = pareceMenuPausa(franja({ bandas: nueve(20, 16) }));
  assert.equal(r.ok, false);
});

test("una fila resaltada por el ratón no rompe la detección", () => {
  const bandas = nueve(); bandas[3].alto = 12;
  assert.equal(pareceMenuPausa(franja({ bandas })).ok, true);
});

test("un hueco de una fila no parte la banda; dos sí", () => {
  const bandas = nueve();
  assert.equal(pareceMenuPausa(franja({ bandas, huecos: [12] })).ok, true, "un hueco");
  const r = pareceMenuPausa(franja({ bandas, huecos: bandas.map((b) => b.centro).flatMap((c) => [c, c + 1]) }));
  assert.equal(r.ok, false, "dos huecos parten cada banda en dos");
  assert.equal(r.bandas, 18);
});

test("el umbral se adapta al fondo", () => {
  assert.equal(umbralTexto(franja({ fondo: 5 })), 60, "suelo");
  assert.equal(pareceMenuPausa(franja({ bandas: nueve(), texto: 100, fondo: 5 })).ok, true);
  const claro = pareceMenuPausa(franja({ bandas: nueve(), texto: 100, fondo: 80 }));
  assert.equal(claro.umbral, 130);
  assert.equal(claro.ok, false, "el texto no destaca del fondo");
  assert.equal(pareceMenuPausa(franja({ fondo: 200 })).bandas, 0, "franja uniforme");
});

// --- Capturas reales (fuera del repo; sin la carpeta se salta) ---------------------------------
const DIR = process.env.CORPUS_PANTALLAS_DIR || "/home/ppsoy/Imágenes/Capturas de pantalla/nofunciona/implementar";
const PAUSAS = ["temas/pausa-oscuro.png", "temas/pausa-red.png", "squadfunctionality.png", "nofunca.png"];
const NO_PAUSAS = ["anky ros.png", "reliccount/1.png", "reliccount/relicscreenredred.png", "temas/reliquias.png",
  "reliccount/lastmission-rojo.png", "temas/caliban.png", "temas/nofuncarecompensa.png", "missioncomplete2.png"];

// Una captura por iteración y sin guardarlas: decodificadas son ~15 MB cada una.
function pista(rel) {
  let img = decodePng(fs.readFileSync(path.join(DIR, rel)));
  const video = new FakeCanvas(img.width, img.height);
  video.getContext("2d").drawImage(img, 0, 0);
  video.videoWidth = img.width; video.videoHeight = img.height;
  img = null;
  return hayPistaMenuPausa(video);
}

for (const rel of PAUSAS) {
  const falta = !fs.existsSync(path.join(DIR, rel)) && `sin ${rel}`;
  test(`captura real: ${rel} es el menú de pausa`, { skip: falta }, () => {
    const r = pista(rel);
    assert.equal(r.ok, true, JSON.stringify(r));
  });
}
for (const rel of NO_PAUSAS) {
  const falta = !fs.existsSync(path.join(DIR, rel)) && `sin ${rel}`;
  test(`captura real: ${rel} no es el menú de pausa`, { skip: falta }, () => {
    const r = pista(rel);
    assert.equal(r.ok, false, JSON.stringify(r));
  });
}
