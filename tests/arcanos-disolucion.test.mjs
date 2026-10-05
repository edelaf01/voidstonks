import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { emparejaArcano, filaArcano } = await import("../deploy/js/utils/inventory/arcanos_disolucion.js");

const tradables = {
  "arcane_camisado": ["Arcane Camisado", "Camisado Arcano", 5],
  "arcane_concentration": ["Arcane Concentration", "Concentración Arcana", 5],
  "arcane_consequence": ["Arcane Consequence", "Consecuencia Arcana", 5],
  "akimbo_slip_shot": ["Akimbo Slip Shot", "Akimbo Slip Shot", 5]
};

const similitud = (a, b) => OCRService.similarityOCR(a, b);

test("emparejaArcano: OCR cases", () => {
  assert.equal(emparejaArcano("Arcane Camisado", tradables, similitud)?.slug, "arcane_camisado");
  assert.equal(emparejaArcano("Arcane\nConcentration", tradables, similitud)?.slug, "arcane_concentration");
  assert.equal(emparejaArcano("Arcane Consequenc", tradables, similitud)?.slug, "arcane_consequence");
  assert.equal(emparejaArcano("Arcane Concentration", tradables, similitud)?.slug, "arcane_concentration");
  assert.equal(emparejaArcano("ee 4 ,,", tradables, similitud), null);
});

test("filaArcano: rangosMax calculation", () => {
  const meta5 = { maxRank: 5 };
  assert.equal(filaArcano({ slug: "a", name: "A", qty: 143 }, meta5, null).rangosMax, 6);

  const meta3 = { maxRank: 3 };
  assert.equal(filaArcano({ slug: "b", name: "B", qty: 143 }, meta3, null).rangosMax, 14);
});
