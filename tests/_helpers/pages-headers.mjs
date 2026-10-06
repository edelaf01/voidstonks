export function reglasDeCabeceras(texto) {
  const reglas = [];
  for (const linea of texto.split("\n")) {
    if (!linea.trim() || linea.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(linea)) reglas.push({ patron: linea.trim(), cabeceras: [] });
    else reglas.at(-1)?.cabeceras.push(linea.trim());
  }
  return reglas;
}

const comoRegex = (patron) => new RegExp(`^${patron.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`);

export function cacheControl(reglas, ruta) {
  return reglas
    .filter(({ patron }) => comoRegex(patron).test(ruta))
    .flatMap(({ cabeceras }) => cabeceras.filter((c) => /^cache-control:/i.test(c)).map((c) => c.slice(c.indexOf(":") + 1).trim()))
    .join(", ");
}
