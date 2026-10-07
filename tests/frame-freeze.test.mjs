// freezing the frame before reading it: the reward pipeline read the LIVE <video> at every stage, seconds apart,
// so the band was found in one frame and each OCR read another

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { freezeFrame, releaseFrame, shareFrame, stopSharingFrame, sharedFrame } = await import("../deploy/js/utils/vision/frame_freeze.js");

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

function videoDe(w, h, v) {
  const cvs = new FakeCanvas(w, h);
  cvs._data.fill(v);
  cvs.videoWidth = w;
  cvs.videoHeight = h;
  return cvs;
}

test("fuera de un tick cada lectura va al vídeo, como siempre", () => {
  const video = videoDe(8, 4, 50);
  assert.equal(sharedFrame(video), video);
});

test("dentro del tick todas las lecturas comparten una copia del fotograma", () => {
  const video = videoDe(8, 4, 50);
  shareFrame(video);
  const copia = sharedFrame(video, 1000);
  assert.notEqual(copia, video);
  assert.equal(copia.width, 8);
  video._data.fill(200);
  assert.equal(sharedFrame(video, 1030), copia);
  assert.equal(copia._data[0], 50, "las sondas del mismo tick miran la misma imagen");
  stopSharingFrame();
});

test("una lectura que llega tarde dentro del tick vuelve a copiar", () => {
  const video = videoDe(8, 4, 50);
  shareFrame(video);
  const copia = sharedFrame(video, 1000);
  video._data.fill(200);
  assert.equal(sharedFrame(video, 1200)._data[0], 200);
  assert.equal(sharedFrame(video, 1200), copia, "reutiliza el mismo canvas");
  stopSharingFrame();
});

test("solo se comparte el vídeo del tick, y al cerrarlo se vuelve a leer directo", () => {
  const video = videoDe(8, 4, 50);
  const otro = videoDe(8, 4, 90);
  shareFrame(video);
  assert.equal(sharedFrame(otro, 1000), otro);
  stopSharingFrame();
  assert.equal(sharedFrame(video, 1000), video);
});

test("un vídeo sin tamaño todavía no se copia", () => {
  const video = videoDe(8, 4, 50);
  video.videoWidth = 0;
  shareFrame(video);
  assert.equal(sharedFrame(video, 1000), video);
  stopSharingFrame();
});

test("al parar el escáner la copia suelta su memoria", () => {
  const video = videoDe(8, 4, 50);
  shareFrame(video);
  const copia = sharedFrame(video, 1000);
  stopSharingFrame({ release: true });
  assert.equal(copia.width, 0);
  shareFrame(video);
  assert.equal(sharedFrame(video, 2000).width, 8, "el siguiente tick vuelve a dimensionarla");
  stopSharingFrame({ release: true });
});
