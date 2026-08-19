import { test, describe } from "node:test";
import assert from "node:assert/strict";

// Lógica PURA de reward_photo_ocr.js (sin DOM ni OCR): el ancla de fila y el filtro de
// columnas. El pipeline completo necesita navegador (OpenCV.js + Tesseract) y se verifica
// con scripts/verify-reward-scan.mjs sobre fotos reales.
const { filterByColumns, findNameRowY } = await import("../deploy/js/utils/vision/reward_photo_ocr.js");

const it = (name, xFrac, ratio = 1) => ({ name, xFrac, ratio });

describe("findNameRowY: ancla PRIME", () => {
  test("elige la fila con más apariciones de PRIME", () => {
    const row = findNameRowY([
      { text: "Prime", cy: 0.42 },
      { text: "Prime", cy: 0.425 },
      { text: "Prime", cy: 0.418 },
      { text: "Prime", cy: 0.90 },   // texto suelto del HUD, fila minoritaria
      { text: "Owned", cy: 0.30 },
    ]);
    assert.equal(row.count, 3);
    assert.ok(Math.abs(row.y - 0.42) < 0.02);
  });

  test("ignora mayúsculas y puntuación pegada del OCR", () => {
    const row = findNameRowY([
      { text: "PRIME", cy: 0.40 },
      { text: "prime,", cy: 0.404 },
      { text: "Prime.", cy: 0.398 },
    ]);
    assert.equal(row.count, 3);
  });

  test("sin PRIME devuelve null (el caller debe usar la imagen entera)", () => {
    assert.equal(findNameRowY([{ text: "Forma", cy: 0.4 }, { text: "Blueprint", cy: 0.4 }]), null);
  });
});

describe("filterByColumns: rejilla de recompensas", () => {
  test("conserva 4 columnas equiespaciadas", () => {
    const { kept, pitch } = filterByColumns([
      it("A", 0.309), it("B", 0.434), it("C", 0.561), it("D", 0.686),
    ]);
    assert.deepEqual(kept.map(i => i.name), ["A", "B", "C", "D"]);
    assert.ok(Math.abs(pitch - 0.125) < 0.01);
  });

  test("descarta los que caen ENTRE columnas (falsos positivos reales del OCR)", () => {
    // Caso medido en descarga.jpeg: junto a los 4 reales aparecían un duplicado desplazado
    // y dos requiems espurios, todos fuera de la rejilla.
    const { kept } = filterByColumns([
      it("Bronco Prime Receiver", 0.309, 0.9),
      it("Bronco Prime Blueprint", 0.371, 0.7),  // falso, entre columnas
      it("Braton Prime Blueprint", 0.434, 0.9),
      it("Fass", 0.494, 0.6),                     // falso, entre columnas
      it("Braton Prime Receiver", 0.561, 0.9),
      it("Forma Blueprint", 0.686, 0.9),
      it("Ris", 0.711, 0.6),                      // falso, entre columnas
    ]);
    const names = kept.map(i => i.name);
    assert.deepEqual(names, [
      "Bronco Prime Receiver", "Braton Prime Blueprint", "Braton Prime Receiver", "Forma Blueprint",
    ]);
  });

  test("si dos caen en la misma columna gana el de mayor ratio", () => {
    const { kept } = filterByColumns([
      it("bueno", 0.300, 0.95), it("malo", 0.305, 0.40),
      it("B", 0.425), it("C", 0.550), it("D", 0.675),
    ]);
    assert.ok(kept.some(i => i.name === "bueno"));
    assert.ok(!kept.some(i => i.name === "malo"));
  });

  test("prefiere el paso real antes que uno DOBLE que se salta columnas", () => {
    // Regresión medida en una foto real: con ratios altos en las columnas 0/1/3, la rejilla
    // de paso doble (0.232) puntuaba mejor que la real (0.116) y descartaba la recompensa
    // de la columna 2 (un nombre a 2 líneas, que suele tener ratio algo menor).
    const { kept, pitch } = filterByColumns([
      it("Braton Prime Receiver", 0.190, 0.95),
      it("Gunsen Prime Blueprint", 0.306, 0.95),
      it("Grendel Prime Neuroptics Blueprint", 0.422, 0.75),
      it("Quassus Prime Blueprint", 0.538, 0.95),
    ]);
    assert.equal(kept.length, 4, "no debe descartar la columna intermedia");
    assert.ok(Math.abs(pitch - 0.116) < 0.02, `paso esperado ~0.116, obtenido ${pitch}`);
  });

  test("con 2 o menos items no inventa rejilla", () => {
    const list = [it("A", 0.31), it("B", 0.80)];
    const { kept, pitch } = filterByColumns(list);
    assert.equal(kept.length, 2);
    assert.equal(pitch, null);
  });

  test("tolera la inclinación de una foto a pulso (X con jitter)", () => {
    // Misma rejilla de 0.125 pero con desviaciones de ±0.015 por inclinación/jitter del OCR.
    const { kept } = filterByColumns([
      it("A", 0.303), it("B", 0.441), it("C", 0.555), it("D", 0.694),
    ]);
    assert.equal(kept.length, 4);
  });
});
