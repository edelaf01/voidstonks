import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

installFakeDocument(); // vision.service.js crea canvases al importarse
const { RelicScreenService } = await import("../deploy/js/services/scanner/relic_screen.service.js");
const { OCRRepository } = await import("../deploy/js/repositories/ocr.repository.js");
const { state } = await import("../deploy/js/state.js");

// ===========================================================================
// Lo leído en VOID RELICS/REFINEMENT se escribe SOLO en el inventario, así que
// aquí se prueba justo lo que protege de una lectura mala: hacen falta dos
// lecturas iguales antes de tocar nada, y una pantalla quieta no se re-OCRea.
// ===========================================================================

const celda = (words, x, y) => words.map((text, i) => ({
  text, x0: x + i * 70, x1: x + i * 70 + 55, y0: y, y1: y + 27,
}));

/** Dos casillas de una fila, con la geometría real (contador 200 px sobre el nombre). */
function pantalla(pares) {
  const nameWords = [], countWords = [];
  pares.forEach(([nombre, cantidad], i) => {
    nameWords.push(...celda(nombre.split(" ").concat("Relic"), 100 + i * 324, 239));
    countWords.push(...celda([`x${cantidad}`], 22 + i * 324, 39));
  });
  return { nameWords, countWords };
}

let frames;
function scriptOCR(...lecturas) {
  frames = lecturas;
  OCRRepository.workers = [{ id: "fake" }];
  let i = 0;
  const siguiente = () => frames[Math.min(i, frames.length - 1)];
  OCRRepository.recognize = async (_w, _c, _o, output) =>
    output?.blocks ? { data: { words: siguiente().nameWords } } : { data: { text: "" } };
  OCRRepository.recognizeWithPSM = async () => {
    const f = siguiente(); i++;
    return { data: { words: f.countWords } };
  };
}

function video(tint = 40) {
  const cvs = new FakeCanvas(320, 180);
  for (let i = 0; i < cvs.data.length; i += 4) {
    cvs.data[i] = tint; cvs.data[i + 1] = tint; cvs.data[i + 2] = tint; cvs.data[i + 3] = 255;
  }
  cvs.videoWidth = 320; cvs.videoHeight = 180;
  return cvs;
}

beforeEach(() => {
  state.allRelicNames = ["Meso C6", "Meso I1", "Meso K4"];
  state.inventory = [];
  RelicScreenService.reset();
  RelicScreenService.onApplied = null;
});

describe("consenso antes de escribir", () => {
  test("una sola lectura NO toca el inventario", async () => {
    scriptOCR(pantalla([["Meso C6", 108]]));
    await RelicScreenService.readGrid(video(40));
    assert.deepEqual(state.inventory, []);
  });

  test("dos lecturas iguales sí", async () => {
    scriptOCR(pantalla([["Meso C6", 108]]));
    await RelicScreenService.readGrid(video(40));
    RelicScreenService.lastGridHash = null; // simula que el frame cambió
    await RelicScreenService.readGrid(video(60));
    assert.deepEqual(state.inventory, [{ name: "Meso C6", count: 108 }]);
  });

  test("dos lecturas DISTINTAS no escriben ninguna de las dos", async () => {
    scriptOCR(pantalla([["Meso C6", 108]]), pantalla([["Meso C6", 103]]));
    await RelicScreenService.readGrid(video(40));
    RelicScreenService.lastGridHash = null;
    await RelicScreenService.readGrid(video(60));
    assert.deepEqual(state.inventory, []);
  });
});

describe("escritura en el inventario", () => {
  const dosLecturas = async () => {
    await RelicScreenService.readGrid(video(40));
    RelicScreenService.lastGridHash = null;
    await RelicScreenService.readGrid(video(60));
  };

  test("la cantidad REEMPLAZA la que había, no se suma", async () => {
    state.inventory = [{ name: "Meso C6", count: 3 }];
    scriptOCR(pantalla([["Meso C6", 108]]));
    await dosLecturas();
    assert.deepEqual(state.inventory, [{ name: "Meso C6", count: 108 }]);
  });

  test("lo que no sale en pantalla se queda como estaba", async () => {
    state.inventory = [{ name: "Axi A1", count: 7 }];
    scriptOCR(pantalla([["Meso C6", 108]]));
    await dosLecturas();
    assert.deepEqual(state.inventory, [{ name: "Axi A1", count: 7 }, { name: "Meso C6", count: 108 }]);
  });

  test("' Relic' no duplica la entrada que ya existe", async () => {
    state.inventory = [{ name: "Meso C6 Relic", count: 3 }];
    scriptOCR(pantalla([["Meso C6", 108]]));
    await dosLecturas();
    assert.deepEqual(state.inventory, [{ name: "Meso C6 Relic", count: 108 }]);
  });

  test("el formato viejo (strings repetidos) se convierte contando las copias", async () => {
    state.inventory = ["Axi A1", "Axi A1", "Meso C6"];
    scriptOCR(pantalla([["Meso C6", 108]]));
    await dosLecturas();
    assert.deepEqual(state.inventory, [{ name: "Axi A1", count: 2 }, { name: "Meso C6", count: 108 }]);
  });

  test("avisa una vez por cambio, y no repite si la cantidad no ha cambiado", async () => {
    const avisos = [];
    RelicScreenService.onApplied = (c) => avisos.push(c);
    scriptOCR(pantalla([["Meso C6", 108], ["Meso I1", 106]]));
    await dosLecturas();
    assert.deepEqual(avisos, [[{ name: "Meso C6", count: 108 }, { name: "Meso I1", count: 106 }]]);

    RelicScreenService.lastGridHash = null;
    await RelicScreenService.readGrid(video(80));
    assert.equal(avisos.length, 1, "la misma cantidad ya aplicada no vuelve a avisar");
  });
});

describe("coste", () => {
  test("una pantalla quieta no repite las dos pasadas de OCR", async () => {
    scriptOCR(pantalla([["Meso C6", 108]]));
    let pasadas = 0;
    const real = OCRRepository.recognizeWithPSM;
    OCRRepository.recognizeWithPSM = async (...a) => { pasadas++; return real(...a); };
    const v = video(40);
    await RelicScreenService.readGrid(v);
    await RelicScreenService.readGrid(v);
    assert.equal(pasadas, 1);
  });

  test("sin workers no revienta", async () => {
    scriptOCR(pantalla([["Meso C6", 108]]));
    OCRRepository.workers = [];
    await RelicScreenService.readGrid(video(40));
    assert.deepEqual(state.inventory, []);
  });
});

describe("reset", () => {
  test("olvida los votos, así que hace falta consenso otra vez", async () => {
    scriptOCR(pantalla([["Meso C6", 108]]));
    await RelicScreenService.readGrid(video(40));
    RelicScreenService.reset();
    await RelicScreenService.readGrid(video(60));
    assert.deepEqual(state.inventory, [], "el voto de antes del reset no debería contar");
  });
});
