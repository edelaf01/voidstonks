/**
 * Warframe Kubrow data translations
 * Mapea códigos internos de assets (los que aparecen tal cual en el EE.log) a los
 * nombres reales que el juego muestra al jugador.
 *
 * FUENTE: wikitext crudo de los módulos Lua del Warframe Wiki oficial (que reflejan
 * el Public Export real del juego), descargado vía ?action=raw:
 *   - https://wiki.warframe.com/index.php?title=Module:Cosmetics/data/pattern&action=raw
 *   - https://wiki.warframe.com/index.php?title=Module:Cosmetics/data/genemaskingkit&action=raw
 *
 * Todo lo que sigue son datos verificados contra esas fuentes. NO se inventan
 * mapeos: si un código no está en la tabla, se muestra el código crudo en vez de
 * adivinar un nombre (ver fallback en translatePattern/translateColor más abajo).
 */

// KubrowPetPattern<X> -> nombre real del patrón de pelaje.
// InternalName completo = /Lotus/Types/Game/KubrowPet/Patterns/KubrowPetPattern<X>
export const KUBROW_PATTERNS = {
  KubrowPetPatternA: { es: 'Patrón de Pelaje Rayado', en: 'Striped Fur Pattern' },
  KubrowPetPatternB: { es: 'Patrón de Pelaje Manchado', en: 'Patchy Fur Pattern' },
  KubrowPetPatternC: { es: 'Patrón de Pelaje Hound', en: 'Hound Fur Pattern' },
  KubrowPetPatternD: { es: 'Patrón de Pelaje Domino', en: 'Domino Fur Pattern' },
  KubrowPetPatternE: { es: 'Patrón de Pelaje Merle', en: 'Merle Fur Pattern' },
  KubrowPetPatternF: { es: 'Patrón de Pelaje Lotus', en: 'Lotus Fur Pattern' },
  KubrowPetPatternG: { es: 'Patrón de Pelaje Jaspeado', en: 'Mottled Fur Pattern' },
  KubrowPetPatternH: { es: 'Patrón de Pelaje Brindle', en: 'Brindle Fur Pattern' },
  KubrowPetPatternI: { es: 'Patrón de Pelaje Tigrol', en: 'Tigrol Fur Pattern' },
  KubrowPetPatternDiamond: { es: 'Patrón de Pelaje Atrox', en: 'Atrox Fur Pattern' },
  KubrowPetPatternLiquid: { es: 'Patrón de Pelaje Arklut', en: 'Arklut Fur Pattern' },
  KubrowPetPatternXmasA: { es: 'Patrón Nart-Deer', en: 'Nart-Deer Pattern' },
  KubrowPetPatternXmasB: { es: 'Patrón Nistlebrush', en: 'Nistlebrush Pattern' },
  KubrowPetPatternXmasC: { es: 'Patrón Nariz Carmesí', en: 'Crimson Nose Pattern' },
  FeralKubrowPattern: { es: 'Patrón Kubrow Salvaje', en: 'Underbrush Kubrow Pattern' },
  DrahkKubrowPattern: { es: 'Patrón Kubrow Drahk', en: 'Drahk Kubrow Pattern' },
  KubrowPetPatternPrimeA: { es: 'Patrón de Pelaje Kavasa Prime', en: 'Kavasa Prime Fur Pattern' },
  KubrowPetPatternPrimeTraderA: { es: 'Patrón de Pelaje Nexus', en: 'Nexus Fur Pattern' },
  KubrowPetPatternCephalon: { es: 'Patrón de Pelaje Neura', en: 'Neura Fur Pattern' },
  KubrowPetPatternDuviriWolf: { es: 'Patrón de Pelaje Fabled Kubrow', en: 'Fabled Kubrow Fur Pattern' },
  KubrowPetPatternInfested: { es: 'Patrón Helminth', en: 'Helminth Pattern' },
  HelminthPetPatternClassic: { es: 'Patrón Helminth Degenerado', en: 'Helminth Degenerate Pattern' },
  WukongPrimeKubrowPattern: { es: 'Patrón de Pelaje Tang Prime', en: 'Tang Prime Kubrow Fur Pattern' },
  KubrowPetPatternHelminthDeluxe: { es: 'Piel Helminth Charger Metus', en: 'Helminth Charger Metus Skin' },
};

// KubrowPetColor<X> -> nombre real del color. InternalName completo =
// /Lotus/Types/Game/KubrowPet/Colors/KubrowPetColor<X>
export const KUBROW_COLORS = {
  KubrowPetColorVibrantG: 'Alad Blue',
  KubrowPetColorVibrantB: 'Ambulas Black',
  KubrowPetColorVibrantA: 'Anyo Grey',
  KubrowPetColorMundaneI: 'Arid Brown',
  KubrowPetColorMundaneA: 'Ash Grey',
  KubrowPetColorSolsticeMundane: 'Bombard White',
  KubrowPetColorXmasVibrantA: 'Brokk Brown',
  KubrowPetColorMidContest: 'Condroc Brown',
  KubrowPetColorDuviriWolfMid: 'Conspirator Green',
  KubrowPetColorMundaneC: 'Corpus Grey',
  KubrowColorWukongPrimeMundane: 'Corrupted Gold',
  KubrowPetColorDuviriWolfMundane: 'Courtier Red',
  KubrowPetColorCephalonVibrant: 'Crewman Grey',
  KubrowPetColorMidF: 'Darvo Blue',
  KubrowPetColorMidB: 'Derelict Black',
  KubrowColorWukongPrimeVibrant: 'Derelict White',
  KubrowPetColorDaybreakMundane: 'Dusk Pink',
  KubrowPetColorMundaneB: 'Earth Brown',
  KubrowPetColorMidI: 'Eris Black',
  KubrowPetColorDaybreakMid: 'Evening Purple',
  KubrowPetColorKavatBase: 'Executioner Grey',
  KubrowPetColorMidLiquid: 'Fomorian Grey',
  KubrowPetColorMundaneJ: 'Forest Grey',
  KubrowPetColorMundaneF: 'Gallium Grey',
  KubrowPetColorMundaneG: 'Grustrag Grey',
  KubrowPetColorDuviriWolfVibrant: 'Harbinger Red',
  KubrowPetColorMundaneD: 'Hek Green',
  KubrowPetColorKavatSecondary: 'Hyacinth Blue',
  KubrowPetColorFeralVibrant: 'Inaros Brown',
  KubrowPetColorMidD: 'Infested Black',
  KubrowPetColorXmasMidB: 'Jadeleaf Green',
  KubrowPetColorVibrantE: 'Jupiter Brown',
  KubrowPetColorPrimeA: 'Kavasa White',
  KubrowPetColorMundaneDiamond: "Ki'Teer Grey",
  KubrowPetColorMundaneE: 'Kril Brown',
  KubrowPetColorCephalonMid: 'Liset Grey',
  KubrowPetColorVibrantI: 'Lotus Purple',
  KubrowPetColorXmasMidA: 'Lotus White',
  KubrowPetColorFeralMid: 'Maggot Pink',
  KubrowPetColorSolsticeVibrant: 'Manic Black',
  KubrowPetColorMidC: 'Mars Red',
  KubrowPetColorMidH: 'Mercury Brown',
  KubrowPetColorDrahkVibrant: 'Mirage Purple',
  KubrowPetColorVibrantK: 'Mirage Red',
  KubrowPetColorCephalonMundane: 'Mirage White',
  KubrowPetColorDaybreakVibrant: 'Morning Yellow',
  KubrowPetColorMundaneContest: 'Mud Puddle Brown',
  KubrowPetColorMidJ: 'Nova Grey',
  KubrowPetColorXmasMundaneB: 'Nova White',
  KubrowPetColorMidG: 'Ordis Grey',
  KubrowPetColorPrimeD: 'Origin Brown',
  KubrowPetColorPrimeC: 'Orokin Gold',
  KubrowPetColorDrahkMid: 'Osprey Blue',
  KubrowPetColorVibrantContest: 'Ostron Brown',
  KubrowPetColorPrimeTraderMidA: 'Perrin Blue',
  KubrowPetColorMundaneK: 'Phobos Brown',
  KubrowPetColorVibrantF: 'Phorid Red',
  KubrowPetColorDuviriWolfAccent: 'Princely Gold',
  KubrowPetColorPrimeTraderVibrantA: 'Rakta Red',
  KubrowPetColorKavatTertiary: 'Regor Green',
  KubrowPetColorMidK: 'Rhino Brown',
  KubrowPetColorDrahkMundane: 'Rubedo Red',
  KubrowPetColorVibrantD: 'Sargas Brown',
  KubrowPetColorMundaneH: 'Saturn Brown',
  KubrowPetColorMidA: 'Sedna Grey',
  KubrowPetColorVibrantC: 'Shadow Grey',
  KubrowPetColorFeralMundane: 'Singularity Black',
  KubrowPetColorMundaneLiquid: 'Specter White',
  KubrowPetColorMidDiamond: 'Star White',
  KubrowPetColorXmasMundaneA: 'Tenno Red',
  KubrowColorWukongPrimeMid: 'Tidal Blue',
  KubrowPetColorXmasVibrantB: 'Trinity Red',
  KubrowPetColorVibrantJ: 'Valkyr Brown',
  KubrowPetColorVibrantLiquid: 'Vandal Blue',
  KubrowPetColorPrimeTraderMundaneA: 'Vaykor White',
  KubrowPetColorVibrantH: 'Venus Brown',
  KubrowPetColorMidE: 'Void Black',
  KubrowPetColorSolsticeMid: 'Wukong Blue',
  KubrowPetColorVibrantDiamond: 'Wyrm Blue',
};

// Sufijo de intensidad -> nivel legible. Confirmado: Mundane/Mid/Vibrant son niveles
// de saturación del mismo color base (la letra), no nombres de color en sí mismos.
export const KUBROW_COLOR_TIERS = {
  Mundane: { es: 'Apagado', en: 'Mundane' },
  Mid: { es: 'Medio', en: 'Mid' },
  Vibrant: { es: 'Vibrante', en: 'Vibrant' },
  Accent: { es: 'Acento', en: 'Accent' },
};

// Niveles de rareza de color según la Kubrow Pricing Guide & Colour Chart de la
// comunidad (Warframe Kubrow & Kavat Breeders discord). El chart clasifica los
// colores de la genética estándar en tres grados por su intensidad:
//   Mundane<letra> -> Común    (p.ej. MundaneA = Ash Grey)
//   Mid<letra>     -> Poco común (p.ej. MidE = Void Black)
//   Vibrant<letra> -> Raro      (p.ej. VibrantD = Sargas Brown/Gold)
// Los colores fuera de esa genética (eventos, Prime, Contest, razas especiales)
// no están tabulados en el chart pero el propio chart señala que los "special
// themed" se venden por más, así que los marcamos como Muy raro.
// FUENTE: https://docs.google.com/spreadsheets/d/1AYotnmwCnnFzbQnyyJ0_XMxDDiaahgHvcC27UIa_RLM
// Los `color` reutilizan la paleta de rarezas de la app (variables --wf-common /
// --wf-uncommon / --wf-rare / --wf-riven de styles.css) para que la ventana de
// kubrow combine con reliquias, sets y rivens.
export const KUBROW_RARITY_LEVELS = {
  0: { es: 'Común', en: 'Common', color: '#cd7f32' }, // --wf-common (bronce)
  1: { es: 'Poco común', en: 'Uncommon', color: '#c0c0c0' }, // --wf-uncommon (plata)
  2: { es: 'Raro', en: 'Rare', color: '#e6c200' }, // --wf-rare (oro)
  3: { es: 'Muy raro', en: 'Very Rare', color: '#a235e2' }, // --wf-riven (púrpura)
};

// Reglas de segmento de código -> nivel de rareza. Se evalúan en orden; la primera
// que coincida gana. Los tres primeros grados salen tal cual del colour chart de la
// comunidad; el resto (temáticos/Prime) se marca como Muy raro porque no está en el
// chart y el chart indica que esos se venden por encima.
const RARITY_RULES = [
  // Temáticos / limitados / Prime: fuera de la genética estándar del chart.
  { test: /(Prime|Contest|Xmas|Solstice|Daybreak|DuviriWolf|Cephalon|Drahk|Feral|Diamond|Liquid)/i, level: 3 },
  // Genética estándar tabulada en el chart (Mundane/Mid/Vibrant + letra).
  { test: /Vibrant/i, level: 2 }, // Rare
  { test: /Mid/i, level: 1 }, // Uncommon
  { test: /Mundane/i, level: 0 }, // Common
];

/**
 * Devuelve el nivel de rareza (0-3) de un código de color de kubrow según el
 * colour chart de la comunidad. Si el código no encaja en ninguna regla conocida
 * (p.ej. paletas Kavat base) se asume Común (0).
 */
export const getColorRarityLevel = (colorCode) => {
  if (!colorCode) return 0;
  for (const rule of RARITY_RULES) {
    if (rule.test.test(colorCode)) return rule.level;
  }
  return 0;
};

// Índice inverso nombre-real -> nivel de rareza, para clasificar los colores que el
// extractor de imagen devuelve como nombre ("Void Black") en vez de código interno.
export const KUBROW_COLOR_RARITY_BY_NAME = {};
for (const [code, name] of Object.entries(KUBROW_COLORS)) {
  KUBROW_COLOR_RARITY_BY_NAME[name] = getColorRarityLevel(code);
}

/**
 * Traduce un código de patrón (tal como aparece en el EE.log, ej. "KubrowPetPatternC")
 * al nombre real que el juego muestra. Si no está en la tabla verificada, devuelve el
 * código crudo — nunca se inventa un nombre plausible.
 */
export const translatePattern = (patternCode, lang = 'es') => {
  if (!patternCode) return lang === 'es' ? 'Desconocido' : 'Unknown';
  const entry = KUBROW_PATTERNS[patternCode];
  if (entry) return entry[lang];
  return patternCode; // sin match verificado: se muestra el código crudo, no una adivinanza
};

/**
 * Traduce un código de color (ej. "KubrowPetColorDrahkMid") al nombre real.
 * Igual que translatePattern: sin match verificado, devuelve el código crudo.
 */
export const translateColor = (colorCode) => {
  if (!colorCode) return null;
  return KUBROW_COLORS[colorCode] || colorCode;
};

/**
 * Traduce el sufijo de intensidad de un código de color, si lo tiene.
 * Ej. "KubrowPetColorDrahkMid" -> "Mid" -> "Medio"
 */
export const translateColorTier = (colorCode, lang = 'es') => {
  if (!colorCode) return null;
  for (const tier of Object.keys(KUBROW_COLOR_TIERS)) {
    if (colorCode.endsWith(tier)) return KUBROW_COLOR_TIERS[tier][lang];
  }
  return null;
};

/**
 * Devuelve el nivel de rareza (0-3) de un color dado por nombre real ("Void Black")
 * o por código interno ("KubrowPetColorVibrantG"). Fallback a Común (0).
 */
export const getColorRarity = (colorNameOrCode) => {
  if (!colorNameOrCode) return 0;
  if (colorNameOrCode in KUBROW_COLOR_RARITY_BY_NAME) {
    return KUBROW_COLOR_RARITY_BY_NAME[colorNameOrCode];
  }
  return getColorRarityLevel(colorNameOrCode);
};

export default {
  translatePattern,
  translateColor,
  translateColorTier,
  getColorRarity,
  getColorRarityLevel,
  KUBROW_PATTERNS,
  KUBROW_COLORS,
  KUBROW_COLOR_TIERS,
  KUBROW_RARITY_LEVELS,
  KUBROW_COLOR_RARITY_BY_NAME,
};
