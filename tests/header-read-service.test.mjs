// OCR de la cabecera con sus pasadas de rescate (services/scanner/header_read.service.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { leeCabeceraOCR, RESCATE_CABECERA_MS } = await import("../deploy/js/services/scanner/header_read.service.js");
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { pistasDelLog } = await import("../deploy/js/utils/ganchos.js");

const W = 640, H = 360;
const video = { videoWidth: W, videoHeight: H, width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(40) };
/** Worker que devuelve las lecturas en orden y cuenta cuántas se le pidieron. */
const worker = (...textos) => ({ n: 0, vistos: [], recognize: async function (img) { this.vistos.push(img); return { data: { text: textos[Math.min(this.n++, textos.length - 1)] } }; } });

test("con la cabecera legible no hay pasadas de rescate", async () => {
  const w = worker("VOID FISSURE/REWARDS");
  const r = await leeCabeceraOCR({ latchedContext: "UNKNOWN", _ultimoRescate: 0 }, video, new FakeCanvas(10, 10), w, true);
  assert.deepEqual(r, { headerText: "VOID FISSURE/REWARDS", pasadas: 1 });
});

// MISSION COMPLETE no cae en el recorte izquierdo: sin el título centrado esa pantalla es invisible.
test("ilegible y con la pantalla quieta, el título centrado rescata el fin de misión", async () => {
  const escaner = { latchedContext: "UNKNOWN", _ultimoRescate: 0 };
  const w = worker("BB MIS", "MISSION COMPLETE");
  const r = await leeCabeceraOCR(escaner, video, new FakeCanvas(10, 10), w, true);
  assert.equal(r.headerText, "MISSION COMPLETE");
  assert.ok(r.pasadas >= 2);
  assert.ok(escaner._ultimoRescate > 0, "el rescate se apunta para el límite de ritmo");
});

test("en movimiento, los rescates van como mucho cada RESCATE_CABECERA_MS", async () => {
  const escaner = { latchedContext: "UNKNOWN", _ultimoRescate: Date.now() };
  const r = await leeCabeceraOCR(escaner, video, new FakeCanvas(10, 10), worker("go TC", "MISSION COMPLETE"), false);
  assert.deepEqual(r, { headerText: "go TC", pasadas: 1 });
  escaner._ultimoRescate = Date.now() - RESCATE_CABECERA_MS;
  const r2 = await leeCabeceraOCR(escaner, video, new FakeCanvas(10, 10), worker("go TC", "MISSION COMPLETE"), false);
  assert.equal(r2.headerText, "MISSION COMPLETE");
});

function conTemaYLog(t, enMision) {
  const original = { fin: VisionService.finalizeVirtualCanvas, umbral: VisionService.applyThemeDistanceThreshold, enMision: pistasDelLog.enMision };
  t.after(() => {
    VisionService.finalizeVirtualCanvas = original.fin;
    VisionService.applyThemeDistanceThreshold = original.umbral;
    pistasDelLog.enMision = original.enMision;
  });
  VisionService.finalizeVirtualCanvas = () => ({ r: 200, g: 160, b: 60 });
  VisionService.applyThemeDistanceThreshold = () => {};
  pistasDelLog.enMision = () => enMision;
}

test("dentro de misión según el log no se pagan pasadas de rescate", async (t) => {
  conTemaYLog(t, true);
  const w = worker("go TC", "MISSION COMPLETE");
  const r = await leeCabeceraOCR({ latchedContext: "UNKNOWN", _ultimoRescate: 0 }, video, new FakeCanvas(10, 10), w, true);
  assert.deepEqual(r, { headerText: "go TC", pasadas: 1 });
  assert.equal(w.n, 1);
});

test("con log y fuera de misión solo queda el título centrado", async (t) => {
  conTemaYLog(t, false);
  const w = worker("go TC", "MISSION COMPLETE");
  const r = await leeCabeceraOCR({ latchedContext: "UNKNOWN", _ultimoRescate: 0 }, video, new FakeCanvas(10, 10), w, true);
  assert.deepEqual(r, { headerText: "MISSION COMPLETE", pasadas: 2 });
  assert.ok(!w.vistos.includes(VisionService.lienzo("cabeceraTema")), "la pasada por tema no corre con log");
});

test("sin log siguen las dos pasadas de rescate", async (t) => {
  conTemaYLog(t, null);
  const w = worker("go TC", "go TC", "MISSION COMPLETE");
  const r = await leeCabeceraOCR({ latchedContext: "UNKNOWN", _ultimoRescate: 0 }, video, new FakeCanvas(10, 10), w, true);
  assert.deepEqual(r, { headerText: "MISSION COMPLETE", pasadas: 3 });
  assert.equal(w.n, 3);
});
