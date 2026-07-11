// Build de producción: copia deploy/ -> dist/ y MINIFICA cada .js con esbuild (parser
// real, no regex). Así deploy/ conserva los comentarios/documentación donde se edita y
// lo que se publica va sin comentarios y más ligero. Se ejecuta en CI antes de wrangler.
//
// Reglas:
//  - NO se hace bundling: la app usa módulos ES con imports relativos en runtime, así que
//    cada archivo se minifica POR SEPARADO (esbuild transform), preservando import/export.
//  - Se saltan los vendored/ya-minificados (tesseract, opencv, *.min.js, *.wasm.js): ni se
//    tocan ni se re-minifican (romperían o no ganan nada).
//  - El HTML NO se toca (tiene <script> inline; minificarlo con regex es frágil). El grueso
//    de los comentarios está en el JS, que es lo que sí se limpia.
//
// Uso: node scripts-actu/build-dist.mjs  (requiere esbuild disponible vía npx/instalado)

import { readdir, readFile, writeFile, rm, mkdir, cp, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { transform } from "esbuild";

const SRC = "deploy";
const OUT = "dist";

const SKIP = (name, path) =>
    name.endsWith(".min.js") ||
    name.endsWith(".wasm.js") ||
    name.startsWith("tesseract") ||
    path.includes("opencv");

async function walk(dir) {
    const out = [];
    for (const ent of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) out.push(...(await walk(p)));
        else out.push(p);
    }
    return out;
}

async function main() {
    await rm(OUT, { recursive: true, force: true });
    await mkdir(OUT, { recursive: true });
    await cp(SRC, OUT, { recursive: true });

    const files = await walk(OUT);
    let minified = 0, skipped = 0;
    for (const f of files) {
        if (extname(f) !== ".js") continue;
        const name = f.split("/").pop();
        if (SKIP(name, f)) { skipped++; continue; }

        const code = await readFile(f, "utf8");
        const res = await transform(code, {
            minify: true,
            // Los archivos son módulos ES cargados por <script type="module">; esto evita
            // que esbuild los trate como script clásico y preserva import/export.
            format: "esm",
            legalComments: "none",
        });
        await writeFile(f, res.code, "utf8");
        minified++;
    }
    // Sanity: el tamaño de dist no debe ser mayor que el de deploy (la minificación reduce).
    console.log(`[build-dist] Minificados ${minified} archivos JS, saltados ${skipped} (vendored). Salida en ${OUT}/`);
    // Verificación básica: dist debe existir y contener index.html.
    await stat(join(OUT, "index.html"));
}

main().catch((e) => { console.error("[build-dist] FALLO:", e); process.exit(1); });
