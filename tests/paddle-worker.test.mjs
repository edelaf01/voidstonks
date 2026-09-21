// El extremo del worker de Paddle: carga la librería que le mandan, atiende en orden y contesta
// SIEMPRE (resultado o error con el id de la petición). Se ejercita por un MessageChannel real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrancaWorkerPaddle } from "../deploy/js/repositories/paddle.worker.js";
import { libreriaFalsa, canvasFalso, BitmapFalso } from "./_helpers/fake-paddle-worker.mjs";

/** Arranca el worker sobre un canal y devuelve cómo hablarle y esperar respuestas por id. */
function montaWorker({ mod, crearCanvas = canvasFalso(), consola = null } = {}) {
  const { port1, port2 } = new MessageChannel();
  const urls = [];
  arrancaWorkerPaddle(port2, { importar: async (u) => { urls.push(u); return mod; }, crearCanvas, consola });
  const esperas = new Map();
  const sueltos = [];
  port1.onmessage = (ev) => { const m = ev.data; if (m.id && esperas.has(m.id)) esperas.get(m.id)(m); else sueltos.push(m); };
  const pide = (msg) => new Promise((r) => { esperas.set(msg.id, r); port1.postMessage(msg); });
  const cierra = () => { port1.close(); port2.close(); };
  return { pide, urls, sueltos, cierra };
}
const INIT = { tipo: "init", id: 1, cdn: "https://cdn/x", pedido: null, local: { detection: "https://p/det" }, opciones: { recognition: { strategy: "per-box" } } };

test("carga la librería del CDN que le mandan y contesta listo con los proveedores", async () => {
  const { mod, inits } = libreriaFalsa({ proveedores: ["webgpu", "wasm"] });
  const w = montaWorker({ mod });
  try {
    const r = await w.pide(INIT);
    assert.deepEqual(w.urls, ["https://cdn/x"]);
    assert.deepEqual(inits, [{ model: { detection: "https://p/det" }, recognition: { strategy: "per-box" } }]);
    assert.deepEqual(r, { tipo: "resultado", id: 1, resultado: { proveedores: ["webgpu", "wasm"], aislado: false } });
  } finally { w.cierra(); }
});

test("las lecturas esperan a la carga y salen en orden de petición", async () => {
  let n = 0;
  const { mod } = libreriaFalsa({ recognize: async () => { const k = ++n; await new Promise((r) => setTimeout(r, k === 1 ? 20 : 0)); return { text: `T${k}` }; } });
  const w = montaWorker({ mod });
  try {
    const [, a, b] = await Promise.all([w.pide(INIT), w.pide({ tipo: "recognize", id: 2, imagen: new BitmapFalso() }), w.pide({ tipo: "recognize", id: 3, imagen: new BitmapFalso() })]);
    assert.equal(a.resultado.text, "T1");
    assert.equal(b.resultado.text, "T2");
  } finally { w.cierra(); }
});

test("una lectura antes de init falla con error, no cuelga", async () => {
  const w = montaWorker(libreriaFalsa());
  try {
    const r = await w.pide({ tipo: "recognize", id: 7, imagen: new BitmapFalso() });
    assert.equal(r.tipo, "error"); assert.equal(r.id, 7); assert.match(r.error.message, /sin inicializar/);
  } finally { w.cierra(); }
});

test("un fallo de la librería contesta error con SU id y el worker sigue vivo", async () => {
  let vez = 0;
  const { mod } = libreriaFalsa({ recognize: async () => { if (++vez === 1) throw new RangeError("tensor"); return { text: "bien" }; } });
  const w = montaWorker({ mod });
  try {
    await w.pide(INIT);
    const mal = await w.pide({ tipo: "recognize", id: 2, imagen: new BitmapFalso() });
    assert.deepEqual(mal, { tipo: "error", id: 2, error: { message: "tensor", name: "RangeError" } });
    const bien = await w.pide({ tipo: "recognize", id: 3, imagen: new BitmapFalso() });
    assert.equal(bien.resultado.text, "bien");
  } finally { w.cierra(); }
});

test("el bitmap se pinta en un canvas con willReadFrequently antes de dibujar, y se cierra", async () => {
  const registro = [];
  let pintado = null;
  const { mod } = libreriaFalsa({ recognize: async (c) => { pintado = c; return { text: "x" }; } });
  const w = montaWorker({ mod, crearCanvas: canvasFalso(registro) });
  const bitmap = new BitmapFalso(30, 12);
  try {
    await w.pide(INIT);
    // Por el canal el bitmap viaja clonado: el `close` se comprueba sobre el que llega al worker.
    const port = { postMessage() {}, onmessage: null };
    let cerrado = null;
    const local = { width: 30, height: 12, close() { cerrado = true; } };
    arrancaWorkerPaddle(port, { importar: async () => mod, crearCanvas: canvasFalso(registro) });
    port.onmessage({ data: INIT });
    port.onmessage({ data: { tipo: "recognize", id: 2, imagen: local } });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(cerrado, true, "sin close el bitmap vive hasta el GC");
    assert.deepEqual(registro[0], ["getContext", { willReadFrequently: true }]);
    assert.equal(registro[1][0], "drawImage");
    assert.equal(pintado.width, 30);
    assert.equal(bitmap.cerrado, false);
  } finally { w.cierra(); }
});

test("el resultado viaja limpio por structured clone aunque la librería cuele una función", async () => {
  const { mod } = libreriaFalsa({ recognize: async () => ({ text: "A", lines: [[{ text: "A", box: { x: 0, y: 0, width: 5, height: 5 }, tensor: { dispose() {} } }]] }) });
  const w = montaWorker({ mod });
  try {
    await w.pide(INIT);
    const r = await w.pide({ tipo: "recognize", id: 2, imagen: new BitmapFalso() });
    assert.deepEqual(r.resultado.lines[0][0], { text: "A", confidence: null, box: { x: 0, y: 0, width: 5, height: 5 } });
  } finally { w.cierra(); }
});

test("los avisos del worker van a la página; los errores se quedan en su consola", async () => {
  const error = () => {};
  const consola = { log() {}, info() {}, debug() {}, warn() {}, error };
  const w = montaWorker({ ...libreriaFalsa(), consola });
  try {
    consola.warn("ojo", 3);
    await w.pide(INIT);
    assert.deepEqual(w.sueltos[0], { tipo: "log", nivel: "warn", args: ["ojo", "3"] });
    assert.equal(consola.error, error);
  } finally { w.cierra(); }
});
