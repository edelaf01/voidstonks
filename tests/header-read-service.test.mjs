// OCR de la cabecera con sus pasadas de rescate (services/scanner/header_read.service.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { leeCabeceraOCR, RESCATE_CABECERA_MS } = await import("../deploy/js/services/scanner/header_read.service.js");

const W = 640, H = 360;
const video = { videoWidth: W, videoHeight: H, width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(40) };
/** Worker que devuelve las lecturas en orden y cuenta cuántas se le pidieron. */
const worker = (...textos) => ({ n: 0, recognize: async function () { return { data: { text: textos[Math.min(this.n++, textos.length - 1)] } }; } });

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
