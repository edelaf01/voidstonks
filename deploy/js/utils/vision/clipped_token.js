// recovers words whose first letters were clipped by OCR against catalog vocabulary

export const MIN_CLIPPED_LEN = 5;
export const MAX_CLIPPED_CHARS = 2;
// high because only the tail is compared, and a wrong recovery adds a ghost anchor
export const MIN_TAIL_SCORE = 0.9;
export const MIN_LEAD = 0.08;

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
    if (comidas <= 0 || comidas > MAX_CLIPPED_CHARS) continue;

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
