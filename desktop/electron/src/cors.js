export const HOSTS_PROPIOS = ["https://api.voidstonks.com/*", "https://*.edelamf0.workers.dev/*"];

const QUITAR = new Set(["access-control-allow-origin", "access-control-allow-credentials"]);

export function conCorsDeLaApp(cabeceras, origen) {
  const out = {};
  for (const [clave, valor] of Object.entries(cabeceras || {})) {
    if (!QUITAR.has(clave.toLowerCase())) out[clave] = valor;
  }
  out["Access-Control-Allow-Origin"] = [origen];
  return out;
}

export function conOrigenLocalParaWfm(url, cabeceras, origenApp) {
  let tipo = "";
  try { tipo = new URL(url).searchParams.get("type") || ""; } catch { return cabeceras; }
  const actual = Object.entries(cabeceras || {}).find(([clave]) => clave.toLowerCase() === "origin")?.[1];
  if (!tipo.startsWith("wfm_") || actual !== origenApp) return cabeceras;
  const out = {};
  for (const [clave, valor] of Object.entries(cabeceras)) if (clave.toLowerCase() !== "origin") out[clave] = valor;
  out.Origin = `http://localhost:${new URL(origenApp).port}`;
  return out;
}
