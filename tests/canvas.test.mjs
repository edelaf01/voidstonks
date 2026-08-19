import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

const doc = installFakeDocument();

let frames = 0;
globalThis.requestAnimationFrame = (fn) => {
  if (++frames > 3) return 0;
  fn(performance.now());
  return frames;
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => tema });
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.window = globalThis;
globalThis.addEventListener = () => {};

let tema = "#d4af37";

const { initCanvas } = await import("../deploy/js/utils/canvas.js");

function conCanvas(fn) {
  frames = 0;
  const cvs = new FakeCanvas(320, 240);
  doc._registrar("void-traces-canvas", cvs);
  try { return fn(cvs); } finally { doc._registrar("void-traces-canvas", null); }
}

test("sin el canvas en la página no se hace nada ni se falla", () => {
  doc._registrar("void-traces-canvas", null);
  assert.doesNotThrow(() => initCanvas());
});

test("con el canvas, arranca y encadena frames", async () => {
  await conCanvas(async () => {
    assert.doesNotThrow(() => initCanvas());
    await new Promise((r) => globalThis.setTimeout(r, 150));
    assert.ok(frames > 0, "el bucle tiene que haberse encadenado solo");
  });
});

test("los tres formatos de color de tema se digieren", () => {
  for (const valor of ["#d4af37", "var(--accent)", "", "no-es-un-color", "#abc"]) {
    tema = valor;
    conCanvas(() => {
      assert.doesNotThrow(() => initCanvas(), `falló con tema ${JSON.stringify(valor)}`);
    });
  }
  tema = "#d4af37";
});

test("un canvas sin tamaño no rompe el arranque", () => {
  frames = 0;
  const cvs = new FakeCanvas(0, 0);
  doc._registrar("void-traces-canvas", cvs);
  try {
    assert.doesNotThrow(() => initCanvas());
  } finally { doc._registrar("void-traces-canvas", null); }
});
