// turns drop table and market item names into in-game chat links

const COMPONENTES = new Set([
  "Neuroptics", "Chassis", "Systems", "Harness", "Wings", "Carapace", "Cerebrum",
]);

export function chatLink(name) {
  const limpio = String(name || "").trim();
  if (!limpio) return "";
  if (!limpio.endsWith(" Blueprint")) return `[${limpio}]`;

  const base = limpio.slice(0, -" Blueprint".length).trim();
  const ultima = base.split(/\s+/).pop();
  return COMPONENTES.has(ultima) ? `[${base}]` : `[${base}] Blueprint`;
}

export function chatLine(name, platinum = 0) {
  const link = chatLink(name);
  return platinum > 0 ? `${link} ${platinum} :platinum:` : link;
}
