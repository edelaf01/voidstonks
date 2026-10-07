// El pool de workers de Tesseract.
//
// El pool crece bajo demanda, pero con tope: cada worker es una instancia WASM con su copia del
// traineddata y el escáner ya es lo que más RAM consume de la app. El tope es dos: medido, el
// tercero y el cuarto solo aceleran una página un 10 % (el ritmo lo pone el hilo principal).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");

/** navigator es de solo lectura en Node: hay que redefinirlo, no asignarlo. */
const nucleos = (n) => Object.defineProperty(globalThis, "navigator",
  { value: { hardwareConcurrency: n }, configurable: true, writable: true });

let creados;

const img = { width: 10, height: 10 };
const workerFalso = (id) => ({
  id,
  terminados: 0,
  terminate() { this.terminados++; },
  setParameters: async () => {},
  recognize: async () => ({ data: { text: id } }),
});
const haceRato = () => Date.now() - OCRRepository.SUELTA_SOBRANTES_MS - 1;

beforeEach(() => {
  creados = 0;
  OCRRepository.workers = [{ id: 0 }];
  OCRRepository._workerPromises = null;
  OCRRepository._usoExtra = 0;
  OCRRepository._ocupados = 0;
  OCRRepository._createStandardWorker = async () => { creados++; return { id: `w${creados}` }; };
  nucleos(8);
});

test("pide uno por celda, hasta el tope del pool", async () => {
  await OCRRepository.ensureWorkers(18);
  assert.equal(OCRRepository.workers.length, OCRRepository.MAX_WORKERS);
  assert.equal(creados, OCRRepository.MAX_WORKERS - 1, "ya había uno; solo se crean los que faltan");
});

test("no crea más workers que núcleos útiles", async () => {
  // Más workers que hilos no reparte nada y sí ocupa memoria.
  nucleos(2);
  await OCRRepository.ensureWorkers(18);
  assert.equal(OCRRepository.workers.length, 1, "con 2 núcleos el tope es 1");
});

test("dos llamadas seguidas no duplican el pool", async () => {
  await OCRRepository.ensureWorkers(4);
  const n = creados;
  await OCRRepository.ensureWorkers(4);
  assert.equal(creados, n);
});

test("llamadas simultáneas comparten la misma creación", async () => {
  // Sin compartir la promesa, dos rutas del escáner pidiendo a la vez arrancaban el doble de
  // instancias WASM y la memoria se disparaba.
  await Promise.all([OCRRepository.ensureWorkers(4), OCRRepository.ensureWorkers(4)]);
  assert.equal(OCRRepository.workers.length, OCRRepository.MAX_WORKERS);
  assert.equal(creados, OCRRepository.MAX_WORKERS - 1);
});

test("un worker que no arranca no deja un hueco en el pool", async () => {
  // `workers[i] = null` con un filter después: un null en medio haría que runWorker recibiera
  // undefined y la página entera se quedara sin leer.
  OCRRepository._createStandardWorker = async () => {
    creados++;
    if (creados === 2) throw new Error("sin memoria");
    return { id: `w${creados}` };
  };
  OCRRepository.MAX_WORKERS = 4;
  try {
    await OCRRepository.ensureWorkers(4);
    assert.ok(OCRRepository.workers.every(Boolean), "quedó un hueco en el pool");
    assert.equal(OCRRepository.workers.length, 3);
  } finally { OCRRepository.MAX_WORKERS = 2; }
});

test("ensureSecondWorker sigue pidiendo exactamente dos", async () => {
  await OCRRepository.ensureSecondWorker();
  assert.equal(OCRRepository.workers.length, 2);
});

test("sin fábrica de workers no revienta", async () => {
  OCRRepository._createStandardWorker = null;
  await OCRRepository.ensureWorkers(4);
  assert.equal(OCRRepository.workers.length, 1);
});

test("un worker de sobra que lleva diez minutos sin usarse se suelta en la siguiente lectura del principal", async () => {
  const w0 = workerFalso("w0"), w1 = workerFalso("w1");
  OCRRepository.workers = [w0, w1];
  OCRRepository._usoExtra = haceRato();
  const r = await OCRRepository.recognize(w0, img);
  assert.equal(r.data.text, "w0");
  assert.equal(OCRRepository.workers.length, 1);
  assert.ok(OCRRepository.workers[0] === w0, "se queda el principal");
  assert.equal(w1.terminados, 1);
  assert.equal(w0.terminados, 0);
});

test("un worker de sobra usado hace poco no se suelta", async () => {
  const w0 = workerFalso("w0"), w1 = workerFalso("w1");
  OCRRepository.workers = [w0, w1];
  OCRRepository._usoExtra = Date.now() - 1000;
  await OCRRepository.recognize(w0, img);
  assert.equal(OCRRepository.workers.length, 2);
  assert.equal(w1.terminados, 0);
});

test("sin uso marcado no se suelta nada", async () => {
  const w0 = workerFalso("w0"), w1 = workerFalso("w1");
  OCRRepository.workers = [w0, w1];
  await OCRRepository.recognize(w0, img);
  assert.equal(OCRRepository.workers.length, 2);
  assert.equal(w1.terminados, 0);
});

test("con un solo worker no hay nada que soltar", () => {
  const w0 = workerFalso("w0");
  OCRRepository.workers = [w0];
  OCRRepository._usoExtra = 1;
  OCRRepository.sueltaSobrantes();
  assert.equal(OCRRepository.workers.length, 1);
  assert.equal(w0.terminados, 0);
});

test("mientras el de sobra lee no se suelta, y el plazo cuenta desde que termina", async () => {
  let suelta;
  const w0 = workerFalso("w0");
  const w1 = { ...workerFalso("w1"), recognize: () => new Promise((r) => { suelta = () => r({ data: { text: "w1" } }); }) };
  OCRRepository.workers = [w0, w1];
  OCRRepository._usoExtra = haceRato();
  const lectura = OCRRepository.recognize(w1, img);
  await OCRRepository.recognize(w0, img);
  assert.equal(OCRRepository.workers.length, 2, "se soltó con una lectura en curso");
  suelta();
  assert.equal((await lectura).data.text, "w1");
  assert.equal(OCRRepository._ocupados, 0);
  await OCRRepository.recognize(w0, img);
  assert.equal(OCRRepository.workers.length, 2, "acaba de usarse");
  OCRRepository.sueltaSobrantes(Date.now() + OCRRepository.SUELTA_SOBRANTES_MS + 1);
  assert.equal(OCRRepository.workers.length, 1);
  assert.equal(w1.terminados, 1);
});

test("pedir workers cuenta como uso", async () => {
  const antes = Date.now();
  await OCRRepository.ensureWorkers(2);
  assert.ok(OCRRepository._usoExtra >= antes);
});

test("tras soltarlo, el pool vuelve a crear el segundo cuando se pide", async () => {
  OCRRepository._createStandardWorker = async () => { creados++; return workerFalso(`w${creados}`); };
  OCRRepository.workers = [workerFalso("w0")];
  await OCRRepository.ensureWorkers(2);
  const primero = OCRRepository.workers[1];
  OCRRepository.sueltaSobrantes(Date.now() + OCRRepository.SUELTA_SOBRANTES_MS + 1);
  assert.equal(OCRRepository.workers.length, 1);
  assert.equal(primero.terminados, 1);
  await OCRRepository.ensureWorkers(2);
  assert.equal(OCRRepository.workers.length, 2);
  assert.ok(OCRRepository.workers[1] !== primero, "se crea uno nuevo");
  assert.equal(creados, 2);
});

test("una lectura sobre un worker ya soltado la hace el principal", async () => {
  const w0 = workerFalso("w0"), w1 = workerFalso("w1");
  OCRRepository.workers = [w0, w1];
  OCRRepository._usoExtra = 1;
  OCRRepository.sueltaSobrantes();
  assert.equal((await OCRRepository.recognize(w1, img)).data.text, "w0");
  assert.equal((await OCRRepository.recognizeWithPSM(w1, img, 11)).data.text, "w0");
  assert.equal((await OCRRepository.recognizeWithChars(w1, img, "AB")).data.text, "w0");
  OCRRepository.workers = [];
  assert.equal((await OCRRepository.recognize(w1, img)).data.text, "");
});
