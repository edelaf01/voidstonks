/**
 * Colores de texto de los temas de la UI de Warframe (el "Secondary highlight" con el que
 * dibuja los nombres de los objetos). Copian los de WFInfo.
 *
 * Aparte de vision.service.js para poder importarlos sin DOM: ese módulo crea canvases al
 * cargarse. Se reexporta desde allí porque medio escáner los pide de ahí.
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
    // Tema por defecto moderno de Warframe (naranja/dorado brillante). El catálogo
    // solo tenía el "Orokin" apagado (178,125,5), que queda a >tolerancia del naranja
    // real de la UI actual (~227,128,20) → detección con weight 0. Medido de captura real.
    { name: "Default", r: 227, g: 128, b: 20 },
    { name: "Tenno", r: 6, g: 106, b: 74 },
    { name: "High Contrast", r: 255, g: 255, b: 0 },
    // Los siete que faltaban, de la misma tabla de WFInfo. No es exhaustividad por gusto: la
    // máscara marca un píxel si coincide con ALGÚN tema, así que un tema ausente no es un caso
    // peor sino un caso IMPOSIBLE — con el blanco puro fuera de la lista, el rótulo de ese tema
    // daba cero tinta a cualquier brillo. Deadlock es el blanco.
    { name: "Equinox", r: 232, g: 227, b: 227 },
    { name: "Dark Lotus", r: 200, g: 169, b: 237 },
    { name: "Zephyr", r: 255, g: 53, b: 0 },
    { name: "Conquera", r: 255, g: 215, b: 0 },
    { name: "Deadlock", r: 255, g: 255, b: 255 },
    { name: "Lunar Renewal", r: 255, g: 200, b: 100 },
    { name: "Pom 2", r: 100, g: 255, b: 100 },
];

/**
 * Los temas que pueden GANAR una votación de "¿de qué color es el texto de esta pantalla?".
 *
 * Los votantes eligen el tema más cercano a cada píxel brillante y pesan por distancia, así que
 * un tema ACROMÁTICO gana con cualquier blanco o gris de la interfaz —iconos, bordes, brillos
 * del arte— que no tiene nada que ver con el color del texto. Con el blanco puro (Deadlock) en
 * la lista, el escáner de inventario pasó a "detectar" ese tema con un peso enorme y dejó de
 * encontrar los nombres: los píxeles blancos de la UI se llevaban la votación entera.
 *
 * Para ENMASCARAR texto sí hacen falta todos (`WF_THEMES`): ahí la pregunta es "¿este píxel es
 * del color del tema?" y va acompañada de un test de contraste con la vecindad, que es quien
 * descarta el fondo. Votar y enmascarar son preguntas distintas y no admiten la misma lista.
 */
const SATURACION_MIN = 0.12;
export const WF_THEMES_VOTABLES = WF_THEMES.filter((t) => {
    const max = Math.max(t.r, t.g, t.b), min = Math.min(t.r, t.g, t.b);
    return max > 0 && (max - min) / max >= SATURACION_MIN;
});

