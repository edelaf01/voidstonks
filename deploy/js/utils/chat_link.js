/**
 * Item name as the in game chat links it. The app's names are those of the drop tables and warframe.market
 * ("Zephyr Prime Systems Blueprint"), and THOSE do not turn into a link when pasted in chat: the game links
 * the buildable part ("Zephyr Prime Systems").
 *
 * Two different shapes, which is why dropping the suffix is not enough:
 *   - Component part      → `[Zephyr Prime Systems]`, with no "Blueprint" at all.
 *   - Whole set blueprint → `[Hydroid Prime] Blueprint`: the bare name is what links and the word
 *     "Blueprint" stays outside the bracket.
 */

// components that carry " Blueprint" in the drop tables and not in chat: the parts built before the set
// (from cleaned_entities.json)
const COMPONENTES = new Set([
  "Neuroptics", "Chassis", "Systems", "Harness", "Wings", "Carapace", "Cerebrum",
]);

/**
 * @param {string} name drop table / warframe.market name
 * @returns {string} the piece ready to paste, brackets included
 */
export function chatLink(name) {
  const limpio = String(name || "").trim();
  if (!limpio) return "";
  if (!limpio.endsWith(" Blueprint")) return `[${limpio}]`;

  const base = limpio.slice(0, -" Blueprint".length).trim();
  const ultima = base.split(/\s+/).pop();
  return COMPONENTES.has(ultima) ? `[${base}]` : `[${base}] Blueprint`;
}

/**
 * Squad slot of the recruiting message. In game chat "3/4" is how many you already are, not how many are
 * missing: the app counter asks for the missing ones, so "1 missing" is "3/4".
 */
export function squadTag(faltan) {
  const n = Math.max(1, Math.min(3, Math.round(Number(faltan)) || 1));
  return `${4 - n}/4`;
}

/** One auto-copy line: the link plus the price, when known. */
export function chatLine(name, platinum = 0) {
  const link = chatLink(name);
  return platinum > 0 ? `${link} ${platinum} :platinum:` : link;
}
