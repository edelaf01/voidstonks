import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OCRRepository } from "../deploy/js/repositories/ocr.repository.js";

// Extrae el cuerpo de un método contando llaves desde su cabecera. Cortar por "la
// siguiente línea que sea sólo }" se detiene en el primer if anidado.
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

// Los comentarios que EXPLICAN por qué no se llama a algo mencionan ese algo por su
// nombre; sin quitarlos, el test se dispara con su propia documentación.
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// -----------------------------------------------------------------------------
// Invariantes de RAM del pool de workers OCR.
// No medimos MB (imposible en node), pero blindamos las condiciones que evitan
// fugas: que warmUp cargue los datos de idioma LOCALES (tessdata_fast, no CDN),
// y que terminateAll libere TODO (terminate por worker + arrays vacíos +
// initPromise anulada) para que el GC pueda reclamar los heaps WASM.
// -----------------------------------------------------------------------------

// Fake mínimo de un worker de Tesseract.js que registra su ciclo de vida.
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
  // Estado limpio entre tests (warmUp memoiza en initPromise).
  OCRRepository.workers = [];
  OCRRepository.initPromise = null;
  OCRRepository._w2Promise = null;
});

test("warmUp arranca con UN solo worker estándar y carga datos LOCALES (no CDN)", async () => {
  const { Tesseract, created } = makeFakeTesseract();
  globalThis.Tesseract = Tesseract; // loadTesseractScript hace short-circuit si existe

  const ok = await OCRRepository.warmUp(50);
  assert.equal(ok, true);

  // Arranque perezoso: 1 worker estándar. El 2º se crea con ensureSecondWorker();
  // las cantidades ya NO usan Tesseract (template-matching), así que no hay badge workers.
  assert.equal(OCRRepository.workers.length, 1);
  assert.equal(created.length, 1);

  // ensureSecondWorker añade el 2º bajo demanda (sin recrear el 1º).
  await OCRRepository.ensureSecondWorker();
  assert.equal(OCRRepository.workers.length, 2);
  assert.equal(created.length, 2);

  // Cada worker debe pedir el idioma local (langPath "js/", sin gzip) para usar
  // el tessdata_fast de 4MB en vez de bajar el estándar de 23MB del CDN.
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
  await OCRRepository.ensureSecondWorker(); // pool completo (2 workers) antes de terminar
  OCRRepository.terminateAll();

  // Cada worker creado debe recibir exactamente un terminate().
  for (const w of created) {
    assert.equal(w.terminated, 1, "cada worker debe terminarse una sola vez");
  }
  // Sin referencias colgando: array vacío e initPromise anulada.
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

  // La segunda llamada reutiliza initPromise; no debe crear un 2º worker.
  assert.equal(created.length, 1);

  delete globalThis.Tesseract;
});

test("tras terminateAll, warmUp vuelve a levantar el pool (cerrar y reabrir el escáner)", async () => {
  const { Tesseract, created } = makeFakeTesseract();
  globalThis.Tesseract = Tesseract;

  await OCRRepository.warmUp(50);
  await OCRRepository.ensureSecondWorker();
  OCRRepository.terminateAll();

  // Reabrir: el móvil llama a close() (que ahora termina los workers) y al siguiente
  // escaneo vuelve a warmUp. Si terminateAll dejara initPromise puesta, warmUp haría
  // short-circuit y el escáner se quedaría SIN workers.
  const ok = await OCRRepository.warmUp(50);
  assert.equal(ok, true);
  assert.equal(OCRRepository.workers.length, 1, "debe haber un worker nuevo tras reabrir");
  assert.equal(created.length, 3, "el worker del segundo ciclo se crea de cero");

  // Y el 2º worker debe seguir pudiendo crearse bajo demanda en el nuevo ciclo.
  await OCRRepository.ensureSecondWorker();
  assert.equal(OCRRepository.workers.length, 2);

  delete globalThis.Tesseract;
});

// El 2º worker es una instancia WASM completa. Arrancar el escáner NO debe crearlo:
// sólo lo necesitan las recompensas, el grid de inventario y el reroll de 2 cartas.
// Antes se precalentaba en ScannerService.start() y una sesión de sólo-rivens pagaba
// esa RAM sin usarla nunca.
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

// close() en móvil sólo paraba la cámara y dejaba los heaps WASM vivos hasta recargar.
test("MobileScanner.close libera los workers OCR", () => {
  const src = readFileSync(
    new URL("../deploy/js/scanner/mobile_scanner.js", import.meta.url),
    "utf8",
  );
  const close = methodBody(src, /^\s*close\(\)\s*\{/);
  assert.ok(close, "no se localizó el cuerpo de close()");
  assert.match(stripComments(close), /OCRRepository\.terminateAll\(\)/);
});
