import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, buildItemPool } from "./_helpers/synthetic-pool.mjs";

globalThis.document ??= { createElement: () => ({ getContext: () => null }) };
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");

// synthetic tests for getRelicMatch: generated relic pool and corrupt inputs using the matcher's confusion
// model plus real-capture degradations
// invariants: high recovery over seeded samples, ZERO false matches (correct or null), prime part texts
// never match a relic

// realistic relic pool: letters and numbers matching the real db (772)
const TIERS = ["Lith", "Meso", "Neo", "Axi"];
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "K", "L", "M", "N", "O", "P", "R", "S", "T", "V", "W"];
function buildRelicPool() {
  const pool = [];
  for (const t of TIERS) for (const L of LETTERS) for (let n = 1; n <= 16; n++) pool.push(`${t} ${L}${n}`);
  pool.push("Requiem I", "Requiem II", "Requiem III", "Requiem IV");
  return pool;
}
const RELIC_POOL = buildRelicPool();
state.allRelicNames = RELIC_POOL;

// confusion substitute: another character from the SAME group (the matcher's model)
function confuse(ch, rand) {
  const group = OCRService._ocrConfMap.get(ch);
  if (!group) return ch;
  const others = [...group].filter(c => c !== ch && c !== "|");
  return others.length ? others[Math.floor(rand() * others.length)] : ch;
}

// existing codes per tier, so the generator does not produce reads that match another real relic EXACTLY
// (genuine ambiguity, not a matcher bug)
const CODES_BY_TIER = new Map();
for (const name of RELIC_POOL) {
  const [t, c] = name.toUpperCase().split(" ");
  if (!CODES_BY_TIER.has(t)) CODES_BY_TIER.set(t, new Set());
  CODES_BY_TIER.get(t).add(c);
}

const JUNK_TOKENS = ["RELIC", "RADIANT", "so", "ve", "kr", "od", "x", "7"];

// generates a corrupt OCR reading of a canonical relic, returning an array of words
function corruptReading(canonical, rand) {
  let [tier, code] = canonical.toUpperCase().split(" ");
  const codes = CODES_BY_TIER.get(tier);
  const roll = rand();
  if (roll < 0.30) {
    // 1 group confusion in tier or code without colliding with another real code
    if (rand() < 0.5 && tier.length > 2) {
      const k = Math.floor(rand() * tier.length);
      tier = tier.slice(0, k) + confuse(tier[k], rand) + tier.slice(k + 1);
    } else {
      for (let tries = 0; tries < 4; tries++) {
        const k = Math.floor(rand() * code.length);
        const mutated = code.slice(0, k) + confuse(code[k], rand) + code.slice(k + 1);
        if (!codes.has(mutated)) { code = mutated; break; }
      }
    }
  } else if (roll < 0.45 && tier !== "REQUIEM") {
    tier = tier.slice(0, tier.length - 1); // lost trailing thin glyph ("AXI"→"AX")
  } else if (roll < 0.60 && tier !== "REQUIEM") {
    // art noise tail ("A16"→"A160") without forming another real code
    for (let d = 0; d < 10; d++) {
      if (!codes.has(code + d)) { code = code + d; break; }
    }
  } else if (roll < 0.70 && code.length >= 3 && tier !== "REQUIEM") {
    // split code with prefix digit confused for a letter ("A14" → "AL" + "4"), as in real captures
    const prefix = code.slice(0, 2);
    const confusedPrefix = prefix[0] + confuse(prefix[1], rand);
    const words = [tier, confusedPrefix, code.slice(2)];
    if (rand() < 0.5) words.push("RELIC");
    return words;
  } else if (roll < 0.78) {
    return [tier + code]; // glued ("LITHC1")
  }
  const words = [tier, code];
  if (rand() < 0.5) words.push("RELIC");
  if (rand() < 0.25) words.unshift(JUNK_TOKENS[Math.floor(rand() * JUNK_TOKENS.length)]);
  return words;
}

describe("getRelicMatch: entradas sintéticas corruptas desde la pool", () => {

  test("recupera la reliquia correcta y NUNCA devuelve otra distinta (500 muestras)", () => {
    const rand = mulberry32(0x5EED);
    let ok = 0, nulls = 0, wrong = [];
    const N = 500;
    for (let n = 0; n < N; n++) {
      const truth = RELIC_POOL[Math.floor(rand() * RELIC_POOL.length)];
      const reading = corruptReading(truth, rand);
      const got = OCRService.getRelicMatch(reading);
      if (got === truth) ok++;
      else if (got === null) nulls++;
      else wrong.push(`${JSON.stringify(reading)} -> "${got}" (real: "${truth}")`);
    }
    assert.equal(wrong.length, 0, `matches INCORRECTOS:\n${wrong.slice(0, 10).join("\n")}`);
    assert.ok(ok / N >= 0.9, `recuperación ${ok}/${N} (${(100 * ok / N).toFixed(1)}%) debería ser >= 90% (nulls: ${nulls})`);
  });

  test("lecturas limpias: 100% de la pool completa matchea exacto", () => {
    for (const truth of RELIC_POOL) {
      const [tier, code] = truth.toUpperCase().split(" ");
      assert.equal(OCRService.getRelicMatch([tier, code, "RELIC"]), truth, `limpia "${tier} ${code}"`);
    }
  });

  test("textos de prime parts (pool de items) jamás matchean una reliquia", () => {
    for (const item of buildItemPool()) {
      const words = item.toUpperCase().split(" ");
      const got = OCRService.getRelicMatch(words);
      assert.equal(got, null, `"${item}" no debería matchear "${got}"`);
    }
  });

  test("basura pura no matchea", () => {
    const rand = mulberry32(0xBA5E);
    for (let n = 0; n < 200; n++) {
      const len = 1 + Math.floor(rand() * 4);
      const words = Array.from({ length: len }, () => {
        const wl = 1 + Math.floor(rand() * 6);
        return Array.from({ length: wl }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(rand() * 36)]).join("");
      });
      const got = OCRService.getRelicMatch(words);
      // random garbage can form a plausible "TIER CODE" by chance, but must NOT match without a recognizable
      // tier in the text
      if (got) {
        const hasTierLike = words.some(w => OCRService.RELIC_TIERS.some(t => OCRService._relicTierScore(w, t) >= 0.78 || w.startsWith(t)));
        assert.ok(hasTierLike, `basura ${JSON.stringify(words)} matcheó "${got}" sin tier plausible`);
      }
    }
  });

  // regression (RELICS tab captures at 1440p): OCR returned thin glyphs as punctuation ("Axi"→"Ax!",
  // "T1"→"T]", "I"→"|", "A7"→"A?") and cleanup was deleting instead of mapping them
  // the code lost its digit ("T]"→"T") and tier dropped to 2 letters ("AX"), failing 9 of 54 real cells;
  // mapping the glyph recovers 52/54
  test("puntuación del OCR traducida a su glifo (| ! ] ?)", () => {
    state.allRelicNames = RELIC_POOL;
    const CASES = [
      [["Ax!", "A10", "Relic"], "Axi A10"],   // thin "i" read as "!"
      [["Ax!", "AQ", "Relic"], "Axi A9"],
      [["Ax!", "El", "Relic"], "Axi E1"],
      [["Ax!", "Al]", "Relic"], "Axi A11"],
      [["Requiem", "|", "Relic"], "Requiem I"],
      [["Meso", "T]", "Relic"], "Meso T1"],
      [["Meso", "A?", "Relic"], "Meso A7"],
    ];
    for (const [reading, expected] of CASES) {
      assert.equal(OCRService.getRelicMatch(reading), expected, JSON.stringify(reading));
    }
  });

  // regression: a WELL-FORMED code (letter + 1-2 digits) missing from catalog was trimmed to fit: "Axi
  // A21"/"Axi A22" recorded as "Axi A2"
  // a false count is worse than reading nothing; noise tails are only trimmed when the code is impossible
  // (3+ digits, "A160"→A16)
  test("código bien formado ausente del catálogo NO se trunca hasta encajar", () => {
    state.allRelicNames = ["Axi A2", "Axi A20", "Axi A16"];
    for (const code of ["A21", "A22"]) {
      assert.equal(OCRService.getRelicMatch(["AXI", code, "RELIC"]), null,
        `${code} no está en el catálogo: debe dar null, no truncarse a Axi A2`);
    }
    // attached art noise (3 digits = impossible code) is still trimmed
    assert.equal(OCRService.getRelicMatch(["AXI", "A160", "RELIC"]), "Axi A16");
  });

  // regression (legible crop yielding UNMATCHED): relic codes are a letter + 1-2 digits starting with 1-9
  // across all 763 normal era relics
  // a leading ZERO is impossible: when OCR read "Axi O5" as "AXI O05" (O and 0 duplicated), score fell to
  // 0.67 below the 0.70 cutoff
  test("cero a la izquierda imposible: glifo duplicado O/0 se recupera", () => {
    state.allRelicNames = RELIC_POOL;
    for (const reading of [["AXI", "OO5", "RELIC"], ["AXI", "O05", "RELIC"], ["AXI", "005", "RELIC"]]) {
      assert.equal(OCRService.getRelicMatch(reading), "Axi O5", JSON.stringify(reading));
    }
    assert.equal(OCRService.getRelicMatch(["AXI", "O5", "RELIC"]), "Axi O5"); // clean read untouched
    // a legitimate 2-digit code is untouched: the 0 in "A10" is not adjacent to the letter
    assert.equal(OCRService.getRelicMatch(["AXI", "A10", "RELIC"]), "Axi A10");
    // garbage with zeroes must not invent anything
    for (const junk of [["AXI", "000", "RELIC"], ["AXI", "0", "RELIC"]]) {
      assert.equal(OCRService.getRelicMatch(junk), null, JSON.stringify(junk));
    }
  });

  // relics not matching the era+letter+number pattern (Requiem I-IV, Requiem Eterna, 4 Vanguard) appear in
  // inventory with the rest
  // Vanguard was missing from RELIC_TIERS and "ETERNA" exceeded addCand's 4-character limit
  test("excepciones al patrón: Vanguard y Requiem Eterna se casan", () => {
    state.allRelicNames = ["Vanguard C1", "Vanguard E1", "Vanguard M1", "Vanguard P1",
      "Requiem ETERNA", "Requiem I", "Requiem II", "Requiem III", "Requiem IV", "Axi C1"];
    const CASES = [
      [["Vanguard", "Cl", "Relic"], "Vanguard C1"],   // real capture read (l for 1)
      [["Vanguard", "E1", "Relic"], "Vanguard E1"],
      [["Vanguard", "P1", "Relic"], "Vanguard P1"],
      [["Requiem", "Eterna", "Relic"], "Requiem ETERNA"],
      [["Requiem", "III", "Relic"], "Requiem III"],
    ];
    for (const [reading, expected] of CASES) {
      assert.equal(OCRService.getRelicMatch(reading), expected, JSON.stringify(reading));
    }
    // "Vanguard" must not steal matches from normal eras that have their own code
    assert.equal(OCRService.getRelicMatch(["AXI", "C1", "RELIC"]), "Axi C1");
  });

  test("casos reales de capturas en vivo (regresión)", () => {
    // catalog with the specific relics from captures (reaffirming what is in the generated pool for clarity)
    state.allRelicNames = RELIC_POOL;
    const CASES = [
      [["AX", "A10", "RELIC"], "Axi A10"],
      [["AXT", "A13", "RELIC"], "Axi A13"],
      [["AX", "AL", "4", "RELIC"], "Axi A14"],
      [["AX", "AQ", "RELIC"], "Axi A9"],
      [["AXI", "ET", "RELIC"], "Axi E1"],
      [["MESO", "T2", "RELIC"], "Meso T2"],
      [["MESO", "IT", "RELIC"], "Meso I1"],
      [["REQUIEM", "IL", "RELIC"], "Requiem II"],
      [["REQUIEM", "ILL", "RELIC"], "Requiem III"],
      [["REQUIEM", "IV", "RELIC"], "Requiem IV"],
      [["NE0", "S12", "RELIC"], "Neo S12"],
    ];
    for (const [reading, expected] of CASES) {
      assert.equal(OCRService.getRelicMatch(reading), expected, JSON.stringify(reading));
    }
  });
});

// regression: "Axi O5" and "Axi O6" came out as UNMATCHED CELL
// code initials are ALWAYS a letter, but OCR read O as 0; sharing confusion with C/D/G/Q, "05" tied at
// 0.800 against C5, D5, G5 and O5, dropping uniqueness margin to 0
// restoring the letter when the candidate starts with a digit matches "O5" exactly
test("getRelicMatch: inicial del código leída como dígito (0→O, 1→I) se recupera", () => {
  state.allRelicNames = RELIC_POOL;
  const CASES = [
    [["AXI", "05", "RELIC"], "Axi O5"],
    [["AXI", "06", "RELIC"], "Axi O6"],
    [["AXI", "01", "RELIC"], "Axi O1"],
    [["LITH", "04", "RELIC"], "Lith O4"],
    [["MESO", "11", "RELIC"], "Meso I1"],
    [["NEO", "12", "RELIC"], "Neo I2"],
    // correct read must continue working
    [["AXI", "O5", "RELIC"], "Axi O5"],
    [["AXI", "L5", "RELIC"], "Axi L5"],
  ];
  for (const [reading, expected] of CASES) {
    assert.equal(OCRService.getRelicMatch(reading), expected, JSON.stringify(reading));
  }
});

// regression: garbage OCR cells were recorded as "Requiem I"
// tier PREFIX recovery did not bound missing glyphs, so "RE" scored 0.92 against REQUIEM (5 missing
// letters) and any garbage containing "RE" initiated code search
// prefixes now only cover ONE missing glyph ("AX"→AXI, "NE"→NEO); false positives put non-existent relics
// in inventory
test("getRelicMatch: OCR basura NO produce falsos positivos de tier", () => {
  state.allRelicNames = RELIC_POOL;
  const JUNK = [
    "AIT . . I EF VO FEA PS SY 7 . . - ) FO RE SM, I",
    "JT TAN ) COD 7 -AF - OS Y 1S J BEX )) YOO A I R",
    "FO RE SM",
    "LI GHT ARMOR",
    "ME TAL PLATE",
  ];
  for (const junk of JUNK) {
    assert.equal(OCRService.getRelicMatch(junk.split(/\s+/)), null, JSON.stringify(junk));
  }

  // legitimate recovery of ONE missing glyph must still work
  assert.equal(OCRService.getRelicMatch(["AX", "A10", "RELIC"]), "Axi A10");
  assert.equal(OCRService.getRelicMatch(["NE", "S12", "RELIC"]), "Neo S12");
  assert.equal(OCRService.getRelicMatch(["REQUIEM", "II", "RELIC"]), "Requiem II");
});
