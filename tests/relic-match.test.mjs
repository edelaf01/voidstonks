import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, buildItemPool } from "./_helpers/synthetic-pool.mjs";

globalThis.document ??= { createElement: () => ({ getContext: () => null }) };
const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");

// ===========================================================================
// Tests SINTÉTICOS del matcher genérico de reliquias (getRelicMatch).
// Pool completa de reliquias generada (tiers × letras × números, como la DB real)
// y ENTRADAS CORRUPTAS generadas con el MISMO modelo de confusiones OCR del
// matcher (grupos de _ocrConfMap) + degradaciones vistas en capturas reales:
// glifo fino perdido ("AXI"→"AX"), cola de ruido del arte ("A16"→"A160"),
// código partido ("A14"→"A1"+"4"), tokens de UI y basura.
// Invariantes:
//   (1) tasa de recuperación alta sobre N muestras seedeadas;
//   (2) CERO matches incorrectos: o la reliquia correcta, o null (nunca otra);
//   (3) textos de prime parts (pool de items) jamás matchean una reliquia.
// ===========================================================================

// Pool de reliquias realista: letras y números como los de la DB real (772).
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

// Sustituto de confusión: otro carácter del MISMO grupo (el modelo del matcher).
function confuse(ch, rand) {
  const group = OCRService._ocrConfMap.get(ch);
  if (!group) return ch;
  const others = [...group].filter(c => c !== ch && c !== "|");
  return others.length ? others[Math.floor(rand() * others.length)] : ch;
}

// Códigos existentes por tier (para que el generador no fabrique lecturas que
// coincidan EXACTAMENTE con otra reliquia real: eso es ambigüedad genuina que
// ni un humano resolvería, no un fallo del matcher).
const CODES_BY_TIER = new Map();
for (const name of RELIC_POOL) {
  const [t, c] = name.toUpperCase().split(" ");
  if (!CODES_BY_TIER.has(t)) CODES_BY_TIER.set(t, new Set());
  CODES_BY_TIER.get(t).add(c);
}

const JUNK_TOKENS = ["RELIC", "RADIANT", "so", "ve", "kr", "od", "x", "7"];

// Genera una lectura OCR corrupta de una reliquia canónica. Devuelve array de palabras.
function corruptReading(canonical, rand) {
  let [tier, code] = canonical.toUpperCase().split(" ");
  const codes = CODES_BY_TIER.get(tier);
  const roll = rand();
  if (roll < 0.30) {
    // 1 confusión de grupo en tier o código (evitando colisionar con otro código real)
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
    tier = tier.slice(0, tier.length - 1); // glifo fino final perdido ("AXI"→"AX")
  } else if (roll < 0.60 && tier !== "REQUIEM") {
    // cola de ruido del arte ("A16"→"A160"), sin formar otro código real
    for (let d = 0; d < 10; d++) {
      if (!codes.has(code + d)) { code = code + d; break; }
    }
  } else if (roll < 0.70 && code.length >= 3 && tier !== "REQUIEM") {
    // código partido con el dígito del prefijo confundido a letra ("A14" → "AL" + "4"),
    // como en las capturas reales
    const prefix = code.slice(0, 2);
    const confusedPrefix = prefix[0] + confuse(prefix[1], rand);
    const words = [tier, confusedPrefix, code.slice(2)];
    if (rand() < 0.5) words.push("RELIC");
    return words;
  } else if (roll < 0.78) {
    return [tier + code]; // pegado ("LITHC1")
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
      // La basura aleatoria puede formar por azar un "TIER CODE" plausible; lo que
      // NO puede pasar es que matchee sin que haya un tier reconocible en el texto.
      if (got) {
        const hasTierLike = words.some(w => OCRService.RELIC_TIERS.some(t => OCRService._relicTierScore(w, t) >= 0.78 || w.startsWith(t)));
        assert.ok(hasTierLike, `basura ${JSON.stringify(words)} matcheó "${got}" sin tier plausible`);
      }
    }
  });

  // REGRESIÓN (capturas reales de la pestaña RELICS, 2560x1440): el OCR devuelve el
  // glifo fino como signo de puntuación —"Axi"→"Ax!", "T1"→"T]", "I"→"|", "A7"→"A?"—
  // y la limpieza lo BORRABA en vez de traducirlo. Dos efectos: el código se quedaba
  // sin dígito ("T]"→"T", "|"→"") y el tier caía a fragmento de 2 letras ("AX"), que
  // dispara la guardia de tier flojo y exige un código casi exacto. 9 de 54 celdas
  // reales fallaban por esto; traduciendo el signo a su glifo, 52/54.
  test("puntuación del OCR traducida a su glifo (| ! ] ?)", () => {
    state.allRelicNames = RELIC_POOL;
    const CASES = [
      [["Ax!", "A10", "Relic"], "Axi A10"],   // "i" fina leída como "!"
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

  // REGRESIÓN: un código BIEN FORMADO (letra + 1-2 dígitos) que no está en el catálogo
  // se recortaba hasta encajar: "Axi A21"/"Axi A22" —que la BD no tiene, se quedó en
  // A20— se anotaban como "Axi A2". Un recuento falso es peor que no leer nada. La cola
  // solo es ruido cuando el código resultante es imposible (3+ dígitos, "A160"→A16).
  test("código bien formado ausente del catálogo NO se trunca hasta encajar", () => {
    state.allRelicNames = ["Axi A2", "Axi A20", "Axi A16"];
    for (const code of ["A21", "A22"]) {
      assert.equal(OCRService.getRelicMatch(["AXI", code, "RELIC"]), null,
        `${code} no está en el catálogo: debe dar null, no truncarse a Axi A2`);
    }
    // Ruido del arte pegado (3 dígitos = código imposible) sí se sigue recortando.
    assert.equal(OCRService.getRelicMatch(["AXI", "A160", "RELIC"]), "Axi A16");
  });

  // REGRESIÓN (captura en vivo, recorte PERFECTAMENTE legible → UNMATCHED): el código de
  // una reliquia es LETRA + número de 1-2 cifras que empieza en 1-9 — los 763 códigos de
  // era normal del catálogo lo cumplen sin excepción (las excepciones son Requiem I-IV,
  // Requiem Eterna y los Vanguard, que van por otra vía). Un CERO A LA IZQUIERDA es por
  // tanto imposible: cuando el OCR leyó "Axi O5" como "AXI O05" —O y 0 son el mismo trazo,
  // leído dos veces, una como letra y otra como dígito— el candidato se quedaba en 0.67
  // contra O5, bajo el corte de 0.70, y la celda salía sin match.
  test("cero a la izquierda imposible: glifo duplicado O/0 se recupera", () => {
    state.allRelicNames = RELIC_POOL;
    for (const reading of [["AXI", "OO5", "RELIC"], ["AXI", "O05", "RELIC"], ["AXI", "005", "RELIC"]]) {
      assert.equal(OCRService.getRelicMatch(reading), "Axi O5", JSON.stringify(reading));
    }
    assert.equal(OCRService.getRelicMatch(["AXI", "O5", "RELIC"]), "Axi O5"); // lectura buena intacta
    // Un código legítimo de 2 cifras no se toca: el 0 de "A10" no va pegado a la letra.
    assert.equal(OCRService.getRelicMatch(["AXI", "A10", "RELIC"]), "Axi A10");
    // Basura con ceros no debe inventar nada.
    for (const junk of [["AXI", "000", "RELIC"], ["AXI", "0", "RELIC"]]) {
      assert.equal(OCRService.getRelicMatch(junk), null, JSON.stringify(junk));
    }
  });

  // Las reliquias que NO siguen el patrón era+letra+número (Requiem I-IV, Requiem Eterna
  // y los 4 Vanguard) aparecen en el inventario junto a las demás — se ven al final de la
  // lista, ordenadas por nombre. Vanguard no estaba en RELIC_TIERS (ni se intentaba) y
  // "ETERNA" pasaba del tope de 4 caracteres de addCand, así que nunca era candidato.
  test("excepciones al patrón: Vanguard y Requiem Eterna se casan", () => {
    state.allRelicNames = ["Vanguard C1", "Vanguard E1", "Vanguard M1", "Vanguard P1",
      "Requiem ETERNA", "Requiem I", "Requiem II", "Requiem III", "Requiem IV", "Axi C1"];
    const CASES = [
      [["Vanguard", "Cl", "Relic"], "Vanguard C1"],   // lectura real de la captura (l por 1)
      [["Vanguard", "E1", "Relic"], "Vanguard E1"],
      [["Vanguard", "P1", "Relic"], "Vanguard P1"],
      [["Requiem", "Eterna", "Relic"], "Requiem ETERNA"],
      [["Requiem", "III", "Relic"], "Requiem III"],
    ];
    for (const [reading, expected] of CASES) {
      assert.equal(OCRService.getRelicMatch(reading), expected, JSON.stringify(reading));
    }
    // "Vanguard" no debe robarle el match a la era normal que sí trae código propio.
    assert.equal(OCRService.getRelicMatch(["AXI", "C1", "RELIC"]), "Axi C1");
  });

  test("casos reales de capturas en vivo (regresión)", () => {
    // Catálogo con las reliquias concretas de las capturas (E1, A9, A10, A13, A14,
    // T2, I1, S12 ya están en la pool generada; se reafirma para claridad).
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

// ===========================================================================
// REGRESIÓN (bug visto en vivo, pestaña de reliquias): "Axi O5" y "Axi O6" salían
// como UNMATCHED CELL. La inicial del código es SIEMPRE una letra, pero el OCR leía
// la O como 0; y como O/0 comparten grupo de confusión con C/D/G/Q, el candidato
// "05" empataba a 0.800 contra C5, D5, G5 y O5 a la vez. El margen de unicidad caía
// a 0 y getRelicMatch devolvía null (correctamente: no podía desempatar).
// Reponiendo la letra cuando el candidato empieza por dígito, "O5" casa exacto.
// ===========================================================================
test("getRelicMatch: inicial del código leída como dígito (0→O, 1→I) se recupera", () => {
  state.allRelicNames = RELIC_POOL;
  const CASES = [
    [["AXI", "05", "RELIC"], "Axi O5"],
    [["AXI", "06", "RELIC"], "Axi O6"],
    [["AXI", "01", "RELIC"], "Axi O1"],
    [["LITH", "04", "RELIC"], "Lith O4"],
    [["MESO", "11", "RELIC"], "Meso I1"],
    [["NEO", "12", "RELIC"], "Neo I2"],
    // La lectura correcta debe seguir funcionando igual.
    [["AXI", "O5", "RELIC"], "Axi O5"],
    [["AXI", "L5", "RELIC"], "Axi L5"],
  ];
  for (const [reading, expected] of CASES) {
    assert.equal(OCRService.getRelicMatch(reading), expected, JSON.stringify(reading));
  }
});

// ===========================================================================
// REGRESIÓN (falso positivo visto en vivo): celdas con OCR basura
// ("AIT . . I EF VO FEA PS SY 7 . . - ) FO RE SM, I") se anotaban como "Requiem I".
// Causa: el rescate por PREFIJO de tier no acotaba cuántos glifos podían faltar, así
// que el fragmento "RE" puntuaba 0.92 contra REQUIEM (5 letras ausentes) y cualquier
// basura que contuviera "RE" abría la búsqueda de código. Ahora el prefijo solo cubre
// UN glifo perdido ("AX"→AXI, "NE"→NEO), que es el error real de OCR que pretendía
// rescatar. Un falso positivo es peor que un fallo: mete en el inventario una reliquia
// que el jugador no tiene.
// ===========================================================================
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

  // El rescate legítimo de UN glifo perdido debe seguir funcionando.
  assert.equal(OCRService.getRelicMatch(["AX", "A10", "RELIC"]), "Axi A10");
  assert.equal(OCRService.getRelicMatch(["NE", "S12", "RELIC"]), "Neo S12");
  assert.equal(OCRService.getRelicMatch(["REQUIEM", "II", "RELIC"]), "Requiem II");
});
