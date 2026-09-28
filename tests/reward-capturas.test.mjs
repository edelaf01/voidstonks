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

const CAPTURAS = {
  "temas/fisura-red.png": { total: 3, tesseract: 3 },
  "temas/caliban.png": { total: 4, tesseract: 3 },
  "temas/nofuncanuevo.png": { total: 4, tesseract: 0 },
  "temas/nofuncarecompensa.png": { total: 4, tesseract: 4 },
  "temas/siguesinarreglar.png": { total: 4, tesseract: 0 },
  "temas/siguesinfunciona.png": { total: 4, tesseract: 4 },
  "temas/styanaxnodetecta.png": { total: 4, tesseract: 3 },
  "temas/ivara-crafted-no-lee.png": { total: 4, tesseract: 4 },
  "mal.png": {
    total: 4, tesseract: 3,
    todo: "junta 'Nidus Prime' con el 'Neuroptics Blueprint' de la tarjeta de al lado",
    esperados: ["Nidus Prime Blueprint", "Chroma Prime Neuroptics Blueprint",
      "Trumna Prime Blueprint", "Burston Prime Stock"],
  },
};

// without configs/tsv, Tesseract returns plain text and parsing drops to zero without warning
const TESS = hayTesseract ? fs.mkdtempSync(path.join(os.tmpdir(), "tessdata-")) : null;
if (TESS) {
  fs.mkdirSync(path.join(TESS, "configs"), { recursive: true });
  fs.writeFileSync(path.join(TESS, "configs", "tsv"), "tessedit_create_tsv 1\n");
  fs.copyFileSync(path.join(RAIZ, "..", "deploy", "js", "eng.traineddata"), path.join(TESS, "eng.traineddata"));
}

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
      for (const nombre of verdad.esperados ? todos : []) {
        assert.ok(verdad.esperados.includes(nombre),
          `"${nombre}" no está en la pantalla; leídos: [${[...new Set(todos)].join(", ")}]`);
      }
      assert.ok(leidos.length >= verdad.tesseract,
        `${leidos.length}/${verdad.total} — antes leía ${verdad.tesseract}: [${leidos.join(", ")}]`);
    });
}

test("la escalera de recortes ofrece siempre una alternativa", () => {
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
