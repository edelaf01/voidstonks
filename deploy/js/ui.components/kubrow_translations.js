/**
 * Warframe Kubrow data translations: internal asset codes (as they show in EE.log) to the names the game
 * shows.
 *
 * Source: raw wikitext of the official Warframe Wiki Lua modules, via ?action=raw:
 *   - https://wiki.warframe.com/index.php?title=Module:Cosmetics/data/pattern&action=raw
 *   - https://wiki.warframe.com/index.php?title=Module:Cosmetics/data/genemaskingkit&action=raw
 *
 * No invented mappings: a code missing from the table shows raw instead of a guessed name.
 */

// KubrowPetPattern<X> -> fur pattern name. Full InternalName =
// /Lotus/Types/Game/KubrowPet/Patterns/KubrowPetPattern<X>
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

// KubrowPetColor<X> -> color name. Full InternalName = /Lotus/Types/Game/KubrowPet/Colors/KubrowPetColor<X>
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

// intensity suffix -> readable tier. Mundane/Mid/Vibrant are saturation levels of the same base color (the
// letter), not color names
export const KUBROW_COLOR_TIERS = {
  Mundane: { es: 'Apagado', en: 'Mundane' },
  Mid: { es: 'Medio', en: 'Mid' },
  Vibrant: { es: 'Vibrante', en: 'Vibrant' },
  Accent: { es: 'Acento', en: 'Accent' },
};

// color rarity tiers from the community Kubrow Pricing Guide & Colour Chart (Warframe Kubrow & Kavat Breeders
// discord), by intensity:
//   Mundane<letter> -> Common    (MundaneA = Ash Grey)
//   Mid<letter>     -> Uncommon  (MidE = Void Black)
//   Vibrant<letter> -> Rare      (VibrantD = Sargas Brown/Gold)
// Colors outside that genetics (events, Prime, Contest, special breeds) are not in the chart, which says
// "special themed" sell higher, so they are Very Rare.
// SOURCE: https://docs.google.com/spreadsheets/d/1AYotnmwCnnFzbQnyyJ0_XMxDDiaahgHvcC27UIa_RLM
// `color` reuses the app rarity palette (--wf-common / --wf-uncommon / --wf-rare / --wf-riven in styles.css)
export const KUBROW_RARITY_LEVELS = {
  0: { es: 'Común', en: 'Common', color: '#cd7f32' }, // --wf-common (bronze)
  1: { es: 'Poco común', en: 'Uncommon', color: '#c0c0c0' }, // --wf-uncommon (silver)
  2: { es: 'Raro', en: 'Rare', color: '#e6c200' }, // --wf-rare (gold)
  3: { es: 'Muy raro', en: 'Very Rare', color: '#a235e2' }, // --wf-riven (purple)
};

// code segment -> rarity tier, in order, first match wins
const RARITY_RULES = [
  // themed / limited / Prime: outside the chart's standard genetics
  { test: /(Prime|Contest|Xmas|Solstice|Daybreak|DuviriWolf|Cephalon|Drahk|Feral|Diamond|Liquid)/i, level: 3 },
  // standard genetics in the chart (Mundane/Mid/Vibrant + letter)
  { test: /Vibrant/i, level: 2 }, // Rare
  { test: /Mid/i, level: 1 }, // Uncommon
  { test: /Mundane/i, level: 0 }, // Common
];

/**
 * Rarity tier (0-3) of a kubrow color code from the community colour chart; codes no rule matches (Kavat
 * base palettes) are Common (0).
 */
export const getColorRarityLevel = (colorCode) => {
  if (!colorCode) return 0;
  for (const rule of RARITY_RULES) {
    if (rule.test.test(colorCode)) return rule.level;
  }
  return 0;
};

// reverse index real name -> rarity tier, for colors the image extractor returns by name ("Void Black")
export const KUBROW_COLOR_RARITY_BY_NAME = {};
for (const [code, name] of Object.entries(KUBROW_COLORS)) {
  KUBROW_COLOR_RARITY_BY_NAME[name] = getColorRarityLevel(code);
}

/**
 * Translates a pattern code as it shows in EE.log ("KubrowPetPatternC") to the name the game shows. Codes
 * missing from the verified table come back raw, never guessed.
 */
export const translatePattern = (patternCode, lang = 'es') => {
  if (!patternCode) return lang === 'es' ? 'Desconocido' : 'Unknown';
  const entry = KUBROW_PATTERNS[patternCode];
  if (entry) return entry[lang];
  return patternCode;
};

/** Translates a color code ("KubrowPetColorDrahkMid") to its real name; raw code without a verified match. */
export const translateColor = (colorCode) => {
  if (!colorCode) return null;
  return KUBROW_COLORS[colorCode] || colorCode;
};

/** Translates the intensity suffix of a color code, if any: "KubrowPetColorDrahkMid" -> "Mid" -> "Medio". */
export const translateColorTier = (colorCode, lang = 'es') => {
  if (!colorCode) return null;
  for (const tier of Object.keys(KUBROW_COLOR_TIERS)) {
    if (colorCode.endsWith(tier)) return KUBROW_COLOR_TIERS[tier][lang];
  }
  return null;
};

/**
 * Rarity tier (0-3) of a color by real name ("Void Black") or internal code ("KubrowPetColorVibrantG");
 * Common (0) as fallback.
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
