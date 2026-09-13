// Palabras de un resultado de tesseract.js, en la forma de la versión 7.
//
// Al subir la librería a 7.0.0 desapareció `data.words`: hay que pedir `blocks: true` y bajar por
// blocks→paragraphs→lines. extractCellText lo leía a pelo y devolvía null para TODAS las celdas
// del inventario con el motor clásico (medido en Chromium: 0/18 con una máscara perfecta; con el
// preciso no se notaba porque los nombres los lee Paddle). El banco de capturas usa el CLI de
// Tesseract, así que la forma del resultado de la librería solo se comprueba aquí.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.document ??= { createElement: () => ({ getContext: () => null }) };

const { rawWords } = await import("../deploy/js/utils/vision/ocr_words.js");
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");

const palabra = (text, x0) => ({ text, confidence: 90, bbox: { x0, y0: 0, x1: x0 + 40, y1: 20 } });
const v7 = {
  text: "Boltor Prime\nReceiver\n",
  blocks: [{ paragraphs: [{ lines: [
    { words: [palabra("Boltor", 0), palabra("Prime", 50)] },
    { words: [palabra("Receiver", 10)] },
  ] }] }],
};

test("con la forma de tesseract.js 7 las palabras salen de blocks→paragraphs→lines", () => {
  assert.deepEqual(rawWords(v7).map((w) => w.text), ["Boltor", "Prime", "Receiver"]);
  // Conserva el objeto original: parseRewards necesita el bbox.
  assert.equal(rawWords(v7)[0].bbox.x0, 0);
});

test("la forma antigua (data.words) sigue valiendo", () => {
  assert.deepEqual(rawWords({ words: [palabra("Lex", 0)] }).map((w) => w.text), ["Lex"]);
});

test("sin palabras en ningún nivel devuelve una lista vacía, no undefined", () => {
  assert.deepEqual(rawWords({ text: "" }), []);
  assert.deepEqual(rawWords(null), []);
});

test("extractCellText pide los bloques y lee la celda con la forma de la versión 7", async () => {
  let pedido = null;
  const worker = { recognize: async (_img, _opts, output) => { pedido = output; return { data: v7 }; } };
  const words = await OCRService.extractCellText(worker, {});
  assert.equal(pedido?.blocks, true, "sin blocks:true la versión 7 no devuelve palabras");
  assert.deepEqual(words, ["BOLTOR", "PRIME", "RECEIVER"]);
});

test("una celda sin texto sigue siendo null", async () => {
  const worker = { recognize: async () => ({ data: { text: "", blocks: [] } }) };
  assert.equal(await OCRService.extractCellText(worker, {}), null);
});
