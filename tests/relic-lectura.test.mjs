// Qué LEE de verdad la pantalla VOID RELICS/REFINEMENT, con Tesseract real sobre capturas reales.
//
// Este test existe por una regresión concreta: se cambió readGrid para que una sola pasada de
// PaddleOCR alimentara nombres y contadores, la suite entera siguió verde y en producción pasó a
// leer CERO reliquias. El test que debía cubrirlo fabricaba la salida de Paddle con cajas por
// PALABRA, cuando Paddle las da por LÍNEA — o sea, verificaba la suposición, no el comportamiento.
// Aquí no se fabrica nada: entra el PNG y sale lo que el usuario vería en su inventario.
//
// Las capturas viven fuera del repo (~4 MB cada una) y el fichero se salta entero si no están.
// La verdad de abajo está contada A MANO mirando la imagen, no copiada de lo que el código saca.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { decodePng, encodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { RelicScreenService } = await import("../deploy/js/services/scanner/relic_screen.service.js");
const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
const { state } = await import("../deploy/js/state.js");
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");

const DIR = process.env.RELIC_CAPTURES_DIR
  || "/home/ppsoy/Imágenes/Capturas de pantalla/nofunciona/implementar/reliccount";
const hayTesseract = spawnSync("tesseract", ["--version"], { stdio: "ignore" }).status === 0;
const hayCapturas = fs.existsSync(DIR);

// Las cuatro capturas son la MISMA pantalla con temas distintos: 19 reliquias con contador.
const PANTALLA = {
  "Meso C6": 108, "Meso I1": 108, "Meso T1": 108, "Meso P5": 106, "Meso K4": 104,
  "Meso K3": 103, "Meso B9": 102, "Meso A3": 100, "Meso M4": 97, "Meso N17": 93,
  "Meso A7": 87, "Meso N10": 85, "Meso X1": 81, "Meso P10": 76, "Meso V13": 75,
  "Meso E6": 74, "Meso W3": 71, "Meso G4": 70, "Meso G8": 70,
};
// Mínimo que cada tema tiene que sacar. Son las cifras MEDIDAS hoy: si suben, el test lo dice
// para actualizarlas; si bajan, es una regresión. Ninguna llega a 19 — el arte de la reliquia se
// come contadores— pero lo que sí se exige siempre es que NADA se lea mal.
const MINIMOS = { "1.png": 9, "3.png": 12, "4.png": 10, "6-ojo otro tema.png": 17 };
// Pantallas de fin de misión: NO son la rejilla de reliquias y no deben escribir nada.
const NO_ES_LA_REJILLA = ["lastmission-rojo.png", "lastmissionstalker.png", "lastmissionvitruvian.png"];

const TESS = hayTesseract ? fs.mkdtempSync(path.join(os.tmpdir(), "tessdata-")) : null;
if (TESS) {
  // El config "tsv" vive en tessdata/configs/ y el traineddata del repo no lo trae. Sin él
  // Tesseract devuelve texto plano, no cajas, y el parseo se queda en cero SIN avisar.
  fs.mkdirSync(path.join(TESS, "configs"), { recursive: true });
  fs.writeFileSync(path.join(TESS, "configs", "tsv"), "tessedit_create_tsv 1\n");
  fs.copyFileSync(new URL("../deploy/js/eng.traineddata", import.meta.url), path.join(TESS, "eng.traineddata"));
}

function palabras(canvas, psm) {
  const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-"));
  const f = path.join(dir, "a.png");
  fs.writeFileSync(f, encodePng({ width: canvas.width, height: canvas.height, data: d.data }));
  const r = spawnSync("tesseract", [f, "-", "--tessdata-dir", TESS, "--psm", String(psm), "tsv"],
    { encoding: "utf8", maxBuffer: 64e6 });
  fs.rmSync(dir, { recursive: true, force: true });
  const words = [];
  for (const ln of (r.stdout || "").split("\n").slice(1)) {
    const c = ln.split("\t");
    if (c.length < 12 || +c[10] < 0) continue;
    const text = (c[11] || "").trim();
    if (text) words.push({ text, x0: +c[6], y0: +c[7], x1: +c[6] + +c[8], y1: +c[7] + +c[9] });
  }
  return { data: { words } };
}

/** getRelicMatch resuelve contra este catálogo: sin él el OCR sale perfecto y el match da 0. */
function catalogoDeReliquias() {
  if (state.allRelicNames?.length) return;
  state.allRelicNames = [];
  for (const t of ["Lith", "Meso", "Neo", "Axi"]) {
    for (const l of "ABCDEFGHIKLMNOPRSTVWZ") {
      for (let n = 1; n <= 20; n++) state.allRelicNames.push(`${t} ${l}${n}`);
    }
  }
}

function leeCaptura(archivo) {
  OCRRepository.workers = [{ id: "cli" }];
  OCRRepository.recognize = async (_w, c, _o, out) => (out?.blocks ? palabras(c, 6) : { data: { text: "" } });
  OCRRepository.recognizeWithPSM = async (_w, c, psm) => palabras(c, psm);
  catalogoDeReliquias();
  state.inventory = [];
  RelicScreenService.reset();

  const img = decodePng(fs.readFileSync(path.join(DIR, archivo)));
  const v = new FakeCanvas(img.width, img.height);
  v.getContext("2d").drawImage(img, 0, 0);
  v.videoWidth = img.width; v.videoHeight = img.height;

  return (async () => {
    await RelicScreenService.readGrid(v);
    RelicScreenService.lastGridHash = null; // el mismo frame otra vez: el consenso pide 2 lecturas
    await RelicScreenService.readGrid(v);
    return state.inventory.map((i) => ({ name: i.name, count: i.count }));
  })();
}

const salta = (!hayTesseract && "tesseract no instalado") || (!hayCapturas && "sin capturas");

for (const [archivo, minimo] of Object.entries(MINIMOS)) {
  test(`rejilla de reliquias: ${archivo}`, { skip: salta }, async () => {
    const leido = await leeCaptura(archivo);
    // Lo primero y lo más importante: una cantidad mal leída PISA la que había en el inventario
    // y no queda rastro de cuál era. Leer de menos se nota; leer mal, no.
    for (const { name, count } of leido) {
      assert.ok(name in PANTALLA, `"${name}" no está en la pantalla: se inventó una reliquia`);
      assert.equal(count, PANTALLA[name], `${name}: cantidad mal leída`);
    }
    assert.ok(leido.length >= minimo,
      `leyó ${leido.length} de ${Object.keys(PANTALLA).length}, antes leía ${minimo}`);
  });
}

for (const archivo of NO_ES_LA_REJILLA) {
  test(`no escribe nada fuera de la rejilla: ${archivo}`, { skip: salta }, async () => {
    assert.deepEqual(await leeCaptura(archivo), []);
  });
}

// ── Reliquia SEGUIDA (el panel "<Tier> <Código> Relic - Possible Rewards") ──────────────
//
// El recorte empezaba en width*0.5 y la rejilla llega hasta 0.60, así que se comía su última
// columna: junto al panel entraba una reliquia de la rejilla y el seguimiento cogía ESA —
// siempre la de arriba a la derecha, hubieras seleccionado algo o no. Verdad leída a mano de
// cada captura.
const SEGUIDA = {
  "1.png": "MESO M4", "2.png": "MESO M4", "3.png": "MESO B9",
  "4.png": "MESO G4", "5.png": "MESO P8", "6-ojo otro tema.png": "MESO M4",
};

function textoDelPanel(archivo) {
  const img = decodePng(fs.readFileSync(path.join(DIR, archivo)));
  const v = new FakeCanvas(img.width, img.height);
  v.getContext("2d").drawImage(img, 0, 0);
  v.videoWidth = img.width; v.videoHeight = img.height;
  const cvs = VisionService.prepareRelicSelectionCanvas(v, 1);
  const d = cvs.getContext("2d").getImageData(0, 0, cvs.width, cvs.height);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sel-"));
  const f = path.join(dir, "a.png");
  fs.writeFileSync(f, encodePng({ width: cvs.width, height: cvs.height, data: d.data }));
  const r = spawnSync("tesseract", [f, "-", "--tessdata-dir", TESS, "--psm", "6"], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return (r.stdout || "").trim();
}

function palabrasDelPanel(archivo) {
  const img = decodePng(fs.readFileSync(path.join(DIR, archivo)));
  const v = new FakeCanvas(img.width, img.height);
  v.getContext("2d").drawImage(img, 0, 0);
  v.videoWidth = img.width; v.videoHeight = img.height;
  const cvs = VisionService.prepareRelicSelectionCanvas(v, 1080 / img.height);
  const d = cvs.getContext("2d").getImageData(0, 0, cvs.width, cvs.height);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sel-"));
  const f = path.join(dir, "a.png");
  fs.writeFileSync(f, encodePng({ width: cvs.width, height: cvs.height, data: d.data }));
  const opts = ["--tessdata-dir", TESS, "--psm", "6"];
  const texto = (spawnSync("tesseract", [f, "-", ...opts], { encoding: "utf8" }).stdout || "").trim();
  const tsv = spawnSync("tesseract", [f, "-", ...opts, "-c", "tessedit_create_tsv=1"], { encoding: "utf8" }).stdout || "";
  fs.rmSync(dir, { recursive: true, force: true });
  const palabras = tsv.split("\n").map((l) => l.split("\t")).filter((c) => c[0] === "5" && c[11]?.trim())
    .map((c) => ({ text: c[11], x0: +c[6], y0: +c[7], x1: +c[6] + +c[8], y1: +c[7] + +c[9] }));
  return { texto, palabras };
}

// Leyendo el recorte entero se seguía la reliquia del compañero: "AXI D6" con No Relic y "AXI A21"
// con la A6 elegida. En la captura reescalada tu fila sale "Axi AG Ril": mejor nada que la de otro.
const FISURA = { "fisura-sin-fin-no-relic.png": "", "fisura-sin-fin-a6-reescalada.png": null };
const ESCUADRA = ["Axi A6", "Axi A21", "Axi D6"];

// Leída a mano. La A6 pone "Last Equipped" donde iba el "x2": no debe salir cantidad para ella.
const REJILLA_FISURA = {
  "Axi A9": 7, "Axi A10": 13, "Axi A11": 12, "Axi A12": 18, "Axi A13": 18, "Axi A14": 7, "Axi A16": 11,
  "Axi A17": 34, "Axi A18": 25, "Axi A19": 7, "Axi A20": 4, "Axi A21": 18, "Axi A22": 11, "Axi B3": 17,
};

test("rejilla en fisura sin fin: \"Last Equipped\" no se lee como contador", { skip: salta || (!fs.existsSync(path.join(DIR, "fisura-sin-fin-no-relic.png")) && "sin la captura") }, async () => {
  catalogoDeReliquias();
  for (const n of ["Axi A21", "Axi A22"]) if (!state.allRelicNames.includes(n)) state.allRelicNames.push(n);
  const leido = await leeCaptura("fisura-sin-fin-no-relic.png");
  assert.ok(!leido.some((r) => r.name === "Axi A6"), "la A6 no tiene contador en pantalla");
  for (const { name, count } of leido) assert.equal(count, REJILLA_FISURA[name], name);
  assert.ok(leido.length >= 13, `leyó ${leido.length}, hoy lee 13`);
});

for (const [archivo, esperada] of Object.entries(FISURA)) {
  test(`reliquia seguida en fisura sin fin: ${archivo} -> ${esperada === "" ? "No Relic" : esperada}`, { skip: salta || (!fs.existsSync(path.join(DIR, archivo)) && "sin la captura") }, () => {
    catalogoDeReliquias();
    for (const n of ESCUADRA) if (!state.allRelicNames.includes(n)) state.allRelicNames.push(n);
    const { texto, palabras } = palabrasDelPanel(archivo);
    assert.equal(OCRService.parseRelicSelection(texto, palabras), esperada);
  });
}

for (const [archivo, esperada] of Object.entries(SEGUIDA)) {
  test(`reliquia seguida: ${archivo} -> ${esperada}`, { skip: salta }, () => {
    catalogoDeReliquias();
    assert.equal(OCRService.parseRelicSelection(textoDelPanel(archivo)), esperada);
  });
}

for (const archivo of NO_ES_LA_REJILLA) {
  test(`no hay reliquia seguida fuera de la pantalla de reliquias: ${archivo}`, { skip: salta }, () => {
    catalogoDeReliquias();
    // Sin exigir el rótulo del panel, el "IMPORTANCE __¥__SEARCH a." de fin de misión devolvía
    // "NEO S2": el matcher saca una reliquia de cualquier basura si se la das.
    assert.equal(OCRService.parseRelicSelection(textoDelPanel(archivo)), null);
  });
}
