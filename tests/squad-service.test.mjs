import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

// vision.service.js crea canvases al importarse: el document falso va antes.
installFakeDocument();
const { SquadService } = await import("../deploy/js/services/scanner/squad.service.js");
const { collectWords } = await import("../deploy/js/utils/vision/ocr_words.js");
const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
const { state } = await import("../deploy/js/state.js");

// ===========================================================================
// El sondeo de la pantalla de pausa.
//
// Lo que se comprueba aquí es el COSTE, que es lo que decide si esto se puede
// permitir corriendo sobre cada frame sin contexto: una pantalla que no es la
// pausa tiene que salir con UN solo OCR (el del menú, que es el barato), y una
// pausa quieta no puede repetir el OCR de la franja ni la resolución de precios.
// ===========================================================================

const MENU_OK = "RESUME\nCHALLENGES\nABILITIES\nABORT MISSION";
const MENU_NO = "PROFILE\nOPTIONS\nEXIT";

const RELIC_WORDS = ["Neo", "N12", "Relic", "(Radiant)"].map((text, i) => ({
  text, bbox: { x0: 100 + i * 70, x1: 100 + i * 70 + 52, y0: 200, y1: 225 },
}));

function fakeVideo(tint = 40) {
  const cvs = new FakeCanvas(320, 180);
  for (let i = 0; i < cvs.data.length; i += 4) {
    cvs.data[i] = tint; cvs.data[i + 1] = tint; cvs.data[i + 2] = tint; cvs.data[i + 3] = 255;
  }
  cvs.videoWidth = 320;
  cvs.videoHeight = 180;
  return cvs;
}

let calls;
function scriptOCR(menuText, words = RELIC_WORDS) {
  calls = [];
  OCRRepository.workers = [{ id: "fake" }];
  OCRRepository.recognize = async (_worker, _canvas, _opts, output) => {
    calls.push(output?.blocks ? "strip" : "menu");
    return output?.blocks ? { data: { words } } : { data: { text: menuText } };
  };
}

beforeEach(() => {
  state.allRelicNames = ["Neo N12", "Neo V11"];
  state.relicsDatabase = {
    "Neo N12": [
      { name: "Forma Blueprint", chance: 25.33, ducats: 0 },
      { name: "Braton Prime Stock", chance: 25.33, ducats: 15 },
      { name: "Braton Prime Receiver", chance: 25.33, ducats: 15 },
      { name: "Ash Prime Systems", chance: 11, ducats: 45 },
      { name: "Ash Prime Chassis", chance: 11, ducats: 45 },
      { name: "Nautilus Prime Carapace", chance: 2, ducats: 100 },
    ],
  };
  state.setsDatabase = { "Ash Prime": ["Ash Prime Systems", "Ash Prime Chassis"] };
  state.primeInventory = {};
  state.squadRun = null;

  SquadService.lastProbeTime = 0;
  SquadService.lastStripHash = null;
  SquadService.lastVerdict = false;
  SquadService.onUpdate = null;
  // La resolución de precios es I/O (IndexedDB + red) y tiene su propio camino: aquí
  // estorba, y sin stub dejaría timers vivos al acabar el test.
  SquadService.withPrices = async () => {};
});

describe("sondeo", () => {
  test("una pantalla que no es la pausa se descarta con UN solo OCR", async () => {
    scriptOCR(MENU_NO);
    assert.equal(await SquadService.probe(fakeVideo()), false);
    assert.deepEqual(calls, ["menu"]);
    assert.equal(state.squadRun, null);
  });

  test("la pausa publica el run y avisa a la UI", async () => {
    scriptOCR(MENU_OK);
    const avisos = [];
    SquadService.onUpdate = (run) => avisos.push(run);

    assert.equal(await SquadService.probe(fakeVideo()), true);
    assert.deepEqual(calls, ["menu", "strip"]);
    assert.deepEqual(state.squadRun.relics.map((r) => r.name), ["Neo N12"]);
    assert.equal(state.squadRun.relics[0].refinement, "radiant");
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0], state.squadRun);
  });

  test("el run trae lo que puede caer, ordenado", async () => {
    scriptOCR(MENU_OK);
    await SquadService.probe(fakeVideo());
    assert.equal(state.squadRun.drops.length, 6);
    assert.equal(state.squadRun.drops[0].name, "Nautilus Prime Carapace");
  });

  test("el ritmo mínimo corta el sondeo sin gastar OCR", async () => {
    scriptOCR(MENU_NO);
    await SquadService.probe(fakeVideo());
    assert.equal(await SquadService.probe(fakeVideo()), false);
    assert.deepEqual(calls, ["menu"], "el segundo sondeo no debería llegar al OCR");
  });

  test("dentro del ritmo mínimo la pausa SIGUE siendo pausa", async () => {
    // Sin esto el frame caía al pipeline normal y, con el contexto en RELICS,
    // processRelicSelection ofrecía una reliquia del squad como elegida por el jugador.
    scriptOCR(MENU_OK);
    assert.equal(await SquadService.probe(fakeVideo()), true);
    assert.equal(await SquadService.probe(fakeVideo()), true);
    assert.deepEqual(calls, ["menu", "strip"]);
  });

  test("una pausa QUIETA no repite el OCR de la franja", async () => {
    scriptOCR(MENU_OK);
    const video = fakeVideo();
    await SquadService.probe(video);
    SquadService.lastProbeTime = 0;
    assert.equal(await SquadService.probe(video), true);
    assert.deepEqual(calls, ["menu", "strip", "menu"]);
  });

  test("si la franja CAMBIA se vuelve a leer: alguien ha cambiado de reliquia", async () => {
    scriptOCR(MENU_OK);
    await SquadService.probe(fakeVideo(40));
    SquadService.lastProbeTime = 0;
    await SquadService.probe(fakeVideo(200));
    assert.deepEqual(calls, ["menu", "strip", "menu", "strip"]);
  });

  test("una pausa sin reliquias (misión normal) se reconoce pero no publica run", async () => {
    scriptOCR(MENU_OK, [{ text: "Volt", bbox: { x0: 10, x1: 60, y0: 20, y1: 45 } }]);
    assert.equal(await SquadService.probe(fakeVideo()), true);
    assert.equal(state.squadRun, null);
  });

  test("sin workers de OCR no revienta", async () => {
    scriptOCR(MENU_OK);
    OCRRepository.workers = [];
    assert.equal(await SquadService.probe(fakeVideo()), false);
  });
});

describe("clear", () => {
  test("borra el run y avisa una sola vez", async () => {
    scriptOCR(MENU_OK);
    await SquadService.probe(fakeVideo());
    const avisos = [];
    SquadService.onUpdate = (run) => avisos.push(run);

    SquadService.clear();
    assert.equal(state.squadRun, null);
    assert.deepEqual(avisos, [null]);

    SquadService.clear();
    assert.equal(avisos.length, 1, "sin run que borrar no hay que repintar");
  });
});

describe("collectWords", () => {
  const w = (text) => ({ text, bbox: { x0: 1, x1: 2, y0: 3, y1: 4 } });
  const esperado = [{ text: "a", x0: 1, x1: 2, y0: 3, y1: 4 }];

  test("saca las palabras estén donde estén en el resultado", () => {
    assert.deepEqual(collectWords({ words: [w("a")] }), esperado);
    assert.deepEqual(collectWords({ lines: [{ words: [w("a")] }] }), esperado);
    assert.deepEqual(collectWords({ paragraphs: [{ lines: [{ words: [w("a")] }] }] }), esperado);
    assert.deepEqual(
      collectWords({ blocks: [{ paragraphs: [{ lines: [{ words: [w("a")] }] }] }] }), esperado);
  });

  test("acepta la caja en la propia palabra y descarta lo que no la trae", () => {
    assert.deepEqual(collectWords({ words: [{ text: "a", x0: 1, x1: 2, y0: 3, y1: 4 }] }), esperado);
    assert.deepEqual(collectWords({ words: [{ text: "a" }] }), []);
    assert.deepEqual(collectWords(null), []);
    assert.deepEqual(collectWords({}), []);
  });
});
