/**
 * Text colors of the Warframe UI themes (the "Secondary highlight" item names are drawn with), taken from
 * WFInfo. Apart from vision.service.js so they can be imported without DOM: that module creates canvases on
 * load.
 */
export const WF_THEMES = [
    { name: "Legacy", r: 232, g: 213, b: 93 },
    { name: "Vitruvian", r: 245, g: 227, b: 173 },
    { name: "Stalker", r: 255, g: 61, b: 51 },
    { name: "Baruuk", r: 236, g: 211, b: 162 },
    { name: "Corpus", r: 111, g: 229, b: 253 },
    { name: "Fortuna", r: 255, g: 115, b: 230 },
    { name: "Grineer", r: 255, g: 224, b: 153 },
    { name: "Lotus", r: 255, g: 241, b: 191 },
    { name: "Nidus", r: 245, g: 73, b: 93 },
    { name: "Orokin", r: 178, g: 125, b: 5 },
    // modern default theme (bright orange)
    { name: "Default", r: 227, g: 128, b: 20 },
    { name: "Tenno", r: 6, g: 106, b: 74 },
    { name: "High Contrast", r: 255, g: 255, b: 0 },
    // every theme is needed: the mask marks a pixel when it matches ANY theme, so a missing one gives zero ink at
    // any brightness. Deadlock is the white one
    { name: "Equinox", r: 232, g: 227, b: 227 },
    { name: "Dark Lotus", r: 200, g: 169, b: 237 },
    { name: "Zephyr", r: 255, g: 53, b: 0 },
    { name: "Conquera", r: 255, g: 215, b: 0 },
    { name: "Deadlock", r: 255, g: 255, b: 255 },
    { name: "Lunar Renewal", r: 255, g: 200, b: 100 },
    { name: "Pom 2", r: 100, g: 255, b: 100 },
];

/**
 * Themes that can WIN a "what color is this screen's text?" vote. Voters pick the closest theme to each
 * bright pixel, so an ACHROMATIC theme wins with any white or gray of the UI (icons, borders, art glows)
 * that has nothing to do with the text color.
 *
 * MASKING text does need all of them (`WF_THEMES`): there the question is "is this pixel the theme color?"
 * and it comes with a contrast test against the neighbourhood that drops the background.
 */
const SATURACION_MIN = 0.12;
export const WF_THEMES_VOTABLES = WF_THEMES.filter((t) => {
    const max = Math.max(t.r, t.g, t.b), min = Math.min(t.r, t.g, t.b);
    return max > 0 && (max - min) / max >= SATURACION_MIN;
});

