// Hay stats que el juego nunca genera como maldición: los cuatro elementales y Punch Through.
// La regla vive en config.js y la comparten OCR, tasador y listas de recomendación.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { canBeNegative, IMPOSSIBLE_NEGATIVE_STATS } = await import("../deploy/js/config.js");

test("los elementales y Punch Through no pueden ser negativa", () => {
  for (const s of ["Heat", "Cold", "Toxin", "Electric",
    "Heat Damage", "Cold Damage", "Toxin Damage", "Electric Damage", "Punch Through"]) {
    assert.equal(canBeNegative(s), false, `${s} no puede rolar como maldición`);
  }
});

test("los stats que sí pueden ser negativa lo siguen siendo", () => {
  for (const s of ["Critical Chance", "Critical Damage", "Multishot", "Recoil", "Zoom",
    "Ammo Maximum", "Status Chance", "Damage to Corpus", "Range"]) {
    assert.equal(canBeNegative(s), true, `${s} sí puede rolar como maldición`);
  }
});

test("Puncture Damage no se confunde con Punch Through", () => {
  // El regex viejo /\bpunch\b/ era correcto aquí, pero un match por substring ("punch" dentro de
  // "puncture" en otras variantes) sí confundiría dos stats distintos: uno puede ser curse y el otro no.
  assert.equal(canBeNegative("Puncture Damage"), true, "Puncture Damage SÍ puede ser negativa");
  assert.equal(canBeNegative("Punch Through"), false, "Punch Through NO puede ser negativa");
});

test("el alias del scanner resuelve antes de decidir", () => {
  // El OCR etiqueta "Crit Chance"; debe seguir siendo negativable vía resolveBaseStatKey.
  assert.equal(canBeNegative("Crit Chance"), true);
  assert.equal(canBeNegative("Crit Damage"), true);
});

test("la lista es única: el OCR y la UI no llevan su propia copia", () => {
  const sinComentarios = (f) => fs.readFileSync(path.resolve(__dirname, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const ocr = sinComentarios("../deploy/js/services/rivens/riven_ocr.service.js");
  assert.ok(!/heat\|cold\|electric\|toxin/i.test(ocr),
    "el OCR volvió a tener su propia lista de elementales: usa canBeNegative()");
  const ui = sinComentarios("../deploy/js/ui.components/rivens/ui_rivens.js");
  assert.ok(!/\\b\(heat\|cold\|electric\|toxin\|punch\)\\b/i.test(ui),
    "ui_rivens volvió a tener su propio regex: usa canBeNegative()");
  assert.ok(IMPOSSIBLE_NEGATIVE_STATS.length > 0, "la lista canónica debe estar exportada");
});
