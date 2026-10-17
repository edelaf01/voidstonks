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
