import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");

// navigator is read-only in node: it must be redefined, not assigned
const nucleos = (n) => Object.defineProperty(globalThis, "navigator",
  { value: { hardwareConcurrency: n }, configurable: true, writable: true });

let creados;
beforeEach(() => {
  creados = 0;
  OCRRepository.workers = [{ id: 0 }];
  OCRRepository._workerPromises = null;
  OCRRepository._createStandardWorker = async () => { creados++; return { id: `w${creados}` }; };
  nucleos(8);
});

test("pide uno por celda, hasta el tope del pool", async () => {
  await OCRRepository.ensureWorkers(18);
  assert.equal(OCRRepository.workers.length, OCRRepository.MAX_WORKERS);
  assert.equal(creados, OCRRepository.MAX_WORKERS - 1, "ya había uno; solo se crean los que faltan");
});

test("no crea más workers que núcleos útiles", async () => {
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
  await Promise.all([OCRRepository.ensureWorkers(4), OCRRepository.ensureWorkers(4)]);
  assert.equal(OCRRepository.workers.length, 4);
  assert.equal(creados, 3);
});

test("un worker que no arranca no deja un hueco en el pool", async () => {
  OCRRepository._createStandardWorker = async () => {
    creados++;
    if (creados === 2) throw new Error("sin memoria");
    return { id: `w${creados}` };
  };
  await OCRRepository.ensureWorkers(4);
  assert.ok(OCRRepository.workers.every(Boolean), "quedó un hueco en el pool");
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
