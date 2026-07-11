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
            // files are ES modules loaded via <script type="module">; tells esbuild to preserve import/export
            format: "esm",
            legalComments: "none",
        });
        await writeFile(f, res.code, "utf8");
        minified++;
    }
    console.log(`[build-dist] Minificados ${minified} archivos JS, saltados ${skipped} (vendored). Salida en ${OUT}/`);
    // smoke check: dist must exist and contain index.html
    await stat(join(OUT, "index.html"));
}

main().catch((e) => { console.error("[build-dist] FALLO:", e); process.exit(1); });
