import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OCRRepository } from "../deploy/js/repositories/ocr.repository.js";

// extracts a method body by counting braces from its header; cutting at "the next line that is only }"
// stops at the first nested if
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

// comments that EXPLAIN why something is not called name it, so without stripping them the test fires on
// its own documentation
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// RAM invariants of the ocr worker pool: MB cannot be measured in node, so the conditions that prevent
// leaks are pinned: warmUp loads the LOCAL language data (tessdata_fast, not the CDN) and terminateAll
// frees EVERYTHING (terminate per worker, empty arrays, initPromise cleared) so the GC can reclaim the
// WASM heaps

// minimal fake of a Tesseract.js worker that records its lifecycle
function makeFakeTesseract() {
  const created = []; // { lang, oem, options, worker }
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
  // clean state between tests (warmUp memoizes in initPromise)
  OCRRepository.workers = [];
  OCRRepository.initPromise = null;
  OCRRepository._w2Promise = null;
});

test("warmUp arranca con UN solo worker estándar y carga datos LOCALES (no CDN)", async () => {
  const { Tesseract, created } = makeFakeTesseract();
  globalThis.Tesseract = Tesseract; // loadTesseractScript short-circuits when it exists

  const ok = await OCRRepository.warmUp(50);
  assert.equal(ok, true);

  // lazy start: 1 standard worker; ensureSecondWorker() creates the 2nd, and quantities use template
  // matching, so there are no badge workers
  assert.equal(OCRRepository.workers.length, 1);
  assert.equal(created.length, 1);

  await OCRRepository.ensureSecondWorker();
  assert.equal(OCRRepository.workers.length, 2);
  assert.equal(created.length, 2);

  // each worker must ask for the local language (langPath "js/", no gzip) to use the 4 MB tessdata_fast
  // instead of the 23 MB standard one from the CDN
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
  await OCRRepository.ensureSecondWorker(); // full pool (2 workers) before terminating
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

  // reopening: mobile calls close() (which terminates the workers) and the next scan goes back to warmUp; if
  // terminateAll left initPromise set, warmUp would short-circuit and the scanner would have NO workers
  const ok = await OCRRepository.warmUp(50);
  assert.equal(ok, true);
  assert.equal(OCRRepository.workers.length, 1, "debe haber un worker nuevo tras reabrir");
  assert.equal(created.length, 3, "el worker del segundo ciclo se crea de cero");

  await OCRRepository.ensureSecondWorker();
  assert.equal(OCRRepository.workers.length, 2);

  delete globalThis.Tesseract;
});

// the 2nd worker is a full WASM instance and only rewards, the inventory grid and the 2-card reroll need
// it; prewarming it in ScannerService.start() made a rivens-only session pay that RAM for nothing
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

// OpenCV (~9 MB of script plus its WASM heap) is only used by the mobile scanner; desktop downloaded and
// compiled it every session without calling it. The source is read because start() pulls network (prime
// list, weapons) and IndexedDB, which node lacks
test("ScannerService.start no carga OpenCV", () => {
  const src = readFileSync(
    new URL("../deploy/js/services/scanner/scanner.service.js", import.meta.url),
    "utf8",
  );
  const start = methodBody(src, /^\s*async start\(/);
  assert.ok(start, "no se localizó el cuerpo de start()");
  assert.doesNotMatch(stripComments(start), /OpenCV/);
});

// close() on mobile only stopped the camera and kept the WASM heaps alive until reload
test("MobileScanner.close libera los workers OCR", () => {
  const src = readFileSync(
    new URL("../deploy/js/scanner/mobile_scanner.js", import.meta.url),
    "utf8",
  );
  const close = methodBody(src, /^\s*close\(\)\s*\{/);
  assert.ok(close, "no se localizó el cuerpo de close()");
  assert.match(stripComments(close), /OCRRepository\.terminateAll\(\)/);
});
