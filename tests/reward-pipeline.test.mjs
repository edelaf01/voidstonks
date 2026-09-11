import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";
import { makeRewardFrameEnEncuadre } from "./_helpers/reward-frame.mjs";

installFakeDocument();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { columnasEnRecorte, radioDeDedup, pasoEntreTarjetas, columnasDesdeCentros } = await import("../deploy/js/utils/vision/reward_cards.js");
const { franjaDeRotulo } = await import("../deploy/js/utils/vision/reward_preprocess.js");
const { localizaBandaRecompensas, candidatosDeRecorte } = await import("../deploy/js/utils/vision/reward_band.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");

const RECOMPENSAS = ["Braton Prime Receiver", "Forma Blueprint", "Bronco Prime Blueprint", "Paris Prime Grip"];
const CATALOGO = [
  ...RECOMPENSAS,
  "Braton Prime Barrel", "Braton Prime Blueprint", "Bronco Prime Receiver",
  "Paris Prime String", "Paris Prime Blueprint", "Paris Prime Upper Limb",
  "Nekros Prime Chassis Blueprint", "Frost Prime Blueprint",
];

state.itemsDatabase = Object.fromEntries(CATALOGO.map((n) => [n, [{ ducats: 15 }]]));
OCRService.cachedDbItems = [];
OCRService.knownParts = new Set();
OCRService._vocabCache = null;
OCRService.initMatcherData();

const FRAME = { width: 2560, height: 1440 };

function geometria(img) {
  const banda = localizaBandaRecompensas(img, img.width, img.height);
  const { cropRect } = banda;
  const margen = cropRect ? Math.floor(cropRect.w * 0.06) : Math.floor(img.width * 0.08);
  return {
    ...banda,
    margen,
    imageW: (cropRect ? cropRect.w : img.width) - margen * 2,
    cols: columnasEnRecorte(banda.columnas, img.width, cropRect),
  };
}

function palabrasDelFrame(ocupacion, { cropRect, margen, imageW }, nombres) {
  const gw = Math.round(FRAME.width * Math.min(1, ocupacion));
  const ox = (FRAME.width - gw) >> 1;
  const filaX0 = ox + Math.round(gw * 0.26), filaX1 = ox + Math.round(gw * 0.75);
  const anchoCard = (filaX1 - filaX0) / nombres.length;
  const origen = (cropRect ? Math.floor(cropRect.x) : 0) + margen;
  const escala = imageW / ((cropRect ? cropRect.w : FRAME.width) - margen * 2);

  const words = [];
  nombres.forEach((nombre, i) => {
    const cardX0 = filaX0 + i * anchoCard + anchoCard * 0.08;
    const util = anchoCard * 0.84;
    const tokens = nombre.split(" ");
    const chars = tokens.reduce((s, t) => s + t.length, 0) + tokens.length - 1;
    const charW = util / chars;
    let x = cardX0;
    for (const t of tokens) {
      const ancho = t.length * charW;
      words.push({
        text: t,
        bbox: { x0: (x - origen) * escala, x1: (x + ancho - origen) * escala, y0: 100, y1: 118 },
      });
      x += ancho + charW;
    }
  });
  return words;
}

describe("cadena completa: frame -> banda -> recorte -> columnas -> parseRewards", () => {
  for (const ocupacion of [1, 0.8, 0.7, 0.55]) {
    test(`el juego al ${Math.round(ocupacion * 100)}% del encuadre: las 4 recompensas`, () => {
      const img = makeRewardFrameEnEncuadre({ ...FRAME, ocupacion });
      const geo = geometria(img);

      assert.ok(geo.cropRect, "sin banda se cae al recorte fijo 18,5-44 %, que está medido sobre el FRAME");
      assert.equal(geo.cardCount, 4, "las cuatro cards");
      assert.equal(geo.cols?.length, 4, "las columnas tienen que llegar al parseo");

      const words = palabrasDelFrame(ocupacion, geo, RECOMPENSAS);
      const leidos = OCRService.parseRewards({ words, imageW: geo.imageW, columnas: geo.cols });
      assert.deepEqual(leidos.map((r) => r.name), RECOMPENSAS);
    });
  }

  test("con el juego pequeño el paso baja del radio de dedup fijo que había antes", () => {
    const geo = geometria(makeRewardFrameEnEncuadre({ ...FRAME, ocupacion: 0.55 }));
    const paso = geo.cols[1].x0 - geo.cols[0].x0;
    assert.ok(paso < 0.1, `paso ${paso.toFixed(3)}·W — con el radio fijo de 0,1·W se fusionaban`);
  });
});

describe("dedup por paso entre tarjetas", () => {
  const item = (x, ratio = 1) => ({ name: `x${x}`, x, ratio, tokens: 3 });

  test("no se fía de un paso medido sobre menos de tres centros", () => {
    assert.equal(pasoEntreTarjetas([item(100), item(180)], 1000), 0);
  });

  test("ni sobre centros que no están equiespaciados", () => {
    assert.equal(pasoEntreTarjetas([item(100), item(180), item(600)], 1000), 0);
  });

  test("una fila regular sí da el paso, y el radio sale de él", () => {
    const fila = [item(100), item(180), item(260), item(340)];
    assert.equal(pasoEntreTarjetas(fila, 1000), 80);
    assert.equal(radioDeDedup(fila, 1000), 52);
  });

  test("el radio nunca sube del 0,1·W histórico", () => {
    const anchas = [item(100), item(400), item(700), item(1000)];
    assert.equal(radioDeDedup(anchas, 1000), 100);
  });

  test("con columnas el paso sale de ellas, no de los candidatos", () => {
    const cols = [{ x0: 0.20, x1: 0.28 }, { x0: 0.28, x1: 0.36 }, { x0: 0.36, x1: 0.44 }];
    assert.ok(Math.abs(radioDeDedup([item(300)], 1000, cols) - 52) < 1e-6);
  });
});

describe("candidatos de recorte", () => {
  // detected band gets 79 right, fixed crop 78, and taking the best of both reaches 122
  const banda = { cropRect: { x: 0, y: 500, w: 2560, h: 200 }, cardCount: 4,
    columnas: [{ x0: 0.2, x1: 0.35 }, { x0: 0.35, x1: 0.5 }] };

  test("con banda detectada se ofrece primero la banda y detrás el recorte fijo", () => {
    const c = candidatosDeRecorte(banda);
    assert.deepEqual(c.map((x) => x.nombre), ["banda", "fijo"]);
    assert.equal(c[0].cropRect, banda.cropRect);
    assert.equal(c[1].cropRect, null, "el fijo lo calcula prepareRewardOCRCanvas por porcentaje");
  });

  test("sin banda solo queda el recorte fijo", () => {
    assert.deepEqual(candidatosDeRecorte(null).map((x) => x.nombre), ["fijo"]);
    assert.deepEqual(candidatosDeRecorte({ cropRect: null }).map((x) => x.nombre), ["fijo"]);
  });

  test("la lectura se da por completa al leer tantos nombres como cards vio la detección", () => {
    assert.equal(candidatosDeRecorte(banda)[0].minimo, 4);
    assert.equal(candidatosDeRecorte({ ...banda, cardCount: 0 })[0].minimo, 1);
    assert.equal(candidatosDeRecorte(banda)[1].minimo, 4);
    assert.equal(candidatosDeRecorte({ ...banda, cardCount: 0 })[1].minimo, 1);
  });

  test("el recorte fijo hereda las columnas de la banda", () => {
    assert.deepEqual(candidatosDeRecorte(banda)[1].columnas, banda.columnas);
    assert.equal(candidatosDeRecorte({ cropRect: null })[0].columnas, undefined);
  });
});

describe("columnas: guarda de plausibilidad", () => {
  const centros = (xs) => columnasDesdeCentros(xs, 1000);

  test("una fila regular con paso de tarjeta se acepta", () => {
    const cols = centros([200, 326, 452, 578]);
    assert.equal(cols.length, 4);
    assert.ok(Math.abs((cols[0].x1 - cols[0].x0) - 0.126) < 0.005);
  });

  test("un paso enano no es una fila de tarjetas", () => {
    assert.equal(centros([400, 416, 432, 448]), undefined);
  });

  test("ni un paso de más de un tercio del ancho", () => {
    assert.equal(centros([100, 500, 900]), undefined);
  });

  test("centros irregulares tampoco: las tarjetas están equiespaciadas", () => {
    assert.equal(centros([200, 210, 220, 600]), undefined);
  });
});

describe("franja del rótulo dentro del recorte", () => {
  function recorte(w = 400, h = 120) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = data[i+1] = data[i+2] = 20; data[i+3] = 255; }
    const pinta = (x, y, v) => { const i = (y * w + x) * 4; data[i] = data[i+1] = data[i+2] = v; };
    let s = 7;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let n = 0; n < 40; n++) {
      const x0 = Math.floor(rnd() * (w - 40)), y0 = Math.floor(rnd() * 70), lado = 8 + Math.floor(rnd() * 20);
      for (let y = y0; y < Math.min(70, y0 + lado); y++) for (let x = x0; x < x0 + lado; x++) pinta(x, y, 210);
    }
    for (let y = 96; y < 108; y++) for (let x = 40; x < 360; x += 5) { pinta(x, y, 190); pinta(x + 1, y, 190); }
    return { data, w, h };
  }

  test("elige la fila de texto y no el arte", () => {
    const { data, w, h } = recorte();
    const f = franjaDeRotulo(data, w, h);
    assert.ok(f, "debería encontrar una franja");
    const centro = (f.y0 + f.y1) / 2;
    assert.ok(centro > 85 && centro < 118,
      `centro en ${centro}: el rótulo está en 96-108, el arte en 0-70`);
  });

  test("sin nada que leer no se inventa una franja", () => {
    const w = 200, h = 80;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = data[i+1] = data[i+2] = 20; data[i+3] = 255; }
    assert.equal(franjaDeRotulo(data, w, h), null);
  });
});
