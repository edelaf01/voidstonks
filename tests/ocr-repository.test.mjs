// Lectura con Tesseract con parámetros por llamada (deploy/js/repositories/ocr.repository.js).
//
// Visto en vivo tras la Update 44: el escáner de rivens dejó de abrir el desplegable. No era la
// pantalla nueva: desde el 1-sep la lista blanca de los rótulos (sin "+", "%" ni ".") se aplicaba
// también a las cartas, Tesseract devolvía "187,6 Critical Chance" y el parser, que se ancla en el
// "%", no encontraba ningún stat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");

function workerFalso({ falla = false } = {}) {
  const log = [];
  return {
    log,
    setParameters: async (p) => { log.push(["lista", p.tessedit_char_whitelist]); },
    recognize: async () => { log.push(["lee"]); if (falla) throw new Error("wasm"); return { data: { text: "ok" } }; },
  };
}

test("una carta se lee con la lista de rivens y el worker vuelve a la de los rótulos", async () => {
  const w = workerFalso();
  const r = await OCRRepository.recognizeWithChars(w, {}, OCRRepository.RIVEN_CHARS);
  assert.equal(r.data.text, "ok");
  assert.deepEqual(w.log, [["lista", OCRRepository.RIVEN_CHARS], ["lee"], ["lista", OCRRepository.DEFAULT_CHARS]]);
});

// Un recorte de 0 px hacía fallar a Tesseract dentro del worker ("File could not be read! Code=0"),
// como promesa sin capturar que ningún catch nuestro veía.
test("un recorte de 0 px no llega a Tesseract", async () => {
  const w = workerFalso();
  for (const vacio of [{ width: 0, height: 40 }, { width: 120, height: 0 }]) {
    assert.equal((await OCRRepository.recognize(w, vacio)).data.text, "");
    assert.equal((await OCRRepository.recognizeWithChars(w, vacio, OCRRepository.RIVEN_CHARS)).data.text, "");
    assert.equal((await OCRRepository.recognizeWithPSM(w, vacio, 6)).data.text, "");
  }
  assert.deepEqual(w.log, [], "ni se llama al worker ni se tocan sus parámetros");
  assert.equal((await OCRRepository.recognize(w, { width: 10, height: 10 })).data.text, "ok");
});

// Si se quedara con la de rivens, los rótulos del inventario volverían a leer "CARRIER.PRIME".
test("si la lectura falla, la lista de los rótulos se restaura igual", async () => {
  const w = workerFalso({ falla: true });
  const r = await OCRRepository.recognizeWithChars(w, {}, OCRRepository.RIVEN_CHARS);
  assert.equal(r.data.text, "");
  assert.deepEqual(w.log.at(-1), ["lista", OCRRepository.DEFAULT_CHARS]);
});

// La carta real: el recorte binarizado que sale de prepareRivenCardCanvases con una captura a 1080p
// de la pantalla de ciclar nueva ("Dread Acricron +187.6% Critical Chance +150.9% Critical Damage").
const FIXTURE = fileURLToPath(new URL("./_fixtures/riven_card_update44_dread.png", import.meta.url));
const TESSDATA = fileURLToPath(new URL("../deploy/js", import.meta.url));
const hayTesseract = spawnSync("tesseract", ["--version"], { stdio: "ignore" }).status === 0;

test("la carta de la pantalla nueva da sus stats con la lista de rivens y ninguno con la de rótulos",
  { skip: !hayTesseract && "tesseract no instalado" }, async () => {
    const { state } = await import("../deploy/js/state.js");
    const { RivenOCRService } = await import("../deploy/js/services/rivens/riven_ocr.service.js");
    Object.assign(state, { allRivenNames: ["Braton", "Dread", "Paris"], weaponMap: { Braton: { d: 1.35, t: "Rifle" }, Dread: { d: 1.25, t: "Bow" }, Paris: { d: 1.2, t: "Bow" } } });
    const lee = (chars) => spawnSync("tesseract",
      [FIXTURE, "-", "--tessdata-dir", TESSDATA, "--psm", "6", "--oem", "1", "-c", `tessedit_char_whitelist=${chars}`],
      { encoding: "utf8" }).stdout;

    const riven = RivenOCRService.parseRivenCard(lee(OCRRepository.RIVEN_CHARS));
    assert.equal(riven?.weaponName, "Dread");
    assert.deepEqual(riven.stats.map((s) => s.name), ["Crit Chance", "Crit Damage"]);
    assert.equal(riven.stats[0].value, 187.6);
    assert.equal(RivenOCRService.parseRivenCard(lee(OCRRepository.DEFAULT_CHARS))?.stats?.length ?? 0, 0);
  });

// Un worker muerto dejaba el bucle del escáner esperando para siempre, sin ningún error.
test("una lectura sin respuesta vuelve vacía y el worker se sustituye por uno nuevo", async () => {
  const colgado = { recognize: () => new Promise(() => {}), setParameters: () => new Promise(() => {}), terminado: false, terminate() { this.terminado = true; } };
  const nuevo = { recognize: async () => ({ data: { text: "ok" } }) };
  const orig = { workers: OCRRepository.workers, crear: OCRRepository._createStandardWorker, init: OCRRepository.initPromise, limite: OCRRepository.LIMITE_OCR_MS };
  Object.assign(OCRRepository, { workers: [colgado], _createStandardWorker: async () => nuevo, initPromise: Promise.resolve(true), LIMITE_OCR_MS: 20 });
  const img = { width: 10, height: 10 };
  const error = console.error;
  console.error = () => {};
  try {
    assert.equal((await OCRRepository.recognize(colgado, img)).data.text, "");
    assert.equal((await OCRRepository.recognizeWithPSM(colgado, img, 11)).data.text, "", "también si se cuelga al cambiar el psm");
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(OCRRepository.workers, [nuevo], "se sustituye una sola vez");
    assert.equal(colgado.terminado, true);
    assert.equal((await OCRRepository.recognize(OCRRepository.workers[0], img)).data.text, "ok");
  } finally {
    console.error = error;
    Object.assign(OCRRepository, { workers: orig.workers, _createStandardWorker: orig.crear, initPromise: orig.init, LIMITE_OCR_MS: orig.limite });
  }
});

test("si el escáner se paró mientras se creaba el sustituto, no vuelve al pool", async () => {
  const colgado = { recognize: () => new Promise(() => {}), terminate() {} };
  let terminado = false;
  const nuevo = { terminate() { terminado = true; } };
  const orig = { workers: OCRRepository.workers, crear: OCRRepository._createStandardWorker, init: OCRRepository.initPromise };
  Object.assign(OCRRepository, { workers: [colgado], _createStandardWorker: async () => { OCRRepository.initPromise = null; return nuevo; }, initPromise: Promise.resolve(true) });
  try {
    await OCRRepository.sustituye(colgado);
    assert.deepEqual(OCRRepository.workers, []);
    assert.equal(terminado, true);
  } finally {
    Object.assign(OCRRepository, { workers: orig.workers, _createStandardWorker: orig.crear, initPromise: orig.init });
  }
});

test("el trabajo de fondo va al segundo worker, y con uno solo al único", async () => {
  const antes = { workers: OCRRepository.workers, crea: OCRRepository._createStandardWorker };
  try {
    OCRRepository._createStandardWorker = null;
    OCRRepository.workers = [{ id: 0 }, { id: 1 }];
    assert.equal((await OCRRepository.workerDeFondo()).id, 1);
    OCRRepository.workers = [{ id: 0 }];
    assert.equal((await OCRRepository.workerDeFondo()).id, 0);
  } finally { Object.assign(OCRRepository, { workers: antes.workers, _createStandardWorker: antes.crea }); }
});

test("trabajos sobre el mismo worker se encolan para no mezclar parámetros", async () => {
  const log = [];
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const w = {
    setParameters: async (p) => { await delay(5); log.push(["param", p]); },
    recognize: async (img, opts) => { await delay(5); log.push(["lee", opts]); return { data: { text: "ok" } }; },
  };

  const p1 = OCRRepository.recognizeWithChars(w, { width: 10, height: 10 }, "ABC");
  const p2 = OCRRepository.recognize(w, { width: 10, height: 10 }, { oem: 1 });
  const p3 = OCRRepository.recognizeWithPSM(w, { width: 10, height: 10 }, "7");
  await Promise.all([p1, p2, p3]);

  assert.deepEqual(log, [
    ["param", { tessedit_char_whitelist: "ABC" }],
    ["lee", {}],
    ["param", { tessedit_char_whitelist: OCRRepository.DEFAULT_CHARS }],
    ["lee", { oem: 1 }],
    ["param", { tessedit_pageseg_mode: "7" }],
    ["lee", {}],
    ["param", { tessedit_pageseg_mode: OCRRepository.DEFAULT_PSM }],
  ]);
});

test("trabajos sobre workers distintos no se esperan entre sí", async () => {
  const log = [];
  let suelta;
  const w1 = { recognize: async () => { log.push("w1_start"); await new Promise(r => suelta = r); log.push("w1_end"); return { data: { text: "w1" } }; } };
  const w2 = { recognize: async () => { log.push("w2"); return { data: { text: "w2" } }; } };

  const p1 = OCRRepository.recognize(w1, { width: 10, height: 10 });
  const p2 = OCRRepository.recognize(w2, { width: 10, height: 10 });

  await p2;
  assert.deepEqual(log, ["w1_start", "w2"], "w2 termina mientras w1 sigue esperando");
  suelta();
  await p1;
});

test("el tiempo de espera en cola no cuenta para el límite de tiempo; si se cuelga, caduca y suelta la cola", async () => {
  const orig = OCRRepository.LIMITE_OCR_MS;
  OCRRepository.LIMITE_OCR_MS = 200;

  const log = [];
  const err = console.error;
  console.error = () => {};

  const origSustituye = OCRRepository.sustituye;
  OCRRepository.sustituye = () => {};

  try {
    const w = {
      recognize: async (img) => {
        if (img.largo) { await new Promise(r => setTimeout(r, 150)); log.push("largo"); }
        else if (img.cuelga) { log.push("cuelga"); await new Promise(() => {}); }
        else { await new Promise(r => setTimeout(r, 100)); log.push("normal"); }
        return { data: { text: "ok" } };
      },
      terminate: () => {}
    };

    const p1 = OCRRepository.recognize(w, { width: 10, height: 10, largo: true });
    const p2 = OCRRepository.recognize(w, { width: 10, height: 10 });

    const r1 = await p1;
    const r2 = await p2;

    assert.equal(r1.data.text, "ok");
    assert.equal(r2.data.text, "ok");
    assert.deepEqual(log, ["largo", "normal"]);

    log.length = 0;
    const p3 = OCRRepository.recognize(w, { width: 10, height: 10, cuelga: true });
    const p4 = OCRRepository.recognize(w, { width: 10, height: 10 });

    const r3 = await p3;
    const r4 = await p4;

    assert.equal(r3.data.text, "");
    assert.equal(r4.data.text, "ok");
    assert.deepEqual(log, ["cuelga", "normal"]);

  } finally {
    OCRRepository.LIMITE_OCR_MS = orig;
    OCRRepository.sustituye = origSustituye;
    console.error = err;
  }
});
