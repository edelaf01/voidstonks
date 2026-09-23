// El protocolo página <-> worker de Paddle, en puro: lo que viaja, cómo se casan respuestas con
// peticiones, y las rutas que el worker no sabría resolver.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rutasAbsolutas, eligeModelo, aplanaResultado, crearLlamadasPendientes, puedeUsarWorker, transferiblesDe, respuestaError,
} from "../deploy/js/utils/vision/paddle_rpc.js";

const MODELO = { detection: "assets/ocr/det.ort", recognition: "assets/ocr/rec.ort", charactersDictionary: "assets/ocr/dict.txt" };

// En prod, relativas, el worker pedía /js/repositories/assets/ocr/... y daba 404: no arrancaba.
test("rutasAbsolutas resuelve los modelos contra la página, no contra el worker", () => {
  assert.deepEqual(rutasAbsolutas(MODELO, "https://voidstonks.com/scanner.html"), {
    detection: "https://voidstonks.com/assets/ocr/det.ort",
    recognition: "https://voidstonks.com/assets/ocr/rec.ort",
    charactersDictionary: "https://voidstonks.com/assets/ocr/dict.txt",
  });
});

test("rutasAbsolutas deja en paz URLs absolutas y buffers", () => {
  const buf = new ArrayBuffer(4);
  const r = rutasAbsolutas({ detection: "https://otro.host/x.ort", recognition: buf }, "https://voidstonks.com/");
  assert.equal(r.detection, "https://otro.host/x.ort");
  assert.equal(r.recognition, buf);
  assert.equal(rutasAbsolutas(null, "https://a/"), null);
});

test("eligeModelo: nombre del catálogo, objeto, o el nuestro si no existe", () => {
  const mod = { V5_MODEL: { nombre: "grande" } };
  assert.deepEqual(eligeModelo(mod, "V5_MODEL", MODELO), { nombre: "grande" });
  assert.deepEqual(eligeModelo(mod, { nombre: "mio" }, MODELO), { nombre: "mio" });
  assert.equal(eligeModelo(mod, "NO_EXISTE", MODELO), MODELO);
  assert.equal(eligeModelo(mod, null, MODELO), MODELO);
});

// postMessage lanza DataCloneError con una función dentro: se perdería la página entera.
test("aplanaResultado deja solo lo que viaja por postMessage", () => {
  const sucio = { text: "A", confidence: 0.9, lines: [[{ text: "A", box: { x: 1, y: 2, width: 3, height: 4 }, confidence: 0.8, tensor: { dispose() {} } }], { text: "B" }, null] };
  assert.throws(() => structuredClone(sucio));
  const limpio = aplanaResultado(sucio);
  assert.doesNotThrow(() => structuredClone(limpio));
  assert.deepEqual(limpio, { text: "A", confidence: 0.9, lines: [
    [{ text: "A", confidence: 0.8, box: { x: 1, y: 2, width: 3, height: 4 } }],
    [{ text: "B", confidence: null, box: null }],
    [],
  ] });
  assert.deepEqual(aplanaResultado(null), { text: "", confidence: null, lines: [] });
});

test("respuestaError serializa un Error y también una cadena", () => {
  assert.deepEqual(respuestaError(3, new TypeError("mal")), { tipo: "error", id: 3, error: { message: "mal", name: "TypeError" } });
  assert.equal(respuestaError(1, "x").error.message, "x");
});

function conTimersFalsos() {
  const timers = [];
  const programa = (fn, ms) => { const t = { fn, ms, cancelado: false }; timers.push(t); return t; };
  const cancela = (t) => { t.cancelado = true; };
  return { timers, programa, cancela };
}

test("cada respuesta resuelve solo su petición", async () => {
  const { programa, cancela } = conTimersFalsos();
  const p = crearLlamadasPendientes({ programa, cancela });
  const a = p.registra(1000), b = p.registra(1000);
  assert.notEqual(a.id, b.id);
  assert.equal(p.resuelve(b.id, "b"), true);
  assert.equal(await b.promesa, "b");
  assert.equal(p.enVuelo(), 1);
  p.rechaza(a.id, new Error("fin"));
  await assert.rejects(a.promesa, /fin/);
});

test("una petición sin respuesta expira y avisa", async () => {
  const { timers, programa, cancela } = conTimersFalsos();
  const p = crearLlamadasPendientes({ programa, cancela });
  let avisos = 0;
  const { id, promesa } = p.registra(500, () => avisos++);
  timers[0].fn();
  await assert.rejects(promesa, /sin respuesta en 500 ms/);
  assert.equal(avisos, 1);
  assert.equal(p.enVuelo(), 0);
  assert.equal(p.resuelve(id, "tarde"), false, "una respuesta tardía no revienta");
});

test("rechazaTodas vacía la cola y cancela los timers", async () => {
  const { timers, programa, cancela } = conTimersFalsos();
  const p = crearLlamadasPendientes({ programa, cancela });
  const a = p.registra(1000), b = p.registra(1000);
  p.rechazaTodas(new Error("muerto"));
  await assert.rejects(a.promesa, /muerto/);
  await assert.rejects(b.promesa, /muerto/);
  assert.equal(p.enVuelo(), 0);
  assert.ok(timers.every((t) => t.cancelado));
});

test("puedeUsarWorker exige las tres APIs y respeta PADDLE_WORKER=false", () => {
  const todo = { Worker: class {}, OffscreenCanvas: class {}, createImageBitmap: () => {} };
  assert.equal(puedeUsarWorker(todo), true);
  assert.equal(puedeUsarWorker({ ...todo, PADDLE_WORKER: false }), false);
  assert.equal(puedeUsarWorker({ ...todo, OffscreenCanvas: undefined }), false);
  assert.equal(puedeUsarWorker({}), false);
});

test("transferiblesDe solo transfiere un ImageBitmap de verdad", () => {
  assert.deepEqual(transferiblesDe({ width: 1 }), []);
  globalThis.ImageBitmap = class {};
  try {
    const b = new globalThis.ImageBitmap();
    assert.deepEqual(transferiblesDe(b), [b]);
  } finally { delete globalThis.ImageBitmap; }
});
