import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OCRRepository } from "../deploy/js/repositories/ocr.repository.js";

function methodBody(src, headerRe) {
  const lines = src.split("\n");
  const from = lines.findIndex((l) => headerRe.test(l));
  if (from < 0) return "";
  let depth = 0;
  const out = [];
  for (let i = from; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth === 0 && i > from) break;
  }
  return out.join("\n");
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function makeFakeTesseract() {
  const created = [];
  const Tesseract = {
    async createWorker(lang, oem, options) {
      const worker = {
        lang,
        oem,
        options: options || null,
        terminated: 0,
        params: null,
        async setParameters(p) {
          this.params = p;
        },
        terminate() {
          this.terminated += 1;
        },
      };
      created.push(worker);
      return worker;
    },
  };
  return { Tesseract, created };
}

beforeEach(() => {
  OCRRepository.workers = [];
  OCRRepository.initPromise = null;
  OCRRepository._w2Promise = null;
});

test("warmUp arranca con UN solo worker estándar y carga datos LOCALES (no CDN)", async () => {
  const { Tesseract, created } = makeFakeTesseract();
  globalThis.Tesseract = Tesseract;

  const ok = await OCRRepository.warmUp(50);
  assert.equal(ok, true);

  assert.equal(OCRRepository.workers.length, 1);
  assert.equal(created.length, 1);

  await OCRRepository.ensureSecondWorker();
  assert.equal(OCRRepository.workers.length, 2);
  assert.equal(created.length, 2);

  // each worker asks for langPath "js/" to use 4 MB tessdata_fast instead of 23 MB from CDN
  for (const w of created) {
    assert.equal(w.lang, "eng");
    assert.equal(w.oem, 1);
    assert.ok(w.options, "el worker debe crearse con opciones de carga local");
    assert.equal(w.options.langPath, "js/");
    assert.equal(w.options.gzip, false);
  }

  delete globalThis.Tesseract;
});

test("terminateAll libera todos los workers y resetea el estado (GC-safe)", async () => {
  const { Tesseract, created } = makeFakeTesseract();
  globalThis.Tesseract = Tesseract;

  await OCRRepository.warmUp(50);
  await OCRRepository.ensureSecondWorker();
  OCRRepository.terminateAll();

  for (const w of created) {
    assert.equal(w.terminated, 1, "cada worker debe terminarse una sola vez");
  }
  assert.deepEqual(OCRRepository.workers, []);
  assert.equal(OCRRepository.initPromise, null);

  delete globalThis.Tesseract;
});

test("warmUp es idempotente: no duplica workers si ya hay un pool", async () => {
  const { Tesseract, created } = makeFakeTesseract();
  globalThis.Tesseract = Tesseract;

  const p1 = OCRRepository.warmUp(50);
  const p2 = OCRRepository.warmUp(50);
  await Promise.all([p1, p2]);

  assert.equal(created.length, 1);

  delete globalThis.Tesseract;
});

test("tras terminateAll, warmUp vuelve a levantar el pool (cerrar y reabrir el escáner)", async () => {
  const { Tesseract, created } = makeFakeTesseract();
  globalThis.Tesseract = Tesseract;

  await OCRRepository.warmUp(50);
  await OCRRepository.ensureSecondWorker();
  OCRRepository.terminateAll();

  const ok = await OCRRepository.warmUp(50);
  assert.equal(ok, true);
  assert.equal(OCRRepository.workers.length, 1, "debe haber un worker nuevo tras reabrir");
  assert.equal(created.length, 3, "el worker del segundo ciclo se crea de cero");

  await OCRRepository.ensureSecondWorker();
  assert.equal(OCRRepository.workers.length, 2);

  delete globalThis.Tesseract;
});

test("ScannerService.start no precalienta el 2º worker", () => {
  const src = readFileSync(
    new URL("../deploy/js/services/scanner/scanner.service.js", import.meta.url),
    "utf8",
  );
  const start = methodBody(src, /^\s*async start\(/);
  assert.ok(start, "no se localizó el cuerpo de start()");
  assert.ok(
    !/ensureSecondWorker\s*\(/.test(stripComments(start)),
    "start() no debe crear el 2º worker: cada punto de uso lo pide bajo demanda",
  );
});

test("ScannerService.start no carga OpenCV", () => {
  const src = readFileSync(
    new URL("../deploy/js/services/scanner/scanner.service.js", import.meta.url),
    "utf8",
  );
  const start = methodBody(src, /^\s*async start\(/);
  assert.ok(start, "no se localizó el cuerpo de start()");
  assert.doesNotMatch(stripComments(start), /OpenCV/);
});

test("MobileScanner.close libera los workers OCR", () => {
  const src = readFileSync(
    new URL("../deploy/js/scanner/mobile_scanner.js", import.meta.url),
    "utf8",
  );
  const close = methodBody(src, /^\s*close\(\)\s*\{/);
  assert.ok(close, "no se localizó el cuerpo de close()");
  assert.match(stripComments(close), /OCRRepository\.terminateAll\(\)/);
});
