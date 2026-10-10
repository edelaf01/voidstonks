// El parser de cartas de riven: texto crudo de OCR → riven estructurado.
//
// Es el módulo del repo con más historia de bugs escrita en sus propios comentarios, y todos
// son del mismo tipo: el arte de la carta ensucia el texto y una regex que "parecía bien" se
// come el curse, inventa un stat o cambia el arma entre frames. Ninguno da error: sale una
// carta plausible con datos de otro riven.
//
// Aquí se fija cada uno de esos casos con el texto que los provocaba, escrito como lo escupe
// Tesseract. No hacen falta imágenes: el parser trabaja sobre cadenas.

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

// --- Normalización de ruido de Tesseract ----------------------------------------------------

test("las barras verticales que Tesseract confunde con I se enderezan", () => {
  assert.equal(S._normalize("|gnis"), "Ignis");
  assert.equal(S._normalize("BRAT0N   PRIME"), "BRAT0N PRIME");
});

test("la O suelta pegada a dígitos se lee como cero", () => {
  assert.equal(S._normalize("O"), "0");
  assert.equal(S._normalize("o5"), "05");
  assert.equal(S._normalize("5o"), "50");
});

// --- Emparejado de stats --------------------------------------------------------------------

test("un nombre de stat limpio se reconoce", () => {
  assert.equal(S._matchStat("Critical Damage"), "Crit Damage");
  assert.equal(S._matchStat("critical chance"), "Crit Chance");
});

test("basura sin parecido no se fuerza a ningún stat", () => {
  assert.equal(S._matchStat("qqq"), null);
  assert.equal(S._matchStat("xy"), null);
});

// El caso que documenta el código: cuando el OCR funde dos líneas, el stat correcto es el que
// EMPIEZA en la primera palabra. Sin anclar, "Zoom Ammo Maximum" resolvía a "Ammo Maximum" y el
// curse aparecía como positivo con el valor del Zoom.
test("una línea fundida se resuelve por la primera palabra, no por la última", () => {
  assert.equal(S._matchStatAnchored("Zoom Ammo Maximum"), "Zoom");
});

// "Weapon Recoil" no ancla porque el catálogo lo llama solo "Recoil": para eso está la tabla de
// alias. Sin ella, "Weapon Recoil Puncture" ganaba "Puncture Damage" por empate de una palabra.
test("Weapon Recoil se reconoce pese a que el catálogo lo llama solo Recoil", () => {
  assert.equal(S._matchStatAnchored("Weapon Recoil"), "Recoil");
  assert.equal(S._matchStatAnchored("Weapon Recoil Puncture"), "Recoil");
});

// El prefijo anclado MÁS LARGO gana: si no, "Damage to Grineer" se quedaría en "Damage".
test("el prefijo anclado más largo gana al más corto", () => {
  assert.equal(S._matchStatAnchored("Damage to Grineer"), "Damage to Grineer");
});

test("el valor de la línea siguiente corta el nombre", () => {
  assert.equal(S._matchStatAnchored("Damage 90 1 Status Chance"), "Damage");
  assert.equal(S._matchStatAnchored("Damage 90 1 Status Duration"), "Damage");
  assert.equal(S._matchStatAnchored("Weapon Recoil 90 1 Status Chance"), "Recoil");
  assert.equal(S._matchStatAnchored("Damage to Grineer"), "Damage to Grineer");
});

// --- Cartas completas -----------------------------------------------------------------------

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

// El contador de ciclos comparte línea con el MR y su glifo ↻ suele salir como un 0, suelto o
// pegado al número, así que se descarta y el número bueno es el primero que queda.
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

// El OCR pierde el punto decimal a menudo: "+82 2%" y "+822%" son el mismo +82.2 real. Ningún
// stat de riven llega a 822.
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

// El calificador condicional de arcos/escopetas se parte en líneas y, si sobrevive, MULT_RE lo
// lee como un stat multiplicador falso.
test('el "(x2 for Bows)" no se cuela como un stat', () => {
  const r = S.parseRivenCard([
    "Braton Cronidex",
    "+82.2% Fire Rate (x2 for",
    "Bows)",
    "+55.0% Multishot",
  ].join("\n"));
  assert.deepEqual(nombres(r).sort(), ["Fire Rate / Attack Speed", "Multishot"].sort());
});

// El daño por facción viene como multiplicador, no como porcentaje: x1.74 es +74% y x0.8 es -20%.
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

// El ruido del arte detrás del curse hacía que el regex no cerrara nunca y el curse se PERDÍA en
// casi todos los frames. La facción es la única palabra que sobrevive bien al OCR.
test("el curse de facción se lee aunque el arte deje basura detrás", () => {
  const r = S.parseRivenCard([
    "Braton Cronidex",
    "+120.5% Critical Damage",
    "+88.2% Multishot",
    "x0.7 Damage to Grineer A / N Om ye",
  ].join("\n"));
  assert.ok(nombres(r).includes("Damage to Grineer"), nombres(r).join(", "));
});

// El OCR también rompe la palabra "Grineer": GRJN, GR1N. Se casa la facción por patrón tolerante.
test("una facción mal leída sigue reconociéndose", () => {
  const r = S.parseRivenCard([
    "Braton Cronidex", "+120.5% Critical Damage", "+88.2% Multishot", "x0.8 Damage to GRJNEER",
  ].join("\n"));
  assert.ok(nombres(r).includes("Damage to Grineer"), nombres(r).join(", "));
});

// El recoil está invertido en la carta: el buff se muestra en negativo. Sin invertirlo, una carta
// legítima con recoil-buff + curse sumaba 2 negativos y la validación estructural la tiraba
// entera — el roll no aparecía nunca.
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

// Los elementales y Punch Through no existen como maldición: un menos ahí es error de lectura.
test("un elemental leído en negativo se corrige a positivo", () => {
  const r = S.parseRivenCard([
    "Braton Cronidex", "-90.0% Heat Damage", "+88.2% Multishot", "-45.0% Zoom",
  ].join("\n"));
  const heat = r.stats.find((s) => s.name.includes("Heat"));
  assert.equal(heat.isPositive, true);
});

// Una carta real nunca tiene 4 positivos: el curse es siempre la última línea, así que se
// recupera el signo ahí en vez de tirar la carta.
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

// Estructura imposible: cuatro positivos donde el último NO puede ser curse. Ahí no hay
// recuperación y devolver null es correcto — mejor nada que un riven inventado.
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

// Los valores diminutos son ruido del arte que casó por casualidad con un nombre de stat.
test("un valor imposiblemente bajo se descarta como ruido", () => {
  const r = S.parseRivenCard([
    "Braton Cronidex", "+120.5% Critical Damage", "+88.2% Multishot", "+3% Puncture Damage",
  ].join("\n"));
  assert.ok(!nombres(r).includes("Puncture"), nombres(r).join(", "));
});

// El nombre del riven se parte en dos líneas y la continuación queda MÁS cerca del bloque de
// stats; si se eligiera por cercanía, "ignido" casaría con Ignis y el arma bailaría entre frames.
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

test("el arma no sale del prefijo del nombre del riven aunque el OCR estropee la primera letra", () => {
  const antes = state.allRivenNames;
  state.allRivenNames = [...antes, "Haalvu"];
  try {
    const r = S.parseRivenCard(["Raalvu Igni-satiata", "+90.8% Damage", "+51.2% Multishot", "+55.4% Heat"].join("\n"));
    assert.equal(r.weaponName, "Haalvu", "Igni-satiata contiene \"ignis\" pero no es una palabra suelta");
    assert.equal(S._matchWeaponScored("Ignis Igni-satiata")?.name, "Ignis");
  } finally {
    state.allRivenNames = antes;
  }
});

// Antes de calcular la distancia se descartan los nombres cuya longitud ya la hace imposible:
// una línea basura de 40 letras se comparaba contra las ~650 armas en cada tick.
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

// El arte pega tokens espurios a la línea del nombre y las guardas antiguas (^\d, includes("%"))
// descartaban la línea entera, perdiendo el arma.
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

// --- Validación cruzada contra las tablas del juego -----------------------------------------

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

// La banda es ancha a propósito (la disposición suele ser un 1.0 de relleno): caza errores
// gordos —un decimal perdido dando 1000%— no la dispersión normal de un roll.
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

// --- Levenshtein ----------------------------------------------------------------------------

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
