// Catálogo de rótulos (utils/vision/title_catalog.js). Un fallo cae al OCR de siempre; un acierto falso
// manda la pantalla por la lógica equivocada, así que ante todo se exige que no haya ninguno.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { COLS, FILAS, UMBRAL, parecido, textura, esTitulo, creaCatalogo, exporta, importa } = await import("../deploy/js/utils/vision/title_catalog.js");
const { muestraMaxCanal } = await import("../deploy/js/utils/vision/frame_hash.js");
const { FRANJA_TITULO_VIDEO } = await import("../deploy/js/utils/vision/context_latch.js");

/** Una franja sintética: letras de 3 columnas a paso 7 empezando en `desde`, con forma según `semilla`. */
function franja(desde, semilla, letras = 14) {
  const m = new Float32Array(COLS * FILAS).fill(20);
  for (let l = 0; l < letras; l++) {
    const x = desde + l * 7;
    for (let f = 0; f < FILAS; f++) for (let k = 0; k < 3; k++) {
      if (x + k < COLS && ((f * 7 + l * semilla + k) % 5) < 3) m[f * COLS + x + k] = 220;
    }
  }
  return m;
}

/** Franja con letras pseudoaleatorias: rótulos distintos entre sí para cada semilla. */
function azar(semilla) {
  let x = semilla * 2654435761 >>> 0;
  const m = new Float32Array(COLS * FILAS).fill(20);
  for (let i = 0; i < m.length; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    if ((i % COLS) % 7 < 3 && (x >>> 16) % 2) m[i] = 220;
  }
  return m;
}

describe("comparación", () => {
  test("la misma franja desplazada (más o menos avatares) sigue siendo la misma", () => {
    assert.ok(parecido(franja(20, 3), franja(20, 3)) > 0.99);
    assert.ok(parecido(franja(20, 3), franja(45, 3)) > 0.99);
  });

  test("un rótulo distinto se queda lejos", () => {
    assert.ok(parecido(franja(20, 3), franja(20, 11)) < UMBRAL);
  });

  test("una franja lisa no tiene textura", () => {
    assert.equal(textura(new Float32Array(COLS * FILAS).fill(40)), 0);
    assert.ok(textura(franja(20, 3)) > 12);
  });
});

test("solo es rótulo lo que tiene la forma CATEGORÍA/SUBTÍTULO", () => {
  assert.equal(esTitulo("VOID FISSURE/REWARDS"), true);
  assert.equal(esTitulo("CB INVENTORY/SELL"), true);
  assert.equal(esTitulo("| + TRADING POST 0 :"), true, "el Trading Post no lleva barra");
  assert.equal(esTitulo("AstilModulaionay | Narin[30]"), false, "la pausa con AstralModulation en la escuadra");
  assert.equal(esTitulo(""), false);
});

describe("catálogo", () => {
  test("reconoce lo aprendido y devuelve el texto que lo enseñó", () => {
    const cat = creaCatalogo();
    cat.aprende(franja(20, 3), "REWARD", "VOID FISSURE/REWARDS");
    cat.aprende(franja(20, 11), "RELICS", "VOID RELICS/REFINEMENT");
    assert.deepEqual({ ...cat.reconoce(franja(40, 3)), score: 0 }, { contexto: "REWARD", texto: "VOID FISSURE/REWARDS", score: 0 });
    assert.equal(cat.reconoce(franja(20, 11)).contexto, "RELICS");
  });

  test("lo desconocido, lo liso o lo que no destaca sobre otro contexto, null", () => {
    const cat = creaCatalogo();
    assert.equal(cat.reconoce(franja(20, 3)), null, "catálogo vacío");
    cat.aprende(franja(20, 3), "REWARD", "VOID FISSURE/REWARDS");
    assert.equal(cat.reconoce(franja(20, 7)), null);
    assert.equal(cat.reconoce(new Float32Array(COLS * FILAS).fill(40)), null);
    const dudoso = creaCatalogo([
      { contexto: "REWARD", texto: "A/B", t: 0, m: Uint8Array.from(franja(20, 3)) },
      { contexto: "RELICS", texto: "C/D", t: 0, m: Uint8Array.from(franja(21, 3)) },
    ]);
    assert.equal(dudoso.reconoce(franja(20, 3)), null, "igual de parecida a dos contextos: no hay certeza");
  });

  test("la misma pantalla no se aprende dos veces, y cada contexto guarda como mucho 6 variantes", () => {
    const cat = creaCatalogo();
    assert.equal(cat.aprende(franja(20, 3), "REWARD", "A/B", 1), true);
    assert.equal(cat.aprende(franja(30, 3), "REWARD", "A/B", 2), false);
    for (let s = 4; s < 12; s++) cat.aprende(azar(s), "REWARD", "A/B", s);
    assert.equal(cat.entradas.filter((e) => e.contexto === "REWARD").length, 6);
    assert.equal(cat.aprende(new Float32Array(COLS * FILAS).fill(40), "REWARD", "A/B"), false, "sin textura no se aprende");
  });

  test("una firma mal aprendida se borra cuando el OCR confirma otro contexto para esa franja", () => {
    const cat = creaCatalogo();
    cat.aprende(franja(20, 3), "RELICS", "VOID RELICS/REFINEMENT");
    assert.equal(cat.aprende(franja(20, 3), "REWARD", "VOID FISSURE/REWARDS"), true);
    assert.deepEqual(cat.entradas.map((e) => e.contexto), ["REWARD"]);
    assert.equal(cat.reconoce(franja(20, 3)).contexto, "REWARD");
  });

  test("sobrevive a guardarse y cargarse", () => {
    const cat = creaCatalogo();
    cat.aprende(franja(20, 3), "REWARD", "VOID FISSURE/REWARDS");
    const cargado = importa(JSON.parse(JSON.stringify(exporta(cat))));
    assert.equal(cargado.reconoce(franja(20, 3)).contexto, "REWARD");
    assert.deepEqual(importa(null).entradas, []);
    assert.deepEqual(importa([{ contexto: "X", m: "abc" }]).entradas, [], "una firma de otro tamaño se descarta");
  });
});

// Una captura de cada contexto enseña; el resto del corpus se reconoce o cae al OCR, pero nunca en el
// contexto equivocado. Los fallos son variantes (otro tema, otro fondo) que en la app se aprenden solas.
const DIR = process.env.CORPUS_PANTALLAS_DIR || "/home/ppsoy/Imágenes/Capturas de pantalla/nofunciona/implementar";
const { pantallas } = JSON.parse(fs.readFileSync(new URL("./_fixtures/corpus-pantallas.json", import.meta.url), "utf8"));
const ENSENA = { "reliccount/1.png": "RELICS", "anky ros.png": "INVENTORY", "temas/caliban.png": "REWARD" };
const hayCorpus = Object.keys(ENSENA).every((rel) => fs.existsSync(path.join(DIR, rel)));

function muestraDe(rel) {
  const img = decodePng(fs.readFileSync(path.join(DIR, rel)));
  const v = new FakeCanvas(img.width, img.height);
  v.getContext("2d").drawImage(img, 0, 0);
  v.videoWidth = img.width; v.videoHeight = img.height;
  return muestraMaxCanal(v, FRANJA_TITULO_VIDEO, COLS, FILAS);
}

test("corpus real: ningún acierto en el contexto equivocado", { skip: !hayCorpus && "sin el corpus" }, () => {
  const cat = creaCatalogo();
  for (const [rel, ctx] of Object.entries(ENSENA)) cat.aprende(muestraDe(rel), ctx, "X/Y");
  const aciertos = [];
  for (const [rel, ctx] of Object.entries(pantallas)) {
    if (ENSENA[rel] || !fs.existsSync(path.join(DIR, rel))) continue;
    const r = cat.reconoce(muestraDe(rel));
    if (!r) continue;
    assert.equal(r.contexto, ctx, `${rel} reconocida como ${r.contexto}`);
    aciertos.push(rel);
  }
  for (const rel of ["reliccount/2.png", "reliccount/3.png", "reliccount/4.png", "reliccount/5.png"]) {
    assert.ok(aciertos.includes(rel), `${rel}: misma pantalla, misma resolución, otro frame`);
  }
});
