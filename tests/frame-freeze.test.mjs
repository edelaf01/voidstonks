// Congelar el frame antes de leerlo.
//
// El pipeline de recompensas leía del <video> EN VIVO en cada etapa, y entre la primera y la
// última pasan segundos (3 presets × 2 pasadas de Tesseract): la banda se detectaba en un frame,
// cada OCR leía otro, y la foto del modal era la de después de todo. El síntoma visible era que
// la captura de depuración no era la del momento de la detección; el invisible, que el reintento
// por presets comparaba pantallas distintas y las posiciones de los badges caían sobre otra.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { freezeFrame, releaseFrame } = await import("../deploy/js/utils/vision/frame_freeze.js");

/** Fuente que va cambiando, como el <video>: cada lectura devuelve un "frame" distinto. */
function fuenteQueCambia() {
  let n = 0;
  return { get frame() { return n; }, avanzar() { n++; } };
}

test("devuelve un canvas del tamaño pedido", () => {
  const cvs = freezeFrame(new FakeCanvas(10, 10), 320, 180);
  assert.equal(cvs.width, 320);
  assert.equal(cvs.height, 180);
});

// Crear un canvas por frame deja backing stores que el navegador libera mucho más despacio que
// el heap normal: con el escáner corriendo son cientos de MB (mismo motivo que el de inventario).
test("reutiliza el canvas que se le pasa", () => {
  const primero = freezeFrame(new FakeCanvas(10, 10), 320, 180);
  const segundo = freezeFrame(new FakeCanvas(10, 10), 320, 180, primero);
  assert.equal(segundo, primero, "no debe crear uno nuevo por frame");
});

// Reasignar width/height LIMPIA el canvas, así que solo se toca cuando cambia de verdad. El
// stream puede llegar reescalado a mitad de sesión, y ahí sí hay que redimensionar.
test("solo redimensiona cuando el tamaño cambia", () => {
  const cvs = freezeFrame(new FakeCanvas(10, 10), 320, 180);
  const mismo = freezeFrame(new FakeCanvas(10, 10), 640, 360, cvs);
  assert.equal(mismo, cvs, "sigue siendo el mismo canvas");
  assert.equal(mismo.width, 640);
  assert.equal(mismo.height, 360);
});

// Lo que de verdad arregla: una sola lectura de la fuente por llamada. Si el pipeline vuelve a
// leer del vídeo en cada etapa, las etapas dejan de mirar la misma imagen.
test("lee la fuente UNA vez y el resultado ya no cambia con ella", () => {
  const fuente = fuenteQueCambia();
  let leidos = 0;
  const cvs = new FakeCanvas(320, 180);
  const ctx = cvs.getContext("2d");
  ctx.drawImage = () => { leidos++; };

  freezeFrame(fuente, 320, 180, cvs);
  assert.equal(leidos, 1);

  // La fuente avanza; el canvas congelado no vuelve a tocarse solo.
  fuente.avanzar();
  assert.equal(leidos, 1, "congelar significa que nadie relee la fuente por su cuenta");
});

// A 1440p el canvas son ~15 MB. Se congela por frame mientras estás en la pantalla de
// recompensas, pero fuera de ella no hace falta: arrastrarlo toda la sesión es RAM regalada,
// y el escáner ya es lo que más consume de la app.
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

// Tras soltarlo, el siguiente frame tiene que volver a dimensionarlo, no quedarse en 0x0.
test("un canvas soltado se puede reutilizar", () => {
  const cvs = freezeFrame(new FakeCanvas(10, 10), 640, 360);
  releaseFrame(cvs);
  const otra = freezeFrame(new FakeCanvas(10, 10), 640, 360, cvs);
  assert.equal(otra.width, 640);
  assert.equal(otra.height, 360);
});
