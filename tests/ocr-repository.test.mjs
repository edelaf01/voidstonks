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
