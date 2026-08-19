/**
 * Recovers a word whose FIRST letters the OCR ate. When a part name is drawn over light art (warframe
 * chassis and systems are white and gold), the color mask swallows the first glyphs: "CHASSIS" reads "ASSIS"
 * and "BLUEPRINT" reads "LUEPRINT". The damage is ALWAYS at the front, because the art sits left of the
 * centered text. Dropping the token is not neutral: without "CHASSIS", "Hildryn Prime Chassis Blueprint"
 * becomes "Hildryn Prime Blueprint", which exists, is another item, and matches almost perfectly.
 *
 * Compared by SIMILARITY against the candidate's TAIL, not by exact suffix: a real read brings clipping AND
 * glyph confusion at once ("A55IS"). The similarity function is the matcher's, injected, so typical OCR
 * confusions (S/5, I/1, O/0) cost the same here as there. The vocabulary comes from the live catalog
 * downloaded with the relics, so any new item gets in by itself.
 */

export const MIN_CLIPPED_LEN = 5;
export const MAX_CLIPPED_CHARS = 2;
// high because only the tail is compared: 5 of 5 letters is easy to hit by chance among thousands of tokens,
// and a wrong recovery adds a ghost anchor
export const MIN_TAIL_SCORE = 0.9;
// and it must STAND OUT over the second: two similar candidates mean the tail does not identify a word, and
// picking the best by hundredths is guessing
export const MIN_LEAD = 0.08;

/**
 * @param text        word read, uppercase and without punctuation
 * @param knownTokens catalog vocabulary (array or Set)
 * @param similarity  (a, b) => 0..1, the matcher's one (aware of OCR confusions)
 * @returns the full token, or null when it cannot be told which one it was
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
    // only at the front and only a few: more than two letters is not a clip, it is another word
    if (comidas <= 0 || comidas > MAX_CLIPPED_CHARS) continue;

    // the candidate's tail, as long as what was read: the comparison measures only what the OCR DID see, with no
    // penalty for the letters it ate
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
