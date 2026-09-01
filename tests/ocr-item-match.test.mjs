import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ocr.service.js importa vision.service.js, que crea canvases con `document`
// al cargar el módulo. Stub mínimo ANTES del import dinámico (mismo motivo por
// el que pure-logic.test.mjs está roto en Node: aquí lo esquivamos).
globalThis.document ??= { createElement: () => ({ getContext: () => null }) };

const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");

// DB mínima con la estructura real de state.itemsDatabase (nombre -> [{ducats}]).
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
  // Los mods Requiem están en itemsDatabase porque son recompensa de reliquia: son los
  // ÚNICOS ítems de una sola palabra corta y por eso los que más basura atraen.
  "Jahu": [{ ducats: 0 }],
  "Khra": [{ ducats: 0 }],
  // "Forma Blueprint" es el otro ítem sin respaldo: BLUEPRINT es opcional detrás de FORMA.
  "Forma Blueprint": [{ ducats: 0 }],
};

beforeEach(() => {
  // initMatcherData memoiza en cachedDbItems: reconstruimos desde la DB mock.
  OCRService.cachedDbItems = [];
  OCRService.initMatcherData();
});

// ===========================================================================
// getValidItemMatch: degradaciones de "LIMB" recuperables por similitud OCR.
// El matcher GENÉRICO (similarityOCR, sin normalizadores por-componente) recupera
// las degradaciones con parecido razonable; las MUY recortadas (LY, UMB…) ya no
// son su trabajo → las rescata PaddleOCR (ver test de lecturas salvajes abajo).
// ===========================================================================

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

// ===========================================================================
// Confusiones de letra en temas de bajo contraste (nebulosa): ASH→ASN, AFURIS→ATUIS.
// El binarizado sale limpio; es el matcher quien debe tolerar la confusión.
// ===========================================================================

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
  // "ASN" solo debe resolver a Ash si las PARTES casan; texto suelto no.
  assert.equal(OCRService.getValidItemMatch("ASN PRIME"), null);
});

// ===========================================================================
// Desambiguación por CALIDAD (no por orden de BD): armas con subcadenas vecinas.
// "BOLTOR" no debe caer en "Akbolto" (que lo captura vía includes("BOLTO")):
// gana el de mayor similitud de primera palabra. Genérico, sin hardcodear.
// ===========================================================================

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

// ===========================================================================
// Componentes de warframe: el item MÁS ESPECÍFICO gana. "Harrow Blueprint" (2
// palabras) NO debe fusionar "CHASSIS BLUEPRINT" y robarle el match a
// "Harrow Chassis Blueprint" (3 palabras). Genérico, por nº de componentes.
// ===========================================================================

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

// "BLADES" (plural OCR) NO debe caer en BLUEPRINT por el prefijo "BLA": Venka Blade
// se identificaba como Venka Blueprint → duplicado y un ítem menos en el inventario.
test("ocr.service: 'VENKA PRIME BLADES' -> Blade (no Blueprint)", () => {
  assert.equal(OCRService.getValidItemMatch("VENKA PRIME BLADES")?.originalName, "Venka Prime Blade");
});

test("ocr.service: 'VENKA PRIME BLUEPRINT' sigue -> Blueprint", () => {
  assert.equal(OCRService.getValidItemMatch("VENKA PRIME BLUEPRINT")?.originalName, "Venka Prime Blueprint");
});

// ===========================================================================
// Lecturas degradadas reales (Stalker) que el matcher GENÉRICO recupera por
// similitud consciente de OCR — SIN un solo alias por-arma hardcodeado.
// ===========================================================================

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
    // Sin "PRIME" ya NO casa: "Akbolto Blueprint" es una pieza que existe de verdad en el
    // juego, y aceptarla como la prime apuntaba en el inventario algo que no cayó. Se pierde
    // recuperar un rótulo al que el OCR se comió "PRIME" entero; a cambio no se inventan
    // piezas. En un alta automática el falso positivo es peor, y el consenso multi-frame
    // recupera la lectura buena en otro frame.
    { ocr: "AKBOLTO BLUEPRINT", expected: undefined },
    { ocr: "AKBOLTO PRIME BLUEPRINT", expected: "Akbolto Prime Blueprint" },
  ];

  for (const { ocr, expected } of liveScanTests) {
    const m = OCRService.getValidItemMatch(ocr);
    assert.equal(m?.originalName, expected, `fallo con OCR raw: "${ocr}" -> esperado: ${expected}, obtenido: ${m?.originalName}`);
  }
});

// Lecturas SALVAJES (basura sin parecido real al nombre): el matcher genérico NO las
// inventa (devuelve null) — se rescatan con el OCR preciso de PaddleOCR, no con alias
// memorizados. Documentado como territorio-Paddle, no como fallo del matcher.
test("ocr.service: lecturas salvajes devuelven null (territorio Paddle, sin alias memorizados)", () => {
  for (const ocr of ["ABSSRONDOIGFINE LINK", "ROLO SLUEFRINT", "BALLISTICA PRIME UPPER LY"]) {
    assert.equal(OCRService.getValidItemMatch(ocr), null, `"${ocr}" no debería inventarse un match`);
  }
});

// Un ítem de UNA palabra no tiene componente detrás que confirme el match, así que la
// primera palabra es toda la prueba y el listón sube. Caso real: la celda de "Axi D2 Relic"
// salió ilegible (el arte de la reliquia cae sobre el texto) y un fragmento de 3 letras se
// apuntó como "Jahu" en el inventario de primes.
test("ocr.service: un fragmento de basura NO se convierte en un ítem de una sola palabra", () => {
  for (const ocr of ["JAH", "AHU", "KHR", "HRA", "N + I.) - AH"]) {
    assert.equal(OCRService.getValidItemMatch(ocr), null, `"${ocr}" no debería inventar un mod Requiem`);
  }
});

test("ocr.service: un mod Requiem bien leído (o con confusión de glifo) sí matchea", () => {
  assert.equal(OCRService.getValidItemMatch("JAHU")?.originalName, "Jahu");
  assert.equal(OCRService.getValidItemMatch("JAHV")?.originalName, "Jahu"); // U/V misma silueta
  assert.equal(OCRService.getValidItemMatch("JA HU")?.originalName, "Jahu"); // palabra partida por el OCR
});

// Mismo agujero que "Jahu" pero con un ítem de DOS palabras: BLUEPRINT es opcional detrás
// de FORMA, así que el match se sostenía solo con algo parecido a "FORMA". Caso real: una
// celda de reliquia ilegible se apuntó como "Forma Blueprint" en el inventario.
test("ocr.service: 'Forma Blueprint' sin BLUEPRINT exige una primera palabra sólida", () => {
  assert.equal(OCRService.getValidItemMatch("FORMA BLUEPRINT")?.originalName, "Forma Blueprint");
  assert.equal(OCRService.getValidItemMatch("FORMA")?.originalName, "Forma Blueprint");
  assert.equal(OCRService.getValidItemMatch("F0RMA")?.originalName, "Forma Blueprint"); // O/0
  assert.equal(OCRService.getValidItemMatch("PORMA")?.originalName, "Forma Blueprint"); // P/F
  // Recortes y fragmentos ya no bastan sin el BLUEPRINT que los respalde.
  for (const ocr of ["FORM", "ORMA", "FOMA", "FORA"]) {
    assert.equal(OCRService.getValidItemMatch(ocr), null, `"${ocr}" no debería dar Forma Blueprint`);
  }
  // Con BLUEPRINT detrás sí, porque el componente corrobora el conjunto.
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

// El 6 de la fuente del juego es casi un bucle cerrado y al binarizar sale como "O":
// "Axi C6 Relic" -> "AXI CO RELIC" (visto en vivo, la celda quedaba UNMATCHED).
// Un dígito perdido y leído como "O" es AMBIGUO y no debe adivinarse. Este test afirmaba
// antes lo contrario ("AXI CO" -> Axi C6) apoyándose en un catálogo reducido SIN el C9
// rival; con el catálogo real conviven C6 y C9. La evidencia en vivo lo zanjó: "Axi S9"
// salió como "AXI SO" y el emparejamiento O≈6 la contaba como Axi S6 — una reliquia que el
// jugador no tiene. Contar mal es peor que no contar, así que O ya no equivale a 6 y la
// lectura ambigua se queda sin match.
test("ocr.service: un dígito leído como O es ambiguo y NO se adivina", () => {
  OCRService._relicIndexCache = null;
  state.allRelicNames = ["Axi C5", "Axi C6", "Axi C7", "Axi C9", "Axi C10", "Axi D6"];
  assert.equal(OCRService.getRelicMatch("AXI CO RELIC"), null);
  OCRService._relicIndexCache = null;
  state.allRelicNames = ["Axi S6", "Axi S9", "Axi S10"];
  assert.equal(OCRService.getRelicMatch("AXI SO RELIC"), null,
    "S9 leído 'SO' no puede contarse como S6");

  // Las confusiones REALES de forma siguen intactas: G↔6 y L↔1 no son ambiguas.
  OCRService._relicIndexCache = null;
  state.allRelicNames = ["Axi S6", "Axi S9", "Axi E1"];
  assert.equal(OCRService.getRelicMatch("AXI SG RELIC"), "Axi S6");
  assert.equal(OCRService.getRelicMatch("AXI EL RELIC"), "Axi E1");
  OCRService._relicIndexCache = null;
});

// Un glifo de más DENTRO del código (ruido del arte pegado al texto): "Axi O5" salió como
// "AXI OO5" y se quedaba en 0.67 contra O5, bajo el corte → UNMATCHED.
test("ocr.service: un glifo espurio dentro del código no tumba el match", () => {
  OCRService._relicIndexCache = null;
  state.allRelicNames = ["Axi O1", "Axi O5", "Axi O6", "Axi C5", "Axi A1", "Axi A4", "Axi A14"];

  assert.equal(OCRService.getRelicMatch("AXI OO5 RELIC"), "Axi O5");
  // Pero borrar el glifo es la ÚLTIMA opción: si esa letra es un dígito mal leído, el mapa
  // de confusiones tiene que ganar — "AL"+"4" es A14 (L≈1), no A4 (borrando la L) ni A1.
  assert.equal(OCRService.getRelicMatch(["AX", "AL", "4", "RELIC"]), "Axi A14");
  OCRService._relicIndexCache = null;
});

