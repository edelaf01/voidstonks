/**
 * Servidor estático de `deploy/` para probar en el navegador.
 *
 * Existe porque la app se sirve como módulos ES: abrir index.html con file:// hace que el
 * navegador bloquee todos los `import` por CORS. Sirve desde localhost, que además es el
 * único host donde config.js acepta el desvío `vs_worker_url` a un `wrangler dev`.
 *
 *     npm run dev:worker    # en una terminal
 *     npm run dev:site      # en otra
 *     # en la consola del navegador:
 *     localStorage.setItem("vs_worker_url", "http://127.0.0.1:8787/"); location.reload();
 */
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../deploy/", import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".traineddata": "application/octet-stream",
};

createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  // normalize() colapsa los "..": sin esto un GET /../../etc/passwd saldría de deploy/.
  const target = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!target.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  let file = target;
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
  } catch {
    res.writeHead(404).end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": MIME[extname(file)] || "application/octet-stream",
    // Sin esto el navegador reutiliza el JS viejo entre recargas mientras se itera.
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`deploy/ servido en http://127.0.0.1:${PORT}`);
});
