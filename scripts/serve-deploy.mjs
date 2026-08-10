/**
 * static server for `deploy/` to test in the browser: the app is ES modules, and opening index.html over
 * file:// makes the browser block every import by CORS
 * it serves from localhost, the only host where config.js accepts the `vs_worker_url` override to a
 * `wrangler dev`
 * usage: npm run dev:worker in one terminal, npm run dev:site in another, then in the browser console:
 * localStorage.setItem("vs_worker_url", "http://127.0.0.1:8787/"); location.reload();
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
  // normalize() collapses ".." to prevent path traversal outside `deploy/` (GET /../../etc/passwd)
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
    // prevents browser from reusing stale JS across reloads while iterating
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`deploy/ servido en http://127.0.0.1:${PORT}`);
});
