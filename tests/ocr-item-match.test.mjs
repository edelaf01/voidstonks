import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ocr.service.js imports vision.service.js, which creates canvases with `document` at load: minimal stub
// before the dynamic import
globalThis.document ??= { createElement: () => ({ getContext: () => null }) };

const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");

// minimal db with the real shape of state.itemsDatabase (name -> [{ducats}])
state.itemsDatabase = {
  "Ballistica Prime Upper Limb": [{ ducats: 45 }],
  "Ballistica Prime Lower Limb": [{ ducats: 45 }],
  "Ballistica Prime Receiver": [{ ducats: 45 }],
  "Ballistica Prime String": [{ ducats: 45 }],
  "Ballistica Prime Blueprint": [{ ducats: 15 }],
  "Paris Prime Upper Limb": [{ ducats: 15 }],
  "Lex Prime Barrel": [{ ducats: 25 }],
  "Volt Prime Systems Blueprint": [{ ducats: 45 }],
  "Odonata Prime Blueprint": [{ ducats: 45 }],
  "Acceltra Prime Barrel": [{ ducats: 45 }],
  "Acceltra Prime Receiver": [{ ducats: 45 }],
  "Acceltra Prime Stock": [{ ducats: 45 }],
  "Acceltra Prime Blueprint": [{ ducats: 15 }],
  "Afuris Prime Barrel": [{ ducats: 45 }],
  "Afuris Prime Link": [{ ducats: 15 }],
  "Afuris Prime Receiver": [{ ducats: 45 }],
  "Afuris Prime Blueprint": [{ ducats: 15 }],
  "Akarius Prime Barrel": [{ ducats: 45 }],
  "Akarius Prime Link": [{ ducats: 15 }],
  "Akarius Prime Receiver": [{ ducats: 45 }],
  "Akarius Prime Blueprint": [{ ducats: 15 }],
  "Akbronco Prime Link": [{ ducats: 15 }],
  "Akjagara Prime Barrel": [{ ducats: 45 }],
  "Akjagara Prime Link": [{ ducats: 15 }],
  "Akjagara Prime Receiver": [{ ducats: 45 }],
  "Akbolto Prime Blueprint": [{ ducats: 15 }],
  "Ash Prime Chassis Blueprint": [{ ducats: 15 }],
  "Ash Prime Neuroptics Blueprint": [{ ducats: 15 }],
  "Ash Prime Systems Blueprint": [{ ducats: 15 }],
  "Ash Prime Blueprint": [{ ducats: 15 }],
  "Akbolto Prime Barrel": [{ ducats: 45 }],
  "Akbolto Prime Receiver": [{ ducats: 45 }],
  "Boltor Prime Barrel": [{ ducats: 45 }],
  "Boltor Prime Receiver": [{ ducats: 45 }],
  "Boltor Prime Stock": [{ ducats: 45 }],
  "Boltor Prime Blueprint": [{ ducats: 15 }],
  "Harrow Prime Blueprint": [{ ducats: 15 }],
  "Harrow Prime Chassis Blueprint": [{ ducats: 15 }],
  "Harrow Prime Neuroptics Blueprint": [{ ducats: 15 }],
  "Harrow Prime Systems Blueprint": [{ ducats: 15 }],
  "Venka Prime Blade": [{ ducats: 15 }],
  "Venka Prime Gauntlet": [{ ducats: 15 }],
  "Venka Prime Blueprint": [{ ducats: 15 }],
  // Requiem mods are in itemsDatabase as relic rewards: the ONLY short one-word items, so the ones that
  // attract the most garbage
  "Jahu": [{ ducats: 0 }],
  "Khra": [{ ducats: 0 }],
  // "Forma Blueprint" is the other item with no backing: BLUEPRINT is optional after FORMA
  "Forma Blueprint": [{ ducats: 0 }],
};

beforeEach(() => {
  // initMatcherData memoizes in cachedDbItems: rebuild it from the mock db
  OCRService.cachedDbItems = [];
  OCRService.initMatcherData();
});

// the generic matcher (similarityOCR) recovers "LIMB" reads with reasonable resemblance; heavily cut ones
// (LY, UMB…) are left to PaddleOCR

test("ocr.service: degradaciones recuperables de LIMB (L1MB, LIME, LIMS) matchean Upper Limb", () => {
  for (const bad of ["L1MB", "LIME", "LIMS"]) {
    const m = OCRService.getValidItemMatch(`BALLISTICA PRIME UPPER ${bad}`);
    assert.equal(m?.originalName, "Ballistica Prime Upper Limb", `fallo con "${bad}"`);
  }
});

test("ocr.service: 'BALLISTICA PRIME LOWER LIMB' (lectura limpia) sigue OK", () => {
  const m = OCRService.getValidItemMatch("BALLISTICA PRIME LOWER LIMB");
  assert.equal(m?.originalName, "Ballistica Prime Lower Limb");
});

test("ocr.service: 'BALLISTICA PRIME' a secas NO matchea (componente final obligatorio)", () => {
  assert.equal(OCRService.getValidItemMatch("BALLISTICA PRIME"), null);
});

test("ocr.service: 'BALLISTICA PRIME UPPER' sin resto de LIMB NO matchea", () => {
  assert.equal(OCRService.getValidItemMatch("BALLISTICA PRIME UPPER"), null);
});

test("ocr.service: una palabra larga arbitraria tras UPPER no se normaliza a LIMB", () => {
  assert.equal(OCRService.getValidItemMatch("BALLISTICA PRIME UPPER LOADING"), null);
});

test("ocr.service: texto aleatorio no matchea nada", () => {
  assert.equal(OCRService.getValidItemMatch("OWNED 3 RADIANT XYZQ"), null);
});

// letter confusions on low-contrast themes (nebula): ASH→ASN, AFURIS→ATUIS; the binarisation is clean, the
// matcher must tolerate them

test("ocr.service: 'ASN FRIME LHASSIS BLUEPRINT' matchea Ash Prime Chassis Blueprint", () => {
  const m = OCRService.getValidItemMatch("ASN FRIME LHASSIS BLUEPRINT");
  assert.equal(m?.originalName, "Ash Prime Chassis Blueprint");
});

test("ocr.service: 'ATUIS FRIME RECEIVER' matchea Afuris Prime Receiver", () => {
  const m = OCRService.getValidItemMatch("ATUIS FRIME RECEIVER");
  assert.equal(m?.originalName, "Afuris Prime Receiver");
});

test("ocr.service: 'ATUIS FRIME BLUEPRINT' matchea Afuris Prime Blueprint", () => {
  const m = OCRService.getValidItemMatch("ATUIS FRIME BLUEPRINT");
  assert.equal(m?.originalName, "Afuris Prime Blueprint");
});

test("ocr.service: 'ASH' no arrastra falsos positivos con partes que no cuadran", () => {
  assert.equal(OCRService.getValidItemMatch("ASN PRIME"), null);
});

// disambiguation by QUALITY, not db order: "BOLTOR" must not fall into "Akbolto" (caught via
// includes("BOLTO")); the best first-word similarity wins

test("ocr.service: 'BOLTOR PRIME BARREL' matchea Boltor (no Akbolto)", () => {
  const m = OCRService.getValidItemMatch("BOLTOR PRIME BARREL");
  assert.equal(m?.originalName, "Boltor Prime Barrel");
});

test("ocr.service: 'BOLTOR PRIME RECEIVER' matchea Boltor (no Akbolto)", () => {
  const m = OCRService.getValidItemMatch("BOLTOR PRIME RECEIVER");
  assert.equal(m?.originalName, "Boltor Prime Receiver");
});

test("ocr.service: 'AKBOLTO PRIME BARREL' sigue matcheando Akbolto", () => {
  const m = OCRService.getValidItemMatch("AKBOLTO PRIME BARREL");
  assert.equal(m?.originalName, "Akbolto Prime Barrel");
});

// warframe components: the MOST SPECIFIC item wins, so "Harrow Blueprint" must not merge "CHASSIS
// BLUEPRINT" and steal "Harrow Chassis Blueprint"

test("ocr.service: 'HARROW PRIME CHASSIS BLUEPRINT' -> Chassis (no el BP principal)", () => {
  assert.equal(OCRService.getValidItemMatch("HARROW PRIME CHASSIS BLUEPRINT")?.originalName, "Harrow Prime Chassis Blueprint");
});

test("ocr.service: 'HARROW PRIME SYSTEMS BLUEPRINT' -> Systems", () => {
  assert.equal(OCRService.getValidItemMatch("HARROW PRIME SYSTEMS BLUEPRINT")?.originalName, "Harrow Prime Systems Blueprint");
});

test("ocr.service: 'HARROW PRIME NEUROPTICS BLUEPRINT' -> Neuroptics", () => {
  assert.equal(OCRService.getValidItemMatch("HARROW PRIME NEUROPTICS BLUEPRINT")?.originalName, "Harrow Prime Neuroptics Blueprint");
});

test("ocr.service: 'HARROW PRIME BLUEPRINT' (principal) sigue -> Blueprint", () => {
  assert.equal(OCRService.getValidItemMatch("HARROW PRIME BLUEPRINT")?.originalName, "Harrow Prime Blueprint");
});

// "BLADES" (ocr plural) must not fall into BLUEPRINT by the "BLA" prefix: Venka Blade became Venka
// Blueprint, a duplicate and one item fewer
test("ocr.service: 'VENKA PRIME BLADES' -> Blade (no Blueprint)", () => {
  assert.equal(OCRService.getValidItemMatch("VENKA PRIME BLADES")?.originalName, "Venka Prime Blade");
});

test("ocr.service: 'VENKA PRIME BLUEPRINT' sigue -> Blueprint", () => {
  assert.equal(OCRService.getValidItemMatch("VENKA PRIME BLUEPRINT")?.originalName, "Venka Prime Blueprint");
});

test("ocr.service: lecturas degradadas recuperables matchean por similitud genérica", () => {
  const liveScanTests = [
    { ocr: "V  JAONATA FRIME BLUEPRINT", expected: "Odonata Prime Blueprint" },
    { ocr: "ACCELLRA PRIME BARREL", expected: "Acceltra Prime Barrel" },
    { ocr: "ACCELTRA FRIME RECEIVER", expected: "Acceltra Prime Receiver" },
    { ocr: "ACCELTRA PRIME STOCK", expected: "Acceltra Prime Stock" },
    { ocr: "ACCELTRA PRIME BLUEPRINT", expected: "Acceltra Prime Blueprint" },
    { ocr: "AFURIS PRIME BARREL", expected: "Afuris Prime Barrel" },
    { ocr: "AFURIS PRIME LINK", expected: "Afuris Prime Link" },
    { ocr: "AFURIS PRIME RECEIVER", expected: "Afuris Prime Receiver" },
    { ocr: "AFURIS PRIME BLUEPRINT", expected: "Afuris Prime Blueprint" },
    { ocr: "AKARIUS PRIME BARREL", expected: "Akarius Prime Barrel" },
    { ocr: "AKARIUS PRIME LINK", expected: "Akarius Prime Link" },
    { ocr: "AKARIUS FRIME RECEIVER", expected: "Akarius Prime Receiver" },
    { ocr: "AKARIUS PRIME BLUEPRINT", expected: "Akarius Prime Blueprint" },
    { ocr: "AKJAGARS PRIME ARREL", expected: "Akjagara Prime Barrel" },
    { ocr: "AKJAGARA PRIME LINK", expected: "Akjagara Prime Link" },
    { ocr: "AKJAGARA FRIME RECEIVER", expected: "Akjagara Prime Receiver" },
    // without "PRIME" it no longer matches: "Akbolto Blueprint" is a real part, and accepting it as the prime
    // logged something that never dropped; in an automatic add a false positive is worse, and multi-frame
    // consensus recovers the good read
    { ocr: "AKBOLTO BLUEPRINT", expected: undefined },
    { ocr: "AKBOLTO PRIME BLUEPRINT", expected: "Akbolto Prime Blueprint" },
  ];

  for (const { ocr, expected } of liveScanTests) {
    const m = OCRService.getValidItemMatch(ocr);
    assert.equal(m?.originalName, expected, `fallo con OCR raw: "${ocr}" -> esperado: ${expected}, obtenido: ${m?.originalName}`);
  }
});

test("ocr.service: lecturas salvajes devuelven null (territorio Paddle, sin alias memorizados)", () => {
  for (const ocr of ["ABSSRONDOIGFINE LINK", "ROLO SLUEFRINT", "BALLISTICA PRIME UPPER LY"]) {
    assert.equal(OCRService.getValidItemMatch(ocr), null, `"${ocr}" no debería inventarse un match`);
  }
});

// a one-word item has no component to confirm the match, so the first word is all the evidence and the bar
// rises
// real case: an unreadable "Axi D2 Relic" cell had a 3-letter fragment logged as "Jahu"
test("ocr.service: un fragmento de basura NO se convierte en un ítem de una sola palabra", () => {
  for (const ocr of ["JAH", "AHU", "KHR", "HRA", "N + I.) - AH"]) {
    assert.equal(OCRService.getValidItemMatch(ocr), null, `"${ocr}" no debería inventar un mod Requiem`);
  }
});

test("ocr.service: un mod Requiem bien leído (o con confusión de glifo) sí matchea", () => {
  assert.equal(OCRService.getValidItemMatch("JAHU")?.originalName, "Jahu");
  assert.equal(OCRService.getValidItemMatch("JAHV")?.originalName, "Jahu"); // U/V same silhouette
  assert.equal(OCRService.getValidItemMatch("JA HU")?.originalName, "Jahu"); // word split by the ocr
});

// same hole as "Jahu" with a two-word item: BLUEPRINT is optional after FORMA, so something close to
// "FORMA" was enough
// real case: an unreadable relic cell was logged as "Forma Blueprint"
test("ocr.service: 'Forma Blueprint' sin BLUEPRINT exige una primera palabra sólida", () => {
  assert.equal(OCRService.getValidItemMatch("FORMA BLUEPRINT")?.originalName, "Forma Blueprint");
  assert.equal(OCRService.getValidItemMatch("FORMA")?.originalName, "Forma Blueprint");
  assert.equal(OCRService.getValidItemMatch("F0RMA")?.originalName, "Forma Blueprint"); // O/0
  assert.equal(OCRService.getValidItemMatch("PORMA")?.originalName, "Forma Blueprint"); // P/F
  // cuts and fragments are not enough without a BLUEPRINT to back them
  for (const ocr of ["FORM", "ORMA", "FOMA", "FORA"]) {
    assert.equal(OCRService.getValidItemMatch(ocr), null, `"${ocr}" no debería dar Forma Blueprint`);
  }
  // with BLUEPRINT after it they are, since the component backs the whole
  assert.equal(OCRService.getValidItemMatch("FORM BLUEPRINT")?.originalName, "Forma Blueprint");
});

test("ocr.service: getRelicMatch matchea reliquias correctamente contra state.allRelicNames con o sin sufijo Relic", () => {
  state.allRelicNames = ["Axi A10 Relic", "Axi A11 Relic", "Lith C1 Relic", "Meso N2 Relic", "Neo V8 Relic", "Requiem Ris Relic"];

  assert.equal(OCRService.getRelicMatch("AXI A10 RELIC"), "Axi A10 Relic");
  assert.equal(OCRService.getRelicMatch("AXI A10"), "Axi A10 Relic");
  assert.equal(OCRService.getRelicMatch("AXI A16 RELIC"), null);
  assert.equal(OCRService.getRelicMatch("LITH C1"), "Lith C1 Relic");
  assert.equal(OCRService.getRelicMatch("NEO V8 RELIC"), "Neo V8 Relic");
  assert.equal(OCRService.getRelicMatch("REQUIEM RIS"), "Requiem Ris Relic");
});

// the game font's 6 is almost a closed loop and binarises as "O": "Axi C6 Relic" -> "AXI CO RELIC". A lost
// digit read as "O" is AMBIGUOUS (C6 and C9 both exist, and "AXI SO" was counted as an unowned Axi S6), so
// it stays unmatched: miscounting is worse than not counting
test("ocr.service: un dígito leído como O es ambiguo y NO se adivina", () => {
  OCRService._relicIndexCache = null;
  state.allRelicNames = ["Axi C5", "Axi C6", "Axi C7", "Axi C9", "Axi C10", "Axi D6"];
  assert.equal(OCRService.getRelicMatch("AXI CO RELIC"), null);
  OCRService._relicIndexCache = null;
  state.allRelicNames = ["Axi S6", "Axi S9", "Axi S10"];
  assert.equal(OCRService.getRelicMatch("AXI SO RELIC"), null,
    "S9 leído 'SO' no puede contarse como S6");

  // real shape confusions still hold: G↔6 and L↔1 are not ambiguous
  OCRService._relicIndexCache = null;
  state.allRelicNames = ["Axi S6", "Axi S9", "Axi E1"];
  assert.equal(OCRService.getRelicMatch("AXI SG RELIC"), "Axi S6");
  assert.equal(OCRService.getRelicMatch("AXI EL RELIC"), "Axi E1");
  OCRService._relicIndexCache = null;
});

// a stray glyph INSIDE the code (art noise touching the text): "Axi O5" read as "AXI OO5" scored 0.67
// against O5, under the cut
test("ocr.service: un glifo espurio dentro del código no tumba el match", () => {
  OCRService._relicIndexCache = null;
  state.allRelicNames = ["Axi O1", "Axi O5", "Axi O6", "Axi C5", "Axi A1", "Axi A4", "Axi A14"];

  assert.equal(OCRService.getRelicMatch("AXI OO5 RELIC"), "Axi O5");
  // but dropping the glyph is the LAST resort: if that letter is a misread digit the confusion map must win,
  // so "AL"+"4" is A14 (L≈1), not A4 or A1
  assert.equal(OCRService.getRelicMatch(["AX", "AL", "4", "RELIC"]), "Axi A14");
  OCRService._relicIndexCache = null;
});

