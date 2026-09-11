// what the scanner reads on REAL reward screen captures, by ENGINE
// pins the TESSERACT floor (9/26 across 7 captures; paddle reads 26/26 but requires onnxruntime outside
// node)
// the count is a floor that must not drop; captures live outside the repo and the file skips without them
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";
import { comoItemsDatabase } from "./_helpers/prime-catalog.mjs";

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { localizaBandaRecompensas, candidatosDeRecorte, recorteDelRotulo } =
  await import("../deploy/js/utils/vision/reward_band.js");
const { leeRecompensas } = await import("../deploy/js/services/scanner/reward_read.service.js");
const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
const { state } = await import("../deploy/js/state.js");
state.itemsDatabase = comoItemsDatabase();

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.CORPUS_PANTALLAS_DIR
  || "/home/ppsoy/Imágenes/Capturas de pantalla/nofunciona/implementar";
const hayTesseract = spawnSync("tesseract", ["--version"], { stdio: "ignore" }).status === 0;

// hand-counted on each capture: tesseract is the current classic floor, precise engine reads all of them
// numbers rose when calling the real scanner instead of a reimplemented preprocessor that hid failures
const CAPTURAS = {
  "temas/fisura-red.png": { total: 3, tesseract: 3 },
  "temas/caliban.png": { total: 4, tesseract: 3 },
  "temas/nofuncanuevo.png": { total: 4, tesseract: 0 },
  "temas/nofuncarecompensa.png": { total: 4, tesseract: 4 },
  "temas/siguesinarreglar.png": { total: 4, tesseract: 0 },
  "temas/siguesinfunciona.png": { total: 4, tesseract: 4 },
  "temas/styanaxnodetecta.png": { total: 4, tesseract: 3 },
  // reported live: scanner returned "Nidus Prime Neuroptics Blueprint", merging "Nidus Prime" from the first
  // card with "Neuroptics Blueprint" from the second
  // that name EXISTS in the catalog, so the matcher accepts it and counting alone cannot catch it: KNOWN
  // BUG, see todo below
  "mal.png": {
    total: 4, tesseract: 3,
    todo: "junta 'Nidus Prime' con el 'Neuroptics Blueprint' de la tarjeta de al lado",
    esperados: ["Nidus Prime Blueprint", "Chroma Prime Neuroptics Blueprint",
      "Trumna Prime Blueprint", "Burston Prime Stock"],
  },
};

// the "tsv" config lives in tessdata/configs/ and repo traineddata lacks it: without it Tesseract returns
// plain text and parsing drops to zero WITHOUT warning
const TESS = hayTesseract ? fs.mkdtempSync(path.join(os.tmpdir(), "tessdata-")) : null;
if (TESS) {
  fs.mkdirSync(path.join(TESS, "configs"), { recursive: true });
  fs.writeFileSync(path.join(TESS, "configs", "tsv"), "tessedit_create_tsv 1\n");
  fs.copyFileSync(path.join(RAIZ, "..", "deploy", "js", "eng.traineddata"), path.join(TESS, "eng.traineddata"));
}

/**
 * words WITH THEIR BOX, not a plain string
 * returning plain text with fake sequential boxes (`x0: i * 40`) hid POSITIONAL bugs where "Nidus Prime"
 * merged with "Neuroptics Blueprint" next door into a valid catalog item
 */
function ocr(cvs) {
  const d = cvs.getContext("2d").getImageData(0, 0, cvs.width, cvs.height);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-"));
  const f = path.join(dir, "b.png");
  fs.writeFileSync(f, encodePng({ width: cvs.width, height: cvs.height, data: d.data }));
  const r = spawnSync("tesseract", [f, "-", "--tessdata-dir", TESS, "--psm", "6", "tsv"],
    { encoding: "utf8", maxBuffer: 64e6 });
  fs.rmSync(dir, { recursive: true, force: true });
  const words = [];
  for (const ln of (r.stdout || "").split("\n").slice(1)) {
    const c = ln.split("\t");
    if (c.length < 12 || +c[10] < 0) continue;
    const text = (c[11] || "").trim();
    if (text) {
      words.push({ text: text.toUpperCase(), confidence: +c[10],
        bbox: { x0: +c[6], y0: +c[7], x1: +c[6] + +c[8], y1: +c[7] + +c[9] } });
    }
  }
  return words;
}

/**
 * reads the capture through the SAME path as the scanner: leeRecompensas with the classic engine and
 * OCRRepository pointing to system tesseract
 * reimplementing preprocessing hid real bugs where cross-card names matched catalog entries
 */
async function leeConTesseract(archivo) {
  OCRRepository.workers = [{ id: "a" }, { id: "b" }];
  OCRRepository.ensureSecondWorker = async () => {};
  OCRRepository.recognize = async (_w, cvs, _o, out) => {
    const words = ocr(cvs);
    if (!out?.blocks) return { data: { text: words.map((w) => w.text).join(" ") } };
    return { data: { words, text: words.map((w) => w.text).join(" ") } };
  };

  const img = decodePng(fs.readFileSync(path.join(DIR, archivo)));
  const frame = new FakeCanvas(img.width, img.height);
  frame.getContext("2d").drawImage(img, 0, 0);
  const { cropRect, columnas, cardCount } = localizaBandaRecompensas(frame, img.width, img.height, null);
  const candidatos = candidatosDeRecorte({ cropRect, columnas, cardCount },
    recorteDelRotulo(frame, img.width, img.height, null));

  // ALL candidates without cutting short: production stops at the first meeting the minimum, but a merged
  // name in any candidate will surface whenever the band shifts
  // in mal.png candidate 0 reads cleanly while 1 and 2 merge
  let mejor = [];
  const todos = [];
  for (const cand of candidatos) {
    const r = await leeRecompensas(frame, img.width, img.height, 1, "STANDARD",
      cand.cropRect, cand.columnas ?? columnas, "clasico");
    const nombres = r.foundItems.map((x) => x.name);
    todos.push(...nombres);
    if (nombres.length > mejor.length) mejor = nombres;
  }
  return { mejor, todos };
}

for (const [archivo, verdad] of Object.entries(CAPTURAS)) {
  const falta = !fs.existsSync(path.join(DIR, archivo)) && `sin ${archivo}`;
  test(`${archivo}: la vía clásica no baja de ${verdad.tesseract}/${verdad.total}`,
    { skip: falta || (!hayTesseract && "tesseract no instalado"), todo: verdad.todo }, async () => {
      const { mejor: leidos, todos } = await leeConTesseract(archivo);
      // counting is not enough: a name MERGED across two cards still counts as one and EXISTS in the catalog,
      // detectable only against screen truth
      for (const nombre of verdad.esperados ? todos : []) {
        assert.ok(verdad.esperados.includes(nombre),
          `"${nombre}" no está en la pantalla; leídos: [${[...new Set(todos)].join(", ")}]`);
      }
      assert.ok(leidos.length >= verdad.tesseract,
        `${leidos.length}/${verdad.total} — antes leía ${verdad.tesseract}: [${leidos.join(", ")}]`);
    });
}

test("la escalera de recortes ofrece siempre una alternativa", () => {
  // the detected band sometimes anchors BELOW the labels and clips their top: in temas/fisura-red.png
  // candidate 1 cuts the top half and reads 0 of 3, while candidate 3 reads all 3
  const archivo = "temas/fisura-red.png";
  if (!fs.existsSync(path.join(DIR, archivo))) return;
  const img = decodePng(fs.readFileSync(path.join(DIR, archivo)));
  const frame = new FakeCanvas(img.width, img.height);
  frame.getContext("2d").drawImage(img, 0, 0);
  const { cropRect, columnas, cardCount } = localizaBandaRecompensas(frame, img.width, img.height, null);
  const candidatos = candidatosDeRecorte({ cropRect, columnas, cardCount },
    recorteDelRotulo(frame, img.width, img.height, null));
  const conRecorte = candidatos.filter((c) => c.cropRect);
  assert.ok(conRecorte.length >= 2, `solo ${conRecorte.length} recorte(s): sin alternativa`);
  assert.ok(conRecorte.some((c) => c.cropRect.y < cropRect.y),
    "ningún candidato mira por encima de la banda detectada");
});
