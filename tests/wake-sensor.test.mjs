// El sensor que despierta al escáner entre ticks (deploy/js/utils/vision/wake_sensor.js).
//
// En los menús el bucle duerme hasta 3 s (inventario con el auto-scan apagado) y 1 s con una
// carta de riven ya leída: cambiar de pestaña o ciclar el riven tardaba eso en verse. El sensor
// mira una miniatura cada 250 ms y adelanta el tick solo cuando la pantalla nueva ya se paró.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { pantallaNuevaParada, creaSensor, sensorDelEscaner, CADA_MS } = await import("../deploy/js/utils/vision/wake_sensor.js");
const { regionLuma, firmaTexto } = await import("../deploy/js/utils/vision/frame_hash.js");
const { FRANJA_TITULO_VIDEO } = await import("../deploy/js/utils/vision/context_latch.js");

const distinto = (a, b) => a !== b;

/** Reloj falso: el intervalo solo avanza al llamar a tick(). */
function relojFalso() {
  const r = {
    fn: null, ms: null,
    setInterval(fn, ms) { r.fn = fn; r.ms = ms; return 1; },
    clearInterval() { r.fn = null; },
    tick() { return r.fn?.(); },
  };
  return r;
}

test("una pantalla nueva ya parada despierta; en movimiento o igual a la leída, no", () => {
  assert.equal(pantallaNuevaParada(5, 5, 0, distinto), true);
  assert.equal(pantallaNuevaParada(4, 5, 0, distinto), false, "aún se mueve");
  assert.equal(pantallaNuevaParada(0, 0, 0, distinto), false, "es la que ya se leyó");
});

test("sin muestra previa, sin muestra o sin base no se despierta", () => {
  assert.equal(pantallaNuevaParada(null, 5, 0, distinto), false, "una sola muestra no dice si está quieta");
  assert.equal(pantallaNuevaParada(5, null, 0, distinto), false);
  assert.equal(pantallaNuevaParada(5, 5, null, distinto), false, "sin lectura previa no hay con qué comparar");
});

test("despierta en la segunda muestra de la pantalla nueva, con la previa, y deja de muestrear", async () => {
  const reloj = relojFalso();
  const muestras = [5, 5];
  const despertares = [];
  const s = creaSensor([{ muestra: () => muestras.shift(), base: () => 0, cambia: distinto }], (p) => despertares.push(p), { reloj });
  s.arma();
  assert.equal(reloj.ms, CADA_MS);
  await reloj.tick();
  assert.equal(despertares.length, 0, "la primera muestra no sabe si la pantalla está quieta");
  await reloj.tick();
  assert.deepEqual(despertares, [[5]]);
  assert.equal(reloj.fn, null);
});

test("mientras la pantalla se mueve no despierta", async () => {
  const reloj = relojFalso();
  let n = 0, despertares = 0;
  const s = creaSensor([{ muestra: () => ++n, base: () => 0, cambia: distinto }], () => despertares++, { reloj });
  s.arma();
  for (let i = 0; i < 8; i++) await reloj.tick();
  assert.equal(despertares, 0);
  assert.notEqual(reloj.fn, null);
});

// Si el tick despertado no lee (el reloj de la cabecera no lo deja) la base no se mueve: sin la
// guarda, el sensor despertaría al bucle cada dos muestras por la misma pantalla.
test("no despierta dos veces por la misma pantalla mientras la base no cambie", async () => {
  const reloj = relojFalso();
  let base = { v: 0 }, despertares = 0;
  const cambia = (a, b) => a !== (b?.v ?? b);
  const s = creaSensor([{ muestra: () => 5, base: () => base, cambia }], () => despertares++, { reloj });
  s.arma(); await reloj.tick(); await reloj.tick();
  assert.equal(despertares, 1);
  s.arma(); await reloj.tick(); await reloj.tick(); await reloj.tick();
  assert.equal(despertares, 1, "misma pantalla y misma base: ya avisada");
  base = { v: 7 }; // se leyó otra pantalla entre medias
  s.arma(); await reloj.tick(); await reloj.tick();
  assert.equal(despertares, 2);
});

test("una vigía sin muestra no cuenta, y otra sí puede despertar", async () => {
  const reloj = relojFalso();
  const despertares = [];
  const s = creaSensor([
    { muestra: () => null, base: () => 0, cambia: distinto },
    { muestra: () => 9, base: () => 0, cambia: distinto },
  ], (p) => despertares.push(p), { reloj });
  s.arma(); await reloj.tick(); await reloj.tick();
  assert.deepEqual(despertares, [[null, 9]]);
});

test("parar el sensor corta el muestreo y rearmarlo empieza sin muestra previa", async () => {
  const reloj = relojFalso();
  let despertares = 0;
  const s = creaSensor([{ muestra: () => 5, base: () => 0, cambia: distinto }], () => despertares++, { reloj });
  s.arma(); await reloj.tick();
  s.para();
  assert.equal(reloj.fn, null);
  s.arma(); await reloj.tick();
  assert.equal(despertares, 0, "la muestra de antes de parar no cuenta como previa");
  await reloj.tick();
  assert.equal(despertares, 1);
});

// --- El sensor del escáner de escritorio, sobre píxeles -----------------------------------------

const W = 640, H = 360;
/** Frame con la franja del rótulo (x 60-288, y 13-31) a rayas y la zona de la carta de riven lisa. */
function frame({ rotulo = 0, carta = 30 } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let v = 30;
    if (x >= 60 && x < 288 && y >= 13 && y < 31) v = ((x >> 3) & 1) ^ rotulo ? 220 : 30;
    if (y >= 200 && y < 320 && x >= 100 && x < 540) v = carta;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { videoWidth: W, videoHeight: H, width: W, height: H, data };
}
const CARTA = { x: 0.13, y: 0.50, w: 0.74, h: 0.40 };

function escanerFalso(video) {
  return { lastHeaderHash: regionLuma(video, FRANJA_TITULO_VIDEO), lastHashL: null, _cartaVigilada: null, scanInterval: null, _franjaTickAnterior: null, vueltas: 0, loop() { this.vueltas++; } };
}

test("el escáner se despierta cuando el rótulo cambia y se para, con la franja previa para processFrame", async () => {
  const video = frame();
  const esc = escanerFalso(video);
  const reloj = relojFalso();
  sensorDelEscaner(esc, video, { reloj }).arma();
  await reloj.tick(); await reloj.tick();
  assert.equal(esc.vueltas, 0, "el rótulo no ha cambiado");
  video.data = frame({ rotulo: 1 }).data;
  await reloj.tick();
  assert.equal(esc.vueltas, 0, "primera muestra de la pantalla nueva: puede seguir moviéndose");
  await reloj.tick();
  assert.equal(esc.vueltas, 1);
  assert.deepEqual([...esc._franjaTickAnterior], [...regionLuma(video, FRANJA_TITULO_VIDEO)]);
});

test("con una carta de riven vigilada, ciclarla despierta al escáner aunque el rótulo no cambie", async () => {
  const video = frame();
  const esc = escanerFalso(video);
  const reloj = relojFalso();
  sensorDelEscaner(esc, video, { reloj }).arma();
  video.data = frame({ carta: 200 }).data;
  await reloj.tick(); await reloj.tick();
  assert.equal(esc.vueltas, 0, "sin carta vigilada la región de la carta no cuenta");

  video.data = frame().data;
  Object.assign(esc, { _cartaVigilada: CARTA, lastHashL: firmaTexto(video, CARTA) });
  sensorDelEscaner(esc, video, { reloj }).arma();
  video.data = frame({ carta: 200 }).data;
  await reloj.tick(); await reloj.tick();
  assert.equal(esc.vueltas, 1);
});

// Jugando (UNKNOWN) la franja se para y arranca a cada rato: solo despierta si es un rótulo conocido,
// y una pantalla rechazada no se vuelve a evaluar mientras siga igual.
test("una vigía con filtro solo despierta si lo acepta, y no reevalúa la misma pantalla", async () => {
  const reloj = relojFalso();
  let evaluaciones = 0, despertares = 0, acepta = false;
  const s = creaSensor([{ muestra: () => 5, base: () => 0, cambia: distinto, acepta: () => { evaluaciones++; return acepta; } }], () => despertares++, { reloj });
  s.arma();
  for (let i = 0; i < 5; i++) await reloj.tick();
  assert.equal(despertares, 0);
  assert.equal(evaluaciones, 1, "la misma pantalla quieta se evalúa una vez");
  acepta = true;
  const t = creaSensor([{ muestra: () => 5, base: () => 0, cambia: distinto, acepta: () => acepta }], () => despertares++, { reloj });
  t.arma();
  await reloj.tick(); await reloj.tick();
  assert.equal(despertares, 1);
});

test("una muestra lenta no se solapa con la siguiente", async () => {
  let llamadas = 0, suelta;
  const muestra = () => { llamadas++; return new Promise((r) => { suelta = r; }); };
  let despertares = 0;
  const reloj = relojFalso();
  const s = creaSensor([{ muestra, base: () => 0, cambia: distinto }], () => despertares++, { reloj });
  s.arma();
  const primera = reloj.tick();
  reloj.tick();
  assert.equal(llamadas, 1);
  suelta(5);
  await primera;
  reloj.tick();
  assert.equal(llamadas, 2);
});

test("una muestra que llega después de parar o rearmar no despierta", async () => {
  let llamadas = 0, suelta;
  const muestra = () => { llamadas++; return llamadas === 1 ? 5 : new Promise((r) => { suelta = r; }); };
  let despertares = 0;
  const reloj = relojFalso();
  let s = creaSensor([{ muestra, base: () => 0, cambia: distinto }], () => despertares++, { reloj });
  s.arma();
  await reloj.tick();
  const pendiente = reloj.tick();
  s.para();
  suelta(5);
  await pendiente;
  assert.equal(despertares, 0);

  llamadas = 0;
  despertares = 0;
  s = creaSensor([{ muestra, base: () => 0, cambia: distinto }], () => despertares++, { reloj });
  s.arma();
  await reloj.tick();
  const p2 = reloj.tick();
  s.arma();
  suelta(5);
  await p2;
  assert.equal(despertares, 0);
});

test("una muestra que falla no rompe el sensor", async () => {
  let llamadas = 0;
  const muestra = () => { llamadas++; if (llamadas === 1) throw new Error("x"); return 5; };
  let despertares = 0;
  const reloj = relojFalso();
  const s = creaSensor([{ muestra, base: () => 0, cambia: distinto }], () => despertares++, { reloj });
  const warnOriginal = console.warn;
  let warnCount = 0;
  console.warn = () => warnCount++;
  try {
    s.arma();
    await reloj.tick();
    await reloj.tick();
    await reloj.tick();
    assert.equal(despertares, 1);
    assert.equal(warnCount, 1);
  } finally {
    console.warn = warnOriginal;
  }
});

test("el sensor del escáner muestrea la franja del rótulo con createImageBitmap, como processFrame", async (t) => {
  const video = frame();
  const esc = escanerFalso(video);
  const reloj = relojFalso();
  const llamadas = [];
  globalThis.createImageBitmap = async (...args) => {
    llamadas.push(args);
    const { resizeWidth: width, resizeHeight: height } = args.at(-1);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = 30; data[i + 3] = 255; }
    return { width, height, data, close() {} };
  };
  t.after(() => { delete globalThis.createImageBitmap; });
  sensorDelEscaner(esc, video, { reloj }).arma();
  await reloj.tick();
  const W = video.videoWidth, H = video.videoHeight;
  assert.ok(llamadas[0]?.[0] === video, "recorta del vídeo");
  assert.deepEqual(llamadas[0].slice(1), [Math.floor(W * FRANJA_TITULO_VIDEO.x), Math.floor(H * FRANJA_TITULO_VIDEO.y), Math.floor(W * FRANJA_TITULO_VIDEO.w), Math.floor(H * FRANJA_TITULO_VIDEO.h), { resizeWidth: 64, resizeHeight: 8 }]);
});
