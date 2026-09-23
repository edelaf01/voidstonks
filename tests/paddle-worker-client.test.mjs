// El lado de la página del worker de Paddle: mismo `recognize(fuente)` que la librería, con las
// respuestas casadas por id, timeouts que matan al worker colgado y muerte que rechaza lo que
// hubiera en vuelo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PaddleWorkerClient } from "../deploy/js/repositories/paddle_worker_client.js";

/** Worker de objeto plano: registra lo enviado y deja contestar a mano. */
function workerPlano() {
  const w = { enviados: [], terminados: 0, postMessage(msg, transfer) { w.enviados.push({ msg, transfer }); }, terminate() { w.terminados++; } };
  return w;
}
const timersFalsos = () => { const t = []; return { timers: t, programa: (fn, ms) => { const x = { fn, ms }; t.push(x); return x; }, cancela: () => {} }; };

function cliente(extra = {}) {
  const w = workerPlano();
  const c = new PaddleWorkerClient({ crearWorker: () => w, aBitmap: async (f) => ({ bitmap: f }), ...extra });
  return { w, c };
}

test("init manda cdn, modelo y opciones, y resuelve con lo que contesta el worker", async () => {
  const { w, c } = cliente();
  const p = c.init({ cdn: "https://cdn/x", pedido: null, local: { detection: "https://p/det" }, opciones: { a: 1 } });
  assert.deepEqual(w.enviados[0].msg, { tipo: "init", id: 1, cdn: "https://cdn/x", pedido: null, local: { detection: "https://p/det" }, opciones: { a: 1 } });
  w.onmessage({ data: { tipo: "resultado", id: 1, resultado: { proveedores: ["wasm"], aislado: false } } });
  assert.deepEqual(await p, { proveedores: ["wasm"], aislado: false });
  c.terminate();
});

test("recognize convierte la fuente en bitmap y lo TRANSFIERE", async () => {
  globalThis.ImageBitmap = class { constructor() { this.width = 1; } };
  try {
    const bitmap = new globalThis.ImageBitmap();
    const { w, c } = cliente({ aBitmap: async () => bitmap });
    const p = c.recognize({ canvas: true });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(w.enviados[0].msg.tipo, "recognize");
    assert.equal(w.enviados[0].msg.imagen, bitmap);
    assert.deepEqual(w.enviados[0].transfer, [bitmap], "copiarlo en vez de transferirlo duplica 3 MB por página");
    w.onmessage({ data: { tipo: "resultado", id: w.enviados[0].msg.id, resultado: { text: "ok" } } });
    assert.deepEqual(await p, { text: "ok" });
    c.terminate();
  } finally { delete globalThis.ImageBitmap; }
});

test("cada respuesta resuelve la petición de su id aunque lleguen desordenadas", async () => {
  const { w, c } = cliente();
  const a = c.recognize("a"), b = c.recognize("b");
  await new Promise((r) => setTimeout(r, 0));
  const [ida, idb] = w.enviados.map((e) => e.msg.id);
  w.onmessage({ data: { tipo: "resultado", id: idb, resultado: "B" } });
  w.onmessage({ data: { tipo: "resultado", id: ida, resultado: "A" } });
  assert.deepEqual(await Promise.all([a, b]), ["A", "B"]);
  c.terminate();
});

test("un error del worker rechaza solo esa petición", async () => {
  const { w, c } = cliente();
  const a = c.recognize("a"), b = c.recognize("b");
  await new Promise((r) => setTimeout(r, 0));
  w.onmessage({ data: { tipo: "error", id: w.enviados[0].msg.id, error: { message: "tensor", name: "RangeError" } } });
  await assert.rejects(a, (e) => e.message === "tensor" && e.name === "RangeError");
  w.onmessage({ data: { tipo: "resultado", id: w.enviados[1].msg.id, resultado: "B" } });
  assert.equal(await b, "B");
  assert.equal(c.vivo, true);
  c.terminate();
});

test("si el worker muere, las peticiones en vuelo se rechazan, se termina y se avisa una vez", async () => {
  const muertes = [];
  const { w, c } = cliente({ onMuerte: (e) => muertes.push(e.message) });
  const a = c.recognize("a"), b = c.recognize("b");
  await new Promise((r) => setTimeout(r, 0));
  w.onerror({ message: "boom" });
  w.onerror({ message: "boom otra vez" });
  await assert.rejects(a, /boom/);
  await assert.rejects(b, /boom/);
  assert.equal(w.terminados, 1);
  assert.equal(c.vivo, false);
  assert.deepEqual(muertes, ["boom"]);
  await assert.rejects(c.recognize("c"), /terminado/);
  assert.equal(w.enviados.length, 2, "muerto no se le manda nada");
});

test("un timeout mata al worker en vez de esperar para siempre", async () => {
  const { timers, programa, cancela } = timersFalsos();
  const muertes = [];
  const { w, c } = cliente({ programa, cancela, timeoutMs: 20000, onMuerte: (e) => muertes.push(e.message) });
  const p = c.recognize("a");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(timers[0].ms, 20000);
  timers[0].fn();
  await assert.rejects(p, /sin respuesta/);
  assert.equal(w.terminados, 1);
  assert.match(muertes[0], /sin respuesta en 20000 ms/);
});

test("los logs del worker salen por la consola de la página con prefijo", () => {
  const { w, c } = cliente();
  const avisos = [];
  const orig = console.warn;
  console.warn = (...a) => avisos.push(a);
  try {
    w.onmessage({ data: { tipo: "log", nivel: "warn", args: ["ojo", "3"] } });
  } finally { console.warn = orig; }
  assert.deepEqual(avisos, [["[Paddle worker]", "ojo", "3"]]);
  c.terminate();
});
