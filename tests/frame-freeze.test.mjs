// freezing the frame before reading it: the reward pipeline read the LIVE <video> at every stage, seconds apart,
// so the band was found in one frame and each OCR read another

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { freezeFrame, releaseFrame } = await import("../deploy/js/utils/vision/frame_freeze.js");

/** a source that keeps changing, like the <video>: every read returns another "frame" */
function fuenteQueCambia() {
  let n = 0;
  return { get frame() { return n; }, avanzar() { n++; } };
}

test("devuelve un canvas del tamaño pedido", () => {
  const cvs = freezeFrame(new FakeCanvas(10, 10), 320, 180);
  assert.equal(cvs.width, 320);
  assert.equal(cvs.height, 180);
});

// a canvas per frame leaves backing stores the browser frees much slower than the normal heap
test("reutiliza el canvas que se le pasa", () => {
  const primero = freezeFrame(new FakeCanvas(10, 10), 320, 180);
  const segundo = freezeFrame(new FakeCanvas(10, 10), 320, 180, primero);
  assert.equal(segundo, primero, "no debe crear uno nuevo por frame");
});

// setting width/height CLEARS the canvas, so it is only touched when the size really changes
test("solo redimensiona cuando el tamaño cambia", () => {
  const cvs = freezeFrame(new FakeCanvas(10, 10), 320, 180);
  const mismo = freezeFrame(new FakeCanvas(10, 10), 640, 360, cvs);
  assert.equal(mismo, cvs, "sigue siendo el mismo canvas");
  assert.equal(mismo.width, 640);
  assert.equal(mismo.height, 360);
});

test("lee la fuente UNA vez y el resultado ya no cambia con ella", () => {
  const fuente = fuenteQueCambia();
  let leidos = 0;
  const cvs = new FakeCanvas(320, 180);
  const ctx = cvs.getContext("2d");
  ctx.drawImage = () => { leidos++; };

  freezeFrame(fuente, 320, 180, cvs);
  assert.equal(leidos, 1);

  fuente.avanzar();
  assert.equal(leidos, 1, "congelar significa que nadie relee la fuente por su cuenta");
});

// at 1440p the canvas is ~15 MB; outside the rewards screen there is no reason to keep it
test("releaseFrame suelta el backing store", () => {
  const cvs = freezeFrame(new FakeCanvas(10, 10), 2560, 1440);
  assert.equal(releaseFrame(cvs), null, "devuelve null para poder reasignar en el llamante");
  assert.equal(cvs.width, 0);
  assert.equal(cvs.height, 0);
});

test("releaseFrame tolera que no haya canvas", () => {
  assert.equal(releaseFrame(null), null);
  assert.equal(releaseFrame(undefined), null);
});

test("un canvas soltado se puede reutilizar", () => {
  const cvs = freezeFrame(new FakeCanvas(10, 10), 640, 360);
  releaseFrame(cvs);
  const otra = freezeFrame(new FakeCanvas(10, 10), 640, 360, cvs);
  assert.equal(otra.width, 640);
  assert.equal(otra.height, 360);
});
