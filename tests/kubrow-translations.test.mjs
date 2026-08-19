// Traducción de patrones y colores de kubrow que salen del EE.log.
//
// El módulo vivía en ui.components/ y lo importaba un service, cruzando la capa. Al bajarlo a
// utils/ (no toca el DOM: es tabla de datos + funciones puras) entró bajo la regla de
// ARCHITECTURE.md §E, y este es su test.
//
// Lo que se fija aquí no es la tabla —esa cambia cuando DE saca colores— sino las dos
// decisiones de diseño que se romperían sin que nadie lo notase.

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

// Un código sin match verificado se muestra crudo a propósito: enseñar "Wukong Blue" cuando en
// realidad no se sabe qué color es sería peor que enseñar el código, porque el usuario lo usa
// para decidir si un kubrow vale plat.
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

// RARITY_RULES se evalúa en orden y la PRIMERA regla que casa gana. "SolsticeMid" contiene a la
// vez "Solstice" (temático, muy raro) y "Mid" (poco común): reordenar el array lo degradaría de
// 3 a 1 en silencio, y con él el precio que la app sugiere para ese kubrow.
test("un color temático con sufijo de intensidad gana por temático, no por el sufijo", () => {
  assert.equal(getColorRarityLevel("KubrowPetColorSolsticeMid"), 3);
  assert.equal(getColorRarityLevel("KubrowPetColorVibrantDiamond"), 3);
  // Y la genética estándar sí se clasifica por intensidad.
  assert.equal(getColorRarityLevel("KubrowPetColorVibrantG"), 2);
  assert.equal(getColorRarityLevel("KubrowPetColorMidE"), 1);
  assert.equal(getColorRarityLevel("KubrowPetColorMundaneA"), 0);
});

// El extractor de imagen devuelve el nombre real ("Wukong Blue"), no el código interno, así que
// getColorRarity tiene que aceptar los dos y dar lo mismo.
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
  // Solo cuenta como sufijo si está al final: es endsWith, no includes.
  assert.equal(translateColorTier("KubrowPetColorMidE"), null);
});
