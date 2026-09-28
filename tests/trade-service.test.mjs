// La mesa del TRADING POST leída por el servicio (services/scanner/trade.service.js), con capturas reales.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { decodePng, encodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";
import { comoItemsDatabase } from "./_helpers/prime-catalog.mjs";

installFakeDocument();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const ARCANOS = new URL("../deploy/assets/json/arcanes_vosfor.json", import.meta.url);
globalThis.fetch = async (url) => (String(url).endsWith("arcanes_vosfor.json")
  ? { ok: true, json: async () => JSON.parse(fs.readFileSync(ARCANOS, "utf8")) }
  : { ok: false, json: async () => ({}) });

const { TradeService } = await import("../deploy/js/services/scanner/trade.service.js");
const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");
const { casillaTradeo } = await import("../deploy/js/utils/vision/trade_post.js");

const KHORA = ["Khora Prime Blueprint", "Khora Prime Systems Blueprint", "Khora Prime Neuroptics Blueprint", "Khora Prime Chassis Blueprint"];
state.itemsDatabase = comoItemsDatabase([...KHORA, "Braton Prime Barrel"]);
OCRService.cachedDbItems = []; OCRService.knownParts = new Set(); OCRService._vocabCache = null;
OCRService.initMatcherData();

const DIR = process.env.CORPUS_PANTALLAS_DIR || "/home/ppsoy/Imágenes/Capturas de pantalla/nofunciona/implementar";
const hayTesseract = spawnSync("tesseract", ["--version"], { stdio: "ignore" }).status === 0;
const TESS = new URL("../deploy/js", import.meta.url).pathname;
const falta = (archivo) => (!fs.existsSync(path.join(DIR, archivo)) && "sin la captura") || (!hayTesseract && "tesseract no instalado");

/** OCR real con la CLI de Tesseract sobre el lienzo que prepara el servicio. */
function tesseract(cvs, extra = []) {
  const d = cvs.getContext("2d").getImageData(0, 0, cvs.width, cvs.height);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trade-"));
  const f = path.join(dir, "a.png");
  fs.writeFileSync(f, encodePng({ width: cvs.width, height: cvs.height, data: d.data }));
  const text = spawnSync("tesseract", [f, "-", "--tessdata-dir", TESS, "--psm", "6", ...extra], { encoding: "utf8" }).stdout || "";
  fs.rmSync(dir, { recursive: true, force: true });
  return { data: { text } };
}

function conTesseract() {
  let lecturas = 0;
  OCRRepository.workers = [{}];
  OCRRepository.recognize = async (_w, cvs) => { lecturas++; return tesseract(cvs); };
  OCRRepository.recognizeWithChars = async (_w, cvs, chars) => tesseract(cvs, ["-c", `tessedit_char_whitelist=${chars}`]);
  return () => lecturas;
}

function captura(archivo) {
  const img = decodePng(fs.readFileSync(path.join(DIR, archivo)));
  const video = new FakeCanvas(img.width, img.height);
  video.getContext("2d").drawImage(img, 0, 0);
  video.videoWidth = img.width; video.videoHeight = img.height;
  return video;
}

/**
 * Mesa sintética de 640×360: rótulo del título encendido (o apagado, como con un diálogo abierto),
 * y la casilla 0 de "lo que das" ocupada, con el rótulo de la pieza con brillo `brillo`.
 */
function mesaSintetica({ brillo = 200, dialogo = false } = {}) {
  const W = 640, H = 360;
  const data = new Uint8ClampedArray(W * H * 4).fill(30);
  const { icono, rotulo } = casillaTradeo("doy", 0, W, H);
  const pinta = (r, v) => {
    for (let y = Math.floor(r.y * H); y < (r.y + r.h) * H; y++) for (let x = Math.floor(r.x * W); x < (r.x + r.w) * W; x++) {
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v(x, y);
    }
  };
  pinta({ x: 0.1, y: 0.04, w: 0.3, h: 0.04 }, (x) => (x % 7 < 3 ? (dialogo ? 38 : 190) : 30));
  pinta(icono, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? 220 : 30);
  pinta(rotulo, (x) => (x % 5 < 2 ? brillo : 30));
  return { videoWidth: W, videoHeight: H, width: W, height: H, data };
}

beforeEach(() => { TradeService.reset(); TradeService.onUpdate = null; TradeService.onTrade = null; TradeService._mesaT = 0; });

test("mesa vacía: ni una lectura OCR", async () => {
  const W = 640, H = 360;
  let lecturas = 0;
  OCRRepository.workers = [{}];
  OCRRepository.recognize = async () => { lecturas++; return { data: { text: "" } }; };
  const video = mesaSintetica();
  const { icono } = casillaTradeo("doy", 0, W, H);
  for (let y = Math.floor(icono.y * H); y < (icono.y + icono.h) * H; y++) for (let x = Math.floor(icono.x * W); x < (icono.x + icono.w) * W; x++) video.data.fill(30, (y * W + x) * 4, (y * W + x) * 4 + 3);
  await TradeService.process(video);
  assert.equal(lecturas, 0);
  assert.deepEqual(TradeService.ultimo, { doy: [], recibo: [] });
});

// Visto en vivo con un set de Khora: leída a media animación, la Neuroptics casaba con el Blueprint y se
// quedaba así. Una casilla cuenta solo con dos lecturas iguales seguidas.
test("una pieza se da por buena con dos lecturas iguales, y una distinta no la sustituye sin confirmar", async () => {
  const textos = ["Khora Prime Blueprint", "Khora Prime Neuroptics Blueprint", "Khora Prime Neuroptics Blueprint"];
  let lecturas = 0;
  OCRRepository.workers = [{}];
  OCRRepository.recognize = async () => ({ data: { text: textos[Math.min(lecturas++, textos.length - 1)] } });
  const video = mesaSintetica();
  await TradeService.process(video);
  assert.deepEqual(TradeService.ultimo.doy, [], "una lectura sola no basta");
  await TradeService.process(video);
  assert.deepEqual(TradeService.ultimo.doy, [], "dos lecturas distintas tampoco");
  await TradeService.process(video);
  assert.equal(TradeService.ultimo.doy[0]?.name, "Khora Prime Neuroptics Blueprint");
  await TradeService.process(video);
  assert.equal(lecturas, 3, "confirmada, no se relee");
});

test("una lectura fallida se reintenta pasado un rato, y si el rótulo cambia sin leerse se conserva la pieza", async () => {
  const textos = ["", "Arcane Velocity", "Arcane Velocity", ""];
  let lecturas = 0;
  OCRRepository.workers = [{}];
  OCRRepository.recognize = async () => ({ data: { text: textos[Math.min(lecturas++, textos.length - 1)] } });
  const video = mesaSintetica();
  await TradeService.process(video);
  await TradeService.process(video);
  assert.equal(lecturas, 1, "dentro del plazo no se relee");
  TradeService._casillas.get("doy0").t -= 2000;
  await TradeService.process(video);
  await TradeService.process(video);
  assert.equal(TradeService.ultimo.doy[0]?.name, "Arcane Velocity");
  await TradeService.process(mesaSintetica({ brillo: 90 }));
  assert.equal(lecturas, 4, "el rótulo cambió: se relee");
  assert.equal(TradeService.ultimo.doy[0]?.name, "Arcane Velocity", "la lectura falló pero la casilla sigue ocupada");
});

test("con el diálogo de confirmación abierto, su lista manda", async () => {
  OCRRepository.workers = [{}];
  OCRRepository.recognize = async () => ({ data: { text: "Are you sure you want to accept this trade? You are\noffering:\nArcane Velocity ©© ©\nand will receive from X the following:\nPlatinum x 165\nOK CANCEL" } });
  await TradeService.process(mesaSintetica({ dialogo: true }));
  assert.equal(TradeService.ultimo.confirmada, true);
  assert.deepEqual(TradeService.ultimo.doy.map((i) => i.name), ["Arcane Velocity"]);
  assert.deepEqual(TradeService.ultimo.recibo, [{ tipo: "platino", name: "Platinum", qty: 165, plat: null }]);
});

const CONFIRMACION = "Are you sure you want to accept this trade? You are\noffering:\nArcane Velocity ©© ©\nand will receive from X the following:\nPlatinum x 165\nOK CANCEL";

test("tras una confirmación, el mensaje de éxito cierra el trade una sola vez", async () => {
  const textos = [CONFIRMACION, "The trade was successful!\nOK", "The trade was successful!\nOK"];
  let i = 0;
  OCRRepository.workers = [{}];
  OCRRepository.recognize = async () => ({ data: { text: textos[Math.min(i++, textos.length - 1)] } });
  const hechos = [];
  TradeService.onTrade = (m) => hechos.push(m);
  for (let n = 0; n < 3; n++) {
    TradeService._dialogoHash = null;
    await TradeService.process(mesaSintetica({ dialogo: true }));
  }
  assert.equal(hechos.length, 1);
  assert.deepEqual(hechos[0].doy.map((x) => x.name), ["Arcane Velocity"]);
  assert.equal(hechos[0].recibo[0].qty, 165);
});

test("sin confirmación leída, el mensaje de éxito no cierra nada", async () => {
  OCRRepository.workers = [{}];
  OCRRepository.recognize = async () => ({ data: { text: "The trade was successful!\nOK" } });
  let hechos = 0;
  TradeService.onTrade = () => hechos++;
  await TradeService.process(mesaSintetica({ dialogo: true }));
  assert.equal(hechos, 0);
});

// Con el diálogo abierto el rótulo se apaga y la cabecera deja de ver el Trading Post: el escáner lo pregunta aquí.
test("hay diálogo del Trading Post solo con el rótulo apagado y poco después de haber visto la mesa", async () => {
  OCRRepository.workers = [{}];
  OCRRepository.recognize = async () => ({ data: { text: "" } });
  assert.equal(TradeService.conDialogo(mesaSintetica({ dialogo: true })), false, "sin haber visto la mesa");
  await TradeService.process(mesaSintetica());
  assert.equal(TradeService.conDialogo(mesaSintetica({ dialogo: true })), true);
  assert.equal(TradeService.conDialogo(mesaSintetica()), false, "rótulo encendido");
  TradeService._mesaT -= 121000;
  assert.equal(TradeService.conDialogo(mesaSintetica({ dialogo: true })), false, "pasado el plazo");
});

test("captura real: el set de Khora y los 80 de platino desde las casillas", { skip: falta("trading-post-khora-set-80.png") }, async () => {
  const lecturas = conTesseract();
  const video = captura("trading-post-khora-set-80.png");
  await TradeService.process(video);
  await TradeService.process(video);
  assert.deepEqual(TradeService.ultimo.doy.map((i) => i.name), KHORA);
  assert.deepEqual(TradeService.ultimo.recibo.map(({ name, qty }) => ({ name, qty })), [{ name: "Platinum", qty: 80 }]);
  const tras = lecturas();
  await TradeService.process(video);
  assert.equal(lecturas(), tras, "todo confirmado: no se relee nada");
});

test("captura real: la confirmación del set de Khora", { skip: falta("trade-confirmacion-khora-set-80.png") }, async () => {
  conTesseract();
  await TradeService.process(captura("trade-confirmacion-khora-set-80.png"));
  assert.equal(TradeService.ultimo.confirmada, true);
  assert.deepEqual(TradeService.ultimo.doy.map((i) => i.name), KHORA);
  assert.deepEqual(TradeService.ultimo.recibo.map(({ name, qty }) => ({ name, qty })), [{ name: "Platinum", qty: 80 }]);
});

test("captura real: una confirmación con arcano y esculturas Ayatan", { skip: falta("trade-confirmacion-velocity-ayatan-165.png") }, async () => {
  conTesseract();
  await TradeService.process(captura("trade-confirmacion-velocity-ayatan-165.png"));
  assert.deepEqual(TradeService.ultimo.doy.map(({ tipo, name }) => `${tipo}:${name}`), ["arcano:Arcane Velocity", "otro:Ayatan Sah Sculpture", "otro:Ayatan Piv Sculpture"]);
  assert.equal(TradeService.ultimo.recibo[0]?.qty, 165);
});

test("captura real: un arcano en lo que das y el platino en otra casilla de lo que recibes", { skip: falta("trading-post-ice-storm-platino-95.png") }, async () => {
  conTesseract();
  for (const [archivo, arcano, platino] of [["trading-post-arcane-velocity.png", "Arcane Velocity", null], ["trading-post-ice-storm-platino-95.png", "Arcane Ice Storm", 95]]) {
    TradeService.reset();
    const video = captura(archivo);
    await TradeService.process(video);
    await TradeService.process(video);
    assert.deepEqual(TradeService.ultimo.doy.map((i) => `${i.tipo}:${i.name}`), [`arcano:${arcano}`], archivo);
    assert.deepEqual(TradeService.ultimo.recibo.map((i) => i.qty), platino ? [platino] : [], archivo);
  }
});
