import { test } from "node:test";
import assert from "node:assert/strict";
import { getSlug, getRivenSlug } from "../deploy/js/utils/slugs.utils.js";
import {
  calculateRealPotential,
  calculateWebPotential,
  calculateRivenPotential,
  calculateAdvancedPredictivePrice,
  calculateHybridTiers,
} from "../deploy/js/utils/rivens/riven_logic.js";
import { getSetName, DEFAULT_WEAPON_SVG } from "../deploy/js/utils/ui_utils.js";
import { OCRService } from "../deploy/js/services/scanner/ocr.service.js";
import { state } from "../deploy/js/state.js";

test("slugs.utils: getSlug normaliza nombres", () => {
  assert.equal(getSlug("Mesa Prime Set"), "mesa_prime_set");
  assert.equal(getSlug("Rhino Prime Neuroptics Blueprint"), "rhino_prime_neuroptics_blueprint");
});

test("slugs.utils: getRivenSlug", () => {
  assert.equal(getRivenSlug("Kuva Bramma"), "kuva_bramma");
});

// characterization: pins current behaviour, which must not change with the refactor
const POPULAR = {
  popularity_pct: 20,
  de_unrolled: { pop: 5, median: 100, max_price: 800, stddev: 30 },
  de_rerolled: { pop: 5, median: 200, max_price: 1600, stddev: 80 },
  wfm_avg_price: 150,
  wfm_market_sample: 30,
};
const OFFMETA = { popularity_pct: 2, de_unrolled: { pop: 1, median: 40, max_price: 200, stddev: 10 } };

test("riven_logic: calculateRealPotential", () => {
  assert.equal(calculateRealPotential(POPULAR), 5.8);
  assert.equal(calculateRealPotential(OFFMETA), 1.31);
  assert.equal(calculateRealPotential(null), 0);
  assert.equal(calculateRealPotential({}), 1);
});

test("riven_logic: calculateWebPotential", () => {
  assert.equal(calculateWebPotential(POPULAR), 3.67);
});

test("riven_logic: calculateRivenPotential delega en Real", () => {
  assert.equal(calculateRivenPotential(POPULAR), calculateRealPotential(POPULAR));
});

// appraisal with distilled ML weights (generar_tiers_servibles.py -> worker dynamic_weights)
// fixture: real Torid weights from the dataset (224k rows); asserts INVARIANTS, not exact values, since
// the curve is heuristic and can be recalibrated
const TORID_ML = {
  name: "Torid",
  // dynamic_weights as the worker injects them from ml_serving.weapons[W].weights
  dynamic_weights: {
    "Multishot": 0.995, "Critical Chance": 0.995, "Critical Damage": 1.0,
    "Range": 0.897, "Heat Damage": 0.674, "Cold Damage": 0.507,
    "Status Chance": 0.372, "Base Damage / Melee Damage": 0.392,
    "Magazine Capacity": 0.155, "Impact Damage": 0.10, "Zoom": 0.05,
  },
  pos: ["Critical Damage", "Multishot", "Critical Chance", "Range"],
  midPos: ["Heat Damage", "Cold Damage"],
  neg: ["Zoom", "Magazine Capacity"],
  // macro so calculateHybridTiers yields coherent tiers
  official_median: 60, official_stddev: 40, wfm_avg_price: 350,
  de_unrolled: { pop: 40, median: 60, max_price: 800, stddev: 40, min_price: 30 },
  de_rerolled: { pop: 40, median: 220, max_price: 2200, stddev: 120 },
  popularity_pct: 79.67, wfm_market_sample: 30, volatility_index: 6, trend_7d_pct: 0,
  liquidity_score: 80, web_max: 2500,
  ml_trash: { min: 300, max: 400 },
};
const TORID_DATA = { d: 0.5, t: "Rifle" };
const BASELINE = { "Critical Damage": 1.0, "Range": 0.897, "Multishot": 0.886, "Critical Chance": 0.881 };

const attr = (name, value, isPositive, minIdeal, maxIdeal) => ({ name, value, isPositive, minIdeal, maxIdeal });

test("ml tasación: el suelo trash data-driven (ml_trash) se respeta en calculateHybridTiers", () => {
  const tiers = calculateHybridTiers(TORID_ML);
  // Torid is meta (generic cap 250) but the real data says trash ~300, so the data must win
  assert.ok(tiers.trash >= 300, `trash ${tiers.trash} debería respetar el suelo ML de 300`);
  assert.ok(tiers.goodReroll > tiers.trash, "goodReroll > trash");
  assert.ok(tiers.godroll > tiers.goodReroll, "godroll > goodReroll");
});

test("ml tasación: un godroll (CC/CD/Multishot top) vale más que un roll trash (Mag/Impact)", () => {
  const tiers = calculateHybridTiers(TORID_ML);
  const god = calculateAdvancedPredictivePrice(TORID_ML, [
    attr("Critical Damage", 200, true, 150, 200),
    attr("Multishot", 100, true, 80, 100),
    attr("Critical Chance", 180, true, 140, 180),
    attr("Magazine Capacity", -40, false, -50, -30), // harmless/wanted negative
  ], tiers, 1.0, TORID_DATA, BASELINE);
  const trashRoll = calculateAdvancedPredictivePrice(TORID_ML, [
    attr("Magazine Capacity", 50, true, 30, 60),
    attr("Impact Damage", 80, true, 50, 90),
    attr("Recoil", -30, false, -40, -20),
  ], tiers, 1.0, TORID_DATA, BASELINE);
  assert.ok(god.estimatedValue > trashRoll.estimatedValue,
    `godroll ${god.estimatedValue} debe superar a trash ${trashRoll.estimatedValue}`);
  assert.ok(god.adjustedScore > trashRoll.adjustedScore, "el score del godroll debe ser mayor");
});

test("ml tasación: brick (stat top como negativa) cae a tier trash", () => {
  const tiers = calculateHybridTiers(TORID_ML);
  const brick = calculateAdvancedPredictivePrice(TORID_ML, [
    attr("Critical Damage", 200, true, 150, 200),
    attr("Multishot", 100, true, 80, 100),
    attr("Critical Chance", -50, false, -60, -40), // CC as a NEGATIVE -> brick
  ], tiers, 1.0, TORID_DATA, BASELINE);
  assert.equal(brick.estimatedValue, tiers.trash, "un riven bricked vale exactamente el suelo trash");
  assert.ok(brick.adjustedScore <= 20, "el score de un bricked es trash-tier");
});

test("ui_utils: getSetName extrae el set", () => {
  assert.equal(getSetName("Mesa Prime Blueprint"), "Mesa Prime");
});

test("ui_utils: DEFAULT_WEAPON_SVG está bien formado (filter cerrado)", () => {
  assert.ok(DEFAULT_WEAPON_SVG.includes("</filter>"), "el SVG fallback debe cerrar <filter>");
});

// ocr.service getRelicMatch: the relic fallback of the inventory scanner
state.allRelicNames = ["Lith C1", "Meso K3", "Meso T2", "Neo N2", "Neo G1", "Neo S14", "Axi A1", "Axi A2", "Axi A9", "Axi A11", "Axi A14", "Axi A16", "Axi E1", "Axi G6", "Axi I1", "Axi I2", "Requiem III"];

test("ocr.service: getRelicMatch matchea tier+código exactos", () => {
  assert.equal(OCRService.getRelicMatch(["LITH", "C1"]), "Lith C1");
});

test("ocr.service: getRelicMatch aguanta ruido OCR en el tier y en el código (letra->dígito)", () => {
  // "L1TH" -> fuzzy match to LITH; "CI" -> the I becomes 1 -> "C1"
  assert.equal(OCRService.getRelicMatch(["L1TH", "CI"]), "Lith C1");
});

test("ocr.service: getRelicMatch ignora ruido de UI (RELIC/RADIANT) entre tier y código", () => {
  assert.equal(OCRService.getRelicMatch(["MES0", "K3", "RELIC", "RADIANT"]), "Meso K3");
});

test("ocr.service: getRelicMatch matchea token pegado (tier+código en una sola palabra)", () => {
  assert.equal(OCRService.getRelicMatch(["LITHC1"]), "Lith C1");
});

test("ocr.service: getRelicMatch devuelve null si no hay reliquia (prime item normal)", () => {
  assert.equal(OCRService.getRelicMatch(["BRATON", "PRIME", "BARREL"]), null);
});

test("ocr.service: getRelicMatch tolera dígito->letra en tiers de 3 letras (NE0 -> NEO)", () => {
  assert.equal(OCRService.getRelicMatch(["NE0", "G1"]), "Neo G1");
});

test("ocr.service: getRelicMatch tolera dígito->letra en tiers de 3 letras (AX1 -> AXI)", () => {
  assert.equal(OCRService.getRelicMatch(["AX1", "A2"]), "Axi A2");
});

test("ocr.service: getRelicMatch acepta confusiones OCR de forma (NEC≈NEO, C≈O) pero no letras arbitrarias", () => {
  // the tier fuzzy uses similarityOCR: a character from the SAME confusion group (C≈O, T≈I) costs little, so
  // "NEC" and "AXT" match as plausible misreads while an unrelated letter (X vs O) stays out; final
  // validation against allRelicNames plus a required code close the false positives
  assert.equal(OCRService.getRelicMatch(["NEC", "G1"]), "Neo G1");
  assert.equal(OCRService.getRelicMatch(["NEX", "G1"]), null);
});

// paddle returns one box per line, sometimes without the space before the suffix: 1 of 101 bench relics
// read "NEO A14RELIC" and the code, with the suffix glued, measured 8 and did not fit
test("ocr.service: getRelicMatch separa el sufijo pegado al código (A14RELIC)", () => {
  assert.equal(OCRService.getRelicMatch(["AXI", "A14RELIC"]), "Axi A14");
  assert.equal(OCRService.getRelicMatch(["NEO", "N2RELIQUIA"]), "Neo N2");
});

test("ocr.service: getRelicMatch tolera el tier TRUNCADO por prefijo único (AX -> AXI)", () => {
  // the thin "I" of "AXI" gets lost against the relic art: "AX A10 RELIC"
  assert.equal(OCRService.getRelicMatch(["AX", "A2", "RELIC"]), "Axi A2");
});

test("ocr.service: getRelicMatch repara dígitos leídos como letra DENTRO del código (AL1 -> A11, AQ -> A9)", () => {
  assert.equal(OCRService.getRelicMatch(["AX", "AL1", "RELIC"]), "Axi A11");
  assert.equal(OCRService.getRelicMatch(["AX", "AQ", "RELIC"]), "Axi A9");
});

test("ocr.service: getRelicMatch fusiona código PARTIDO por el OCR (AL + 4 -> A14)", () => {
  // accepting "AL" alone would give A1 (valid but wrong): the next loose digit is merged
  assert.equal(OCRService.getRelicMatch(["AX", "AL", "4", "RELIC"]), "Axi A14");
});

test("ocr.service: getRelicMatch recorta un 3er dígito colado por el arte (A160 -> A16)", () => {
  // real read: "AXI A160 RELIC" (the art adds a 0); codes have at most 2 digits
  assert.equal(OCRService.getRelicMatch(["AXI", "A160", "RELIC"]), "Axi A16");
});

test("ocr.service: getRelicMatch repara 1 leída como T en la cola del código (ET -> E1)", () => {
  // real read: "AXI ET RELIC" = Axi E1; the LEADING letter is never touched (Meso T2 is legit)
  assert.equal(OCRService.getRelicMatch(["AXI", "ET", "RELIC"]), "Axi E1");
  assert.equal(OCRService.getRelicMatch(["MESO", "T2", "RELIC"]), "Meso T2");
});

test("ocr.service: parseRelicSelection conserva la letra inicial del código (Neo S14, no 514)", () => {
  // _fixRelicCode corrected digits over the WHOLE code and the leading S became 5 -> "NEO 514" -> null; only
  // the numeric tail must be corrected
  assert.equal(OCRService.parseRelicSelection("NEO S14 RELIC RADIANT"), "NEO S14");
  assert.equal(OCRService.parseRelicSelection("MESO T2 RELIC"), "MESO T2");
});

// real boxes (tesseract psm 6) from the SELECT RELIC crop in an endless fissure at 1440p; with "No Relic"
// the teammate's Axi D6 was tracked and deducted at mission end
const w = (text, x0, y0, x1, y1) => ({ text, x0, y0, x1, y1 });
const ESCUADRA_SIN_RELIQUIA = [
  w("Location:", 0, 0, 60, 14), w("Void", 64, 0, 90, 14), w("Squad", 260, 45, 300, 61), w("Relics", 306, 44, 350, 61),
  w("<", 248, 64, 256, 76), w("No", 334, 87, 352, 99), w("Relic", 356, 86, 390, 99), w("y", 478, 63, 484, 70),
  w("Axi", 333, 170, 355, 184), w("D6", 358, 170, 376, 184), w("Relic", 381, 169, 412, 184), w("[Radiant]", 417, 168, 480, 184),
];
const TEXTO_SIN_RELIQUIA = "Location: Void Fissure Missions\nSquad Relics\n< No Relic y\nd Axi D6 Relic [Radiant]";

const ESCUADRA_CON_LA_MIA = [
  ...ESCUADRA_SIN_RELIQUIA.filter((p) => p.y0 < 80 || p.y0 > 100),
  w("Axi", 334, 87, 352, 99), w("A6", 356, 87, 374, 99), w("Relic", 378, 86, 410, 99),
];

/**
 * own catalog without touching the shared one: adding relics would move the uniqueness margin of the other
 * tests
 */
function conCatalogo(nombres, fn) {
  const antes = state.allRelicNames;
  state.allRelicNames = nombres;
  OCRService._relicIndexCache = null;
  try { fn(); } finally { state.allRelicNames = antes; OCRService._relicIndexCache = null; }
}

test("ocr.service: en la fisura se sigue la primera fila de Squad Relics, no la del compañero", () => {
  conCatalogo(["Axi A6", "Axi D6", "Meso M4"], () => {
    assert.equal(OCRService.parseRelicSelection(TEXTO_SIN_RELIQUIA), "AXI D6", "sin cajas: el comportamiento de antes");
    assert.equal(OCRService.parseRelicSelection(TEXTO_SIN_RELIQUIA, ESCUADRA_SIN_RELIQUIA), "", "No Relic: ninguna, no \"no se sabe\"");
    assert.equal(OCRService.parseRelicSelection(TEXTO_SIN_RELIQUIA, ESCUADRA_SIN_RELIQUIA.filter((p) => p.y0 < 80 || p.y0 > 100)), null, "fila sin leer: no se sabe");
    assert.equal(OCRService.parseRelicSelection(TEXTO_SIN_RELIQUIA, ESCUADRA_CON_LA_MIA), "AXI A6");
  });
});

test("ocr.service: sin el rótulo Squad (refinamiento) se lee el recorte entero", () => {
  conCatalogo(["Axi A6", "Axi D6", "Meso M4"], () => {
    assert.equal(OCRService.parseRelicSelection("MESO M4 RELIC - Possible Rewards", [w("MESO", 0, 0, 40, 14), w("M4", 44, 0, 60, 14)]), "MESO M4");
  });
});

test("ocr.service: getRelicMatch tolera dígito cuya normalización no da la letra del tier (AX0 -> AXI)", () => {
  // real cell read: "CG AX0 G6 RELIC" -> Axi G6; "AX0" normalises to "AXO", which is neither a prefix of AXI
  // nor passes the fuzzy, and the mismatch is a DIGIT in the original word
  assert.equal(OCRService.getRelicMatch(["CG", "AX0", "G6", "RELIC"]), "Axi G6");
});

test("ocr.service: getRelicMatch mapea la LETRA del código leída como dígito (11 -> I1)", () => {
  // real read: "HD 1 . - AXI 11 RELIC" -> Axi I1; the loose "1" before the tier must break nothing and "11"
  // must read as I1 (validated against allRelicNames)
  assert.equal(OCRService.getRelicMatch(["HD", "1", "AXI", "11", "RELIC"]), "Axi I1");
});

test("ocr.service: getRelicMatch mapea código todo-dígitos (12 -> I2)", () => {
  assert.equal(OCRService.getRelicMatch(["AXI", "12"]), "Axi I2");
});
