import { readdir, readFile, writeFile, rm, mkdir, cp, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { transform } from "esbuild";

const SRC = "deploy";
const OUT = "dist";

// wrangler pages deploy does not respect .assetsignore
const NO_PUBLICAR = (ruta) => {
    const nombre = ruta.split("/").pop();
    return nombre.endsWith(".md")
        || nombre === ".assetsignore"
        || nombre.endsWith(".pem")
        || nombre.endsWith(".crt")
        || nombre.endsWith(".bak")
        || ruta.includes("/.wrangler");
};

const SKIP = (name, path) =>
    name.endsWith(".min.js") ||
    name.endsWith(".wasm.js") ||
    name.startsWith("tesseract") ||
    path.includes("opencv");

const BUILD_ID = (process.env.GITHUB_SHA || "").slice(0, 8) || `dev${Date.now().toString(36)}`;

function stampVersions(code) {
    return code
        .replace(/(["'])([^"']+\.(?:js|css))\?v=[^"']*\1/g, `$1$2?v=${BUILD_ID}$1`)
        .replace(/(from\s*|import\s*)(["'])(\.{1,2}\/[^"']+\.js)\2/g,
            `$1$2$3?v=${BUILD_ID}$2`)
        .replace(/(import\s*\(\s*)(["'])(\.{1,2}\/[^"']+\.js)\2/g,
            `$1$2$3?v=${BUILD_ID}$2`)
        .replace(/((?:src|href)=)(["'])((?!https?:|\/\/)[^"']+\.(?:js|css))\2/g,
            `$1$2$3?v=${BUILD_ID}$2`);
}

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
    await cp(SRC, OUT, {
        recursive: true,
        filter: (origen) => !NO_PUBLICAR(origen),
    });

    const files = await walk(OUT);
    let minified = 0, skipped = 0, stamped = 0;
    for (const f of files) {
        if (extname(f) !== ".js") continue;
        const name = f.split("/").pop();
        if (SKIP(name, f)) { skipped++; continue; }

        const code = await readFile(f, "utf8");
        const res = await transform(code, {
            minify: true,
            format: "esm",
            legalComments: "none",
        });
        await writeFile(f, stampVersions(res.code), "utf8");
        minified++;
        stamped++;
    }

    for (const f of files) {
        if (extname(f) !== ".html") continue;
        await writeFile(f, stampVersions(await readFile(f, "utf8")), "utf8");
        stamped++;
    }

    console.log(`[build-dist] Minificados ${minified} JS, saltados ${skipped} (vendored).`);
    console.log(`[build-dist] Sello de versión ?v=${BUILD_ID} en ${stamped} archivos. Salida en ${OUT}/`);

    await stat(join(OUT, "index.html"));

    const html = await readFile(join(OUT, "index.html"), "utf8");
    if (!html.includes(`?v=${BUILD_ID}`)) {
        throw new Error("index.html quedó sin sello de versión: revisa stampVersions()");
    }
}

main().catch((e) => { console.error("[build-dist] FALLO:", e); process.exit(1); });
