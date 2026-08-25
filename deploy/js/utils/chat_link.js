/**
 * Nombre de un ítem tal y como lo enlaza el chat del juego.
 *
 * Los nombres que maneja la app son los de las tablas de drop y warframe.market ("Zephyr Prime
 * Systems Blueprint"), y ESOS no se convierten en link al pegarlos en el chat: el juego enlaza
 * la pieza construible ("Zephyr Prime Systems"). El auto-copy pegaba el nombre crudo, así que
 * media línea salía en texto plano y había que reescribirla a mano.
 *
 * Dos formas distintas, y por eso no vale con quitar el sufijo:
 *   - Pieza de componente  → `[Zephyr Prime Systems]`, sin "Blueprint" ninguno.
 *   - Plano del set entero → `[Hydroid Prime] Blueprint`: lo que enlaza es el nombre a secas y
 *     la palabra "Blueprint" se queda fuera del corchete.
 */

// Componentes que en las tablas de drop llevan " Blueprint" detrás y en el chat no. Salen del
// manifiesto (cleaned_entities.json): son las piezas que se construyen antes que el set.
const COMPONENTES = new Set([
  "Neuroptics", "Chassis", "Systems", "Harness", "Wings", "Carapace", "Cerebrum",
]);

/**
 * @param {string} name nombre de la tabla de drop / warframe.market
 * @returns {string} el trozo ya listo para pegar, corchetes incluidos
 */
export function chatLink(name) {
  const limpio = String(name || "").trim();
  if (!limpio) return "";
  if (!limpio.endsWith(" Blueprint")) return `[${limpio}]`;

  const base = limpio.slice(0, -" Blueprint".length).trim();
  const ultima = base.split(/\s+/).pop();
  return COMPONENTES.has(ultima) ? `[${base}]` : `[${base}] Blueprint`;
}

/** Una línea de auto-copy: el link más el precio, si se sabe. */
export function chatLine(name, platinum = 0) {
  const link = chatLink(name);
  return platinum > 0 ? `${link} ${platinum} :platinum:` : link;
}
