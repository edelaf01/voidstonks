// El fondo animado de trazos ("void traces").
//
// Es decorativo: si no se ve, nadie pierde datos. Pero corre en el arranque, en un
// `requestAnimationFrame` continuo, y toca `getComputedStyle` — o sea que un fallo aquí es un
// error en consola en CADA carga, o un bucle de animación que no para al cambiar de pestaña.
// Eso es lo que se protege; el aspecto no se puede comprobar sin ojos.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

const doc = installFakeDocument();

let frames = 0;
let maxFrames = 3;
globalThis.requestAnimationFrame = (fn) => {
  // Se corta a los pocos frames: el bucle real es infinito por diseño.
  if (++frames > maxFrames) return 0;
  fn(performance.now());
  return frames;
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => tema });
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
// canvas.js usa `window` a pelo (como otros 21 sitios del repo); en navegador es el mismo
// objeto que globalThis, así que aquí se enlaza en vez de tocar producción por un test.
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

// El canvas del fondo no está en todas las vistas ni en el móvil: initCanvas se llama igual.
test("sin el canvas en la página no se hace nada ni se falla", () => {
  doc._registrar("void-traces-canvas", null);
  assert.doesNotThrow(() => initCanvas());
});

// El primer frame se pinta síncrono y los siguientes los encadena un temporizador a 15 Hz, no
// un requestAnimationFrame corriendo a la frecuencia del monitor. Por eso hay que esperar un
// pulso para ver el segundo: si el encadenado se rompiera, el fondo se quedaría congelado tras
// el primer frame y ningún test síncrono lo notaría.
test("con el canvas, arranca y encadena frames", async () => {
  await conCanvas(async () => {
    assert.doesNotThrow(() => initCanvas());
    await new Promise((r) => globalThis.setTimeout(r, 150));
    assert.ok(frames > 0, "el bucle tiene que haberse encadenado solo");
  });
});

// El color sale de la variable CSS del tema activo, que puede venir en tres formas distintas
// (hex, `var(--otra)`, o vacía). Ninguna de las tres puede tirar el arranque, y la vacía tiene
// que caer al dorado Orokin en vez de dejar los trazos invisibles.
test("los tres formatos de color de tema se digieren", () => {
  for (const valor of ["#d4af37", "var(--accent)", "", "no-es-un-color", "#abc"]) {
    tema = valor;
    conCanvas(() => {
      assert.doesNotThrow(() => initCanvas(), `falló con tema ${JSON.stringify(valor)}`);
    });
  }
  tema = "#d4af37";
});

// Un canvas de 0×0 aparece cuando la pestaña arranca oculta; sin guarda, el cálculo de la
// rejilla divide entre cero y llena la consola de NaN.
test("un canvas sin tamaño no rompe el arranque", () => {
  frames = 0;
  const cvs = new FakeCanvas(0, 0);
  doc._registrar("void-traces-canvas", cvs);
  try {
    assert.doesNotThrow(() => initCanvas());
  } finally { doc._registrar("void-traces-canvas", null); }
});

// El color sale de getComputedStyle, que fuerza un recálculo de estilo del documento entero.
// Resolverlo por frame eran 15 recálculos por segundo a cuenta de un adorno del fondo; pero
// cachearlo contra la clave equivocada es peor todavía: el fondo se quedaría con el color del
// tema anterior para siempre y nadie relacionaría el síntoma con este archivo.
test("el color del tema se resuelve una vez por tema, no una por frame", async () => {
  let consultas = 0;
  const gcs = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({
    getPropertyValue: () => { consultas++; return tema; },
  });
  try {
    // Los initCanvas de los tests anteriores dejaron sus bucles vivos y siguen consultando el
    // color. maxFrames = 0 hace que su siguiente rAF no dispare, y sin ese rAF ya no se
    // reencadenan: a los 200 ms el único bucle que queda es el de este test.
    maxFrames = 0;
    await new Promise((r) => globalThis.setTimeout(r, 200));

    await conCanvas(async () => {
      maxFrames = 12;
      consultas = 0;
      doc.body.className = "theme-relic";
      initCanvas();
      await new Promise((r) => globalThis.setTimeout(r, 250));
      assert.ok(frames >= 2, "hacen falta varios frames para que la caché signifique algo");
      assert.equal(consultas, 1, "el color no puede resolverse en cada frame");

      doc.body.className = "theme-riven";
      await new Promise((r) => globalThis.setTimeout(r, 250));
      assert.equal(consultas, 2, "al cambiar de tema se resuelve otra vez, y solo una");
    });
  } finally {
    globalThis.getComputedStyle = gcs;
    doc.body.className = "";
    maxFrames = 3;
  }
});
