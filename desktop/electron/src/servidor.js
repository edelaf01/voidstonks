import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export const HOST = "voidstonks.localhost";
export const PRIMER_PUERTO = 47823;
export const ULTIMO_PUERTO = 47830;
export const PREFIJO_OVERLAY = "/__voidstonks/overlay/";
const AISLAMIENTO = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export function tipoDe(fichero) {
  return TIPOS[path.extname(fichero).toLowerCase()] || "application/octet-stream";
}

export function resuelveFichero(raiz, rutaUrl, { stat = fs.statSync } = {}) {
  let limpia;
  try { limpia = decodeURIComponent(rutaUrl); } catch { return null; }
  if (limpia.includes("\0")) return null;
  const relativa = path.posix.normalize("/" + limpia).replace(/^\/+/, "") || "index.html";
  const base = path.resolve(raiz);
  for (const cand of [relativa, `${relativa}/index.html`, `${relativa}.html`]) {
    const abs = path.resolve(base, cand);
    if (abs !== base && !abs.startsWith(base + path.sep)) return null;
    try {
      if (stat(abs).isFile()) return abs;
    } catch { /* sigue */ }
  }
  return null;
}

export function creaManejador({ raizApp, raizOverlay, puerto }) {
  const hostValido = `${HOST}:${puerto}`;
  return (req, res) => {
    if (req.headers.host !== hostValido) {
      res.writeHead(421).end("host no permitido");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const ruta = new URL(req.url, `http://${hostValido}`).pathname;
    const fichero = ruta.startsWith(PREFIJO_OVERLAY)
      ? resuelveFichero(raizOverlay, ruta.slice(PREFIJO_OVERLAY.length))
      : resuelveFichero(raizApp, ruta);
    if (!fichero) {
      res.writeHead(404).end();
      return;
    }
    let info;
    try { info = fs.statSync(fichero); } catch { res.writeHead(404).end(); return; }
    const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const cabeceras = { "Content-Type": tipoDe(fichero), "Cache-Control": "no-cache", ETag: etag, ...AISLAMIENTO };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, cabeceras).end();
      return;
    }
    res.writeHead(200, { ...cabeceras, "Content-Length": info.size });
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(fichero).on("error", () => res.destroy()).pipe(res);
  };
}

function escucha(servidor, puerto, host) {
  return new Promise((resolve) => {
    const fallo = () => resolve(false);
    servidor.once("error", fallo);
    servidor.listen(puerto, host, () => {
      servidor.off("error", fallo);
      resolve(true);
    });
  });
}

export async function arrancaServidor({ raizApp, raizOverlay, desde = PRIMER_PUERTO, hasta = ULTIMO_PUERTO }) {
  for (let puerto = desde; puerto <= hasta; puerto++) {
    const manejador = creaManejador({ raizApp, raizOverlay, puerto });
    const v4 = http.createServer(manejador);
    if (!(await escucha(v4, puerto, "127.0.0.1"))) continue;
    const v6 = http.createServer(manejador);
    const conV6 = await escucha(v6, puerto, "::1");
    return {
      puerto,
      origen: `http://${HOST}:${puerto}`,
      cerrar() {
        v4.close();
        if (conV6) v6.close();
      },
    };
  }
  throw new Error(`Los puertos ${desde}-${hasta} están ocupados.`);
}
