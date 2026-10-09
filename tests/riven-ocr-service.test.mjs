// riven card parser: raw ocr text -> structured riven
// card background art pollutes text, causing subtle regex bugs that drop curses or swap weapons without
// error
// pins each regression against raw Tesseract output strings without requiring images

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { state } = await import("../deploy/js/state.js");
const { RivenOCRService: S } = await import("../deploy/js/services/rivens/riven_ocr.service.js");

state.allRivenNames = ["Braton", "Furis", "Ignis", "Gotva Prime", "Scourge", "Stug", "Torid", "Zenith"];
state.weaponMap = {
  Braton: { t: "Rifle", d: 1.0 },
  Furis: { t: "Pistol", d: 1.0 },
  "Gotva Prime": { t: "Rifle", d: 1.0 },
  Zenith: { t: "Rifle", d: 1.0 },
};

const nombres = (r) => r.stats.map((s) => s.name);
const positivos = (r) => r.stats.filter((s) => s.isPositive).map((s) => s.name);
const negativos = (r) => r.stats.filter((s) => !s.isPositive).map((s) => s.name);

test("las barras verticales que Tesseract confunde con I se enderezan", () => {
  assert.equal(S._normalize("|gnis"), "Ignis");
  assert.equal(S._normalize("BRAT0N   PRIME"), "BRAT0N PRIME");
});

test("la O suelta pegada a dígitos se lee como cero", () => {
  assert.equal(S._normalize("O"), "0");
  assert.equal(S._normalize("o5"), "05");
  assert.equal(S._normalize("5o"), "50");
});

test("un nombre de stat limpio se reconoce", () => {
  assert.equal(S._matchStat("Critical Damage"), "Crit Damage");
  assert.equal(S._matchStat("critical chance"), "Crit Chance");
});

test("basura sin parecido no se fuerza a ningún stat", () => {
  assert.equal(S._matchStat("qqq"), null);
  assert.equal(S._matchStat("xy"), null);
});

// when ocr fuses two lines, the correct stat STARTS on the first word: unanchored, "Zoom Ammo Maximum"
// resolved to "Ammo Maximum" and the curse appeared as positive with Zoom value
test("una línea fundida se resuelve por la primera palabra, no por la última", () => {
  assert.equal(S._matchStatAnchored("Zoom Ammo Maximum"), "Zoom");
});

// "Weapon Recoil" does not anchor because the catalog names it "Recoil": alias table prevents "Weapon
// Recoil Puncture" from matching "Puncture Damage"
test("Weapon Recoil se reconoce pese a que el catálogo lo llama solo Recoil", () => {
  assert.equal(S._matchStatAnchored("Weapon Recoil"), "Recoil");
  assert.equal(S._matchStatAnchored("Weapon Recoil Puncture"), "Recoil");
});

// LONGEST anchored prefix wins: otherwise "Damage to Grineer" falls back to "Damage"
test("el prefijo anclado más largo gana al más corto", () => {
  assert.equal(S._matchStatAnchored("Damage to Grineer"), "Damage to Grineer");
});

test("el valor de la línea siguiente corta el nombre", () => {
  assert.equal(S._matchStatAnchored("Damage 90 1 Status Chance"), "Damage");
  assert.equal(S._matchStatAnchored("Damage 90 1 Status Duration"), "Damage");
  assert.equal(S._matchStatAnchored("Weapon Recoil 90 1 Status Chance"), "Recoil");
  assert.equal(S._matchStatAnchored("Damage to Grineer"), "Damage to Grineer");
});

test("una carta limpia sale con sus stats, su arma y su MR", () => {
  const r = S.parseRivenCard([
    "Braton Cronidex",
    "+120.5% Critical Damage",
    "+88.2% Multishot",
    "-45.3% Zoom",
    "MR 14",
  ].join("\n"));

  assert.ok(r, "debe parsear");
  assert.equal(r.weaponName, "Braton");
  assert.equal(r.mr, 14);
  assert.deepEqual(positivos(r), ["Crit Damage", "Multishot"]);
  assert.deepEqual(negativos(r), ["Zoom"]);
});

// roll counter shares a line with MR and its ↻ glyph often reads as 0, standalone or attached; discarding
// it leaves the true roll count
test("de la línea del MR, los ciclos son el primer número tras quitar el glifo", () => {
  const r = S.parseRivenCard([
    "Braton Cronidex",
    "+120.5% Critical Damage",
    "+88.2% Multishot",
    "MR 14   0 15",
  ].join("\n"));
  assert.equal(r.mr, 14);
  assert.equal(r.rolls, 15);
});

test("el glifo de ciclos pegado al número o con ruido detrás no cambia la cuenta", () => {
  const ciclos = (linea) => S.parseRivenCard([
    "Braton Cronidex",
    "+120.5% Critical Damage",
    "+88.2% Multishot",
    linea,
  ].join("\n")).rolls;
  assert.equal(ciclos("MR 13 0 15"), 15);
  assert.equal(ciclos("MR 13 015)"), 15);
  assert.equal(ciclos("MR 13 015%"), 15);
  assert.equal(ciclos("MR 13 O15"), 15);
  assert.equal(ciclos("MR 13 0 15 5"), 15);
  assert.equal(ciclos("MR 13 0123"), 123);
  assert.equal(ciclos("MR 13 OB"), null);
});

// ocr frequently drops the decimal point: "+82 2%" and "+822%" represent +82.2; no riven stat reaches 822
test("un decimal perdido se recupera en vez de aceptar un 822%", () => {
  const conEspacio = S.parseRivenCard([
    "Braton Cronidex", "+82 2% Critical Damage", "+55.0% Multishot",
  ].join("\n"));
  assert.equal(conEspacio.stats[0].value, 82.2);

  const sinPunto = S.parseRivenCard([
    "Braton Cronidex", "+822% Critical Damage", "+55.0% Multishot",
  ].join("\n"));
  assert.equal(sinPunto.stats[0].value, 82.2);
});

// bow and shotgun conditional qualifiers split across lines and MULT_RE falsely parsed them as multiplier
// stats
test('el "(x2 for Bows)" no se cuela como un stat', () => {
  const r = S.parseRivenCard([
    "Braton Cronidex",
    "+82.2% Fire Rate (x2 for",
    "Bows)",
    "+55.0% Multishot",
  ].join("\n"));
  assert.deepEqual(nombres(r).sort(), ["Fire Rate / Attack Speed", "Multishot"].sort());
});

// faction damage arrives as a multiplier rather than a percentage: x1.74 is +74% and x0.8 is -20%
test("el daño por facción se convierte de multiplicador a porcentaje con su signo", () => {
  const bueno = S.parseRivenCard([
    "Braton Cronidex", "+120.5% Critical Damage", "+88.2% Multishot", "x1.74 Damage to Corpus",
  ].join("\n"));
  const dc = bueno.stats.find((s) => s.name === "Damage to Corpus");
  assert.ok(dc, `no se leyó la facción: ${nombres(bueno)}`);
  assert.equal(dc.isPositive, true);
  assert.equal(dc.value, 74);

  const malo = S.parseRivenCard([
    "Braton Cronidex", "+120.5% Critical Damage", "+88.2% Multishot", "x0.8 Damage to Grineer",
  ].join("\n"));
  const dg = malo.stats.find((s) => s.name === "Damage to Grineer");
  assert.equal(dg.isPositive, false);
  assert.equal(dg.value, 20);
});

// background art noise prevented regex closure and the curse was LOST across most frames; faction is the
// only word consistently surviving ocr
test("el curse de facción se lee aunque el arte deje basura detrás", () => {
  const r = S.parseRivenCard([
    "Braton Cronidex",
    "+120.5% Critical Damage",
    "+88.2% Multishot",
    "x0.7 Damage to Grineer A / N Om ye",
  ].join("\n"));
  assert.ok(nombres(r).includes("Damage to Grineer"), nombres(r).join(", "));
});

// ocr corrupts "Grineer" into GRJN or GR1N: matches factions via fuzzy patterns
test("una facción mal leída sigue reconociéndose", () => {
  const r = S.parseRivenCard([
    "Braton Cronidex", "+120.5% Critical Damage", "+88.2% Multishot", "x0.8 Damage to GRJNEER",
  ].join("\n"));
  assert.ok(nombres(r).includes("Damage to Grineer"), nombres(r).join(", "));
});

// recoil is inverted on cards with buffs shown as negative: without inverting, a legit roll with recoil
// buff + curse had 2 curses and failed structural validation
test("el recoil está invertido: el menos es el buff", () => {
  const r = S.parseRivenCard([
    "Braton Cronidex",
    "+120.5% Critical Damage",
    "-89.5% Weapon Recoil",
    "-45.0% Zoom",
  ].join("\n"));
  assert.ok(r, "la carta no puede rechazarse");
  assert.ok(positivos(r).includes("Recoil"), `positivos: ${positivos(r)}`);
  assert.deepEqual(negativos(r), ["Zoom"]);
});

// elementals and Punch Through cannot roll as curses: a minus sign is an ocr misread
test("un elemental leído en negativo se corrige a positivo", () => {
  const r = S.parseRivenCard([
    "Braton Cronidex", "-90.0% Heat Damage", "+88.2% Multishot", "-45.0% Zoom",
  ].join("\n"));
  const heat = r.stats.find((s) => s.name.includes("Heat"));
  assert.equal(heat.isPositive, true);
});

// a real card never has 4 positives: the curse is always the last line, recovering the sign there instead
// of dropping the card
test("cuatro positivos significan que se comió el signo del último", () => {
  const r = S.parseRivenCard([
    "Braton Cronidex",
    "+120.5% Critical Damage",
    "+88.2% Multishot",
    "+55.0% Critical Chance",
    "+91.9% Ammo Maximum",
  ].join("\n"));
  assert.ok(r, "no puede rechazarse la carta");
  assert.deepEqual(negativos(r), ["Ammo Maximum"]);
});

// impossible structure: four positives where the last CANNOT be a curse; returning null is correct to
// avoid inventing rivens
test("una carta estructuralmente imposible se descarta", () => {
  assert.equal(S.parseRivenCard([
    "Braton Cronidex",
    "+120.5% Critical Damage", "+88.2% Multishot", "+55.0% Critical Chance", "+90.0% Heat Damage",
  ].join("\n")), null);

  assert.equal(S.parseRivenCard(["Braton Cronidex", "+120.5% Critical Damage"].join("\n")), null,
    "un solo positivo no es una carta");
});

test("un texto vacío o demasiado corto no parsea nada", () => {
  assert.equal(S.parseRivenCard(""), null);
  assert.equal(S.parseRivenCard("   "), null);
  assert.equal(S.parseRivenCard(null), null);
});

// tiny values are art noise that accidentally matched a stat name
test("un valor imposiblemente bajo se descarta como ruido", () => {
  const r = S.parseRivenCard([
    "Braton Cronidex", "+120.5% Critical Damage", "+88.2% Multishot", "+3% Puncture Damage",
  ].join("\n"));
  assert.ok(!nombres(r).includes("Puncture"), nombres(r).join(", "));
});

// riven name splits across two lines and the continuation is CLOSER to the stats block; distance-based
// matching falsely paired "ignido" with Ignis
test("un match exacto del arma gana a uno difuso más cercano a los stats", () => {
  const r = S.parseRivenCard([
    "Gotva Prime Croni-",
    "ignido",
    "+120.5% Critical Damage",
    "+88.2% Multishot",
  ].join("\n"));
  assert.equal(r.weaponName, "Gotva Prime");
});

test("nombre del riven partido en dos líneas: la primera es solo el arma y no se recorta", () => {
  const antes = state.allRivenNames;
  state.allRivenNames = [...antes, "Kuva Bramma", "Kuva Twin Stubbas", "Kuva Kohm"];
  try {
    const r = S.parseRivenCard(["Kuva Bramma", "Gelican", "+80.9% Multishot", "+83% Cold", "-19.5% Zoom"].join("\n"));
    assert.equal(r.weaponName, "Kuva Bramma", "con 'Kuva' a secas casaba la Kuva más larga: Twin Stubbas");
    assert.equal(S._matchWeaponScored("Kuva"), null, "un trozo corto no es el nombre de un arma");
    assert.equal(S._matchWeaponScored("Kuva Bramm")?.name, "Kuva Bramma", "un nombre cortado por el OCR sigue casando");
  } finally {
    state.allRivenNames = antes;
  }
});

// names with impossible lengths are pruned before calculating edit distance, avoiding 40-character garbage
// lines comparing against ~650 weapons every tick
test("una errata que se come justo las letras que permite el umbral sigue casando", () => {
  const antes = state.allRivenNames;
  state.allRivenNames = [...antes, "Ignis Wraith"];
  try {
    assert.deepEqual(S._matchWeaponScored("igns wrat"), { name: "Ignis Wraith", tier: 1, dist: 3 });
    assert.equal(S._matchWeaponScored("the yuvan clerisy commissioned these golden statues"), null);
  } finally {
    state.allRivenNames = antes;
  }
});

test("la distancia de edición cuenta inserciones, borrados y cambios", () => {
  assert.equal(S._levenshtein("", "abc"), 3);
  assert.equal(S._levenshtein("abc", ""), 3);
  assert.equal(S._levenshtein("kitten", "sitting"), 3);
  assert.equal(S._levenshtein("braton", "braton"), 0);
});

// art attaches spurious tokens to the name line; old guards (^\d, includes("%")) previously discarded the
// entire line, losing the weapon
test("basura pegada al nombre del arma no hace perder el arma", () => {
  const conDigito = S.parseRivenCard([
    "4 Scourge Cronidex", "+120.5% Critical Damage", "+88.2% Multishot",
  ].join("\n"));
  assert.equal(conDigito.weaponName, "Scourge");

  const conPorcentaje = S.parseRivenCard([
    "Stug Sati-ignidex a%", "+120.5% Critical Damage", "+88.2% Multishot",
  ].join("\n"));
  assert.equal(conPorcentaje.weaponName, "Stug");
});

test("un stat sin porcentaje como Atravesar se lee y conserva el orden de la carta", () => {
  const r = S.parseRivenCard([
    "Furis Visi-vexinok",
    "+89.2% Electricity",
    "+234.4% Damage",
    ". +2.6 Punch Through",
    "MR 13 O15",
  ].join("\n"));
  assert.equal(r.weaponName, "Furis");
  assert.equal(r.mr, 13);
  assert.equal(r.rolls, 15);
  assert.deepEqual(nombres(r), ["Electric", "Damage", "Punch Through"]);
  assert.deepEqual(negativos(r), []);
  assert.equal(r.stats[2].value, 2.6);
});

test("el multiplicador de facción va en su sitio y un decimal con coma y punto se lee", () => {
  const r = S.parseRivenCard([
    "Furis Visi-puratak",
    "+60.8% Reload Speed",
    "+293% Damage",
    "x1.59 Damage to Infested ,",
    ", -80,.8% Fire Rate P",
    "MR 13 015)",
  ].join("\n"));
  assert.equal(r.weaponName, "Furis");
  assert.equal(r.rolls, 15);
  assert.deepEqual(nombres(r), ["Reload Speed", "Damage", "Damage to Infested", "Fire Rate / Attack Speed"]);
  assert.deepEqual(negativos(r), ["Fire Rate / Attack Speed"]);
  assert.equal(r.stats.find((s) => s.name === "Damage to Infested").value, 59);
  assert.equal(r.stats.find((s) => s.name === "Fire Rate / Attack Speed").value, 80.8);
});

test("un pie con la etiqueta MR rota no inventa un stat con la basura de debajo", () => {
  const r = S.parseRivenCard([
    "Furis Visi-vexinok",
    "+89.2% Electricity",
    "+234.4% Damage",
    ". +2.6 Punch Through",
    "AMR 13 015%",
    "Been ASh",
    "(ae",
  ].join("\n"));
  assert.deepEqual(nombres(r), ["Electric", "Damage", "Punch Through"]);
  assert.equal(r.mr, 13);
  assert.equal(r.rolls, 15);
});

test("el pie se reconoce sin la palabra MR y corta la lectura ahí", () => {
  const r = S.parseRivenCard([
    "Furis Visi-vexinok",
    "+89.2% Electricity",
    "+234.4% Damage",
    "D +2.6 Punch Through",
    "Aun 13 015% n",
    "Brae ASh",
  ].join("\n"));
  assert.deepEqual(nombres(r), ["Electric", "Damage", "Punch Through"]);
  assert.equal(r.mr, 13);
  assert.equal(r.rolls, 15);
});

test("un MR imposible en el pie se ignora pero los rolls se quedan", () => {
  const r = S.parseRivenCard([
    "Furis Visi-puratak",
    "+60.8% Reload Speed",
    "+293% Damage",
    ", -80.8% Fire Rate '",
    "Aan 3 O15",
  ].join("\n"));
  assert.equal(r.mr, null);
  assert.equal(r.rolls, 15);
});

test("un valor con cero delante nunca es un stat", () => {
  const r = S.parseRivenCard([
    "Furis Visi-vexinok",
    "+89.2% Electricity",
    "+234.4% Damage",
    "015% Slash",
  ].join("\n"));
  assert.deepEqual(nombres(r), ["Electric", "Damage"]);
});

test("un stat sin unidad que perdió el punto decimal se recupera", () => {
  const r = S.parseRivenCard([
    "Furis Visi-vexinok",
    "+89.2% Electricity",
    "+234.4% Damage",
    "., +26 Punch Through",
    "Aun 13 015",
  ].join("\n"));
  const atravesar = r.stats.find((s) => s.name === "Punch Through");
  assert.equal(atravesar.value, 2.6);
  assert.ok(!atravesar.suspicious);
});

test("sin parse la validación no finge confianza", () => {
  const v = S.validateRiven(null);
  assert.equal(v.valid, false);
  assert.equal(v.confidence, 0);
});

test("sin arma reconocida la confianza baja aunque los stats sean buenos", () => {
  const conArma = S.validateRiven({
    weaponName: "Braton",
    stats: [
      { name: "Crit Damage", value: 120, isPositive: true },
      { name: "Multishot", value: 80, isPositive: true },
    ],
  });
  const sinArma = S.validateRiven({
    weaponName: null,
    stats: [
      { name: "Crit Damage", value: 120, isPositive: true },
      { name: "Multishot", value: 80, isPositive: true },
    ],
  });
  assert.ok(sinArma.confidence < conArma.confidence);
  assert.equal(sinArma.valid, false);
  assert.ok(sinArma.issues.some((i) => i.includes("weapon")), sinArma.issues.join(" | "));
});

// wide range on purpose (disposition is often filler 1.0): catches gross errors like dropped decimals
// producing 1000%, not normal roll dispersion
test("un valor absurdo se marca sospechoso y tumba la validación", () => {
  const v = S.validateRiven({
    weaponName: "Braton",
    stats: [
      { name: "Crit Damage", value: 12000, isPositive: true },
      { name: "Multishot", value: 80, isPositive: true },
    ],
  });
  assert.ok(v.issues.some((i) => i.includes("off-range")), v.issues.join(" | "));
  assert.equal(v.valid, false);
});

test("un stat que no existe en las tablas se señala en vez de ignorarse", () => {
  const v = S.validateRiven({
    weaponName: "Braton",
    stats: [{ name: "Stat Inventado", value: 50, isPositive: true }],
  });
  assert.ok(v.issues.some((i) => i.includes("base table")), v.issues.join(" | "));
});

test("la distancia de edición es simétrica y cuenta lo que debe", () => {
  assert.equal(S._levenshtein("ignis", "ignis"), 0);
  assert.equal(S._levenshtein("ignido", "ignis"), 2);
  assert.equal(S._levenshtein("", "abc"), 3);
  assert.equal(S._levenshtein("abc", ""), 3);
  assert.equal(S._levenshtein("braton", "bratun"), S._levenshtein("bratun", "braton"));
});

test("el OCR lee una carta de ITEM DETAILS sin rolls (captura real)", () => {
  const r = S.parseRivenCard([
    "Zenith Armatio",
    "+11.2 % Electricity",
    "+6.2% Magazine Capacity",
    "MR 16",
    "10",
  ].join("\n"));

  assert.ok(r, "debe parsear");
  assert.equal(r.weaponName, "Zenith");
  assert.equal(r.mr, 16);
  assert.equal(r.rolls, null, "no hay rolls en esta pantalla");
  assert.deepEqual(positivos(r), ["Electric", "Magazine Capacity"]);
});
