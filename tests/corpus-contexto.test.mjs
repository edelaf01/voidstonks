// ANDAMIAJE del corpus de capturas reales: ¿qué PANTALLA cree el escáner que está viendo?
//
// El contexto es la primera decisión de toda la cadena: con él mal, la pantalla se lee con la
// lógica equivocada o no se lee. Aquí se recorre la cascada REAL de tres intentos que hace
// processFrame (cabecera izquierda -> rebinarizada por tema -> título centrado) sobre cada
// captura del corpus, con la verdad en tests/_fixtures/corpus-pantallas.json.
//
// Las imágenes viven fuera del repo (pesan ~5 MB cada una): sin la carpeta, el fichero entero
// se salta. Las entradas con `null` en el JSON son las que todavía no están etiquetadas y salen
// como `todo`, para que se vean sin romper la suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.CORPUS_PANTALLAS_DIR
  || "/home/ppsoy/Imágenes/Capturas de pantalla/nofunciona/implementar";
const { pantallas } = JSON.parse(fs.readFileSync(path.join(RAIZ, "_fixtures", "corpus-pantallas.json"), "utf8"));
const hayTesseract = spawnSync("tesseract", ["--version"], { stdio: "ignore" }).status === 0;

function ocr(canvas) {
  const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-"));
  const f = path.join(dir, "h.png");
  fs.writeFileSync(f, encodePng({ width: canvas.width, height: canvas.height, data: d.data }));
  // TESSDATA_DIR permite pasar el corpus con otro modelo (p. ej. uno afinado) antes de servirlo.
  const r = spawnSync("tesseract", [f, "-", "--tessdata-dir", process.env.TESSDATA_DIR || path.join(RAIZ, "..", "deploy", "js"), "--psm", "6"],
    { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return (r.stdout || "").trim();
}

/** La misma cascada que processFrame, sin el paso del medio (que solo rescata la izquierda). */
function contextoDe(img) {
  const video = new FakeCanvas(img.width, img.height);
  video.getContext("2d").drawImage(img, 0, 0);
  video.videoWidth = img.width;
  video.videoHeight = img.height;

  const izq = new FakeCanvas(10, 10);
  VisionService.prepareVirtualCanvas(video, izq);
  let ctx = VisionService.determineContext(ocr(izq));
  if (ctx !== "UNKNOWN") return ctx;

  // MISSION COMPLETE no cae en el recorte izquierdo: sin esta pasada esa pantalla es invisible.
  const centro = new FakeCanvas(10, 10);
  VisionService.prepareCenterHeaderCanvas(video, centro);
  const tema = VisionService.detectThemeFromSnapshot(centro, 0, 0, centro.width, centro.height, { sinRecuerdo: true });
  VisionService.applyThemeDistanceThreshold(centro.getContext("2d"), centro.width, centro.height, tema);
  return VisionService.determineContext(ocr(centro));
}

for (const [rel, esperado] of Object.entries(pantallas)) {
  const archivo = path.join(DIR, rel);
  const falta = !fs.existsSync(archivo) && `sin ${rel}`;
  test(`contexto de ${rel}`, { skip: falta || (!hayTesseract && "tesseract no instalado"), todo: !esperado && "sin etiquetar" }, () => {
    const ctx = contextoDe(decodePng(fs.readFileSync(archivo)));
    assert.equal(ctx, esperado);
  });
}

test("el corpus no se queda sin etiquetar en silencio", () => {
  const sinEtiquetar = Object.entries(pantallas).filter(([, v]) => !v).map(([k]) => k);
  // No es un fallo: es el inventario de lo que falta, visible en cada `npm test`.
  assert.ok(sinEtiquetar.length <= 7, `pendientes de etiquetar: ${sinEtiquetar.join(", ")}`);
});

// La franja del rótulo (64×8 en luma) ve el cambio INVENTORY/SELL -> INVENTORY/MODS que el hash de
// 16×9 daba por "la misma pantalla" (distancia 19-25, tolerancia 24). Sin Tesseract: solo píxeles.
{
  const { regionLuma, smallCanvasHash, compareHashes } = await import("../deploy/js/utils/vision/frame_hash.js");
  const { FRANJA_TITULO_VIDEO, tituloHaCambiado } = await import("../deploy/js/utils/vision/context_latch.js");
  // Una captura cada vez y sin guardarla: decodificada son ~15 MB.
  const cabecera = (rel) => {
    let img = decodePng(fs.readFileSync(path.join(DIR, rel)));
    const video = new FakeCanvas(img.width, img.height);
    video.getContext("2d").drawImage(img, 0, 0);
    video.videoWidth = img.width; video.videoHeight = img.height;
    img = null;
    const cvs = new FakeCanvas(10, 10);
    VisionService.prepareVirtualCanvas(video, cvs);
    return { franja: regionLuma(video, FRANJA_TITULO_VIDEO), hash: smallCanvasHash(cvs) };
  };
  const MODS = process.env.CORPUS_MODS_PNG || "/home/ppsoy/Imágenes/Capturas de pantalla/nofunciona/riven2.png";
  const faltaMods = !(fs.existsSync(path.join(DIR, "anky ros.png")) && fs.existsSync(MODS)) && "sin anky ros.png o riven2.png";
  test("la franja del título ve INVENTORY/SELL -> INVENTORY/MODS donde el hash 16×9 no", { skip: faltaMods }, () => {
    const a = cabecera("anky ros.png");
    let img = decodePng(fs.readFileSync(MODS));
    const video = new FakeCanvas(img.width, img.height);
    video.getContext("2d").drawImage(img, 0, 0);
    video.videoWidth = img.width; video.videoHeight = img.height;
    img = null;
    const cvs = new FakeCanvas(10, 10);
    VisionService.prepareVirtualCanvas(video, cvs);
    const b = { franja: regionLuma(video, FRANJA_TITULO_VIDEO), hash: smallCanvasHash(cvs) };
    assert.equal(tituloHaCambiado(b.franja, a.franja), true);
    assert.equal(compareHashes(a.hash, b.hash, 24), true, "el hash viejo las daba por la misma pantalla");
  });
  // Dos fotos de la misma pantalla con el inventario desplazado, en la carpeta hermana `inventario/`.
  const INV = process.env.CORPUS_INVENTARIO_DIR || path.join(DIR, "..", "..", "inventario");
  const pares = ["2026-07-14_21-53.png", "2026-07-14_21-53_1.png"].map((p) => path.join(INV, p));
  const faltaPar = !pares.every((p) => fs.existsSync(p)) && `sin ${pares.join(" / ")}`;
  test("el inventario desplazado no cambia el rótulo", { skip: faltaPar }, () => {
    const a = cabecera(path.relative(DIR, pares[0]));
    const b = cabecera(path.relative(DIR, pares[1]));
    assert.equal(tituloHaCambiado(b.franja, a.franja), false);
  });
}
