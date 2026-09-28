// kubrow pattern and colour translation from EE.log
// the table changes when DE adds colours; what is pinned are two design choices that would break silently

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  translateColor,
  translatePattern,
  translateColorTier,
  getColorRarity,
  getColorRarityLevel,
  KUBROW_COLORS,
  KUBROW_RARITY_LEVELS,
} from "../deploy/js/utils/vision/kubrow_translations.js";

// an unverified code is shown raw on purpose: a made-up "Wukong Blue" is worse than the code, since users
// price kubrows by it
test("un código desconocido devuelve el código, nunca un nombre inventado", () => {
  assert.equal(translateColor("KubrowPetColorInventado"), "KubrowPetColorInventado");
  assert.equal(translatePattern("KubrowPetPatternZZ"), "KubrowPetPatternZZ");
});

test("sin código no se inventa nada", () => {
  assert.equal(translateColor(null), null);
  assert.equal(translateColorTier(null), null);
  assert.equal(getColorRarity(null), 0);
  assert.equal(translatePattern(null), "Desconocido");
  assert.equal(translatePattern(null, "en"), "Unknown");
});

// RARITY_RULES is evaluated in order and the first match wins: "SolsticeMid" matches both "Solstice"
// (themed, very rare) and "Mid" (uncommon), so reordering would drop it from 3 to 1
test("un color temático con sufijo de intensidad gana por temático, no por el sufijo", () => {
  assert.equal(getColorRarityLevel("KubrowPetColorSolsticeMid"), 3);
  assert.equal(getColorRarityLevel("KubrowPetColorVibrantDiamond"), 3);
  assert.equal(getColorRarityLevel("KubrowPetColorVibrantG"), 2);
  assert.equal(getColorRarityLevel("KubrowPetColorMidE"), 1);
  assert.equal(getColorRarityLevel("KubrowPetColorMundaneA"), 0);
});

test("la rareza sale igual por nombre real que por código interno", () => {
  assert.equal(getColorRarity("Wukong Blue"), getColorRarityLevel("KubrowPetColorSolsticeMid"));
  for (const [code, nombre] of Object.entries(KUBROW_COLORS)) {
    assert.equal(getColorRarity(nombre), getColorRarityLevel(code), `${nombre} (${code})`);
  }
});

test("todo nivel de rareza que se puede devolver está definido con sus dos idiomas", () => {
  const niveles = new Set(Object.keys(KUBROW_COLORS).map(getColorRarityLevel));
  for (const n of niveles) {
    const def = KUBROW_RARITY_LEVELS[n];
    assert.ok(def, `falta el nivel ${n} en KUBROW_RARITY_LEVELS`);
    assert.ok(def.es && def.en && def.color, `el nivel ${n} necesita es, en y color`);
  }
});

test("el sufijo de intensidad se traduce a los dos idiomas", () => {
  assert.equal(translateColorTier("KubrowPetColorSolsticeMid"), "Medio");
  assert.equal(translateColorTier("KubrowPetColorSolsticeMid", "en"), "Mid");
  // only a trailing suffix counts (endsWith, not includes)
  assert.equal(translateColorTier("KubrowPetColorMidE"), null);
});
