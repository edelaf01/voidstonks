// Qué lee el escáner en las capturas REALES de la pantalla de recompensas, por MOTOR.
//
// Faltaba: las capturas de recompensas no estaban en ningún test —se medían con un script
// suelto— y el usuario reportó una pantalla en la que Tesseract se dejaba un ítem. Medido aquí,
// no es un ítem suelto: sobre estas 7 capturas (26 recompensas) Tesseract lee 9 y PaddleOCR 26.
//
// Paddle no corre en Node (necesita onnxruntime), así que aquí se fija el suelo de TESSERACT,
// que es la vía que sí se puede ejecutar. Su cifra por captura no es un objetivo: es el listón
// que no debe bajar. La calidad del motor preciso se mide en el banco de scripts-actu.
//
// Las capturas viven fuera del repo (~5 MB cada una): sin la carpeta, el fichero se salta.
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

// Contadas a mano sobre cada captura. `tesseract` es lo que lee HOY la vía clásica; el motor
// preciso las lee todas. Las cifras subieron al hacer que el test llamara al escáner de verdad
// en vez de reimplementar su preprocesado: la reimplementación leía menos y ocultaba fallos.
const CAPTURAS = {
  "temas/fisura-red.png": { total: 3, tesseract: 3 },
  "temas/caliban.png": { total: 4, tesseract: 3 },
  "temas/nofuncanuevo.png": { total: 4, tesseract: 0 },
  "temas/nofuncarecompensa.png": { total: 4, tesseract: 4 },
  "temas/siguesinarreglar.png": { total: 4, tesseract: 0 },
  "temas/siguesinfunciona.png": { total: 4, tesseract: 4 },
  "temas/styanaxnodetecta.png": { total: 4, tesseract: 3 },
  // Reportada en vivo: el escáner devolvía "Nidus Prime Neuroptics Blueprint", juntando el
  // "Nidus Prime" de la primera tarjeta con el "Neuroptics Blueprint" de la segunda. Ese nombre
  // EXISTE en el catálogo, así que el matcher lo acepta y no hay forma de notarlo contando.
  // FALLO CONOCIDO, sin arreglar: ver el `todo` de abajo.
  "mal.png": {
    total: 4, tesseract: 3,
    todo: "junta 'Nidus Prime' con el 'Neuroptics Blueprint' de la tarjeta de al lado",
    esperados: ["Nidus Prime Blueprint", "Chroma Prime Neuroptics Blueprint",
      "Trumna Prime Blueprint", "Burston Prime Stock"],
  },
};

// El config "tsv" vive en tessdata/configs/ y el traineddata del repo no lo trae: sin él
// Tesseract devuelve texto plano y el parseo se queda en cero SIN avisar.
const TESS = hayTesseract ? fs.mkdtempSync(path.join(os.tmpdir(), "tessdata-")) : null;
if (TESS) {
  fs.mkdirSync(path.join(TESS, "configs"), { recursive: true });
  fs.writeFileSync(path.join(TESS, "configs", "tsv"), "tessedit_create_tsv 1\n");
  fs.copyFileSync(path.join(RAIZ, "..", "deploy", "js", "eng.traineddata"), path.join(TESS, "eng.traineddata"));
}

/**
 * Palabras CON SU CAJA, no una cadena.
 *
 * Antes esto devolvía texto y el test fabricaba cajas falsas en fila (`x0: i * 40`). Con eso el
 * test no podía ver ningún fallo POSICIONAL, que son justo los que duelen: medido en mal.png, el
 * escáner juntaba "Nidus Prime" de una tarjeta con el "Neuroptics Blueprint" de la de al lado y
 * daba un nombre que existe en el catálogo, y este fichero seguía en verde.
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
 * Lee la captura por el MISMO camino que el escáner: leeRecompensas con el motor clásico, con
 * OCRRepository apuntando al tesseract del sistema.
 *
 * Antes esto reimplementaba el preprocesado (su propio binarizado, sus propias cajas) y por eso
 * no veía los fallos reales: sobre mal.png el escáner devolvía "Nidus Prime Neuroptics
 * Blueprint" —el "Nidus Prime" de una tarjeta con el "Neuroptics Blueprint" de la de al lado— y
 * este fichero leía tres nombres correctos y se quedaba en verde.
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

  // TODOS los candidatos, sin cortar: en producción se para en el primero que llega al mínimo,
  // pero un nombre mezclado en cualquiera de ellos es un fallo que aparecerá en cuanto la banda
  // salga un poco distinta. Medido en mal.png: el candidato 0 lee bien y el 1 y el 2 mezclan.
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
      // Contar no basta: un nombre MEZCLADO entre dos tarjetas también suma uno, y además EXISTE
      // en el catálogo, así que solo se ve comparando con lo que pone en la pantalla.
      for (const nombre of verdad.esperados ? todos : []) {
        assert.ok(verdad.esperados.includes(nombre),
          `"${nombre}" no está en la pantalla; leídos: [${[...new Set(todos)].join(", ")}]`);
      }
      assert.ok(leidos.length >= verdad.tesseract,
        `${leidos.length}/${verdad.total} — antes leía ${verdad.tesseract}: [${leidos.join(", ")}]`);
    });
}

test("la escalera de recortes ofrece siempre una alternativa", () => {
  // La banda detectada se ancla a veces BAJO los rótulos y los corta por arriba: medido en
  // temas/fisura-red.png, el primer candidato deja fuera la mitad superior del texto y lee 0 de
  // 3, mientras el tercero lee las 3. Sin más de un candidato, esa pantalla no se lee nunca.
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
  // Y no pueden ser el mismo: el segundo tiene que mirar más arriba que la banda detectada.
  assert.ok(conRecorte.some((c) => c.cropRect.y < cropRect.y),
    "ningún candidato mira por encima de la banda detectada");
});
