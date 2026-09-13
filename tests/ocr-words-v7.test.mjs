// words from a tesseract.js result, in the version 7 shape
// since 7.0.0 `data.words` is gone: ask for `blocks: true` and walk blocks→paragraphs→lines. Reading it
// directly returned null for EVERY inventory cell with the classic engine (0/18 in Chromium with a perfect
// mask)
// the capture bench uses the tesseract cli, so the library's result shape is only checked here
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
  // keeps the original object: parseRewards needs the bbox
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
