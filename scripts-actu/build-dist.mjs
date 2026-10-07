// Build de producción: copia deploy/ -> dist/ y MINIFICA cada .js con esbuild (parser
// real, no regex). Así deploy/ conserva los comentarios/documentación donde se edita y
// lo que se publica va sin comentarios y más ligero. Se ejecuta en CI antes de wrangler.
//
// Reglas:
//  - NO se hace bundling: la app usa módulos ES con imports relativos en runtime, así que
//    cada archivo se minifica POR SEPARADO (esbuild transform), preservando import/export.
//  - Se saltan los vendored/ya-minificados (tesseract, opencv, *.min.js, *.wasm.js): ni se
//    tocan ni se re-minifican (romperían o no ganan nada).
//  - HTML is not minified (inline <script>, regex minifying is fragile); it only gets stamped.
//  - Every local .js/.css URL gets ?v=<hash of that file's final content>, so a deploy only
//    changes the URLs of files that really changed. The hash covers the stamps the file
//    carries, so a change in a module also renames every importer up to the HTML.
//
// Uso: node scripts-actu/build-dist.mjs  (requiere esbuild disponible vía npx/instalado)

import { readdir, readFile, writeFile, rm, mkdir, cp, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, extname, relative, sep, posix } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";

const SRC = "deploy";
const OUT = "dist";

/**
 * Lo que NO se copia a dist/, y por tanto no se publica.
 *
 * `deploy/` es a la vez fuente y carpeta publicada, así que cualquier documentación que caiga
 * ahí acaba servida en voidstonks.com: los dos .md que había respondían 200 con `text/markdown`,
 * y el propio `.assetsignore` publicaba la lista de lo que se pretendía esconder. Ese fichero no
 * vale aquí: lo entiende Workers Assets, no `wrangler pages deploy`, que es lo que usa el
 * workflow. Los .md ya viven fuera de deploy/, pero el filtro se queda: es la red que evita que
 * el siguiente que caiga ahí se publique sin que nadie se entere.
 */
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

const LITERAL = /(["'])((?:\.{1,2}\/|js\/|css\/)[^"'?\s]+\.(?:js|css))(\?v=[^"']*)?\1/dg;
const ATTR = /\b(?:src|href)\s*=\s*(["'])([^"']*)\1/dg;
const ATTR_VALUE = /^([^?#]+\.(?:js|css))(\?v=.*)?$/;
const EXTERNAL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

const shortHash = (data) => createHash("sha256").update(data).digest("hex").slice(0, 10);

function resolveRef(from, base, html) {
    let path;
    if (base.startsWith("/")) path = base.slice(1);
    else if (html || /^\.{1,2}\//.test(base)) path = posix.join(posix.dirname(from), base);
    else path = base;
    path = posix.normalize(path);
    return path === ".." || path.startsWith("../") ? null : path;
}

function findRefs(from, content) {
    const html = from.endsWith(".html");
    const found = [];
    const add = (start, end, base) =>
        found.push({ start, end, value: content.slice(start, end), base, target: resolveRef(from, base, html) });

    for (const m of content.matchAll(LITERAL)) {
        add(m.indices[2][0], (m.indices[3] ?? m.indices[2])[1], m[2]);
    }
    if (html) {
        for (const m of content.matchAll(ATTR)) {
            const local = !EXTERNAL.test(m[2]) && ATTR_VALUE.exec(m[2]);
            if (local) add(m.indices[2][0], m.indices[2][1], local[1]);
        }
    }

    found.sort((a, b) => a.start - b.start || b.end - a.end);
    const refs = [];
    for (const ref of found) {
        if (refs.length && ref.start < refs[refs.length - 1].end) continue;
        refs.push(ref);
    }
    return refs;
}

function render(content, refs, valueOf) {
    let out = "";
    let at = 0;
    for (const ref of refs) {
        out += content.slice(at, ref.start) + valueOf(ref);
        at = ref.end;
    }
    return out + content.slice(at);
}

function stronglyConnected(nodes, edgesOf) {
    let counter = 0;
    const index = new Map();
    const low = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];

    const visit = (node) => {
        index.set(node, counter);
        low.set(node, counter);
        counter++;
        stack.push(node);
        onStack.add(node);
        for (const next of edgesOf(node)) {
            if (!index.has(next)) {
                visit(next);
                low.set(node, Math.min(low.get(node), low.get(next)));
            } else if (onStack.has(next)) {
                low.set(node, Math.min(low.get(node), index.get(next)));
            }
        }
        if (low.get(node) !== index.get(node)) return;
        const component = [];
        let member;
        do {
            member = stack.pop();
            onStack.delete(member);
            component.push(member);
        } while (member !== node);
        components.push(component.sort());
    };

    for (const node of nodes) if (!index.has(node)) visit(node);
    return components;
}

// Import cycles have no order to hash in: each cycle shares one hash, taken with its inner refs unstamped.
export function stampContentHashes(files, vendored = new Set()) {
    const refsOf = new Map();
    const unresolved = [];
    for (const [path, content] of files) {
        if (vendored.has(path) || !/\.(?:js|html)$/.test(path)) continue;
        const refs = [];
        for (const ref of findRefs(path, content)) {
            if (ref.target && files.has(ref.target)) refs.push(ref);
            else unresolved.push({ from: path, ref: ref.value });
        }
        refsOf.set(path, refs);
    }

    const nodes = [...files.keys()].sort();
    const edgesOf = (path) => [...new Set((refsOf.get(path) ?? []).map((ref) => ref.target))].sort();
    const hashes = new Map();
    const output = new Map();
    let rewritten = 0;

    for (const component of stronglyConnected(nodes, edgesOf)) {
        if (!refsOf.has(component[0])) {
            hashes.set(component[0], shortHash(files.get(component[0])));
            continue;
        }
        const members = new Set(component);
        const draft = component.map((path) => render(files.get(path), refsOf.get(path), (ref) =>
            members.has(ref.target) ? ref.base : `${ref.base}?v=${hashes.get(ref.target)}`));
        const cyclic = component.length > 1 || edgesOf(component[0]).includes(component[0]);
        const hash = cyclic
            ? shortHash(component.map((path, i) => `${path}\0${draft[i]}\0`).join(""))
            : shortHash(draft[0]);

        for (const path of component) {
            hashes.set(path, hash);
            const refs = refsOf.get(path);
            output.set(path, render(files.get(path), refs, (ref) =>
                `${ref.base}?v=${members.has(ref.target) ? hash : hashes.get(ref.target)}`));
            rewritten += refs.length;
        }
    }

    const referenced = new Set([...refsOf.values()].flat().map((ref) => ref.target));
    const unreferenced = nodes.filter((path) =>
        /\.(?:js|css)$/.test(path) && !vendored.has(path) && !referenced.has(path));

    return { files: output, hashes, rewritten, unresolved, unreferenced };
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
        // El filtro se aplica también a los directorios: devolver false en uno se lleva todo
        // lo que cuelga (ver .wrangler).
        filter: (origen) => !NO_PUBLICAR(origen),
    });

    const files = new Map();
    const vendored = new Set();
    let minified = 0;
    for (const f of (await walk(OUT)).sort()) {
        const rel = relative(OUT, f).split(sep).join("/");
        const ext = extname(f);
        if (ext === ".css") files.set(rel, await readFile(f));
        else if (ext === ".html") files.set(rel, await readFile(f, "utf8"));
        if (ext !== ".js") continue;
        if (SKIP(f.split("/").pop(), f)) {
            vendored.add(rel);
            files.set(rel, await readFile(f));
            continue;
        }

        const res = await transform(await readFile(f, "utf8"), {
            minify: true,
            // Los archivos son módulos ES cargados por <script type="module">; esto evita
            // que esbuild los trate como script clásico y preserva import/export.
            format: "esm",
            legalComments: "none",
        });
        files.set(rel, res.code);
        minified++;
    }

    const { files: stamped, hashes, rewritten, unresolved, unreferenced } = stampContentHashes(files, vendored);
    for (const [rel, content] of stamped) await writeFile(join(OUT, rel), content, "utf8");

    console.log(`[build-dist] Minificados ${minified} JS, saltados ${vendored.size} (vendored).`);
    console.log(`[build-dist] ${hashes.size} ficheros con hash, ${rewritten} referencias selladas. Salida en ${OUT}/`);
    if (unresolved.length) {
        console.warn(`[build-dist] AVISO: ${unresolved.length} referencias sin fichero en ${OUT}/ (se dejan como están):`);
        for (const { from, ref } of unresolved) console.warn(`  ${from}: ${ref}`);
    }
    if (unreferenced.length) {
        console.log(`[build-dist] ${unreferenced.length} .js/.css sin ninguna URL sellada que los nombre:`);
        for (const path of unreferenced) console.log(`  ${path}`);
    }

    // Verificación básica: dist debe existir y contener index.html.
    await stat(join(OUT, "index.html"));

    // Guarda: si el HTML publicado se quedara sin sellar, los usuarios volverían a arrastrar
    // módulos viejos y el síntoma sería difícil de atribuir. Mejor romper el deploy aquí.
    const html = await readFile(join(OUT, "index.html"), "utf8");
    if (!/["'](?:\.\/)?js\/main\.js\?v=[\da-f]{10}["']/.test(html)) {
        throw new Error("index.html no apunta a js/main.js?v=<hash>: revisa stampContentHashes()");
    }
}

// realpath: /home is a symlink on Fedora Atomic, and node reports the real path in import.meta.url.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    main().catch((e) => { console.error("[build-dist] FALLO:", e); process.exit(1); });
}
