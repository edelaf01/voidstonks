/**
 * Recupera una palabra a la que el OCR le comió las PRIMERAS letras.
 *
 * Cuando el nombre de una pieza se pinta encima del arte claro (los chasis y sistemas de
 * warframe son blancos y dorados), la máscara por color se traga los primeros glifos:
 * "CHASSIS" se lee "ASSIS" y "BLUEPRINT" se lee "LUEPRINT". El daño es SIEMPRE por delante,
 * porque el arte queda a la izquierda del texto centrado.
 *
 * Esas lecturas no pasan el umbral de similitud normal —que compara la palabra ENTERA, y a la
 * leída le faltan letras— así que el token se tiraba. Y tirarlo no es neutro: sin "CHASSIS" en
 * la sopa, "Hildryn Prime Chassis Blueprint" queda como "Hildryn Prime Blueprint", que existe,
 * es otro ítem, y casa casi perfecto.
 *
 * Se compara por SIMILITUD contra la COLA del candidato, no por sufijo exacto: una lectura real
 * trae recorte Y confusión de glifos a la vez ("A55IS"), y un endsWith() solo cubre la primera.
 * La misma función de similitud que usa el resto del emparejador, inyectada, para que las
 * confusiones típicas del OCR (S/5, I/1, O/0) cuesten lo mismo aquí que allí.
 *
 * El vocabulario sale del catálogo vivo que se descarga con las reliquias, no de una lista
 * escrita a mano: cualquier ítem nuevo entra solo.
 */

export const MIN_CLIPPED_LEN = 5;
export const MAX_CLIPPED_CHARS = 2;
// Alto porque solo se compara la cola: acertar 5 de 5 letras es fácil de conseguir por azar
// entre miles de tokens, y una recuperación equivocada mete un ancla fantasma.
export const MIN_TAIL_SCORE = 0.9;
// Y además tiene que DESTACAR sobre el segundo: dos candidatos parecidos significa que la cola
// no identifica una palabra, y elegir el mejor por centésimas es adivinar.
export const MIN_LEAD = 0.08;

/**
 * @param text        palabra leída, en mayúsculas y sin puntuación
 * @param knownTokens vocabulario del catálogo (array o Set)
 * @param similarity  (a, b) => 0..1 — la misma del emparejador (consciente de confusiones OCR)
 * @returns el token completo, o null si no se puede afirmar cuál era
 */
export function recoverClippedToken(text, knownTokens, similarity) {
  if (typeof text !== "string" || text.length < MIN_CLIPPED_LEN) return null;
  if (typeof similarity !== "function") return null;
  if (!Array.isArray(knownTokens) && !(knownTokens instanceof Set)) return null;

  let mejor = null;
  let mejorScore = 0;
  let segundoScore = 0;

  for (const token of knownTokens) {
    if (typeof token !== "string") continue;
    const comidas = token.length - text.length;
    // Solo hacia delante y poco: más de dos letras ya no es un recorte, es otra palabra.
    if (comidas <= 0 || comidas > MAX_CLIPPED_CHARS) continue;

    // La cola del candidato, del mismo largo que lo leído: así la comparación mide únicamente
    // lo que el OCR SÍ vio, sin penalizar por las letras que se comió.
    const score = similarity(text, token.slice(comidas));
    if (score > mejorScore) {
      segundoScore = mejorScore;
      mejorScore = score;
      mejor = token;
    } else if (score > segundoScore) {
      segundoScore = score;
    }
  }

  if (!mejor || mejorScore < MIN_TAIL_SCORE) return null;
  if (mejorScore - segundoScore < MIN_LEAD) return null;
  return mejor;
}
